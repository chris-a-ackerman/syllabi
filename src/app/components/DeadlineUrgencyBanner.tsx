import { useMemo, useState } from 'react';
import { parseISO, isAfter, isBefore, startOfDay, endOfDay, addDays, differenceInCalendarDays } from 'date-fns';
import { ChevronDown, ChevronUp, X, AlertCircle } from 'lucide-react';
import type { Event, Course } from '../context/AppContext';

// Session-scoped dismissal key — resets when the tab is closed.
const DISMISSED_KEY = 'deadline_banner_dismissed';

interface DeadlineUrgencyBannerProps {
  events: Event[];
  courses: Course[];
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

function getUrgencyColor(daysUntil: number): string {
  if (daysUntil < 0) return 'text-red-700 bg-red-50 border-red-200';
  if (daysUntil === 0) return 'text-orange-700 bg-orange-50 border-orange-200';
  return 'text-amber-700 bg-amber-50 border-amber-200';
}

function getRelativeLabel(daysUntil: number): string {
  if (daysUntil < 0) return `${Math.abs(daysUntil)}d overdue`;
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil}d`;
}

export function DeadlineUrgencyBanner({ events, courses }: DeadlineUrgencyBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(false);

  const urgentEvents = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = endOfDay(addDays(today, 7));

    return events
      .filter(e => {
        if (!e.date) return false;
        if (e.type === 'no_class') return false;
        const eventDate = startOfDay(parseISO(e.date));
        const isOverdue = isBefore(eventDate, today);
        const isThisWeek = !isBefore(eventDate, today) && !isAfter(eventDate, weekEnd);
        return isOverdue || isThisWeek;
      })
      .map(e => {
        const eventDate = startOfDay(parseISO(e.date!));
        const daysUntil = differenceInCalendarDays(eventDate, today);
        return {
          event: e,
          course: courses.find(c => c.id === e.courseId),
          isOverdue: daysUntil < 0,
          daysUntil,
        };
      })
      .sort((a, b) => {
        const aCanvas = a.event.canvasAssignmentId ? 1 : 0;
        const bCanvas = b.event.canvasAssignmentId ? 1 : 0;
        if (bCanvas !== aCanvas) return bCanvas - aCanvas;
        return a.daysUntil - b.daysUntil;
      });
  }, [events, courses]);

  if (dismissed || urgentEvents.length === 0) return null;

  const overdueCount = urgentEvents.filter(e => e.isOverdue).length;
  const thisWeekCount = urgentEvents.filter(e => !e.isOverdue).length;
  const hasOverdue = overdueCount > 0;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // sessionStorage not available (e.g., private browsing edge case) — still dismiss in state
    }
    setDismissed(true);
  };

  const palette = hasOverdue
    ? {
        container: 'border-b border-red-200 bg-red-50',
        icon: 'text-red-600',
        text: 'text-red-800',
        button: 'text-red-600 hover:text-red-800 hover:bg-red-100',
      }
    : {
        container: 'border-b border-amber-200 bg-amber-50',
        icon: 'text-amber-600',
        text: 'text-amber-800',
        button: 'text-amber-600 hover:text-amber-800 hover:bg-amber-100',
      };

  return (
    <div className={palette.container}>
      <div className="flex items-center gap-2 px-6 py-2.5">
        <AlertCircle className={`h-4 w-4 shrink-0 ${palette.icon}`} />

        <div className={`flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${palette.text}`}>
          <span className="font-medium">
            {overdueCount > 0 && thisWeekCount > 0
              ? `${overdueCount} overdue, ${thisWeekCount} due this week`
              : overdueCount > 0
              ? `${overdueCount} overdue deadline${overdueCount > 1 ? 's' : ''}`
              : `${thisWeekCount} deadline${thisWeekCount > 1 ? 's' : ''} this week`}
          </span>
        </div>

        <button
          onClick={() => setCollapsed(v => !v)}
          className={`p-1 rounded-md transition-colors shrink-0 ${palette.button}`}
          aria-label={collapsed ? 'Expand deadline banner' : 'Collapse deadline banner'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>

        <button
          onClick={handleDismiss}
          className={`p-1 rounded-md transition-colors shrink-0 ${palette.button}`}
          aria-label="Dismiss deadline banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded event list */}
      {!collapsed && (
        <div className="px-6 pb-3">
          <div className="flex flex-wrap gap-2">
            {urgentEvents.map(({ event, course, daysUntil }) => (
              <div
                key={event.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${getUrgencyColor(daysUntil)}`}
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
