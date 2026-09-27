import { assertEquals } from '@std/assert';
import {
  addDays,
  dayIndex,
  expandSessions,
  localDate,
  parseDays,
  sortSessions,
} from '../../functions/agent-upcoming/expand.ts';

const MWF = {
  meeting_days: ['Monday', 'Wednesday', 'Friday'],
  meeting_times: { start: '10:00', end: '11:00' },
};

const dates = (sessions: { date: string }[]) => sessions.map((s) => s.date);

// ── expandSessions ───────────────────────────────────────────────────────────

Deno.test('expandSessions: MWF course over two weeks, skipping a break', () => {
  const sessions = expandSessions({
    course_id: 'c1',
    code: 'CS101',
    schedule: {
      ...MWF,
      // Thu Oct 8 – Tue Oct 13 knocks out Fri Oct 9 and Mon Oct 12.
      breaks: [{ name: 'Fall break', start_date: '2026-10-08', end_date: '2026-10-13' }],
    },
    start: '2026-09-28', // Monday
    end: '2026-10-14', // Wednesday
  });
  assertEquals(dates(sessions), [
    '2026-09-28',
    '2026-09-30',
    '2026-10-02',
    '2026-10-05',
    '2026-10-07',
    '2026-10-14',
  ]);
  assertEquals(sessions[0], {
    course_id: 'c1',
    code: 'CS101',
    date: '2026-09-28',
    start: '10:00',
    end: '11:00',
  });
});

Deno.test('expandSessions: a course with two meeting times', () => {
  const sessions = expandSessions({
    course_id: 'c2',
    code: 'MATH18',
    schedule: {
      meeting_days: ['Tue', 'Thu'],
      meeting_times: [
        { start: '09:30', end: '11:00' }, // lecture, inherits Tue/Thu
        { start: '14:00', end: '15:00', days: ['F'] }, // recitation
      ],
    },
    start: '2026-09-29', // Tuesday
    end: '2026-10-02', // Friday
  });
  assertEquals(
    sessions.map((s) => `${s.date} ${s.start}-${s.end}`),
    ['2026-09-29 09:30-11:00', '2026-10-01 09:30-11:00', '2026-10-02 14:00-15:00']
  );
});

Deno.test('expandSessions: two slots on the same day both appear', () => {
  const sessions = expandSessions({
    course_id: 'c2',
    code: null,
    schedule: {
      meeting_days: ['Monday'],
      meeting_times: [
        { start: '13:00', end: '14:00' },
        { start: '09:00', end: '10:00' },
      ],
    },
    start: '2026-09-28',
    end: '2026-09-28',
  });
  assertEquals(
    sortSessions(sessions).map((s) => s.start),
    ['09:00', '13:00']
  );
});

Deno.test('expandSessions: no_class events suppress that date only', () => {
  const sessions = expandSessions({
    course_id: 'c1',
    code: 'CS101',
    schedule: MWF,
    start: '2026-09-28',
    end: '2026-10-02',
    noClassDates: ['2026-09-30'],
  });
  assertEquals(dates(sessions), ['2026-09-28', '2026-10-02']);
});

Deno.test('expandSessions: missing or unusable schedules yield nothing', () => {
  const base = { course_id: 'c', code: null, start: '2026-09-28', end: '2026-10-02' };
  assertEquals(expandSessions({ ...base, schedule: null }), []);
  assertEquals(expandSessions({ ...base, schedule: { meeting_days: [] } }), []);
  assertEquals(expandSessions({ ...base, schedule: { meeting_days: ['Someday'] } }), []);
  assertEquals(
    expandSessions({ ...base, schedule: MWF, start: '2026-10-03', end: '2026-10-01' }),
    []
  );
});

Deno.test('expandSessions: days without stated times still produce untimed sessions', () => {
  const sessions = expandSessions({
    course_id: 'c',
    code: null,
    schedule: { meeting_days: ['Monday'], meeting_times: { start: null, end: null } },
    start: '2026-09-28',
    end: '2026-09-28',
  });
  assertEquals(sessions, [
    { course_id: 'c', code: null, date: '2026-09-28', start: null, end: null },
  ]);
});

// ── timezone edge ───────────────────────────────────────────────────────────

Deno.test(
  'localDate + expandSessions: 23:30 local session on a date that is already tomorrow in UTC',
  () => {
    // 03:15Z on Wed Sep 30 is still 23:15 on Tue Sep 29 in New York.
    const now = new Date('2026-09-30T03:15:00Z');
    const today = localDate(now, 'America/New_York');
    assertEquals(today, '2026-09-29');
    assertEquals(now.toISOString().slice(0, 10), '2026-09-30'); // what a UTC "today" would say

    const sessions = expandSessions({
      course_id: 'late',
      code: 'NIGHT1',
      schedule: { meeting_days: ['Tuesday'], meeting_times: { start: '23:30', end: '23:59' } },
      start: today,
      end: addDays(today, 0),
    });
    assertEquals(sessions, [
      { course_id: 'late', code: 'NIGHT1', date: '2026-09-29', start: '23:30', end: '23:59' },
    ]);
  }
);

Deno.test('localDate: invalid zone falls back to America/New_York', () => {
  assertEquals(localDate(new Date('2026-09-30T03:15:00Z'), 'Not/A_Zone'), '2026-09-29');
  assertEquals(localDate(new Date('2026-09-30T03:15:00Z'), 'Asia/Tokyo'), '2026-09-30');
});

// ── small helpers ────────────────────────────────────────────────────────────

Deno.test('dayIndex accepts full names, abbreviations and single letters', () => {
  assertEquals(
    ['Sunday', 'Mon', 'Tues', 'wed', 'Th', 'R', 'Fri.', 'Sat'].map(dayIndex),
    [0, 1, 2, 3, 4, 4, 5, 6]
  );
  assertEquals(dayIndex('Funday'), null);
});

Deno.test('addDays crosses month and DST boundaries by calendar day', () => {
  assertEquals(addDays('2026-09-30', 1), '2026-10-01');
  assertEquals(addDays('2026-10-31', 2), '2026-11-02'); // US DST ends Nov 1
});

Deno.test('parseDays: default 3, clamped to [0, 14]', () => {
  assertEquals(parseDays(null), 3);
  assertEquals(parseDays(''), 3);
  assertEquals(parseDays('abc'), 3);
  assertEquals(parseDays('7'), 7);
  assertEquals(parseDays('99'), 14);
  assertEquals(parseDays('-2'), 0);
  assertEquals(parseDays('2.9'), 2);
});
