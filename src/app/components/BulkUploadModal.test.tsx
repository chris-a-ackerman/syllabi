// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkUploadModal } from './BulkUploadModal';

// SYL-61: the Add Course entry points pass fixedSemesterId='' when there is
// no active semester. useBulkUpload then creates nothing on confirm, so the
// modal must block up front instead of showing the detect-a-semester form.

vi.mock('../context/DataProvider', () => ({
  useData: () => ({
    courses: [],
    semesters: [
      { id: 'sem-1', name: 'Fall 2026', startDate: '2026-09-01', endDate: '2026-12-18', isActive: true },
    ],
    refreshCourses: vi.fn(),
    addSemester: vi.fn(),
    addCourse: vi.fn(),
  }),
}));

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../hooks/useProcessingPoll', () => ({
  useProcessingPoll: () => {},
}));

vi.mock('@/lib/api/syllabus', () => ({
  uploadTempSyllabus: vi.fn(),
  detectSyllabiInfo: vi.fn(),
  uploadAndProcess: vi.fn(),
  reprocessSyllabus: vi.fn(),
}));

afterEach(cleanup);

describe('BulkUploadModal', () => {
  it('blocks the flow when launched from Add Course with no active semester', () => {
    render(<BulkUploadModal open onClose={vi.fn()} fixedSemesterId="" />);

    expect(screen.getByText(/no active semester/i)).toBeTruthy();
    expect(screen.queryByText('Drop PDF syllabi here')).toBeNull();
    expect(screen.queryByText('Analyze')).toBeNull();
    expect(screen.queryByPlaceholderText('e.g. Spring 2026')).toBeNull();
  });

  it('shows the upload step when the fixed semester exists', () => {
    render(<BulkUploadModal open onClose={vi.fn()} fixedSemesterId="sem-1" />);

    expect(screen.getByText('Drop PDF syllabi here')).toBeTruthy();
    expect(screen.queryByText(/no active semester/i)).toBeNull();
  });
});
