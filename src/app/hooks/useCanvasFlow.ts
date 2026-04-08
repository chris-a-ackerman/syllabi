import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../../lib/supabase';

export type CanvasStep = 'dates' | 'detecting' | 'review' | 'processing' | 'syllabi';
export type SyllabusSearchStatus = 'searching' | 'found' | 'not_found' | 'error';

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
  const [syllabiResults, setSyllabiResults] = useState<Record<string, SyllabusSearchStatus>>({});
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('dates');
    setSemesterName('');
    setStartDate('');
    setEndDate('');
    setDetectedCourses([]);
    setCreatedCourseIds([]);
    setSyllabiResults({});
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

  const confirm = useCallback(async () => {
    setError(null);
    setStep('processing');
    // CHECK HERE

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
    const initialResults: Record<string, SyllabusSearchStatus> = {};
    createdIds.forEach(id => { initialResults[id] = 'searching'; });
    setSyllabiResults(initialResults);

    createdIds.forEach((courseId, i) => {
      const dc = detectedCourses[i];
      if (!dc) return;
      supabase.functions
        .invoke('find-canvas-syllabus', {
          body: { course_id: courseId, canvas_course_id: dc.canvas_course_id },
        })
        .then(({ data, error: fnError }) => {
          let status: SyllabusSearchStatus;
          if (fnError) {
            status = 'error';
          } else if (data?.success === false) {
            status = 'not_found';
          } else {
            status = 'found';
          }
          setSyllabiResults(prev => ({ ...prev, [courseId]: status }));
        })
        .catch(() => {
          setSyllabiResults(prev => ({ ...prev, [courseId]: 'error' }));
        });
    });
  }, [semesterName, startDate, endDate, detectedCourses, addSemester, addCourse]);

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
    error,
    reset,
    detect,
    updateCourse,
    confirm,
  };
}
