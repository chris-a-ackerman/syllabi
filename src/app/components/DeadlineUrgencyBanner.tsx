import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { startOfDay } from 'date-fns';
import { ChevronDown, ChevronUp, X, AlertCircle } from 'lucide-react';
import type { Event, Course } from '../context/AppContext';
import { getEventTypeLabel } from '@/lib/eventHelpers';
import { getRelativeLabel, getUrgencyColor, selectUrgentDeadlines } from '@/lib/deadlineUrgency';

interface DeadlineUrgencyBannerProps {
  events: Event[];
  courses: Course[];
  activeSemesterId?: string;
}

export function DeadlineUrgencyBanner({ events, courses, activeSemesterId }: DeadlineUrgencyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Reset dismissal when active semester changes
  useEffect(() => {
    setDismissed(false);
  }, [activeSemesterId]);

  const urgentEvents = useMemo(
    () => selectUrgentDeadlines(events, courses, startOfDay(new Date())),
    [events, courses],
  );

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
