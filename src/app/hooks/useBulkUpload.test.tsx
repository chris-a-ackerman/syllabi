// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkUpload } from './useBulkUpload';

// SYL-61: pins the hook contract both the Add-Course (fixedSemesterId) and the
// Onboarding/Add-Semester (detection) flows depend on. Add Course must never
// create a semester and must put every course in the id it was given;
// Onboarding/Add Semester must still detect + group by semester name.

const { addSemester, addCourse } = vi.hoisted(() => ({
  addSemester: vi.fn(),
  addCourse: vi.fn(),
}));

const { uploadTempSyllabus, detectSyllabiInfo, uploadAndProcess, reprocessSyllabus } = vi.hoisted(() => ({
  uploadTempSyllabus: vi.fn(),
  detectSyllabiInfo: vi.fn(),
  uploadAndProcess: vi.fn(),
  reprocessSyllabus: vi.fn(),
}));

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../context/DataProvider', () => ({
  useData: () => ({ addSemester, addCourse }),
}));

vi.mock('@/lib/api/syllabus', () => ({
  uploadTempSyllabus,
  detectSyllabiInfo,
  uploadAndProcess,
  reprocessSyllabus,
}));

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
  reprocessSyllabus.mockResolvedValue(undefined);

  addSemester.mockImplementation(async ({ name }: { name: string }) => `sem-id-${name}`);
  addCourse.mockImplementation(async () => `course-id-${Math.random()}`);
});

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
});
