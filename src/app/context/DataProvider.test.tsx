// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYL-64: a failed lib/api call used to be swallowed (console.error + silent
// return) instead of rejecting, so callers like ConfirmDeleteDialog closed as
// if the mutation had succeeded and local state drifted from the DB. This
// pins that semester update/delete now reject and leave state untouched.

const {
  fetchSemesters,
  updateSemester,
  deleteSemesterWithCourses,
  deactivateSemesters,
  activateSemester,
  upsertSemester,
} = vi.hoisted(() => ({
  fetchSemesters: vi.fn(),
  updateSemester: vi.fn(),
  deleteSemesterWithCourses: vi.fn(),
  deactivateSemesters: vi.fn(),
  activateSemester: vi.fn(),
  upsertSemester: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/api/semesters', () => ({
  fetchSemesters,
  updateSemester,
  deleteSemesterWithCourses,
  deactivateSemesters,
  activateSemester,
  upsertSemester,
}));

vi.mock('@/lib/api/courses', () => ({
  fetchCourses: vi.fn(async () => ({ data: [], error: null })),
  deleteCourse: vi.fn(),
  insertCourse: vi.fn(),
  updateCourse: vi.fn(),
}));

vi.mock('@/lib/api/events', () => ({
  fetchEvents: vi.fn(async () => ({ data: [], error: null })),
}));

vi.mock('@/lib/api/notes', () => ({
  fetchNotes: vi.fn(async () => ({ data: [], error: null })),
  insertNote: vi.fn(),
  deleteNote: vi.fn(),
}));

// Imported after the mocks above are declared — vi.mock calls are hoisted
// above this import by Vitest regardless of source order.
import { DataProvider, useData } from './DataProvider';

const SEMESTER = {
  id: 'sem-1',
  name: 'Fall 2026',
  startDate: '2026-09-01',
  endDate: '2026-12-15',
  isActive: true,
};

function renderData() {
  return renderHook(() => useData(), {
    wrapper: ({ children }) => <DataProvider>{children}</DataProvider>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSemesters.mockResolvedValue({ data: [SEMESTER], error: null });
  deactivateSemesters.mockResolvedValue({ error: null });
  activateSemester.mockResolvedValue({ error: null });
});

describe('DataProvider semester mutations (SYL-64)', () => {
  it('rejects and leaves state untouched when updateSemester fails', async () => {
    const boom = new Error('update failed');
    updateSemester.mockResolvedValue({ error: boom });

    const { result } = renderData();
    await waitFor(() => expect(result.current.semesters).toEqual([SEMESTER]));

    await act(async () => {
      await expect(
        result.current.updateSemester('sem-1', {
          name: 'Renamed',
          startDate: '2026-09-01',
          endDate: '2026-12-15',
          isActive: false,
        })
      ).rejects.toBe(boom);
    });

    // Optimistic update must have been rolled back.
    expect(result.current.semesters).toEqual([SEMESTER]);
  });

  it('rejects and leaves state untouched when deleteSemester fails', async () => {
    const boom = new Error('delete failed');
    deleteSemesterWithCourses.mockResolvedValue({ error: boom });

    const { result } = renderData();
    await waitFor(() => expect(result.current.semesters).toEqual([SEMESTER]));

    await act(async () => {
      await expect(result.current.deleteSemester('sem-1')).rejects.toBe(boom);
    });

    // The delete never touched local state because the API call failed
    // before any setState ran.
    expect(result.current.semesters).toEqual([SEMESTER]);
  });
});
