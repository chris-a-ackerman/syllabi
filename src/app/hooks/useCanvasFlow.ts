import { useState, useCallback, useMemo } from 'react';
import { useData } from '../context/DataProvider';
import * as canvasApi from '@/lib/api/canvas';
import { COURSE_COLORS } from '@/lib/courseColors';
import type { CanvasSyllabusSourceType } from '@/lib/types';

export type CanvasStep = 'dates' | 'detecting' | 'review' | 'processing' | 'syllabi' | 'downloading';
export type SyllabusSearchStatus = 'searching' | 'found' | 'not_found' | 'error';
export type SyllabusDownloadStatus = 'downloading' | 'started' | 'error' | 'skipped';

export interface SyllabusFindResult {
  status: SyllabusSearchStatus;
  source_type?: CanvasSyllabusSourceType;
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
  /** Whether this detected course is created on Confirm & Create (SYL-71). Defaults to true. */
  selected: boolean;
}

/**
 * Pairs a created course to the detected Canvas course it came from, keyed by
 * canvas_course_id rather than array index (SYL-71) — index pairing broke
 * whenever an addCourse call failed partway through confirm(), since every
 * subsequent syllabus search/download would then be matched to the wrong
 * detected course.
 */
export interface CanvasCourseLink {
  courseId: string;
  canvasCourseId: string;
  detected: CanvasDetectedCourse;
}

export function useCanvasFlow() {
  const { addSemester, addCourse, deleteSemester } = useData();
  const [step, setStep] = useState<CanvasStep>('dates');
  const [semesterName, setSemesterName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detectedCourses, setDetectedCourses] = useState<CanvasDetectedCourse[]>([]);
  const [createdSemesterId, setCreatedSemesterId] = useState<string | null>(null);
  const [courseLinks, setCourseLinks] = useState<CanvasCourseLink[]>([]);
  const [syllabiResults, setSyllabiResults] = useState<Record<string, SyllabusFindResult>>({});
  const [downloadResults, setDownloadResults] = useState<Record<string, SyllabusDownloadStatus>>({});
  const [error, setError] = useState<string | null>(null);

  const createdCourseIds = useMemo(() => courseLinks.map(l => l.courseId), [courseLinks]);

  const reset = useCallback(() => {
    setStep('dates');
    setSemesterName('');
    setStartDate('');
    setEndDate('');
    setDetectedCourses([]);
    setCreatedSemesterId(null);
    setCourseLinks([]);
    setSyllabiResults({});
    setDownloadResults({});
    setError(null);
  }, []);

  const detect = useCallback(async () => {
    if (!startDate || !endDate) return;
    setError(null);
    setStep('detecting');

    const { data, error: fnError } = await canvasApi.findCanvasCourses(startDate, endDate);

    if (fnError || !data?.courses) {
      setError('Failed to fetch Canvas courses. Please check your connection and try again.');
      setStep('dates');
      return;
    }

    const courses: CanvasDetectedCourse[] = data.courses.map((c) => ({
      canvas_course_id: c.canvas_course_id,
      name: c.name,
      course_code: c.course_code ?? '',
      instructor: c.instructor ?? '',
      term_name: c.term_name ?? '',
      needs_review: c.needs_review ?? false,
      editedName: c.name,
      editedCode: c.course_code ?? '',
      selected: true,
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

  const toggleCourse = useCallback((index: number) => {
    setDetectedCourses(prev =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c))
    );
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
    setCreatedSemesterId(semId);

    const selectedCourses = detectedCourses.filter(dc => dc.selected);
    const links: CanvasCourseLink[] = [];

    for (let i = 0; i < selectedCourses.length; i++) {
      const dc = selectedCourses[i];
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

      // Pair by canvas_course_id, not the loop index — a failed addCourse
      // above must not shift every later course's syllabus search/download
      // onto the wrong detected course (SYL-71).
      links.push({ courseId, canvasCourseId: dc.canvas_course_id, detected: dc });

      // Store canvas_course_id — not part of the Course interface so update directly
      await canvasApi.linkCanvasCourse(courseId, dc.canvas_course_id);
    }

    setCourseLinks(links);
    setStep('syllabi');

    // Kick off parallel syllabus searches for all created courses
    const initialResults: Record<string, SyllabusFindResult> = {};
    links.forEach(({ courseId }) => { initialResults[courseId] = { status: 'searching' }; });
    setSyllabiResults(initialResults);

    links.forEach(({ courseId, canvasCourseId }) => {
      canvasApi.findCanvasSyllabus(courseId, canvasCourseId)
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
    courseLinks.forEach(({ courseId }) => {
      initial[courseId] = syllabiResults[courseId]?.status === 'found' ? 'downloading' : 'skipped';
    });
    setDownloadResults(initial);

    // Fire download for each found course in parallel
    courseLinks.forEach(({ courseId }) => {
      const result = syllabiResults[courseId];
      if (result?.status !== 'found') return;

      canvasApi.downloadCanvasSyllabus({
        courseId,
        // status === 'found' guarantees source_type was set when this result was recorded.
        sourceType: result.source_type as CanvasSyllabusSourceType,
        fileUrl: result.file_url,
        fileName: result.file_name,
        htmlContent: result.html_content,
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
  }, [courseLinks, syllabiResults]);

  /**
   * Deletes everything confirm() created for this attempt (semester + every
   * created course, via deleteSemester so the SYL-64 course_events pruning
   * applies too). Only safe to call before any download-canvas-syllabus call
   * has been kicked off — the modal enforces that by only calling this while
   * step is 'processing' or 'syllabi' (SYL-71). A no-op if nothing was
   * created yet.
   */
  const rollback = useCallback(async () => {
    if (!createdSemesterId) return;
    try {
      await deleteSemester(createdSemesterId);
    } catch (err) {
      console.error('Error rolling back Canvas import:', err);
    }
  }, [createdSemesterId, deleteSemester]);

  return {
    step,
    semesterName,
    setSemesterName,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    detectedCourses,
    courseLinks,
    createdCourseIds,
    syllabiResults,
    downloadResults,
    error,
    reset,
    detect,
    updateCourse,
    removeCourse,
    toggleCourse,
    confirm,
    downloadSyllabi,
    rollback,
  };
}
