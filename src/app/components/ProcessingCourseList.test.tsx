// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '@/lib/types';
import { ProcessingCourseList } from './ProcessingCourseList';

// SYL-66 / SYL-68: the one processing list. A failed course must show its
// reason and a Retry that targets that course; an id with no course yet
// reads as processing rather than crashing.

const base = { semesterId: 's1', professor: '', color: '#6366f1' };
const COURSES: Course[] = [
  { ...base, id: 'c1', name: 'Algorithms', code: 'CS 201', status: 'processing' },
  { ...base, id: 'c2', name: 'Chemistry', code: 'CHEM 101', status: 'ready' },
  { ...base, id: 'c3', name: 'History', code: 'HIST 110', status: 'failed', analysisError: 'Upload failed: bucket quota exceeded' },
];

afterEach(cleanup);

describe('ProcessingCourseList', () => {
  it.each(['compact', 'page'] as const)('renders each state with its label (%s)', (variant) => {
    render(<ProcessingCourseList courseIds={['c1', 'c2', 'c3', 'missing']} courses={COURSES} onRetry={vi.fn()} variant={variant} />);

    expect(screen.getAllByText('Processing')).toHaveLength(2); // c1 + the not-yet-loaded id
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Upload failed: bucket quota exceeded')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('offers Retry only for failed courses and passes that course id', () => {
    const onRetry = vi.fn();
    render(<ProcessingCourseList courseIds={['c1', 'c2', 'c3']} courses={COURSES} onRetry={onRetry} />);

    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    expect(onRetry).toHaveBeenCalledWith('c3');
  });
});
