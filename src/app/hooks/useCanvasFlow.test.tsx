// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasFlow } from './useCanvasFlow';

// SYL-71: pins two contracts the "Confirm & Create" repro depended on.
// 1. courseLinks pairs a created course to its detected Canvas course by
//    canvas_course_id, not array index — so a failed addCourse never shifts
//    every later course's syllabus search/download onto the wrong course.
// 2. rollback() deletes exactly what confirm() created (via deleteSemester,
//    so SYL-64's course_events pruning applies), and is a no-op otherwise.

const { addSemester, addCourse, deleteSemester } = vi.hoisted(() => ({
  addSemester: vi.fn(),
  addCourse: vi.fn(),
  deleteSemester: vi.fn(),
}));

const { findCanvasCourses, findCanvasSyllabus, downloadCanvasSyllabus, linkCanvasCourse } = vi.hoisted(() => ({
  findCanvasCourses: vi.fn(),
  findCanvasSyllabus: vi.fn(),
  downloadCanvasSyllabus: vi.fn(),
  linkCanvasCourse: vi.fn(),
}));

vi.mock('../context/DataProvider', () => ({
  useData: () => ({ addSemester, addCourse, deleteSemester }),
}));

vi.mock('@/lib/api/canvas', () => ({
  findCanvasCourses,
  findCanvasSyllabus,
  downloadCanvasSyllabus,
  linkCanvasCourse,
}));

function candidate(id: string, name: string) {
  return {
    canvas_course_id: id,
    name,
    course_code: `${name} 101`,
    instructor: 'Prof',
    term_name: 'Fall',
    term_start: '2026-09-01',
    term_end: '2026-12-15',
    has_syllabus: true,
    needs_review: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  findCanvasCourses.mockResolvedValue({
    data: {
      courses: [candidate('c1', 'Alpha'), candidate('c2', 'Beta'), candidate('c3', 'Gamma')],
      total_found: 3,
      needs_review_count: 0,
    },
    error: null,
  });
  addSemester.mockResolvedValue('sem-1');
  addCourse.mockImplementation(async ({ name }: { name: string }) => `course-${name}`);
  linkCanvasCourse.mockResolvedValue({ error: null });
  findCanvasSyllabus.mockResolvedValue({ data: { success: true, found: false, course_id: 'x' }, error: null });
  downloadCanvasSyllabus.mockResolvedValue({ data: { success: true }, error: null });
  deleteSemester.mockResolvedValue(undefined);
});

async function detectThree(result: { current: ReturnType<typeof useCanvasFlow> }) {
  act(() => {
    result.current.setStartDate('2026-09-01');
    result.current.setEndDate('2026-12-15');
  });
  await act(async () => {
    await result.current.detect();
  });
}

describe('useCanvasFlow', () => {
  it('detect() marks every candidate selected by default', async () => {
    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);

    expect(result.current.detectedCourses).toHaveLength(3);
    expect(result.current.detectedCourses.every(dc => dc.selected)).toBe(true);
  });

  it('toggleCourse flips only the targeted course', async () => {
    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);

    act(() => { result.current.toggleCourse(1); });

    expect(result.current.detectedCourses.map(dc => dc.selected)).toEqual([true, false, true]);
  });

  it('confirm() creates only selected courses (deselecting one excludes it entirely)', async () => {
    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);
    act(() => { result.current.toggleCourse(1); }); // deselect Beta

    await act(async () => {
      await result.current.confirm();
    });

    expect(addCourse).toHaveBeenCalledTimes(2);
    expect(result.current.createdCourseIds).toEqual(['course-Alpha', 'course-Gamma']);
    expect(result.current.courseLinks.map(l => l.canvasCourseId)).toEqual(['c1', 'c3']);
  });

  it('pairs syllabus searches by canvas_course_id, so a failed addCourse never misattributes a later course', async () => {
    // Beta's addCourse fails — with index-based pairing this used to shift
    // Gamma's syllabus search onto Beta's canvas_course_id (or vice versa).
    addCourse.mockImplementation(async ({ name }: { name: string }) =>
      name === 'Beta' ? undefined : `course-${name}`
    );
    findCanvasSyllabus.mockImplementation(async (courseId: string, canvasCourseId: string) => ({
      data: {
        success: true,
        found: true,
        course_id: courseId,
        source_type: 'html' as const,
        html_content: `<p>${canvasCourseId}</p>`,
        confidence: 'high' as const,
      },
      error: null,
    }));

    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);

    await act(async () => {
      await result.current.confirm();
    });

    // Beta never got a course row, so only Alpha and Gamma are linked.
    expect(result.current.createdCourseIds).toEqual(['course-Alpha', 'course-Gamma']);
    expect(linkCanvasCourse).toHaveBeenCalledTimes(2);
    expect(linkCanvasCourse).toHaveBeenCalledWith('course-Gamma', 'c3');

    // Gamma's search must be keyed to its own canvas_course_id (c3) — index
    // pairing would have used Beta's slot (index 1, canvas_course_id c2).
    expect(findCanvasSyllabus).toHaveBeenCalledWith('course-Gamma', 'c3');
    await waitFor(() => {
      expect(result.current.syllabiResults['course-Gamma']?.html_content).toBe('<p>c3</p>');
    });
    expect(result.current.syllabiResults['course-Beta']).toBeUndefined();
  });

  it('downloadSyllabi() downloads only the courses whose search found a syllabus', async () => {
    findCanvasSyllabus.mockImplementation(async (courseId: string) => ({
      data: {
        success: true,
        found: courseId === 'course-Alpha',
        course_id: courseId,
        source_type: 'file' as const,
        file_url: 'https://canvas.example.edu/f',
        confidence: 'high' as const,
      },
      error: null,
    }));

    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);
    await act(async () => {
      await result.current.confirm();
    });
    await waitFor(() => {
      expect(Object.values(result.current.syllabiResults).every(r => r.status !== 'searching')).toBe(true);
    });

    await act(async () => {
      await result.current.downloadSyllabi();
    });

    await waitFor(() => {
      expect(downloadCanvasSyllabus).toHaveBeenCalledTimes(1);
    });
    expect(downloadCanvasSyllabus).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'course-Alpha' }));
    expect(result.current.downloadResults['course-Beta']).toBe('skipped');
    expect(result.current.downloadResults['course-Gamma']).toBe('skipped');
  });

  it('rollback() deletes the created semester (courses/events cascade through deleteSemester)', async () => {
    const { result } = renderHook(() => useCanvasFlow());
    await detectThree(result);
    await act(async () => {
      await result.current.confirm();
    });

    await act(async () => {
      await result.current.rollback();
    });

    expect(deleteSemester).toHaveBeenCalledWith('sem-1');
  });

  it('rollback() is a no-op before confirm() has created anything', async () => {
    const { result } = renderHook(() => useCanvasFlow());

    await act(async () => {
      await result.current.rollback();
    });

    expect(deleteSemester).not.toHaveBeenCalled();
  });
});
