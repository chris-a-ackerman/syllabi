import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthProvider';
import { useData } from '../context/DataProvider';
import { courseColorAt } from '@/lib/courseColors';
import {
  detectSyllabiInfo,
  markSyllabusFailed,
  reprocessSyllabus,
  uploadAndProcess,
  uploadTempSyllabus,
} from '@/lib/api/syllabus';
import { isClaudeKeyRejected, toastClaudeKeyRejected } from '@/lib/claudeKeyRejection';

export type BulkUploadStep = 'upload' | 'detecting' | 'review' | 'processing';

export interface FileItem {
  id: string;
  file: File;
}

export interface DetectedCourse {
  id: string;
  fileItem: FileItem;
  tempFilePath: string;
  courseName: string;
  courseCode: string;
  semesterName: string;
  semesterStart: string;
  semesterEnd: string;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

interface BulkUploadOptions {
  /**
   * When provided, every course is created in this semester and no semesters
   * are created from the detected names (the add-to-existing-semester flow).
   * An empty string means "no semester available" and confirm() is a no-op.
   */
  fixedSemesterId?: string;
}

export function useBulkUpload({ fixedSemesterId }: BulkUploadOptions = {}) {
  const { user } = useAuth();
  const { courses, addSemester, addCourse, updateCourse } = useData();
  const [step, setStep] = useState<BulkUploadStep>('upload');
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [detectedCourses, setDetectedCourses] = useState<DetectedCourse[]>([]);
  const [createdCourseIds, setCreatedCourseIds] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Files whose Storage upload failed, by course id — Retry re-uploads these
  // instead of re-invoking process-syllabus against a row with no file.
  const pendingUploads = useRef(new Map<string, File>());

  /**
   * Every created course has settled — complete or failed (SYL-66) — so the
   * processing poll can stop and the Done/auto-close state is reachable. A
   * course that has disappeared from state (deleted elsewhere) counts as
   * settled: nothing can change it any more.
   */
  const allDone =
    createdCourseIds.length > 0 &&
    createdCourseIds.every((id) => {
      const course = courses.find((c) => c.id === id);
      return !course || course.status === 'ready' || course.status === 'failed';
    });

  // Marks the course failed locally (card) and on the row (poll) with the same
  // message, so the two never disagree about a course that never got a file.
  const markFailed = useCallback(
    async (courseId: string, message: string) => {
      updateCourse(courseId, { status: 'failed', analysisError: message });
      const { error } = await markSyllabusFailed(courseId, message);
      if (error) console.error('Error recording syllabus failure:', error);
    },
    [updateCourse]
  );

  // Runs upload + process for one course and applies the outcome to state.
  const uploadForCourse = useCallback(
    async (courseId: string, file: File) => {
      if (!user) return;
      const { data, error } = await uploadAndProcess(user.id, courseId, file);
      if (!error) {
        pendingUploads.current.delete(courseId);
        return;
      }
      // data.path is null only when the file never reached Storage.
      if (data.path === null) pendingUploads.current.set(courseId, file);
      await markFailed(courseId, error.message);
    },
    [user, markFailed]
  );

  const addFiles = useCallback((files: File[]) => {
    const MAX_SIZE = 50 * 1024 * 1024;
    setFileItems((prev) => [
      ...prev,
      ...files
        .filter((f) => f.size <= MAX_SIZE)
        .map((file) => ({ id: `${Date.now()}-${Math.random()}`, file })),
    ]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFileItems((prev) => prev.filter((fi) => fi.id !== id));
  }, []);

  const reset = useCallback(() => {
    setStep('upload');
    setFileItems([]);
    setDetectedCourses([]);
    setCreatedCourseIds([]);
    setGlobalError(null);
    pendingUploads.current.clear();
  }, []);

  const analyze = useCallback(async () => {
    if (!user || fileItems.length === 0) return;
    setGlobalError(null);
    setStep('detecting');

    // 1. Upload each file to temp storage in parallel
    const timestamp = Date.now();
    const uploadResults = await Promise.all(
      fileItems.map(async (fileItem) => {
        const { data, error } = await uploadTempSyllabus(user.id, timestamp, fileItem.file);
        return { fileItem, tempFilePath: data.path, uploadError: error?.message };
      })
    );

    // 2. Call detect-syllabi-info with all successfully uploaded paths
    const successPaths = uploadResults.filter((r) => !r.uploadError).map((r) => r.tempFilePath);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detectResults: any[] = [];
    if (successPaths.length > 0) {
      const { data, error: fnError } = await detectSyllabiInfo(successPaths);
      if (fnError || !data?.results) {
        if (fnError && (await isClaudeKeyRejected(fnError))) {
          toastClaudeKeyRejected();
          setGlobalError('Your Claude API key was rejected. Update it in Settings.');
        } else {
          setGlobalError('Failed to analyze syllabi. Please try again.');
        }
        setStep('upload');
        return;
      }
      detectResults = data.results;
    }

    // 3. Map detection results back to file items
    const mapped: DetectedCourse[] = uploadResults.map((ur) => {
      if (ur.uploadError) {
        return {
          id: ur.fileItem.id,
          fileItem: ur.fileItem,
          tempFilePath: ur.tempFilePath,
          courseName: '',
          courseCode: '',
          semesterName: '',
          semesterStart: '',
          semesterEnd: '',
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
        semesterName: result?.semester_name ?? '',
        semesterStart: result?.semester_start ?? '',
        semesterEnd: result?.semester_end ?? '',
        confidence: (result?.confidence ?? 'low') as 'high' | 'medium' | 'low',
        error: result?.error,
      };
    });

    setDetectedCourses(mapped);
    setStep('review');
  }, [user, fileItems]);

  const updateDetectedCourse = useCallback(
    (
      id: string,
      updates: Partial<
        Pick<
          DetectedCourse,
          'courseName' | 'courseCode' | 'semesterName' | 'semesterStart' | 'semesterEnd'
        >
      >
    ) => {
      setDetectedCourses((prev) => prev.map((dc) => (dc.id === id ? { ...dc, ...updates } : dc)));
    },
    []
  );

  const confirm = useCallback(async () => {
    if (!user) return;
    setGlobalError(null);
    setStep('processing');

    // 1. Create each unique semester (handle duplicates via conflict resolution
    //    in addSemester) — skipped entirely when the caller fixed the semester.
    const semesterMap = new Map<string, string>(); // semesterName → semesterId
    if (fixedSemesterId === undefined) {
      const uniqueSemesterNames = [
        ...new Set(detectedCourses.map((dc) => dc.semesterName.trim()).filter(Boolean)),
      ];

      for (const semName of uniqueSemesterNames) {
        const semCourses = detectedCourses.filter((d) => d.semesterName.trim() === semName);
        const validStarts = semCourses.map((d) => d.semesterStart).filter(Boolean);
        const validEnds = semCourses.map((d) => d.semesterEnd).filter(Boolean);
        const startDate =
          validStarts.length > 0
            ? validStarts.reduce((min, d) => (d < min ? d : min))
            : new Date().toISOString().split('T')[0];
        const endDate =
          validEnds.length > 0
            ? validEnds.reduce((max, d) => (d > max ? d : max))
            : new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const semId = await addSemester({
          name: semName,
          startDate,
          endDate,
          isActive: true,
        });
        if (semId) semesterMap.set(semName, semId);
      }
    }

    // 2. Create each course and upload its syllabus to the permanent path
    const createdIds: string[] = [];

    for (const dc of detectedCourses) {
      const semId =
        fixedSemesterId !== undefined ? fixedSemesterId : semesterMap.get(dc.semesterName.trim());
      if (!semId) continue;

      const color = courseColorAt(createdIds.length);
      const courseId = await addCourse({
        semesterId: semId,
        name: dc.courseName || dc.fileItem.file.name,
        code: dc.courseCode || '',
        professor: '',
        color,
        status: 'processing',
      });
      if (!courseId) continue;
      createdIds.push(courseId);
      // The insert lands at the DB default ('pending', shown as ready); the
      // card must read as processing until the poll sees the row settle.
      updateCourse(courseId, { status: 'processing' });

      await uploadForCourse(courseId, dc.fileItem.file);
    }

    setCreatedCourseIds(createdIds);
  }, [
    user,
    fixedSemesterId,
    detectedCourses,
    addSemester,
    addCourse,
    updateCourse,
    uploadForCourse,
  ]);

  /**
   * Retry for a failed course: re-uploads when the file never reached Storage,
   * otherwise re-invokes process-syllabus. Either way the card goes back to
   * processing so the poll resumes and picks up the outcome.
   */
  const retryProcessing = useCallback(
    async (courseId: string) => {
      updateCourse(courseId, { status: 'processing', analysisError: undefined });
      const file = pendingUploads.current.get(courseId);
      if (file) {
        await uploadForCourse(courseId, file);
        return;
      }
      const { error } = await reprocessSyllabus(courseId);
      if (error) updateCourse(courseId, { status: 'failed', analysisError: error.message });
    },
    [updateCourse, uploadForCourse]
  );

  return {
    step,
    fileItems,
    detectedCourses,
    createdCourseIds,
    allDone,
    globalError,
    addFiles,
    removeFile,
    reset,
    analyze,
    updateDetectedCourse,
    confirm,
    retryProcessing,
  };
}
