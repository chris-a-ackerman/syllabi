import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { ArrowLeft, Calendar } from 'lucide-react';
import { startOfDay } from 'date-fns';
import { getEventTypeColor, getEventTypeLabel } from '@/lib/eventHelpers';
import {
  enrichAndSortEvents,
  groupEventsByWeek,
  type EnrichedEvent,
} from '@/lib/agendaGrouping';

// ── Component ─────────────────────────────────────────────────────────────────

export function Agenda() {
  const { semesters, courses, events } = useApp();
  const navigate = useNavigate();

  const activeSemester = semesters.find(s => s.isActive);

  // Courses in active semester
  const activeCourses = useMemo(
    () => courses.filter(c => c.semesterId === activeSemester?.id),
    [courses, activeSemester?.id],
  );

  // All events for active semester courses — future only (date >= today)
  const enrichedEvents = useMemo<EnrichedEvent[]>(() => {
    if (!activeSemester) return [];
    return enrichAndSortEvents(events, activeCourses, startOfDay(new Date()));
  }, [events, activeCourses, activeSemester]);

  // Group into weeks (Mon-start) then days
  const weekGroups = useMemo(() => groupEventsByWeek(enrichedEvents), [enrichedEvents]);

  return (
    <div className="min-h-screen bg-white">
      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Back button + page heading */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard')}
            className="rounded-lg mb-4 -ml-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>

          <h1 className="text-2xl font-bold text-gray-900">
            Agenda {activeSemester ? `— ${activeSemester.name}` : ''}
          </h1>
        </div>

        {/* Empty: no semesters */}
        {semesters.length === 0 && (
          <Card className="p-12 text-center rounded-2xl">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No semesters yet</h3>
            <p className="text-gray-600 mb-6">Set up a semester to see your agenda.</p>
            <Button
              onClick={() => navigate('/dashboard')}
              className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Go to Dashboard
            </Button>
          </Card>
        )}

        {/* Empty: no courses */}
        {semesters.length > 0 && activeCourses.length === 0 && (
          <Card className="p-12 text-center rounded-2xl">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No courses this semester</h3>
            <p className="text-gray-600 mb-6">Add courses and upload syllabi to populate your agenda.</p>
            <Button
              onClick={() => navigate('/dashboard')}
              className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Go to Dashboard
            </Button>
          </Card>
        )}

        {/* Empty: has courses but zero upcoming events */}
        {semesters.length > 0 && activeCourses.length > 0 && weekGroups.length === 0 && (
          <Card className="p-12 text-center rounded-2xl">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No upcoming events for this semester.</p>
          </Card>
        )}

        {/* Timeline grouped by week then day */}
        {weekGroups.length > 0 && (
          <div className="space-y-10">
            {weekGroups.map(({ weekKey, weekLabel, days }) => (
              <div key={weekKey}>
                {/* Week header */}
                <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                  {weekLabel}
                </h2>

                <div className="space-y-6 pl-2">
                  {days.map(({ dateKey, dayLabel, dateShort, items }) => (
                    <div key={dateKey}>
                      {/* Day sub-header */}
                      <h3 className="text-sm font-medium text-gray-500 mb-2">{dayLabel}</h3>

                      {/* Event rows */}
                      <div className="space-y-2">
                        {items.map(({ event, course }) => (
                          <button
                            key={event.id}
                            type="button"
                            className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                            onClick={() => navigate(`/course/${event.courseId}?from=agenda`)}
                          >
                            <Card className="px-4 py-3 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                              <div className="flex items-center gap-4">
                                {/* Date — fixed width, left-aligned */}
                                <span className="w-20 shrink-0 text-sm text-gray-500 font-medium">
                                  {dateShort}
                                </span>

                                {/* Title */}
                                <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                                  {event.title}
                                </span>

                                {/* Course code + color dot */}
                                {course && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <div
                                      className="w-2.5 h-2.5 rounded-full"
                                      style={{ backgroundColor: course.color }}
                                    />
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                      {course.code}
                                    </span>
                                  </div>
                                )}

                                {/* Event-type badge */}
                                <Badge
                                  className={`${getEventTypeColor(event.type)} rounded-full text-xs shrink-0`}
                                >
                                  {getEventTypeLabel(event.type)}
                                </Badge>
                              </div>
                            </Card>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
