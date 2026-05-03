import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { parseISO, isAfter, isBefore, startOfDay, addDays, differenceInCalendarDays } from 'date-fns';
import { ChevronDown, ChevronUp, X, AlertCircle, ArrowRight } from 'lucide-react';
import type { Event, Course } from '../context/AppContext';

interface DeadlineUrgencyBannerProps {
  events: Event[];
  courses: Course[];
  activeSemesterId?: string;
}

function getEventTypeLabel(type: Event['type']): string {
  switch (type) {
    case 'exam': return 'Exam';
    case 'deadline': return 'Deadline';
    case 'quiz': return 'Quiz';
    case 'presentation': return 'Presentation';
    case 'project_due': return 'Project';
    case 'no_class': return 'No Class';
    default: return 'Event';
  }
}

// Four-tier color scheme:
// today or tomorrow → red
// ≤ 3 days → amber
// ≤ 7 days → indigo
// > 7 days → muted gray
function getUrgencyColor(daysUntil: number): string {
  if (daysUntil <= 1) return 'text-red-700 bg-red-50 border-red-200';
  if (daysUntil <= 3) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (daysUntil <= 7) return 'text-indigo-700 bg-indigo-50 border-indigo-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
}

function getRelativeLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil}d`;
}

export function DeadlineUrgencyBanner({ events, courses, activeSemesterId }: DeadlineUrgencyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Reset dismissal when active semester changes
  useEffect(() => {
    setDismissed(false);
  }, [activeSemesterId]);

  const urgentEvents = useMemo(() => {
    const today = startOfDay(new Date());
    const windowEnd = addDays(today, 14);

    // Only upcoming events (today or later), within 14 days, excluding no_class
    const inWindow = events.filter(e => {
      if (!e.date) return false;
      if (e.type === 'no_class') return false;
      const eventDate = startOfDay(parseISO(e.date));
      // Must be >= today and <= 14 days from now
      return !isBefore(eventDate, today) && !isAfter(eventDate, windowEnd);
    });

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
  }, [events, courses]);

  if (dismissed || urgentEvents.length === 0) return null;

  const count = urgentEvents.length;

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl mb-3">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />

        <div className="flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-amber-800">
          <span className="font-medium">
            {count === 1
              ? '1 deadline coming up'
              : `${count} deadlines coming up`}
          </span>
          <Link
            to="/agenda"
            className="inline-flex items-center gap-0.5 text-amber-700 hover:text-amber-900 text-xs font-medium underline underline-offset-2 transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <button
          onClick={() => setCollapsed(v => !v)}
          className="p-1 rounded-md transition-colors shrink-0 text-amber-600 hover:text-amber-800 hover:bg-amber-100"
          aria-label={collapsed ? 'Expand deadline banner' : 'Collapse deadline banner'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>

        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-md transition-colors shrink-0 text-amber-600 hover:text-amber-800 hover:bg-amber-100"
          aria-label="Dismiss deadline banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded event list */}
      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-2">
            {urgentEvents.map(({ event, course, daysUntil }) => (
              <Link
                key={event.id}
                to={`/course/${event.courseId}?from=dashboard#event-${event.id}`}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${getUrgencyColor(daysUntil)}`}
              >
                {/* Course color dot */}
                {course && (
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: course.color }}
                  />
                )}
                {/* Course code */}
                {course && (
                  <span className="font-semibold">{course.code}</span>
                )}
                {/* Event title */}
                <span className="max-w-[200px] truncate">{event.title}</span>
                {/* Type badge */}
                <span className="opacity-70">· {getEventTypeLabel(event.type)}</span>
                {/* Relative time */}
                <span className="font-bold">{getRelativeLabel(daysUntil)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
