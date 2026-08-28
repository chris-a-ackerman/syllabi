import { describe, expect, it } from 'vitest';
import { startOfDay, parseISO } from 'date-fns';
import { enrichAndSortEvents, groupEventsByWeek } from './agendaGrouping';
import type { Event, Course } from '@/lib/types';

// Fixed clock for every test: Tuesday, Sep 1 2026.
const TODAY = startOfDay(parseISO('2026-09-01'));

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    semesterId: 's1',
    name: 'Course One',
    code: 'CS101',
    professor: '',
    color: '#6366f1',
    status: 'ready',
    ...overrides,
  };
}

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

describe('enrichAndSortEvents', () => {
  const courses = [makeCourse()];

  it('keeps today and future events, drops past and dateless events', () => {
    const result = enrichAndSortEvents(
      [
        makeEvent({ id: 'past', date: '2026-08-31' }),
        makeEvent({ id: 'today', date: '2026-09-01' }),
        makeEvent({ id: 'future', date: '2026-09-08' }),
        makeEvent({ id: 'no-date', date: null }),
      ],
      courses,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual(['today', 'future']);
  });

  it('drops events belonging to courses outside the active set', () => {
    const result = enrichAndSortEvents(
      [makeEvent({ id: 'mine' }), makeEvent({ id: 'other', courseId: 'c-other' })],
      courses,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual(['mine']);
  });

  it('normalizes dateKey to YYYY-MM-DD even when the date carries a time component (SYL-13 regression)', () => {
    const result = enrichAndSortEvents(
      [
        makeEvent({ id: 'a', date: '2026-09-08T23:59:00' }),
        makeEvent({ id: 'b', date: '2026-09-08' }),
      ],
      courses,
      TODAY,
    );
    // Same day → one dateKey, so a later grouping step keeps them together
    expect(result.map(r => r.dateKey)).toEqual(['2026-09-08', '2026-09-08']);
  });

  it('sorts by date ascending, then by type priority within a day', () => {
    const result = enrichAndSortEvents(
      [
        makeEvent({ id: 'later-day', date: '2026-09-09', type: 'exam' }),
        makeEvent({ id: 'deadline', date: '2026-09-08', type: 'deadline' }),
        makeEvent({ id: 'exam', date: '2026-09-08', type: 'exam' }),
        makeEvent({ id: 'quiz', date: '2026-09-08', type: 'quiz' }),
        makeEvent({ id: 'no-class', date: '2026-09-08', type: 'no_class' }),
      ],
      courses,
      TODAY,
    );
    expect(result.map(r => r.event.id)).toEqual([
      'exam', 'quiz', 'deadline', 'no-class', 'later-day',
    ]);
  });

  it('attaches the matching course', () => {
    const [enriched] = enrichAndSortEvents([makeEvent()], courses, TODAY);
    expect(enriched.course?.code).toBe('CS101');
  });
});

describe('groupEventsByWeek', () => {
  const courses = [makeCourse()];

  function enrich(events: Event[]) {
    return enrichAndSortEvents(events, courses, TODAY);
  }

  it('groups into Monday-start weeks with spec wording (SYL-13 AC4)', () => {
    // Sep 8 2026 is a Tuesday → its week starts Monday Sep 7
    const weeks = groupEventsByWeek(enrich([makeEvent({ date: '2026-09-08' })]));
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekKey).toBe('2026-09-07');
    expect(weeks[0].weekLabel).toBe('Week of Sep 7');
    expect(weeks[0].days[0].dayLabel).toBe('Tuesday, Sep 8');
    expect(weeks[0].days[0].dateShort).toBe('Sep 8');
  });

  it('puts Sunday in the week of the preceding Monday', () => {
    // Sep 13 2026 is a Sunday → belongs to week of Monday Sep 7, not Sep 14
    const weeks = groupEventsByWeek(
      enrich([
        makeEvent({ id: 'tue', date: '2026-09-08' }),
        makeEvent({ id: 'sun', date: '2026-09-13' }),
        makeEvent({ id: 'next-mon', date: '2026-09-14' }),
      ]),
    );
    expect(weeks.map(w => w.weekKey)).toEqual(['2026-09-07', '2026-09-14']);
    expect(weeks[0].days.map(d => d.dateKey)).toEqual(['2026-09-08', '2026-09-13']);
  });

  it('keeps events with time-suffixed dates in the same day group', () => {
    const weeks = groupEventsByWeek(
      enrich([
        makeEvent({ id: 'a', date: '2026-09-08T09:00:00' }),
        makeEvent({ id: 'b', date: '2026-09-08' }),
      ]),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].days).toHaveLength(1);
    expect(weeks[0].days[0].items).toHaveLength(2);
  });

  it('sorts weeks and days ascending', () => {
    const weeks = groupEventsByWeek(
      enrich([
        makeEvent({ id: 'late', date: '2026-10-06' }),
        makeEvent({ id: 'early', date: '2026-09-02' }),
        makeEvent({ id: 'mid', date: '2026-09-04' }),
      ]),
    );
    expect(weeks.map(w => w.weekKey)).toEqual(['2026-08-31', '2026-10-05']);
    expect(weeks[0].days.map(d => d.dateKey)).toEqual(['2026-09-02', '2026-09-04']);
  });

  it('returns an empty array for no events', () => {
    expect(groupEventsByWeek([])).toEqual([]);
  });
});
