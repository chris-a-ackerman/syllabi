import { parseISO, startOfDay, differenceInCalendarDays } from 'date-fns';
import { getUpcomingEvents } from '@/lib/eventHelpers';
import type { Event, Course } from '@/lib/types';

export interface UrgentDeadline {
  event: Event;
  course: Course | undefined;
  daysUntil: number;
}

// Four-tier color scheme:
// today or tomorrow → red
// ≤ 3 days → amber
// ≤ 7 days → indigo
// > 7 days → muted gray
export function getUrgencyColor(daysUntil: number): string {
  if (daysUntil <= 1) return 'text-red-700 bg-red-50 border-red-200';
  if (daysUntil <= 3) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (daysUntil <= 7) return 'text-indigo-700 bg-indigo-50 border-indigo-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

export function getRelativeLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil}d`;
}

/**
 * Banner selection rules (SYL-14): upcoming events within 14 days of `today`
 * (inclusive), excluding no_class; Canvas-matched events claim slots first;
 * at most 3; sorted by date ascending. `today` must be a start-of-day Date.
 */
export function selectUrgentDeadlines(
  events: Event[],
  courses: Course[],
  today: Date,
): UrgentDeadline[] {
  // Only upcoming events (today or later), within 14 days, excluding no_class.
  // getUpcomingEvents returns them date-sorted, so the cap below always keeps
  // the soonest events of each pool.
  const inWindow = getUpcomingEvents(events, { today, windowDays: 14 });

  // Selection rule: canvas-matched events first, fill remaining slots with syllabus-only
  const canvasEvents = inWindow.filter(e => e.canvasAssignmentId != null);
  const syllabusOnlyEvents = inWindow.filter(e => e.canvasAssignmentId == null);

  // Take up to 3, canvas-first
  const chosen: typeof inWindow = [];
  for (const e of canvasEvents) {
    if (chosen.length >= 3) break;
    chosen.push(e);
  }
  for (const e of syllabusOnlyEvents) {
    if (chosen.length >= 3) break;
    chosen.push(e);
  }

  // Map to enriched shape, then sort by date ascending
  return chosen
    .map(e => {
      const eventDate = startOfDay(parseISO(e.date!));
      const daysUntil = differenceInCalendarDays(eventDate, today);
      return {
        event: e,
        course: courses.find(c => c.id === e.courseId),
        daysUntil,
      };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);
}
