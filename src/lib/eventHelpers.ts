import { addDays, isAfter, parseISO, startOfDay } from 'date-fns';
import type { Event } from '@/lib/types';

// Same-day tiebreak order for event lists (SYL-13; moved here in SYL-41).
export const EVENT_TYPE_PRIORITY: Record<string, number> = {
  exam: 0, quiz: 1, presentation: 2, project_due: 3, deadline: 4, other: 5, no_class: 6,
};

export interface UpcomingEventsOptions {
  /** Start-of-day reference date; the day itself is included. */
  today: Date;
  /** Inclusive window in days from `today`; unbounded when omitted. */
  windowDays?: number;
  /** Restrict to events belonging to these courses; all courses when omitted. */
  courseIds?: string[];
  /** no_class events are dropped unless true. */
  includeNoClass?: boolean;
}

/**
 * The one "which events are upcoming" policy (SYL-41: previously three
 * divergent implementations in Agenda, DeadlineUrgencyBanner, and
 * CourseQuickInfoCards). Drops undated events, normalizes dates with
 * startOfDay(parseISO(...)), and sorts by date with the type-priority
 * tiebreak.
 */
export function getUpcomingEvents(events: Event[], opts: UpcomingEventsOptions): Event[] {
  const { today, windowDays, courseIds, includeNoClass = false } = opts;
  const windowEnd = windowDays !== undefined ? addDays(today, windowDays) : undefined;

  return events
    .filter(e => {
      if (!e.date) return false;
      if (!includeNoClass && e.type === 'no_class') return false;
      if (courseIds && !courseIds.includes(e.courseId)) return false;
      const eventDate = startOfDay(parseISO(e.date));
      if (eventDate < today) return false;
      if (windowEnd && isAfter(eventDate, windowEnd)) return false;
      return true;
    })
    .sort((a, b) => {
      const aKey = a.date!.slice(0, 10);
      const bKey = b.date!.slice(0, 10);
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      return (EVENT_TYPE_PRIORITY[a.type] ?? 5) - (EVENT_TYPE_PRIORITY[b.type] ?? 5);
    });
}

/**
 * Returns Tailwind color classes for an event-type badge.
 * Canonical source — imported by Agenda, CourseDetail, and DeadlineUrgencyBanner.
 */
export function getEventTypeColor(type: Event['type']): string {
  switch (type) {
    case 'exam':         return 'bg-red-100 text-red-800';
    case 'deadline':     return 'bg-orange-100 text-orange-800';
    case 'quiz':         return 'bg-yellow-100 text-yellow-800';
    case 'no_class':     return 'bg-gray-100 text-gray-800';
    case 'presentation': return 'bg-purple-100 text-purple-800';
    case 'project_due':  return 'bg-orange-100 text-orange-800';
    default:             return 'bg-blue-100 text-blue-800';
  }
}

/**
 * Returns a human-readable label for an event type.
 * Canonical source — imported by Agenda, CourseDetail, and DeadlineUrgencyBanner.
 */
export function getEventTypeLabel(type: Event['type']): string {
  switch (type) {
    case 'exam':         return 'Exam';
    case 'deadline':     return 'Deadline';
    case 'quiz':         return 'Quiz';
    case 'presentation': return 'Presentation';
    case 'project_due':  return 'Project';
    case 'no_class':     return 'No Class';
    default:             return 'Event';
  }
}
