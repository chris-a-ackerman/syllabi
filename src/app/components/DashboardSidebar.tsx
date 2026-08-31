import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BookOpen,
  ExternalLink,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import type { Course, Semester } from '@/lib/types';
import { useData } from '../context/DataProvider';
import { useChat } from '../context/ChatProvider';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ChatHistoryList } from './ChatHistoryList';
import type { ChatRenameControls } from '../hooks/useChatRename';

interface DashboardSidebarProps {
  activeSemester?: Semester;
  activeCourses: Course[];
  selectedCourses: string[];
  onToggleCourse: (courseId: string) => void;
  onToggleAllCourses: () => void;
  onSemesterChange: (semesterId: string) => void;
  rename: ChatRenameControls;
  mobileMenuOpen: boolean;
  onCloseMobileMenu: () => void;
  onAddSemester: () => void;
  onAddCourse: () => void;
  onEditSemester: () => void;
  onUploadSyllabus: (course: Course) => void;
}

/**
 * The dashboard's left panel: a knowledge-base tab (semester, course selection,
 * quick actions) and a chat-history tab. Doubles as the mobile drawer.
 */
export function DashboardSidebar({
  activeSemester,
  activeCourses,
  selectedCourses,
  onToggleCourse,
  onToggleAllCourses,
  onSemesterChange,
  rename,
  mobileMenuOpen,
  onCloseMobileMenu,
  onAddSemester,
  onAddCourse,
  onEditSemester,
  onUploadSyllabus,
}: DashboardSidebarProps) {
  const navigate = useNavigate();
  const { semesters } = useData();
  const { startNewChat } = useChat();
  const [sidebarTab, setSidebarTab] = useState<'knowledge-base' | 'chat'>('knowledge-base');

  const readyCourses = activeCourses.filter((c) => c.status === 'ready');
  const processingCourses = activeCourses.filter((c) => c.status === 'processing');
  const allReadySelected =
    readyCourses.length > 0 && selectedCourses.length === readyCourses.length;

  return (
    <div
      className={`
        bg-gray-50 overflow-y-auto
        ${
          mobileMenuOpen
            ? 'fixed inset-y-0 left-0 z-50 w-80 md:hidden'
            : 'hidden md:block w-80 border-r border-gray-200'
        }
      `}
    >
      <div className="p-6">
        {/* Mobile menu header */}
        <div className="flex items-center gap-2 mb-5 md:hidden">
          <Button
            onClick={onCloseMobileMenu}
            variant="ghost"
            size="sm"
            className="rounded-lg -ml-2"
            aria-label="Close menu"
          >
            <X className="h-5 w-5 text-gray-600" />
          </Button>
          <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
        </div>

        {/* Agenda — mobile only; the header entry is desktop only */}
        <button
          type="button"
          onClick={() => {
            onCloseMobileMenu();
            navigate('/agenda');
          }}
          className="md:hidden w-full flex items-center gap-2 mb-5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-900 hover:border-indigo-300 transition-colors"
        >
          <ListChecks className="h-4 w-4 text-gray-600" />
          Agenda
        </button>

        {/* Pill Navigation */}
        <div className="bg-gray-200 rounded-full p-1 flex mb-6">
          <button
            onClick={() => setSidebarTab('knowledge-base')}
            className={`flex-1 py-2 text-sm font-medium rounded-full transition-all ${
              sidebarTab === 'knowledge-base'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Knowledge Base
          </button>
          <button
            onClick={() => setSidebarTab('chat')}
            className={`flex-1 py-2 text-sm font-medium rounded-full transition-all ${
              sidebarTab === 'chat'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Chat
          </button>
        </div>

        {sidebarTab === 'knowledge-base' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Knowledge Base</h2>
              <Button onClick={onAddCourse} size="sm" variant="ghost" className="rounded-lg">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Semester Selector */}
            <div className="mb-6">
              <label className="text-sm font-medium text-gray-700 mb-2 block">Semester</label>
              <div className="flex items-center gap-1 group">
                <Select value={activeSemester?.id} onValueChange={onSemesterChange}>
                  <SelectTrigger className="rounded-lg bg-white flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {semesters.map((semester) => (
                      <SelectItem key={semester.id} value={semester.id}>
                        {semester.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={onEditSemester}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 shrink-0"
                  title="Edit semester"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Processing indicator */}
            {processingCourses.length > 0 && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
                <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin shrink-0" />
                <span className="text-xs text-indigo-700">
                  Analyzing {processingCourses.length} syllabus
                  {processingCourses.length > 1 ? 'es' : ''}…
                </span>
              </div>
            )}

            {/* Course Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">Courses to Ask About</label>
                <Button
                  onClick={onToggleAllCourses}
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 rounded-lg"
                >
                  {allReadySelected ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <div className="space-y-2">
                {activeCourses.map((course) => {
                  const hasSyllabus = course.status === 'ready';
                  return (
                    <div
                      key={course.id}
                      className={`group relative flex items-start gap-3 p-3 bg-white rounded-lg border transition-colors ${
                        hasSyllabus
                          ? 'border-gray-200 hover:border-indigo-300'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div
                        className="w-1 h-full absolute left-0 top-0 rounded-l-lg"
                        style={{ backgroundColor: course.color, opacity: hasSyllabus ? 1 : 0.3 }}
                      />
                      {hasSyllabus ? (
                        <>
                          <Checkbox
                            id={`course-${course.id}`}
                            checked={selectedCourses.includes(course.id)}
                            onCheckedChange={() => onToggleCourse(course.id)}
                            className="mt-0.5"
                          />
                          <label htmlFor={`course-${course.id}`} className="flex-1 cursor-pointer">
                            <div className="text-sm font-medium text-gray-900">{course.code}</div>
                            <div className="text-xs text-gray-600 line-clamp-1">{course.name}</div>
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(`/course/${course.id}?from=dashboard`);
                            }}
                          >
                            <ExternalLink className="h-3 w-3 text-gray-400" />
                          </Button>
                        </>
                      ) : (
                        <div className="flex-1 flex items-start gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="text-sm font-medium text-gray-500">{course.code}</div>
                              <Badge
                                variant="outline"
                                className="text-xs text-gray-500 border-gray-300"
                              >
                                No syllabus
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-500 line-clamp-1 mb-2">
                              {course.name}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs rounded-lg w-full"
                              onClick={() => onUploadSyllabus(course)}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Upload Syllabus
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(`/course/${course.id}?from=dashboard`);
                            }}
                          >
                            <ExternalLink className="h-3 w-3 text-gray-400" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* New Chat With Selected Courses */}
            <Button
              onClick={() => {
                startNewChat();
                onCloseMobileMenu();
              }}
              disabled={selectedCourses.length === 0}
              className="w-full h-9 mt-3 rounded-[10px] bg-[#4f39f6] hover:bg-[#4333d9] text-white text-sm font-medium gap-2 disabled:opacity-40"
            >
              <MessageSquare className="h-4 w-4" />
              New Chat With Selected Courses
            </Button>

            {/* Quick Actions */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <Button
                  onClick={onAddSemester}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start rounded-lg"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Semester
                </Button>
                <Button
                  onClick={onAddCourse}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start rounded-lg"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Course
                </Button>
                <Button
                  onClick={() => navigate('/courses')}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start rounded-lg"
                  disabled={activeCourses.length === 0}
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  View Course Details
                </Button>
              </div>
            </div>
          </>
        )}

        {sidebarTab === 'chat' && (
          <ChatHistoryList rename={rename} onChatOpened={onCloseMobileMenu} />
        )}
      </div>
    </div>
  );
}
