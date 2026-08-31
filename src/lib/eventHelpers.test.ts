import { describe, expect, it } from 'vitest';
import { parseISO, startOfDay } from 'date-fns';
import { getEventTypeColor, getEventTypeLabel, getUpcomingEvents } from './eventHelpers';
import type { Event } from '@/lib/types';

const ALL_TYPES: Event['type'][] = [
  'exam', 'deadline', 'quiz', 'presentation', 'project_due', 'no_class', 'other',
];

describe('getEventTypeColor', () => {
  it('maps every event type to its badge classes', () => {
    expect(getEventTypeColor('exam')).toBe('bg-red-100 text-red-800');
    expect(getEventTypeColor('deadline')).toBe('bg-orange-100 text-orange-800');
    expect(getEventTypeColor('quiz')).toBe('bg-yellow-100 text-yellow-800');
    expect(getEventTypeColor('no_class')).toBe('bg-gray-100 text-gray-800');
    expect(getEventTypeColor('presentation')).toBe('bg-purple-100 text-purple-800');
    expect(getEventTypeColor('project_due')).toBe('bg-orange-100 text-orange-800');
    expect(getEventTypeColor('other')).toBe('bg-blue-100 text-blue-800');
  });

  it('returns a non-empty class string for every known type', () => {
    for (const type of ALL_TYPES) {
      expect(getEventTypeColor(type)).toMatch(/^bg-\S+ text-\S+$/);
    }
  });
});

describe('getEventTypeLabel', () => {
  it('maps every event type to its display label', () => {
    expect(getEventTypeLabel('exam')).toBe('Exam');
    expect(getEventTypeLabel('deadline')).toBe('Deadline');
    expect(getEventTypeLabel('quiz')).toBe('Quiz');
    expect(getEventTypeLabel('presentation')).toBe('Presentation');
    expect(getEventTypeLabel('project_due')).toBe('Project');
    expect(getEventTypeLabel('no_class')).toBe('No Class');
    expect(getEventTypeLabel('other')).toBe('Event');
  });
});

// Fixed clock: Tuesday, Sep 1 2026 (same convention as agendaGrouping.test.ts).
const TODAY = startOfDay(parseISO('2026-09-01'));

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: Math.random().toString(36).slice(2),
    courseId: 'c1',
    title: 'Event',
    date: '2026-09-08',
    type: 'deadline',
    ...overrides,
  };
}

describe('getUpcomingEvents', () => {
  it('keeps today and future events, drops past and dateless events', () => {
    const result = getUpcomingEvents(
      [
        makeEvent({ id: 'past', date: '2026-08-31' }),
        makeEvent({ id: 'today', date: '2026-09-01' }),
        makeEvent({ id: 'future', date: '2026-09-15' }),
        makeEvent({ id: 'dateless', date: null }),
      ],
      { today: TODAY },
    );
    expect(result.map(e => e.id)).toEqual(['today', 'future']);
  });

  it('applies an inclusive day window when windowDays is set', () => {
    const result = getUpcomingEvents(
      [
        makeEvent({ id: 'edge', date: '2026-09-15' }), // exactly 14 days out
        makeEvent({ id: 'beyond', date: '2026-09-16' }),
      ],
      { today: TODAY, windowDays: 14 },
    );
    expect(result.map(e => e.id)).toEqual(['edge']);
  });

  it('drops no_class events unless includeNoClass is set', () => {
    const events = [
      makeEvent({ id: 'nc', type: 'no_class' }),
      makeEvent({ id: 'dl' }),
    ];
    expect(getUpcomingEvents(events, { today: TODAY }).map(e => e.id)).toEqual(['dl']);
    // deadline outranks no_class in the same-day tiebreak
    expect(getUpcomingEvents(events, { today: TODAY, includeNoClass: true }).map(e => e.id))
      .toEqual(['dl', 'nc']);
  });

  it('filters to the given courses when courseIds is set', () => {
    const result = getUpcomingEvents(
      [
        makeEvent({ id: 'mine', courseId: 'c1' }),
        makeEvent({ id: 'other', courseId: 'c2' }),
      ],
      { today: TODAY, courseIds: ['c1'] },
    );
    expect(result.map(e => e.id)).toEqual(['mine']);
  });

  it('sorts by date, breaking same-day ties by type priority', () => {
    const result = getUpcomingEvents(
      [
        makeEvent({ id: 'later-exam', date: '2026-09-10', type: 'exam' }),
        makeEvent({ id: 'deadline', date: '2026-09-08', type: 'deadline' }),
        makeEvent({ id: 'exam', date: '2026-09-08', type: 'exam' }),
      ],
      { today: TODAY },
    );
    expect(result.map(e => e.id)).toEqual(['exam', 'deadline', 'later-exam']);
  });
});
