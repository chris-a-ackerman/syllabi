import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LogOut,
  Cog,
} from 'lucide-react';
import {
  parseISO,
  startOfDay,
  differenceInCalendarDays,
  isAfter,
  isBefore,
  format,
} from 'date-fns';
import type { Event, Course } from '../context/AppContext';

// ── Urgency helpers (mirror DeadlineUrgencyBanner exactly) ───────────────────

function getUrgencyClasses(daysUntil: number): {
  badge: string;
  dot: string;
  border: string;
} {
  if (daysUntil < 0) {
    return {
      badge: 'text-gray-500 bg-gray-50 border-gray-200',
      dot: 'bg-gray-400',
      border: 'border-l-gray-300',
    };
  }
  if (daysUntil <= 1) {
    return {
      badge: 'text-red-700 bg-red-50 border-red-200',
      dot: 'bg-red-500',
      border: 'border-l-red-400',
    };
  }
  if (daysUntil <= 3) {
    return {
      badge: 'text-amber-700 bg-amber-50 border-amber-200',
      dot: 'bg-amber-500',
      border: 'border-l-amber-400',
    };
  }
  if (daysUntil <= 7) {
    return {
      badge: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      dot: 'bg-indigo-500',
      border: 'border-l-indigo-400',
    };
  }
  return {
    badge: 'text-gray-600 bg-gray-50 border-gray-200',
    dot: 'bg-gray-400',
    border: 'border-l-gray-300',
  };
}

function getRelativeLabel(daysUntil: number): string {
  if (daysUntil < 0) return `${Math.abs(daysUntil)}d ago`;
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil}d`;
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

function getEventTypeBadgeColor(type: Event['type']): string {
  switch (type) {
    case 'exam': return 'bg-red-100 text-red-800';
    case 'deadline': return 'bg-orange-100 text-orange-800';
    case 'quiz': return 'bg-yellow-100 text-yellow-800';
    case 'no_class': return 'bg-gray-100 text-gray-800';
    case 'presentation': return 'bg-purple-100 text-purple-800';
    case 'project_due': return 'bg-orange-100 text-orange-800';
    default: return 'bg-blue-100 text-blue-800';
  }
}

const EVENT_TYPES: Array<{ value: Event['type'] | 'all'; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'exam', label: 'Exams' },
  { value: 'deadline', label: 'Deadlines' },
  { value: 'quiz', label: 'Quizzes' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'project_due', label: 'Projects' },
  { value: 'no_class', label: 'No Class' },
  { value: 'other', label: 'Other' },
];

const TIME_WINDOWS = [
  { value: '14', label: 'Next 14 days' },
  { value: '30', label: 'Next 30 days' },
  { value: '60', label: 'Next 60 days' },
  { value: 'all', label: 'All upcoming' },
  { value: 'past', label: 'Past events' },
  { value: 'semester', label: 'Full semester' },
];

// ── Canvas metadata helpers (mirrors CourseDetail) ────────────────────────────

function getSubmissionLabel(types: string[]): string {
  const map: Record<string, string> = {
    online_upload: 'File upload',
    online_text_entry: 'Text entry',
    online_quiz: 'Online quiz',
    on_paper: 'In person',
    none: 'No submission',
  };
  for (const t of types) {
    if (map[t]) return map[t];
  }
  return types[0];
}

// ── Enriched event type ───────────────────────────────────────────────────────

interface EnrichedEvent {
  event: Event;
  course: Course | undefined;
  daysUntil: number;
  dateKey: string; // YYYY-MM-DD for grouping
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Agenda() {
  const { user, semesters, courses, events, signOut, setActiveSemester } = useApp();
  const navigate = useNavigate();

  const activeSemester = semesters.find(s => s.isActive);

  // Filters
  const [typeFilter, setTypeFilter] = useState<Event['type'] | 'all'>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [window, setWindow] = useState<string>('30');

  // Expanded Canvas metadata
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Courses in active semester
  const activeCourses = useMemo(
    () => courses.filter(c => c.semesterId === activeSemester?.id),
    [courses, activeSemester?.id],
  );

  // All events for active semester courses
  const semesterEvents = useMemo(
    () => events.filter(e => activeCourses.some(c => c.id === e.courseId) && e.date),
    [events, activeCourses],
  );

  // Apply filters and enrich with urgency data
  const enrichedEvents = useMemo<EnrichedEvent[]>(() => {
    const today = startOfDay(new Date());

    return semesterEvents
      .filter(e => {
        if (!e.date) return false;

        const eventDate = startOfDay(parseISO(e.date));
        const daysUntil = differenceInCalendarDays(eventDate, today);

        // Window filter
        if (window === '14') {
          if (daysUntil < 0 || daysUntil > 14) return false;
        } else if (window === '30') {
          if (daysUntil < 0 || daysUntil > 30) return false;
        } else if (window === '60') {
          if (daysUntil < 0 || daysUntil > 60) return false;
        } else if (window === 'all') {
          if (daysUntil < 0) return false;
        } else if (window === 'past') {
          if (daysUntil >= 0) return false;
        }
        // 'semester' = no date filter beyond the semester events already loaded

        // Type filter
        if (typeFilter !== 'all' && e.type !== typeFilter) return false;

        // Course filter
        if (courseFilter !== 'all' && e.courseId !== courseFilter) return false;

        return true;
      })
      .map(e => {
        const eventDate = startOfDay(parseISO(e.date!));
        const daysUntil = differenceInCalendarDays(eventDate, today);
        return {
          event: e,
          course: activeCourses.find(c => c.id === e.courseId),
          daysUntil,
          dateKey: e.date!, // already YYYY-MM-DD from DB
        };
      })
      .sort((a, b) => {
        // ascending by date; within same date sort by type priority
        if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
        const priority: Record<string, number> = {
          exam: 0, quiz: 1, presentation: 2, project_due: 3, deadline: 4, other: 5, no_class: 6,
        };
        return (priority[a.event.type] ?? 5) - (priority[b.event.type] ?? 5);
      });
  }, [semesterEvents, activeCourses, window, typeFilter, courseFilter]);

  // Group by date for timeline rendering
  const groupedByDate = useMemo(() => {
    const groups: Array<{ dateKey: string; label: string; events: EnrichedEvent[] }> = [];
    const seen = new Map<string, EnrichedEvent[]>();

    for (const item of enrichedEvents) {
      if (!seen.has(item.dateKey)) {
        seen.set(item.dateKey, []);
      }
      seen.get(item.dateKey)!.push(item);
    }

    for (const [dateKey, items] of seen) {
      const parsed = parseISO(dateKey);
      const today = startOfDay(new Date());
      const daysUntil = differenceInCalendarDays(parsed, today);

      let label: string;
      if (daysUntil === 0) label = `Today · ${format(parsed, 'EEEE, MMMM d')}`;
      else if (daysUntil === 1) label = `Tomorrow · ${format(parsed, 'EEEE, MMMM d')}`;
      else label = format(parsed, 'EEEE, MMMM d, yyyy');

      groups.push({ dateKey, label, events: items });
    }

    // already sorted because enrichedEvents is sorted by dateKey
    return groups;
  }, [enrichedEvents]);

  const totalCount = enrichedEvents.length;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/dashboard')}
              className="rounded-lg"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-xl font-bold text-indigo-600">Syllabi</h1>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="rounded-full p-0 h-10 w-10">
                <Avatar>
                  <AvatarFallback className="bg-indigo-100 text-indigo-600">
                    {user?.avatar}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-lg">
              <div className="px-2 py-1.5 text-sm font-medium">{user?.displayName}</div>
              <div className="px-2 py-1.5 text-xs text-gray-500">{user?.email}</div>
              <DropdownMenuItem onClick={() => navigate('/settings/canvas')}>
                <Cog className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Page heading + semester selector */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Agenda</h2>
            <p className="text-gray-500 text-sm">
              Unified deadline timeline across all your courses
            </p>
          </div>

          {/* Semester selector */}
          {semesters.length > 0 && (
            <div className="w-56 shrink-0">
              <label className="text-sm font-medium text-gray-700 mb-2 block">Semester</label>
              <Select
                value={activeSemester?.id ?? ''}
                onValueChange={id => setActiveSemester(id)}
              >
                <SelectTrigger className="rounded-lg bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {semesters.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* Time window */}
          <Select value={window} onValueChange={setWindow}>
            <SelectTrigger className="w-44 rounded-lg bg-white h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg">
              {TIME_WINDOWS.map(w => (
                <SelectItem key={w.value} value={w.value} className="text-sm">
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Type filter */}
          <Select value={typeFilter} onValueChange={v => setTypeFilter(v as Event['type'] | 'all')}>
            <SelectTrigger className="w-40 rounded-lg bg-white h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg">
              {EVENT_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value} className="text-sm">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Course filter */}
          {activeCourses.length > 0 && (
            <Select value={courseFilter} onValueChange={setCourseFilter}>
              <SelectTrigger className="w-44 rounded-lg bg-white h-9 text-sm">
                <SelectValue placeholder="All courses" />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                <SelectItem value="all" className="text-sm">All courses</SelectItem>
                {activeCourses.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-sm">
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Result count */}
          <div className="flex items-center ml-auto">
            <span className="text-sm text-gray-500">
              {totalCount === 0
                ? 'No events'
                : totalCount === 1
                ? '1 event'
                : `${totalCount} events`}
            </span>
          </div>
        </div>

        {/* Empty state */}
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

        {semesters.length > 0 && activeCourses.length > 0 && groupedByDate.length === 0 && (
          <Card className="p-12 text-center rounded-2xl">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No events match your filters</h3>
            <p className="text-gray-600">Try expanding the time window or adjusting filters.</p>
          </Card>
        )}

        {/* Timeline */}
        <div className="space-y-8">
          {groupedByDate.map(({ dateKey, label, events: dayEvents }) => {
            // Urgency from first event of the day (they share the same date)
            const daysUntil = dayEvents[0].daysUntil;
            const urgency = getUrgencyClasses(daysUntil);

            return (
              <div key={dateKey}>
                {/* Date header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${urgency.dot}`} />
                  <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
                  {daysUntil >= 0 && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${urgency.badge}`}>
                      {getRelativeLabel(daysUntil)}
                    </span>
                  )}
                  {daysUntil < 0 && (
                    <span className="text-xs text-gray-400">{getRelativeLabel(daysUntil)}</span>
                  )}
                </div>

                {/* Events for this date */}
                <div className="space-y-2 pl-5">
                  {dayEvents.map(({ event, course }) => {
                    const meta = event.canvasMetadata ?? null;
                    const isExpanded = expandedEventId === event.id;

                    return (
                      <Card
                        key={event.id}
                        className={`p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow border-l-4 ${urgency.border}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          {/* Left: course dot + info */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            {/* Course color dot */}
                            {course && (
                              <div
                                className="w-3 h-3 rounded-full shrink-0 mt-1"
                                style={{ backgroundColor: course.color }}
                              />
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {/* Course code */}
                                {course && (
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                    {course.code}
                                  </span>
                                )}
                                {event.time && (
                                  <>
                                    <span className="text-gray-300 text-xs">·</span>
                                    <span className="text-xs text-gray-500">{event.time}</span>
                                  </>
                                )}
                              </div>

                              {/* Title */}
                              <p className="text-gray-900 font-medium text-sm mb-2 leading-snug">
                                {event.title}
                              </p>

                              {/* Type badge */}
                              <Badge
                                className={`${getEventTypeBadgeColor(event.type)} rounded-full text-xs`}
                              >
                                {getEventTypeLabel(event.type)}
                              </Badge>
                            </div>
                          </div>

                          {/* Right: expand + course link */}
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Link to course detail */}
                            {course && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-gray-400 hover:text-indigo-600"
                                onClick={() =>
                                  navigate(
                                    `/course/${event.courseId}?from=agenda#event-${event.id}`,
                                  )
                                }
                                aria-label="View in course"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}

                            {/* Canvas metadata expand toggle */}
                            {meta && (
                              <button
                                onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                                className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Canvas metadata panel */}
                        {meta && isExpanded && (
                          <div className="border-t border-gray-100 mt-3 pt-3 space-y-2 text-sm text-gray-700">
                            {meta.description_summary && (
                              <div>
                                <span className="font-medium text-gray-500 text-xs uppercase tracking-wide">
                                  What to submit
                                </span>
                                <p className="mt-0.5">{meta.description_summary}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                              {meta.points_possible != null && (
                                <span>{meta.points_possible} pts</span>
                              )}
                              {meta.submission_types && meta.submission_types.length > 0 && (
                                <span>{getSubmissionLabel(meta.submission_types)}</span>
                              )}
                              {meta.unlock_at && (
                                <span>Opens {format(parseISO(meta.unlock_at), 'MMM d')}</span>
                              )}
                              {meta.allowed_attempts != null && (
                                <span>{meta.allowed_attempts} attempts allowed</span>
                              )}
                              {meta.time_limit != null && (
                                <span>{meta.time_limit} min time limit</span>
                              )}
                            </div>
                            {meta.canvas_url && (
                              <a
                                href={meta.canvas_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
                              >
                                View on Canvas
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
