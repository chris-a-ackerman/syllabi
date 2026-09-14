// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '@/lib/types';
import { useBulkUpload } from './useBulkUpload';

// SYL-61: pins the hook contract both the Add-Course (fixedSemesterId) and the
// Onboarding/Add-Semester (detection) flows depend on. Add Course must never
// create a semester and must put every course in the id it was given;
// Onboarding/Add Semester must still detect + group by semester name.

// A tiny in-memory DataProvider: addCourse inserts a row the way the real one
// does (status from the DB default, i.e. 'ready'), updateCourse merges. The
// array is mutated in place so the hook sees changes on its next render.
const { courses, addSemester, addCourse, updateCourse } = vi.hoisted(() => ({
  courses: [] as Course[],
  addSemester: vi.fn(),
  addCourse: vi.fn(),
  updateCourse: vi.fn(),
}));

const { uploadTempSyllabus, detectSyllabiInfo, uploadAndProcess, reprocessSyllabus, markSyllabusFailed } = vi.hoisted(() => ({
  uploadTempSyllabus: vi.fn(),
  detectSyllabiInfo: vi.fn(),
  uploadAndProcess: vi.fn(),
  reprocessSyllabus: vi.fn(),
  markSyllabusFailed: vi.fn(),
}));

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../context/DataProvider', () => ({
  useData: () => ({ courses, addSemester, addCourse, updateCourse }),
}));

vi.mock('@/lib/api/syllabus', () => ({
  uploadTempSyllabus,
  detectSyllabiInfo,
  uploadAndProcess,
  reprocessSyllabus,
  markSyllabusFailed,
}));

const courseById = (id: string) => courses.find(c => c.id === id);

function makeFile(name: string) {
  return new File([new TextEncoder().encode('%PDF-1.4\n%e2e\n')], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();

  uploadTempSyllabus.mockImplementation(async (_userId: string, _timestamp: number, file: File) => ({
    data: { path: `temp/${file.name}` },
    error: null,
  }));

  // Two files detecting two DIFFERENT semester names — this is exactly the
  // shape that used to flip is_active to a brand-new semester when launched
  // from Add Course (the bug).
  detectSyllabiInfo.mockImplementation(async (filePaths: string[]) => ({
    data: {
      results: filePaths.map((file_path, i) => ({
        file_path,
        course_name: `Course ${i}`,
        course_code: `C 10${i}`,
        semester_name: i === 0 ? 'Fall 2026' : 'Autumn 2099',
        semester_start: i === 0 ? '2026-09-01' : '2099-09-01',
        semester_end: i === 0 ? '2026-12-18' : '2099-12-15',
        confidence: 'high',
      })),
    },
    error: null,
  }));

  uploadAndProcess.mockResolvedValue({ data: { path: 'perm/path' }, error: null });
  reprocessSyllabus.mockResolvedValue({ error: null });
  markSyllabusFailed.mockResolvedValue({ error: null });

  courses.length = 0;
  addSemester.mockImplementation(async ({ name }: { name: string }) => `sem-id-${name}`);
  addCourse.mockImplementation(async (course: Omit<Course, 'id'>) => {
    const id = `course-${courses.length + 1}`;
    courses.push({ ...course, id, status: 'ready' });
    return id;
  });
  updateCourse.mockImplementation((id: string, updates: Partial<Course>) => {
    const i = courses.findIndex(c => c.id === id);
    if (i >= 0) courses[i] = { ...courses[i], ...updates };
  });
});

/** Drives a two-file upload through analyze + confirm. */
async function confirmTwoFiles(result: { current: ReturnType<typeof useBulkUpload> }) {
  act(() => {
    result.current.addFiles([makeFile('a.pdf'), makeFile('b.pdf')]);
  });
  await act(async () => {
    await result.current.analyze();
  });
  await act(async () => {
    await result.current.confirm();
  });
}

describe('useBulkUpload', () => {
  it('fixedSemesterId: creates no semesters and puts every course in the fixed semester (AC1)', async () => {
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));

    act(() => {
      result.current.addFiles([makeFile('a.pdf'), makeFile('b.pdf')]);
    });

    await act(async () => {
      await result.current.analyze();
    });

    expect(result.current.step).toBe('review');
    // Detection still ran and still produced two distinct semester names —
    // fixedSemesterId ignores them rather than never detecting them.
    expect(new Set(result.current.detectedCourses.map(dc => dc.semesterName)).size).toBe(2);

    await act(async () => {
      await result.current.confirm();
    });

    expect(addSemester).not.toHaveBeenCalled();
    expect(addCourse).toHaveBeenCalledTimes(2);
    for (const call of addCourse.mock.calls) {
      expect(call[0].semesterId).toBe('sem-active');
    }
  });

  it('no options: detects and creates one semester per distinct name, courses use their group id (AC2)', async () => {
    const { result } = renderHook(() => useBulkUpload());

    act(() => {
      result.current.addFiles([makeFile('a.pdf'), makeFile('b.pdf')]);
    });

    await act(async () => {
      await result.current.analyze();
    });

    await act(async () => {
      await result.current.confirm();
    });

    expect(addSemester).toHaveBeenCalledTimes(2);
    expect(addSemester).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fall 2026' }));
    expect(addSemester).toHaveBeenCalledWith(expect.objectContaining({ name: 'Autumn 2099' }));

    expect(addCourse).toHaveBeenCalledTimes(2);
    const semesterIdsUsed = addCourse.mock.calls.map(call => call[0].semesterId);
    expect(semesterIdsUsed).toContain('sem-id-Fall 2026');
    expect(semesterIdsUsed).toContain('sem-id-Autumn 2099');
  });
  it("fixedSemesterId '': no semester available — confirm creates no semesters and no courses", async () => {
    // The Add Course entry points pass '' when there is no active semester;
    // the hook must not fall back to detection and must not create anything.
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: '' }));

    act(() => {
      result.current.addFiles([makeFile('a.pdf')]);
    });
    await act(async () => {
      await result.current.analyze();
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(addSemester).not.toHaveBeenCalled();
    expect(addCourse).not.toHaveBeenCalled();
    expect(result.current.createdCourseIds).toEqual([]);
  });

  // ── SYL-66: uploadAndProcess failures are surfaced, not discarded ──────────

  it('shows every created course as processing until the poll sees it settle', async () => {
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));
    await confirmTwoFiles(result);

    // The insert lands at the DB default (shown as ready); the hook flips the
    // card to processing itself so allDone is not true before anything ran.
    expect(courseById('course-1')?.status).toBe('processing');
    expect(courseById('course-2')?.status).toBe('processing');
    expect(result.current.allDone).toBe(false);
  });

  it('marks a course whose upload failed as failed, locally and on the row, with the message', async () => {
    uploadAndProcess.mockImplementation(async (_userId: string, _courseId: string, file: File) =>
      file.name === 'b.pdf'
        ? { data: { path: null }, error: { message: 'Upload failed: bucket quota exceeded' } }
        : { data: { path: 'perm/a.pdf' }, error: null }
    );
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));
    await confirmTwoFiles(result);

    expect(result.current.createdCourseIds).toEqual(['course-1', 'course-2']);
    expect(courseById('course-1')?.status).toBe('processing');
    expect(courseById('course-2')).toMatchObject({
      status: 'failed',
      analysisError: 'Upload failed: bucket quota exceeded',
    });
    // The row is updated too, so the poll cannot flip the card back.
    expect(markSyllabusFailed).toHaveBeenCalledTimes(1);
    expect(markSyllabusFailed).toHaveBeenCalledWith('course-2', 'Upload failed: bucket quota exceeded');
  });

  it('counts failed courses as settled so allDone becomes reachable (AC2)', async () => {
    uploadAndProcess.mockImplementation(async (_userId: string, _courseId: string, file: File) =>
      file.name === 'b.pdf'
        ? { data: { path: null }, error: { message: 'Upload failed: boom' } }
        : { data: { path: 'perm/a.pdf' }, error: null }
    );
    const { result, rerender } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));
    await confirmTwoFiles(result);
    expect(result.current.allDone).toBe(false);

    // Simulate the poll's refresh reporting course-1 complete.
    updateCourse('course-1', { status: 'ready' });
    rerender();
    expect(result.current.allDone).toBe(true);
  });

  it('retryProcessing re-uploads when the file never reached Storage, otherwise re-invokes processing', async () => {
    uploadAndProcess.mockImplementation(async (_userId: string, _courseId: string, file: File) =>
      file.name === 'b.pdf'
        ? { data: { path: null }, error: { message: 'Upload failed: boom' } }
        : { data: { path: 'perm/a.pdf' }, error: null }
    );
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));
    await confirmTwoFiles(result);
    uploadAndProcess.mockClear();
    uploadAndProcess.mockResolvedValue({ data: { path: 'perm/b.pdf' }, error: null });

    // b's file is still in hand: Retry re-runs the upload rather than asking
    // process-syllabus to read a file that was never stored.
    await act(async () => {
      await result.current.retryProcessing('course-2');
    });
    expect(uploadAndProcess).toHaveBeenCalledTimes(1);
    expect(uploadAndProcess.mock.calls[0][1]).toBe('course-2');
    expect((uploadAndProcess.mock.calls[0][2] as File).name).toBe('b.pdf');
    expect(reprocessSyllabus).not.toHaveBeenCalled();
    expect(courseById('course-2')).toMatchObject({ status: 'processing', analysisError: undefined });

    // a's file is stored; a later processing failure (reported by the poll)
    // retries through process-syllabus alone.
    updateCourse('course-1', { status: 'failed', analysisError: 'JSON parse failed' });
    await act(async () => {
      await result.current.retryProcessing('course-1');
    });
    expect(reprocessSyllabus).toHaveBeenCalledWith('course-1');
    expect(uploadAndProcess).toHaveBeenCalledTimes(1);
    expect(courseById('course-1')).toMatchObject({ status: 'processing', analysisError: undefined });
  });

  it('retryProcessing surfaces a failed re-invoke on the card', async () => {
    const { result } = renderHook(() => useBulkUpload({ fixedSemesterId: 'sem-active' }));
    await confirmTwoFiles(result);
    reprocessSyllabus.mockResolvedValue({ error: { message: 'Processing failed: 429' } });

    await act(async () => {
      await result.current.retryProcessing('course-1');
    });
    expect(courseById('course-1')).toMatchObject({ status: 'failed', analysisError: 'Processing failed: 429' });
  });
});
