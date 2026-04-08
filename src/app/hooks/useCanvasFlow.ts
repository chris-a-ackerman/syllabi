import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../../lib/supabase';

export type CanvasStep = 'dates' | 'detecting' | 'review' | 'processing' | 'syllabi' | 'downloading';
export type SyllabusSearchStatus = 'searching' | 'found' | 'not_found' | 'error';
export type SyllabusDownloadStatus = 'downloading' | 'started' | 'error' | 'skipped';

export interface SyllabusFindResult {
  status: SyllabusSearchStatus;
  source_type?: 'file' | 'html' | 'page';
  file_name?: string | null;
  file_url?: string | null;
  html_content?: string | null;
  confidence?: 'high' | 'medium';
}

export interface CanvasDetectedCourse {
  canvas_course_id: string;
  name: string;
  course_code: string;
  instructor: string;
  term_name: string;
  needs_review: boolean;
  editedName: string;
  editedCode: string;
}

const COURSE_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#0ea5e9', '#64748b',
];

export function useCanvasFlow() {
  const { addSemester, addCourse } = useApp();
  const [step, setStep] = useState<CanvasStep>('dates');
  const [semesterName, setSemesterName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detectedCourses, setDetectedCourses] = useState<CanvasDetectedCourse[]>([]);
  const [createdCourseIds, setCreatedCourseIds] = useState<string[]>([]);
  const [syllabiResults, setSyllabiResults] = useState<Record<string, SyllabusFindResult>>({});
  const [downloadResults, setDownloadResults] = useState<Record<string, SyllabusDownloadStatus>>({});
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('dates');
    setSemesterName('');
    setStartDate('');
    setEndDate('');
    setDetectedCourses([]);
    setCreatedCourseIds([]);
    setSyllabiResults({});
    setDownloadResults({});
    setError(null);
  }, []);

  const detect = useCallback(async () => {
    if (!startDate || !endDate) return;
    setError(null);
    setStep('detecting');

    console.log('[useCanvasFlow] invoking find-canvas-courses', { semester_start: startDate, semester_end: endDate });
    const { data, error: fnError } = await supabase.functions.invoke(
      'find-canvas-courses',
      { body: { semester_start: startDate, semester_end: endDate } }
    );
    console.log('[useCanvasFlow] find-canvas-courses response', { data, error: fnError });

    if (fnError || !data?.courses) {
      setError('Failed to fetch Canvas courses. Please check your connection and try again.');
      setStep('dates');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const courses: CanvasDetectedCourse[] = data.courses.map((c: any) => ({
      canvas_course_id: c.canvas_course_id,
      name: c.name,
      course_code: c.course_code,
      instructor: c.instructor ?? '',
      term_name: c.term_name ?? '',
      needs_review: c.needs_review ?? false,
      editedName: c.name,
      editedCode: c.course_code ?? '',
    }));

    setDetectedCourses(courses);
    setStep('review');
  }, [startDate, endDate]);

  const updateCourse = useCallback((
    index: number,
    field: 'editedName' | 'editedCode',
    value: string,
  ) => {
    setDetectedCourses(prev =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }, []);

  const removeCourse = useCallback((index: number) => {
    setDetectedCourses(prev => prev.filter((_, i) => i !== index));
  }, []);

  const confirm = useCallback(async () => {
    setError(null);
    setStep('processing');

    const semId = await addSemester({
      name: semesterName,
      startDate,
      endDate,
      isActive: true,
    });

    if (!semId) {
      setError('Failed to create semester. Please try again.');
      setStep('review');
      return;
    }

    const createdIds: string[] = [];

    for (let i = 0; i < detectedCourses.length; i++) {
      const dc = detectedCourses[i];
      const color = COURSE_COLORS[i % COURSE_COLORS.length];
      const courseId = await addCourse({
        semesterId: semId,
        name: dc.editedName || dc.name,
        code: dc.editedCode || dc.course_code,
        professor: dc.instructor,
        color,
        status: 'ready',
      });
      if (!courseId) continue;

      createdIds.push(courseId);

      // Store canvas_course_id — not part of the Course interface so update directly
      await supabase
        .from('courses')
        .update({ canvas_course_id: dc.canvas_course_id })
        .eq('id', courseId);
    }

    setCreatedCourseIds(createdIds);
    setStep('syllabi');

    // Kick off parallel syllabus searches for all created courses
    const initialResults: Record<string, SyllabusFindResult> = {};
    createdIds.forEach(id => { initialResults[id] = { status: 'searching' }; });
    setSyllabiResults(initialResults);

    createdIds.forEach((courseId, i) => {
      const dc = detectedCourses[i];
      if (!dc) return;
      supabase.functions
        .invoke('find-canvas-syllabus', {
          body: { course_id: courseId, canvas_course_id: dc.canvas_course_id },
        })
        .then(({ data, error: fnError }) => {
          let result: SyllabusFindResult;
          if (fnError) {
            result = { status: 'error' };
          } else if (data?.success === false || !data?.found) {
            result = { status: 'not_found' };
          } else {
            result = {
              status: 'found',
              source_type: data.source_type,
              file_name: data.file_name,
              file_url: data.file_url,
              html_content: data.html_content,
              confidence: data.confidence,
            };
          }
          setSyllabiResults(prev => ({ ...prev, [courseId]: result }));
        })
        .catch(() => {
          setSyllabiResults(prev => ({ ...prev, [courseId]: { status: 'error' } }));
        });
    });
  }, [semesterName, startDate, endDate, detectedCourses, addSemester, addCourse]);

  const downloadSyllabi = useCallback(async () => {
    setStep('downloading');

    // Initialize download statuses
    const initial: Record<string, SyllabusDownloadStatus> = {};
    createdCourseIds.forEach(id => {
      initial[id] = syllabiResults[id]?.status === 'found' ? 'downloading' : 'skipped';
    });
    setDownloadResults(initial);

    // Fire download for each found course in parallel
    createdCourseIds.forEach(courseId => {
      const result = syllabiResults[courseId];
      if (result?.status !== 'found') return;

      supabase.functions
        .invoke('download-canvas-syllabus', {
          body: {
            course_id: courseId,
            source_type: result.source_type,
            file_url: result.file_url ?? undefined,
            file_name: result.file_name ?? undefined,
            html_content: result.html_content ?? undefined,
          },
        })
        .then(({ data, error: fnError }) => {
          const status: SyllabusDownloadStatus =
            fnError || !data?.success ? 'error' : 'started';
          setDownloadResults(prev => ({ ...prev, [courseId]: status }));
        })
        .catch(() => {
          setDownloadResults(prev => ({ ...prev, [courseId]: 'error' }));
        });
    });
  }, [createdCourseIds, syllabiResults]);

  return {
    step,
    semesterName,
    setSemesterName,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    detectedCourses,
    createdCourseIds,
    syllabiResults,
    downloadResults,
    error,
    reset,
    detect,
    updateCourse,
    removeCourse,
    confirm,
    downloadSyllabi,
  };
}
