// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkReviewForm } from './BulkReviewForm';
import type { DetectedCourse } from '../hooks/useBulkUpload';

function makeDetected(overrides: Partial<DetectedCourse> = {}): DetectedCourse {
  const id = overrides.id ?? Math.random().toString(36).slice(2);
  return {
    id,
    fileItem: { id, file: new File(['x'], `${id}.pdf`, { type: 'application/pdf' }) },
    tempFilePath: `temp/${id}.pdf`,
    courseName: 'Course',
    courseCode: 'C 101',
    semesterName: 'Fall 2026',
    semesterStart: '2026-09-01',
    semesterEnd: '2026-12-18',
    confidence: 'high',
    ...overrides,
  };
}

afterEach(cleanup);

describe('BulkReviewForm', () => {
  it('propagates a semester-field edit to every course in the group', () => {
    const update = vi.fn();
    render(
      <BulkReviewForm
        detectedCourses={[makeDetected({ id: 'a' }), makeDetected({ id: 'b' })]}
        updateDetectedCourse={update}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('e.g. Spring 2026'), {
      target: { value: 'Fall 2027' },
    });

    expect(update).toHaveBeenCalledWith('a', { semesterName: 'Fall 2027' });
    expect(update).toHaveBeenCalledWith('b', { semesterName: 'Fall 2027' });
  });

  it('keeps focus in the semester-name input while typing renames the group', () => {
    function Harness() {
      const [courses, setCourses] = useState([makeDetected({ id: 'a' }), makeDetected({ id: 'b' })]);
      return (
        <BulkReviewForm
          detectedCourses={courses}
          updateDetectedCourse={(id, updates) =>
            setCourses(prev => prev.map(dc => (dc.id === id ? { ...dc, ...updates } : dc)))
          }
        />
      );
    }
    render(<Harness />);

    const input = screen.getByPlaceholderText('e.g. Spring 2026');
    input.focus();
    fireEvent.change(input, { target: { value: 'Fall 2027' } });

    // The group's key must not derive from the name being edited — that
    // remounted the card and dropped focus on every keystroke.
    const after = screen.getByPlaceholderText('e.g. Spring 2026');
    expect(after).toBe(input);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('Fall 2027');
  });
});
