import { parseISO, format, startOfWeek } from 'date-fns';
import { getUpcomingEvents } from '@/lib/eventHelpers';
import type { Event, Course } from '@/lib/types';

export interface EnrichedEvent {
  event: Event;
  course: Course | undefined;
  dateKey: string; // YYYY-MM-DD
}

export interface AgendaDay {
  dateKey: string;
  dayLabel: string;
  dateShort: string;
  items: EnrichedEvent[];
}

export interface AgendaWeek {
  weekKey: string;
  weekLabel: string;
  days: AgendaDay[];
}

/**
 * Filter to future events (date >= today) belonging to the given courses,
 * pair each with its course, and sort by date then type priority.
 * `today` is injected so callers pass `startOfDay(new Date())`.
 */
export function enrichAndSortEvents(
  events: Event[],
  activeCourses: Course[],
  today: Date,
): EnrichedEvent[] {
  return getUpcomingEvents(events, {
    today,
    courseIds: activeCourses.map(c => c.id),
    includeNoClass: true,
  }).map(e => ({
    event: e,
    course: activeCourses.find(c => c.id === e.courseId),
    dateKey: e.date!.slice(0, 10),
  }));
}

/**
 * Group enriched events into Monday-start weeks, then days, both ascending.
 * Labels per spec (SYL-13 AC4): "Week of Sep 8" / "Monday, Sep 8".
 */
export function groupEventsByWeek(enrichedEvents: EnrichedEvent[]): AgendaWeek[] {
  // Map: weekKey (YYYY-MM-DD of Mon) → Map: dateKey → EnrichedEvent[]
  const weeks = new Map<string, Map<string, EnrichedEvent[]>>();

  for (const item of enrichedEvents) {
    const parsed = parseISO(item.dateKey);
    const weekStart = startOfWeek(parsed, { weekStartsOn: 1 }); // Monday
    const weekKey = format(weekStart, 'yyyy-MM-dd');

    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, new Map());
    }
    const days = weeks.get(weekKey)!;
    if (!days.has(item.dateKey)) {
      days.set(item.dateKey, []);
    }
    days.get(item.dateKey)!.push(item);
  }

  // Convert to sorted array
  return Array.from(weeks.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekKey, daysMap]) => {
      const weekMon = parseISO(weekKey);
      return {
        weekKey,
        weekLabel: `Week of ${format(weekMon, 'MMM d')}`,
        days: Array.from(daysMap.entries())
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([dateKey, items]) => {
            const parsed = parseISO(dateKey);
            return {
              dateKey,
              dayLabel: format(parsed, 'EEEE, MMM d'),
              dateShort: format(parsed, 'MMM d'),
              items,
            };
          }),
      };
    });
}
