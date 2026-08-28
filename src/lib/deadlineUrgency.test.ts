import { describe, expect, it } from 'vitest';
import { startOfDay, parseISO } from 'date-fns';
import { getRelativeLabel, getUrgencyColor, selectUrgentDeadlines } from './deadlineUrgency';
import type { Event, Course } from '@/app/context/AppContext';

// Fixed clock: Tuesday, Sep 1 2026.
const TODAY = startOfDay(parseISO('2026-09-01'));

const COURSES: Course[] = [
  {
    id: 'c1',
    semesterId: 's1',
    name: 'Course One',
    code: 'CS101',
    professor: '',
    color: '#6366f1',
    status: 'ready',
  },
];

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: Math.random().toString(36).slice(2),
    courseId: 'c1',
    title: 'Event',
    date: '2026-09-05',
    type: 'deadline',
    ...overrides,
  };
}

describe('getUrgencyColor', () => {
  it('uses the four-tier scheme from SYL-14', () => {
    expect(getUrgencyColor(0)).toContain('text-red-700');
    expect(getUrgencyColor(1)).toContain('text-red-700');
    expect(getUrgencyColor(2)).toContain('text-amber-700');
    expect(getUrgencyColor(3)).toContain('text-amber-700');
    expect(getUrgencyColor(4)).toContain('text-indigo-700');
    expect(getUrgencyColor(7)).toContain('text-indigo-700');
    expect(getUrgencyColor(8)).toContain('text-gray-600');
  });
});

describe('getRelativeLabel', () => {
  it('labels today, tomorrow, and beyond', () => {
    expect(getRelativeLabel(0)).toBe('Today');
    expect(getRelativeLabel(1)).toBe('Tomorrow');
    expect(getRelativeLabel(5)).toBe('In 5d');
  });
});

describe('selectUrgentDeadlines', () => {
  it('keeps only events within the 14-day window, inclusive on both ends', () => {
    const result = selectUrgentDeadlines(
      [
        makeEvent({ id: 'past', date: '2026-08-31' }),
        makeEvent({ id: 'today', date: '2026-09-01' }),
        makeEvent({ id: 'day14', date: '2026-09-15' }),
        makeEvent({ id: 'day15', date: '2026-09-16' }),
      ],
      COURSES,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual(['today', 'day14']);
    expect(result.map(r => r.daysUntil)).toEqual([0, 14]);
  });

  it('excludes no_class and dateless events', () => {
    const result = selectUrgentDeadlines(
      [
        makeEvent({ id: 'break', type: 'no_class' }),
        makeEvent({ id: 'no-date', date: null }),
        makeEvent({ id: 'real' }),
      ],
      COURSES,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual(['real']);
  });

  it('gives Canvas-matched events the slots first, capped at 3, then sorts by date', () => {
    const result = selectUrgentDeadlines(
      [
        makeEvent({ id: 'syllabus-soon', date: '2026-09-02' }),
        makeEvent({ id: 'canvas-a', date: '2026-09-10', canvasAssignmentId: '1' }),
        makeEvent({ id: 'canvas-b', date: '2026-09-11', canvasAssignmentId: '2' }),
        makeEvent({ id: 'canvas-c', date: '2026-09-12', canvasAssignmentId: '3' }),
      ],
      COURSES,
      TODAY,
    );
    // The syllabus-only event dated soonest is squeezed out by Canvas-matched ones,
    // and the final list is date-ascending.
    expect(result.map(r => r.event.id)).toEqual(['canvas-a', 'canvas-b', 'canvas-c']);
  });

  it('fills remaining slots with syllabus-only events', () => {
    const result = selectUrgentDeadlines(
      [
        makeEvent({ id: 'syllabus', date: '2026-09-02' }),
        makeEvent({ id: 'canvas', date: '2026-09-10', canvasAssignmentId: '1' }),
      ],
      COURSES,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual(['syllabus', 'canvas']);
  });

  it('attaches the course and computes daysUntil', () => {
    const [item] = selectUrgentDeadlines([makeEvent({ date: '2026-09-03' })], COURSES, TODAY);
    expect(item.course?.code).toBe('CS101');
    expect(item.daysUntil).toBe(2);
  });

  it('returns an empty array when nothing qualifies', () => {
    expect(selectUrgentDeadlines([], COURSES, TODAY)).toEqual([]);
  });
});
