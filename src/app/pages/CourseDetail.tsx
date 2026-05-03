import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router';
import { useApp } from '../context/AppContext';
import { getEventTypeColor } from '@/lib/eventHelpers';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  ArrowLeft,
  Calendar,
  Download,
  Upload,
  AlertTriangle,
  Trash2,
  Plus,
  MessageSquare,
  FileText,
  Pencil,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { AddCourseModal } from '../components/AddCourseModal';
import { CourseQuickInfoCards } from '../components/CourseQuickInfoCards';

export function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { courses, events, notes, addNote, deleteNote, deleteCourse } = useApp();

  const from = searchParams.get('from');
  const backLabel =
    from === 'dashboard' ? 'Back to Dashboard'
    : from === 'agenda' ? 'Back to Agenda'
    : 'Back to Courses';
  const handleBack = () => {
    if (from === 'dashboard') {
      navigate('/dashboard');
    } else if (from === 'agenda') {
      navigate('/agenda');
    } else {
      navigate('/courses', { state: { semesterId: course?.semesterId } });
    }
  };

  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [showDeleteCourse, setShowDeleteCourse] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const course = courses.find(c => c.id === id);
  const courseEvents = events.filter(e => e.courseId === id && e.date);
  const courseNotes = notes.filter(n => n.courseId === id);

  useEffect(() => {
    const match = location.hash.match(/^#event-(.+)$/);
    if (!match) return;
    const targetId = match[1];
    const target = courseEvents.find(e => e.id === targetId);
    if (!target) return;

    if (target.canvasMetadata) {
      setExpandedEventId(targetId);
    }

    requestAnimationFrame(() => {
      document
        .getElementById(`event-${targetId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [location.hash, courseEvents]);

  if (!course) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Course not found</h2>
          <Button onClick={handleBack} className="mt-4">
            {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  const hasSyllabus = course.status === 'ready';

  // Empty state for courses without syllabus
  if (!hasSyllabus) {
    return (
      <div className="min-h-screen bg-white">
        {/* Header */}
        <div
          className="border-b border-gray-200 px-6 py-6"
          style={{ borderLeftWidth: '4px', borderLeftColor: course.color }}
        >
          <Button
            variant="ghost"
            onClick={handleBack}
            className="mb-4 rounded-lg"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Button>

          <div className="relative group inline-block">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{course.name}</h1>
            <div className="flex items-center gap-4 text-gray-600">
              <span className="font-medium">{course.code}</span>
              {course.code && course.professor && <span>•</span>}
              <span>{course.professor}</span>
            </div>
            <button
              onClick={() => setEditModalOpen(true)}
              className="absolute -top-1 -right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              aria-label="Edit course details"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Empty State */}
        <div className="px-4 py-6 md:px-6 md:py-8 max-w-7xl mx-auto">
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="p-12 text-center rounded-2xl max-w-md">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                No Syllabus Uploaded
              </h2>
              <p className="text-gray-600 mb-6">
                Upload your syllabus to see course details, assignments, grading policies, and more.
              </p>
              <Button
                onClick={() => navigate('/dashboard')}
                className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Syllabus
              </Button>
            </Card>
          </div>
        </div>

        {/* Edit Course Details */}
        <AddCourseModal
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          editMode
          existingCourse={{
            id: course.id,
            name: course.name,
            code: course.code,
            professor: course.professor,
            color: course.color,
          }}
        />
      </div>
    );
  }

  const getSubmissionLabel = (types: string[]): string => {
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
  };

  // Group events by month
  const eventsByMonth = courseEvents.reduce((acc, event) => {
    const month = format(parseISO(event.date), 'MMMM yyyy');
    if (!acc[month]) acc[month] = [];
    acc[month].push(event);
    return acc;
  }, {} as Record<string, typeof courseEvents>);

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote({
      courseId: id!,
      text: noteText,
    });
    setNoteText('');
    setShowNoteInput(false);
  };

  const handleDeleteNote = () => {
    if (deleteNoteId) {
      deleteNote(deleteNoteId);
      setDeleteNoteId(null);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div
        className="border-b border-gray-200 px-6 py-6"
        style={{ borderLeftWidth: '4px', borderLeftColor: course.color }}
      >
        <Button
          variant="ghost"
          onClick={handleBack}
          className="mb-4 rounded-lg -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {backLabel}
        </Button>

        <div className="mb-4">
          <div className="relative group inline-block">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{course.name}</h1>
            <div className="flex items-center gap-4 text-gray-600">
              <span className="font-medium">{course.code}</span>
              {course.code && course.professor && <span>•</span>}
              <span>{course.professor}</span>
            </div>
            <button
              onClick={() => setEditModalOpen(true)}
              className="absolute -top-1 -right-8 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              aria-label="Edit course details"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
          <Button
            onClick={() => navigate('/dashboard', { state: { selectedCourseId: course.id } })}
            className="bg-indigo-600 hover:bg-indigo-700 rounded-lg justify-start"
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Chat About This Course
          </Button>
          <Button variant="outline" className="rounded-lg justify-start">
            <Download className="mr-2 h-4 w-4" />
            Download Calendar
          </Button>
          <Button variant="outline" className="rounded-lg justify-start">
            <Upload className="mr-2 h-4 w-4" />
            Re-upload Syllabus
          </Button>
          <Button
            variant="outline"
            className="rounded-lg justify-start text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            onClick={() => setShowDeleteCourse(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Quick Info Cards */}
      <div className="px-4 pt-6 md:px-6 md:pt-8 max-w-7xl mx-auto">
        <CourseQuickInfoCards course={course} events={courseEvents} />
      </div>

      {/* Tabs */}
      <div className="px-4 pb-6 md:px-6 md:pb-8 max-w-7xl mx-auto">
        <Tabs defaultValue="events" className="w-full">
          <TabsList className="mb-6 rounded-lg w-full overflow-x-auto flex">
            <TabsTrigger value="events" className="rounded-lg flex-1">Events</TabsTrigger>
            <TabsTrigger value="grading" className="rounded-lg flex-1">Grading</TabsTrigger>
            <TabsTrigger value="schedule" className="rounded-lg flex-1">Schedule</TabsTrigger>
            <TabsTrigger value="policies" className="rounded-lg flex-1">Policies</TabsTrigger>
            <TabsTrigger value="notes" className="rounded-lg flex-1">Notes</TabsTrigger>
          </TabsList>

          {/* Events Tab */}
          <TabsContent value="events" className="space-y-6">
            {Object.entries(eventsByMonth).map(([month, monthEvents]) => (
              <div key={month}>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">{month}</h3>
                <div className="space-y-2">
                  {monthEvents.map(event => {
                    const meta = event.canvasMetadata ?? null;
                    const isExpanded = expandedEventId === event.id;
                    return (
                      <Card id={`event-${event.id}`} key={event.id} className="p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-medium text-gray-900">
                                {format(parseISO(event.date), 'MMM d, yyyy')}
                              </span>
                              {event.time && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="text-gray-600">{event.time}</span>
                                </>
                              )}
                              {event.confidence === 'low' && (
                                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                              )}
                            </div>
                            <p className="text-gray-900 mb-2">{event.title}</p>
                            <Badge className={`${getEventTypeColor(event.type)} rounded-full text-xs`}>
                              {event.type.charAt(0).toUpperCase() + event.type.slice(1).replace('_', ' ')}
                            </Badge>
                          </div>
                          {meta && (
                            <button
                              onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                              className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          )}
                        </div>

                        {meta && isExpanded && (
                          <div className="border-t border-gray-100 mt-3 pt-3 space-y-2 text-sm text-gray-700">
                            {meta.description_summary && (
                              <div>
                                <span className="font-medium text-gray-500 text-xs uppercase tracking-wide">What to submit</span>
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
            ))}

            {courseEvents.length === 0 && (
              <Card className="p-12 text-center rounded-2xl">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No events found for this course</p>
              </Card>
            )}
          </TabsContent>

          {/* Grading Tab */}
          <TabsContent value="grading" className="space-y-6">
            {(() => {
              const components = course.grading_rules?.components ?? [];
              // Weights may be decimals (0.15) or percents (15) depending on which run produced the data.
              const toPercent = (w: number) => w > 0 && w <= 1 ? Math.round(w * 100) : Math.round(w);

              if (components.length === 0) {
                return (
                  <Card className="p-12 text-center rounded-2xl">
                    <p className="text-gray-600">No grading information available</p>
                  </Card>
                );
              }

              return (
                <>
                  <div className="grid md:grid-cols-2 gap-4">
                    {components.map((component, i) => (
                      <Card key={i} className="p-6 rounded-xl shadow-sm">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-gray-900 mb-1">{component.name}</h3>
                            {component.count != null && (
                              <p className="text-sm text-gray-600">{component.count} items</p>
                            )}
                          </div>
                          <div className="text-2xl font-bold" style={{ color: course.color }}>
                            {toPercent(component.weight)}%
                          </div>
                        </div>

                        {component.description && (
                          <p className="text-sm text-gray-600 mb-2">{component.description}</p>
                        )}

                        {!!component.drop_lowest && component.drop_lowest > 0 && (
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Drop Policy:</span> Drops lowest {component.drop_lowest}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>

                  {/* Weight visualization */}
                  <Card className="p-6 rounded-xl shadow-sm">
                    <h3 className="font-semibold text-gray-900 mb-4">Grade Breakdown</h3>
                    <div className="space-y-3">
                      {components.map((component, i) => {
                        const pct = toPercent(component.weight);
                        return (
                          <div key={i}>
                            <div className="flex items-center justify-between mb-1 text-sm">
                              <span className="text-gray-700">{component.name}</span>
                              <span className="font-medium">{pct}%</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: course.color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  {course.grading_rules?.late_policy && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-2">Late Work Policy</h3>
                      <p className="text-sm text-gray-700">{course.grading_rules.late_policy}</p>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule" className="space-y-4">
            {(() => {
              const s = course.schedule;
              if (!s) {
                return (
                  <Card className="p-12 text-center rounded-2xl">
                    <p className="text-gray-600">No schedule information available</p>
                  </Card>
                );
              }

              const formatTime = (t: string | null | undefined) => {
                if (!t) return null;
                const [h, m] = t.split(':').map(Number);
                const period = h >= 12 ? 'PM' : 'AM';
                const hour = h % 12 || 12;
                return `${hour}:${String(m).padStart(2, '0')} ${period}`;
              };

              const meetingTimeStr =
                s.meeting_times?.start && s.meeting_times?.end
                  ? `${formatTime(s.meeting_times.start)} – ${formatTime(s.meeting_times.end)}`
                  : null;

              return (
                <>
                  {/* Class Meetings */}
                  <Card className="p-6 rounded-xl shadow-sm">
                    <h3 className="font-semibold text-gray-900 mb-4">Class Meetings</h3>
                    <div className="space-y-2">
                      {s.meeting_days && s.meeting_days.length > 0 && (
                        <div className="flex items-center gap-4">
                          <span className="text-gray-500 w-24 text-sm">Days</span>
                          <span className="font-medium text-gray-900">{s.meeting_days.join(', ')}</span>
                        </div>
                      )}
                      {meetingTimeStr && (
                        <div className="flex items-center gap-4">
                          <span className="text-gray-500 w-24 text-sm">Time</span>
                          <span className="font-medium text-gray-900">{meetingTimeStr}</span>
                        </div>
                      )}
                      {s.location && (
                        <div className="flex items-center gap-4">
                          <span className="text-gray-500 w-24 text-sm">Location</span>
                          <span className="font-medium text-gray-900">{s.location}</span>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Instructor / Office Hours */}
                  {s.instructor && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-4">Instructor</h3>
                      <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                        {s.instructor.name && (
                          <p className="font-medium text-gray-900">{s.instructor.name}</p>
                        )}
                        {s.instructor.email && (
                          <p className="text-sm text-gray-600">{s.instructor.email}</p>
                        )}
                        {s.instructor.office_hours && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Office Hours:</span> {s.instructor.office_hours}
                          </p>
                        )}
                        {s.instructor.office && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Office:</span> {s.instructor.office}
                          </p>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Semester Dates */}
                  {(s.semester_start || s.semester_end || s.finals_period_start) && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-4">Semester Dates</h3>
                      <div className="space-y-2">
                        {s.semester_start && (
                          <div className="flex items-center gap-4">
                            <span className="text-gray-500 w-32 text-sm">First Class</span>
                            <span className="font-medium text-gray-900">
                              {format(parseISO(s.semester_start), 'MMMM d, yyyy')}
                            </span>
                          </div>
                        )}
                        {s.semester_end && (
                          <div className="flex items-center gap-4">
                            <span className="text-gray-500 w-32 text-sm">Last Class</span>
                            <span className="font-medium text-gray-900">
                              {format(parseISO(s.semester_end), 'MMMM d, yyyy')}
                            </span>
                          </div>
                        )}
                        {s.finals_period_start && (
                          <div className="flex items-center gap-4">
                            <span className="text-gray-500 w-32 text-sm">Final Exam</span>
                            <span className="font-medium text-gray-900">
                              {format(parseISO(s.finals_period_start), 'MMMM d, yyyy')}
                              {s.finals_period_end && s.finals_period_end !== s.finals_period_start
                                ? ` – ${format(parseISO(s.finals_period_end), 'MMMM d, yyyy')}`
                                : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Breaks */}
                  {s.breaks && s.breaks.length > 0 && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-4">Breaks</h3>
                      <div className="space-y-2">
                        {s.breaks.map((b, i) => (
                          <div key={i} className="flex items-center gap-4">
                            <span className="text-gray-500 w-32 text-sm shrink-0">{b.name}</span>
                            <span className="font-medium text-gray-900">
                              {format(parseISO(b.start_date), 'MMM d')} – {format(parseISO(b.end_date), 'MMM d, yyyy')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Notes */}
                  {s.notes && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-2">Notes</h3>
                      <p className="text-sm text-gray-700">{s.notes}</p>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>

          {/* Policies Tab */}
          <TabsContent value="policies" className="space-y-4">
            {(() => {
              const p = course.policies;
              if (!p) {
                return (
                  <Card className="p-12 text-center rounded-2xl">
                    <p className="text-gray-600">No policy information available</p>
                  </Card>
                );
              }

              const namedPolicies: { label: string; value: string | null | undefined }[] = [
                { label: 'Attendance', value: p.attendance },
                { label: 'Late Work', value: p.late_work },
                { label: 'Academic Integrity', value: p.academic_integrity },
                { label: 'Technology', value: p.technology },
                { label: 'AI Usage', value: p.ai_policy },
                { label: 'Recording', value: p.recording },
              ];

              const hasAny =
                namedPolicies.some(({ value }) => value) ||
                (p.other && p.other.length > 0);

              if (!hasAny) {
                return (
                  <Card className="p-12 text-center rounded-2xl">
                    <p className="text-gray-600">No policy information available</p>
                  </Card>
                );
              }

              return (
                <>
                  {namedPolicies
                    .filter(({ value }) => value)
                    .map(({ label, value }) => (
                      <Card key={label} className="p-6 rounded-xl shadow-sm">
                        <h3 className="font-semibold text-gray-900 mb-3">{label} Policy</h3>
                        <p className="text-gray-700 text-sm leading-relaxed">{value}</p>
                      </Card>
                    ))}

                  {p.other && p.other.length > 0 && (
                    <Card className="p-6 rounded-xl shadow-sm">
                      <h3 className="font-semibold text-gray-900 mb-3">Other Policies</h3>
                      <ul className="space-y-2">
                        {p.other.map((item, i) => (
                          <li key={i} className="text-gray-700 text-sm leading-relaxed flex gap-2">
                            <span className="text-gray-400 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-4">
            {showNoteInput && (
              <Card className="p-4 rounded-xl shadow-sm">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="e.g. Prof said the midterm will focus on chapters 1–5, not 6."
                  className="mb-2 rounded-lg"
                  rows={4}
                  maxLength={1000}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {noteText.length}/1000 characters
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowNoteInput(false);
                        setNoteText('');
                      }}
                      className="rounded-lg"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddNote}
                      disabled={!noteText.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                    >
                      Save Note
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {!showNoteInput && (
              <Button
                onClick={() => setShowNoteInput(true)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Note
              </Button>
            )}

            <div className="space-y-3">
              {courseNotes.map(note => (
                <Card key={note.id} className="p-4 rounded-xl shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-gray-900 mb-2">{note.text}</p>
                      <p className="text-xs text-gray-500">
                        {format(new Date(note.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteNoteId(note.id)}
                      className="rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {courseNotes.length === 0 && !showNoteInput && (
              <Card className="p-12 text-center rounded-2xl">
                <p className="text-gray-600">No notes yet. Add your first note above.</p>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Course Confirmation */}
      <AlertDialog open={showDeleteCourse} onOpenChange={setShowDeleteCourse}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {course.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the course and all its extracted events. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 rounded-lg"
              onClick={async () => {
                const semesterId = course.semesterId;
                await deleteCourse(course.id);
                navigate('/courses', { state: { semesterId } });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Note Confirmation */}
      <AlertDialog open={!!deleteNoteId} onOpenChange={() => setDeleteNoteId(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The note will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteNote}
              className="bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Course Details */}
      <AddCourseModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        editMode
        existingCourse={{
          id: course.id,
          name: course.name,
          code: course.code,
          professor: course.professor,
          color: course.color,
        }}
      />
    </div>
  );
}