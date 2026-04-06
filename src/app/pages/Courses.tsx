import { useNavigate, useLocation } from 'react-router';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Upload,
  AlertCircle,
  MoreHorizontal,
  Trash2,
  Pencil,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { AddCourseModal } from '../components/AddCourseModal';
import { BulkUploadModal } from '../components/BulkUploadModal';
import { EditSemesterModal } from '../components/EditSemesterModal';

export function Courses() {
  const { user, semesters, courses, events, deleteCourse, signOut } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedCourseForUpload, setSelectedCourseForUpload] = useState<{
    id: string;
    name: string;
    code: string;
    color: string;
  } | undefined>(undefined);
  const [courseToDelete, setCourseToDelete] = useState<string | null>(null);
  const [showEditSemester, setShowEditSemester] = useState(false);

  const activeSemester = semesters.find(s => s.isActive);
  // Restore from navigation state (e.g. back from CourseDetail), otherwise fall back to active semester
  const [selectedSemesterId, setSelectedSemesterId] = useState<string>(
    (location.state as { semesterId?: string } | null)?.semesterId ?? ''
  );
  const effectiveSemesterId = selectedSemesterId || activeSemester?.id || '';

  const displayedCourses = courses.filter(c => c.semesterId === effectiveSemesterId);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
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
              <div className="px-2 py-1.5 text-sm font-medium">
                {user?.displayName}
              </div>
              <div className="px-2 py-1.5 text-xs text-gray-500">
                {user?.email}
              </div>
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Course Details
            </h2>
            <p className="text-gray-600">
              Select a course to view details, deadlines, and policies
            </p>
          </div>

          <div className="flex items-end gap-3">
            {/* Upload Multiple button */}
            <Button
              variant="outline"
              className="rounded-lg shrink-0"
              onClick={() => setShowBulkUpload(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Multiple
            </Button>

            {/* Semester Selector */}
            <div className="w-56">
              <label className="text-sm font-medium text-gray-700 mb-2 block">Semester</label>
              <div className="flex items-center gap-1 group">
                <Select value={effectiveSemesterId} onValueChange={setSelectedSemesterId}>
                  <SelectTrigger className="rounded-lg bg-white border-gray-300 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {semesters.map(semester => (
                      <SelectItem key={semester.id} value={semester.id}>
                        {semester.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {effectiveSemesterId && (
                  <button
                    type="button"
                    onClick={() => setShowEditSemester(true)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Edit semester"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {displayedCourses.length === 0 ? (
          <Card className="p-12 text-center rounded-2xl">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No courses yet
            </h3>
            <p className="text-gray-600 mb-6">
              Add your first course to get started
            </p>
            <Button
              onClick={() => setShowAddCourse(true)}
              className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Add Course
            </Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedCourses.map(course => {
              const hasSyllabus = course.status === 'ready';
              return (
                <Card
                  key={course.id}
                  className="p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden cursor-pointer"
                  style={{ borderLeft: `4px solid ${course.color}` }}
                  onClick={() => navigate(`/course/${course.id}?from=courses`)}
                >
                  {/* Color accent */}
                  <div
                    className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20"
                    style={{ backgroundColor: course.color }}
                  />

                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                        style={{ backgroundColor: course.color }}
                      >
                        {course.code.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex items-center gap-2">
                        {!hasSyllabus && (
                          <Badge variant="outline" className="text-xs text-gray-500 border-gray-300">
                            No syllabus
                          </Badge>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-lg"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-4 w-4 text-gray-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-lg">
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 focus:bg-red-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCourseToDelete(course.id);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Course
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <h3 className="font-semibold text-gray-900 mb-1">
                      {course.code}
                    </h3>
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {course.name}
                    </p>

                    {course.professor && (
                      <p className="text-xs text-gray-500 mb-4">
                        {course.professor}
                      </p>
                    )}

                    {hasSyllabus ? (
                      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <BookOpen className="w-4 h-4" />
                          <span>
                            {events.filter(e => e.courseId === course.id).length} events extracted
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/course/${course.id}?from=courses`);
                          }}
                        >
                          View Details
                        </Button>
                      </div>
                    ) : (
                      <div className="pt-4 border-t border-gray-100">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full rounded-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCourseForUpload({
                              id: course.id,
                              name: course.name,
                              code: course.code,
                              color: course.color,
                            });
                            setShowAddCourse(true);
                          }}
                        >
                          <Upload className="mr-2 h-3 w-3" />
                          Upload Syllabus
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <AddCourseModal
        open={showAddCourse}
        onClose={() => {
          setShowAddCourse(false);
          setSelectedCourseForUpload(undefined);
        }}
        existingCourse={selectedCourseForUpload}
      />

      <BulkUploadModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
      />

      {showEditSemester && effectiveSemesterId && (() => {
        const sem = semesters.find(s => s.id === effectiveSemesterId);
        return sem ? (
          <EditSemesterModal
            open={showEditSemester}
            onClose={() => setShowEditSemester(false)}
            semester={sem}
          />
        ) : null;
      })()}

      <AlertDialog open={!!courseToDelete} onOpenChange={() => setCourseToDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this course?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the course and all its extracted events. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 rounded-lg"
              onClick={async () => {
                if (courseToDelete) await deleteCourse(courseToDelete);
                setCourseToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}