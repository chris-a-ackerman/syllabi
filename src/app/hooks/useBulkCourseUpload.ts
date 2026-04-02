import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../../lib/supabase';
import { FileItem, COURSE_COLORS } from './useBulkUpload';

export type BulkCourseUploadStep = 'upload' | 'detecting' | 'review' | 'processing';

export interface BulkDetectedCourse {
  id: string;
  fileItem: FileItem;
  tempFilePath: string;
  courseName: string;
  courseCode: string;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

export function useBulkCourseUpload(semesterId: string) {
  const { user, addCourse } = useApp();
  const [step, setStep] = useState<BulkCourseUploadStep>('upload');
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [detectedCourses, setDetectedCourses] = useState<BulkDetectedCourse[]>([]);
  const [createdCourseIds, setCreatedCourseIds] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const addFiles = useCallback((files: File[]) => {
    const MAX_SIZE = 50 * 1024 * 1024;
    setFileItems(prev => [
      ...prev,
      ...files
        .filter(f => f.size <= MAX_SIZE)
        .map(file => ({ id: `${Date.now()}-${Math.random()}`, file })),
    ]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFileItems(prev => prev.filter(fi => fi.id !== id));
  }, []);

  const reset = useCallback(() => {
    setStep('upload');
    setFileItems([]);
    setDetectedCourses([]);
    setCreatedCourseIds([]);
    setGlobalError(null);
  }, []);

  const analyze = useCallback(async () => {
    if (!user || fileItems.length === 0) return;
    setGlobalError(null);
    setStep('detecting');

    const timestamp = Date.now();
    const uploadResults = await Promise.all(
      fileItems.map(async (fileItem) => {
        const tempFilePath = `${user.id}/temp/${timestamp}_${fileItem.file.name}`;

        let buffer: ArrayBuffer;
        try {
          buffer = await Promise.race([
            fileItem.file.arrayBuffer(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Could not read file — make sure it is stored locally and not still syncing')), 15_000)
            ),
          ]);
        } catch (e: unknown) {
          return { fileItem, tempFilePath, uploadError: (e as Error).message };
        }

        const { error } = await supabase.storage
          .from('syllabi')
          .upload(tempFilePath, buffer, { upsert: true, contentType: 'application/pdf' });

        return { fileItem, tempFilePath, uploadError: error?.message };
      })
    );

    const successPaths = uploadResults
      .filter(r => !r.uploadError)
      .map(r => r.tempFilePath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detectResults: any[] = [];
    if (successPaths.length > 0) {
      const { data, error: fnError } = await supabase.functions.invoke('detect-syllabi-info', {
        body: { file_paths: successPaths },
      });
      if (fnError || !data?.results) {
        setGlobalError('Failed to analyze syllabi. Please try again.');
        setStep('upload');
        return;
      }
      detectResults = data.results;
    }

    const mapped: BulkDetectedCourse[] = uploadResults.map((ur) => {
      if (ur.uploadError) {
        return {
          id: ur.fileItem.id,
          fileItem: ur.fileItem,
          tempFilePath: ur.tempFilePath,
          courseName: '',
          courseCode: '',
          confidence: 'low' as const,
          error: ur.uploadError,
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = detectResults.find((r: any) => r.file_path === ur.tempFilePath);
      return {
        id: ur.fileItem.id,
        fileItem: ur.fileItem,
        tempFilePath: ur.tempFilePath,
        courseName: result?.course_name ?? '',
        courseCode: result?.course_code ?? '',
        confidence: (result?.confidence ?? 'low') as 'high' | 'medium' | 'low',
        error: result?.error,
      };
    });

    setDetectedCourses(mapped);
    setStep('review');
  }, [user, fileItems]);

  const updateDetectedCourse = useCallback((
    id: string,
    updates: Partial<Pick<BulkDetectedCourse, 'courseName' | 'courseCode'>>
  ) => {
    setDetectedCourses(prev => prev.map(dc => dc.id === id ? { ...dc, ...updates } : dc));
  }, []);

  const confirm = useCallback(async () => {
    if (!user || !semesterId) return;
    setGlobalError(null);
    setStep('processing');

    const createdIds: string[] = [];

    for (const dc of detectedCourses) {
      const color = COURSE_COLORS[createdIds.length % COURSE_COLORS.length];
      const courseId = await addCourse({
        semesterId,
        name: dc.courseName || dc.fileItem.file.name,
        code: dc.courseCode || '',
        professor: '',
        color,
        status: 'processing',
      });
      if (!courseId) continue;
      createdIds.push(courseId);

      const finalPath = `${user.id}/${courseId}/${dc.fileItem.file.name}`;
      let finalBuffer: ArrayBuffer;
      try {
        finalBuffer = await dc.fileItem.file.arrayBuffer();
      } catch {
        continue;
      }
      const { error: uploadError } = await supabase.storage
        .from('syllabi')
        .upload(finalPath, finalBuffer, { upsert: true, contentType: 'application/pdf' });

      if (!uploadError) {
        await supabase
          .from('courses')
          .update({ syllabus_file_path: finalPath })
          .eq('id', courseId);

        // Fire process-syllabus — do not await
        supabase.functions.invoke('process-syllabus', { body: { course_id: courseId } });
      }
    }

    setCreatedCourseIds(createdIds);
  }, [user, semesterId, detectedCourses, addCourse]);

  return {
    step,
    fileItems,
    detectedCourses,
    createdCourseIds,
    globalError,
    addFiles,
    removeFile,
    reset,
    analyze,
    updateDetectedCourse,
    confirm,
  };
}
