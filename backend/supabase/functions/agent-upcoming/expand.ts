// Pure helpers for agent-upcoming (SYL-92): turn a course's `schedule` JSONB
// into concrete class meetings inside a date window. No Supabase, no clock —
// the handler passes `now` in, so everything here is unit-testable.

export interface MeetingTime {
  start: string | null;
  end: string | null;
  // Optional per-slot days, for schedules where e.g. Tue and Thu meet at
  // different times. Falls back to the schedule's `meeting_days`.
  days?: string[] | null;
}

export interface CourseScheduleJson {
  meeting_days?: string[] | null;
  // process-syllabus writes a single object; an array is accepted for courses
  // with more than one meeting slot.
  meeting_times?: MeetingTime | MeetingTime[] | null;
  breaks?: Array<{ name?: string; start_date: string; end_date: string }> | null;
}

export interface Session {
  course_id: string;
  code: string | null;
  date: string; // YYYY-MM-DD, the course's local calendar date
  start: string | null; // HH:MM, 24h
  end: string | null;
}

export interface ExpandInput {
  course_id: string;
  code: string | null;
  schedule: CourseScheduleJson | null;
  start: string; // inclusive YYYY-MM-DD
  end: string; // inclusive YYYY-MM-DD
  /** Dates (YYYY-MM-DD) with a `no_class` course_event for this course. */
  noClassDates?: Iterable<string>;
}

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0, su: 0, u: 0,
  mon: 1, monday: 1, mo: 1, m: 1,
  tue: 2, tues: 2, tuesday: 2, tu: 2, t: 2,
  wed: 3, wednesday: 3, we: 3, w: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, th: 4, r: 4,
  fri: 5, friday: 5, fr: 5, f: 5,
  sat: 6, saturday: 6, sa: 6, s: 6,
};

/** "Monday" / "Mon" / "M" / "Th" → 0–6 (Sunday = 0), or null if unrecognised. */
export function dayIndex(day: string): number | null {
  const key = day.trim().toLowerCase().replace(/\.$/, '');
  return key in DAY_INDEX ? DAY_INDEX[key] : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function normaliseTime(t: string | null | undefined): string | null {
  if (!t || !HH_MM.test(t.trim())) return null;
  const [h, m] = t.trim().split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

/** Add `days` to a YYYY-MM-DD date, calendar-wise (no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The calendar date `now` falls on in `timeZone` (IANA name). An invalid zone
 * falls back to America/New_York, the `profiles.timezone` default.
 */
export function localDate(now: Date, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return fmt(timeZone);
  } catch {
    return fmt('America/New_York');
  }
}

function slots(schedule: CourseScheduleJson): Array<{ days: number[]; start: string | null; end: string | null }> {
  const raw = schedule.meeting_times;
  const list: MeetingTime[] = Array.isArray(raw) ? raw : [raw ?? { start: null, end: null }];
  const toIdx = (days: string[] | null | undefined) =>
    (days ?? []).map(dayIndex).filter((d): d is number => d !== null);
  return list
    .filter((mt): mt is MeetingTime => !!mt && typeof mt === 'object')
    .map((mt) => ({
      days: toIdx(mt.days && mt.days.length > 0 ? mt.days : schedule.meeting_days),
      start: normaliseTime(mt.start),
      end: normaliseTime(mt.end),
    }))
    .filter((s) => s.days.length > 0);
}

/**
 * Expand one course's weekly meeting pattern into sessions on each date in
 * [start, end], skipping dates inside a `breaks` range or with a `no_class`
 * event. Sorted by date, then start time (untimed sessions last).
 */
export function expandSessions(input: ExpandInput): Session[] {
  const { course_id, code, schedule, start, end } = input;
  if (!schedule || !ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) return [];

  const breaks = (schedule.breaks ?? []).filter(
    (b) => b && ISO_DATE.test(b.start_date) && ISO_DATE.test(b.end_date)
  );
  const noClass = new Set(input.noClassDates ?? []);
  const courseSlots = slots(schedule);
  if (courseSlots.length === 0) return [];

  const sessions: Session[] = [];
  // Hard cap keeps a malformed range from looping forever.
  for (let date = start, i = 0; date <= end && i < 366; date = addDays(date, 1), i++) {
    if (noClass.has(date)) continue;
    if (breaks.some((b) => date >= b.start_date && date <= b.end_date)) continue;
    const dow = weekday(date);
    for (const slot of courseSlots) {
      if (slot.days.includes(dow)) {
        sessions.push({ course_id, code, date, start: slot.start, end: slot.end });
      }
    }
  }
  return sessions;
}

/** Stable ordering for a merged multi-course list. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start ?? '99:99').localeCompare(b.start ?? '99:99') ||
      (a.code ?? '').localeCompare(b.code ?? '')
  );
}

/** Parse `?days=`: default 3, clamped to [0, 14]; non-numeric → default. */
export function parseDays(raw: string | null): number {
  if (raw === null || raw.trim() === '') return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(14, Math.max(0, Math.floor(n)));
}
