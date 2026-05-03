import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate, useLocation } from 'react-router';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/button';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
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
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { MessageSquare, Plus, LogOut, Calendar, Send, Settings2, BookOpen, Upload, ExternalLink, Menu, X, ChevronUp, ChevronDown, Trash2, Pencil, Flag, Loader2, Cog } from 'lucide-react';
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
import { AddSemesterModal } from '../components/AddSemesterModal';
import { AddCourseModal } from '../components/AddCourseModal';
import { EditSemesterModal } from '../components/EditSemesterModal';
import { DeadlineUrgencyBanner } from '../components/DeadlineUrgencyBanner';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

const SUGGESTED_PROMPTS = [
  "What's due this week?",
  "What's my exam schedule?",
  "Can I miss class on Thursday?",
  "What's the late policy for my courses?",
  "When are office hours?",
  "What assignments can I drop?",
];

export function Dashboard() {
  const { user, semesters, courses, events, signOut, aiEnabled, chats, currentChatId, chatMessages, addChatMessage, startNewChat, selectChat, deleteChat, renameChat, setActiveSemester, submitFeedback, refreshCourses, refreshEvents } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAddSemester, setShowAddSemester] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [selectedCourseForUpload, setSelectedCourseForUpload] = useState<{
    id: string;
    name: string;
    code: string;
    color: string;
  } | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeChatCollapsed, setActiveChatCollapsed] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'knowledge-base' | 'chat'>('knowledge-base');
  const [input, setInput] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [showEditSemester, setShowEditSemester] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSemester = semesters.find(s => s.isActive);
  const lastMessage = chatMessages[chatMessages.length - 1];
  const isTyping = lastMessage?.role === 'user';
  const activeCourses = courses.filter(c => c.semesterId === activeSemester?.id);
  const processingCourses = activeCourses.filter(c => c.status === 'processing');
  const currentChat = chats.find(c => c.id === currentChatId);
  const chatCourseIds = currentChat ? currentChat.courseIds : selectedCourses;
  const selectedCourseObjects = activeCourses.filter(c => chatCourseIds.includes(c.id));

  // Handle navigation from course detail page
  useEffect(() => {
    const state = location.state as { selectedCourseId?: string } | null;
    if (state?.selectedCourseId) {
      // Select only this course
      setSelectedCourses([state.selectedCourseId]);
      // Open the settings sidebar
      setShowSettings(true);
      // Clear the location state
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Poll for processing status while any active-semester courses are still processing
  useEffect(() => {
    if (processingCourses.length === 0) return;
    const interval = setInterval(() => refreshCourses(), 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingCourses.length > 0, refreshCourses]);

  // Refresh events once when processing completes (same semester guard)
  const prevProcessingRef = useRef<{ count: number; semesterId: string | undefined }>({ count: 0, semesterId: undefined });
  useEffect(() => {
    const prev = prevProcessingRef.current;
    prevProcessingRef.current = { count: processingCourses.length, semesterId: activeSemester?.id };
    if (prev.count > 0 && processingCourses.length === 0 && prev.semesterId === activeSemester?.id) {
      refreshEvents();
    }
  }, [processingCourses.length, activeSemester?.id, refreshEvents]);

  const handleSend = () => {
    if (!input.trim() || !aiEnabled || !activeSemester) return;
    addChatMessage(
      { role: 'user', content: input },
      currentChatId ? undefined : { semesterId: activeSemester.id, courseIds: selectedCourses },
    );
    setInput('');
  };

  const handlePromptClick = (prompt: string) => {
    if (!activeSemester) return;
    addChatMessage(
      { role: 'user', content: prompt },
      currentChatId ? undefined : { semesterId: activeSemester.id, courseIds: selectedCourses },
    );
  };

  const toggleCourse = (courseId: string) => {
    setSelectedCourses(prev => 
      prev.includes(courseId) 
        ? prev.filter(id => id !== courseId)
        : [...prev, courseId]
    );
  };

  const toggleAllCourses = () => {
    if (selectedCourses.length === activeCourses.filter(c => c.status === 'ready').length) {
      setSelectedCourses([]);
    } else {
      setSelectedCourses(activeCourses.map(c => c.id));
    }
  };

  const startEditingTitle = (chatId: string, currentTitle: string) => {
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
  };

  const saveEditingTitle = () => {
    if (editingChatId && editingTitle.trim()) {
      renameChat(editingChatId, editingTitle.trim());
    }
    setEditingChatId(null);
  };

  if (semesters.length === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <header className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-indigo-600">Syllabi</h1>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => window.open('https://docs.google.com/forms/d/e/1FAIpQLSfWB-gASY_vhg7xlHgXpdYavrDpX0qcZUmK7_zlaeFKHS2GSg/viewform', '_blank')}
                variant="outline"
                size="sm"
                className="rounded-lg gap-1.5"
              >
                <Flag className="h-4 w-4 text-gray-700" />
                <span className="text-sm font-medium text-gray-900 tracking-tight">Feedback</span>
              </Button>
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
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="mb-6">
              <Calendar className="w-16 h-16 text-indigo-200 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Welcome to Syllabi!
              </h2>
              <p className="text-gray-600">
                Get started by setting up your first semester
              </p>
            </div>
            <Button
              onClick={() => setShowAddSemester(true)}
              className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              Set Up Your First Semester
            </Button>
          </div>
        </main>

        <AddSemesterModal open={showAddSemester} onClose={() => setShowAddSemester(false)} />

        <AlertDialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
          <AlertDialogContent className="rounded-2xl shadow-lg max-w-[510px]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[18px] font-semibold tracking-tight">
                Submit Feedback
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[14px] text-gray-500 leading-5">
                Let us know if you encountered a bug or have any feedback about your experience.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Describe what happened..."
              className="h-[120px] resize-none rounded-[10px] bg-[#f3f3f5] border-0 shadow-[0_0_0_1.23px_rgba(161,161,161,0.21)] text-[14px] placeholder:text-gray-400"
            />
            <AlertDialogFooter>
              <AlertDialogCancel
                className="rounded-[10px] border border-black/10 text-[14px] font-medium"
                onClick={() => { setFeedbackText(''); }}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                onClick={async () => {
                  if (!feedbackText.trim()) return;
                  setFeedbackSubmitting(true);
                  try {
                    await submitFeedback(feedbackText.trim());
                    setFeedbackText('');
                    setFeedbackOpen(false);
                    toast.success('Feedback submitted successfully!', {
                      description: 'Thank you for helping us improve Syllabi.',
                    });
                  } catch {
                    toast.error('Failed to submit feedback.', {
                      description: 'Please try again in a moment.',
                    });
                  } finally {
                    setFeedbackSubmitting(false);
                  }
                }}
                disabled={!feedbackText.trim() || feedbackSubmitting}
                className="rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-[14px] font-medium px-4"
              >
                Submit Feedback
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Hamburger — mobile only */}
            <Button
              onClick={() => setMobileMenuOpen(true)}
              variant="ghost"
              size="sm"
              className="rounded-lg md:hidden -ml-2"
            >
              <Menu className="h-5 w-5 text-gray-600" />
            </Button>
            <h1 className="text-xl font-bold text-indigo-600">Syllabi</h1>
          </div>
          <div className="flex items-center gap-3">
            {user?.isAdmin && (
              <Button
                onClick={() => navigate('/admin')}
                variant="outline"
                size="sm"
                className="rounded-lg"
              >
                <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                  Admin
                </Badge>
              </Button>
            )}
            <Button
              onClick={() => window.open('https://docs.google.com/forms/d/e/1FAIpQLSfWB-gASY_vhg7xlHgXpdYavrDpX0qcZUmK7_zlaeFKHS2GSg/viewform', '_blank')}
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5"
            >
              <Flag className="h-4 w-4 text-gray-700" />
              <span className="text-sm font-medium text-gray-900 tracking-tight">Feedback</span>
            </Button>
            {/* Settings toggle — desktop only */}
            <Button
              onClick={() => setShowSettings(!showSettings)}
              variant="ghost"
              size="sm"
              className="rounded-lg hidden md:inline-flex"
            >
              <Settings2 className="h-5 w-5 text-gray-600" />
            </Button>
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
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Mobile overlay backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        {(showSettings || mobileMenuOpen) && (
          <div className={`
            bg-gray-50 overflow-y-auto
            ${mobileMenuOpen
              ? 'fixed inset-y-0 left-0 z-50 w-80 md:hidden'
              : 'hidden md:block w-80 border-r border-gray-200'
            }
          `}>
            <div className="p-6">
              {/* Mobile menu header */}
              <div className="flex items-center gap-2 mb-5 md:hidden">
                <Button
                  onClick={() => setMobileMenuOpen(false)}
                  variant="ghost"
                  size="sm"
                  className="rounded-lg -ml-2"
                >
                  <X className="h-5 w-5 text-gray-600" />
                </Button>
                <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              </div>
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

              {/* Knowledge Base Content */}
              {sidebarTab === 'knowledge-base' && (<>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Knowledge Base</h2>
                <Button
                  onClick={() => setShowAddCourse(true)}
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Semester Selector */}
              <div className="mb-6">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Semester</label>
                <div className="flex items-center gap-1 group">
                  <Select
                    value={activeSemester?.id}
                    onValueChange={(id) => {
                      setActiveSemester(id);
                      setSelectedCourses([]);
                    }}
                  >
                    <SelectTrigger className="rounded-lg bg-white flex-1">
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
                  <button
                    type="button"
                    onClick={() => setShowEditSemester(true)}
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
                    Analyzing {processingCourses.length} syllabus{processingCourses.length > 1 ? 'es' : ''}…
                  </span>
                </div>
              )}

              {/* Course Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">Courses to Ask About</label>
                  <Button
                    onClick={toggleAllCourses}
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 rounded-lg"
                  >
                    {selectedCourses.length === activeCourses.filter(c => c.status === 'ready').length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
                <div className="space-y-2">
                  {activeCourses.map(course => {
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
                              onCheckedChange={() => toggleCourse(course.id)}
                              className="mt-0.5"
                            />
                            <label
                              htmlFor={`course-${course.id}`}
                              className="flex-1 cursor-pointer"
                            >
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
                                <Badge variant="outline" className="text-xs text-gray-500 border-gray-300">
                                  No syllabus
                                </Badge>
                              </div>
                              <div className="text-xs text-gray-500 line-clamp-1 mb-2">{course.name}</div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs rounded-lg w-full"
                                onClick={() => {
                                  // TODO: Open upload modal for this specific course
                                  setSelectedCourseForUpload({ id: course.id, name: course.name, code: course.code, color: course.color });
                                  setShowAddCourse(true);
                                }}
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
                onClick={() => { startNewChat(); setMobileMenuOpen(false); }}
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
                    onClick={() => setShowAddSemester(true)}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start rounded-lg"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Semester
                  </Button>
                  <Button
                    onClick={() => setShowAddCourse(true)}
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
              </>)}

              {/* Chat Content */}
              {sidebarTab === 'chat' && (
                <div className="flex flex-col gap-5">
                  {/* Header */}
                  <div>
                    <h3 className="text-sm font-medium text-[#364153] mb-1.5">Chat History</h3>
                    <p className="text-xs text-[#6a7282]">Your previous conversations will appear here</p>
                  </div>

                  {/* Chat list */}
                  <div className="flex flex-col gap-2">
                    {chats.length === 0 && (
                      <p className="text-xs text-[#99a1af] text-center py-4">No chats yet</p>
                    )}
                    {chats.map(chat => (
                      <div
                        key={chat.id}
                        className={`group relative w-full border rounded-[10px] p-3 text-left transition-colors cursor-pointer ${
                          chat.id === currentChatId
                            ? 'bg-indigo-50 border-[#a3b3ff]'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => { if (editingChatId !== chat.id) { selectChat(chat.id); setMobileMenuOpen(false); } }}
                      >
                        {editingChatId === chat.id && chat.id !== currentChatId ? (
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onBlur={saveEditingTitle}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEditingTitle();
                              if (e.key === 'Escape') setEditingChatId(null);
                            }}
                            className="text-sm font-medium text-gray-900 bg-transparent border-b border-indigo-400 outline-none w-full pr-7"
                          />
                        ) : (
                          <div className="flex items-center gap-1 pr-7">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {chat.title ?? 'Chat'}
                            </p>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditingTitle(chat.id, chat.title ?? 'Chat'); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-200 shrink-0"
                              aria-label="Rename chat"
                            >
                              <Pencil className="h-4 w-4 text-gray-400" />
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-[#99a1af] mt-1">
                          {format(parseISO(chat.createdAt), 'MMM d, h:mm a')}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); setChatToDelete(chat.id); }}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-50"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Divider + New Chat */}
                  <div className="border-t border-gray-200 pt-6">
                    <button
                      onClick={startNewChat}
                      className="w-full bg-white border border-black/10 rounded-[10px] h-8 flex items-center gap-2 px-2.5 hover:bg-gray-50 transition-colors"
                    >
                      <Plus className="h-4 w-4 text-gray-900" />
                      <span className="text-sm font-medium text-gray-900">New Chat</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Chat Interface */}
        <div className="flex-1 flex flex-col">
          {/* Chat Header */}
          <div className="border-b border-[#e5e7eb] pt-4 pb-3 px-7 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="group flex items-center gap-1.5 min-w-0">
                {editingChatId !== null && editingChatId === currentChatId ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={saveEditingTitle}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEditingTitle();
                      if (e.key === 'Escape') setEditingChatId(null);
                    }}
                    className="text-sm font-medium text-[#364153] leading-5 tracking-[-0.015em] bg-transparent border-b border-indigo-400 outline-none min-w-0 w-full max-w-xs"
                  />
                ) : (
                  <>
                    <p className="text-sm font-medium text-[#364153] leading-5 tracking-[-0.015em] truncate">
                      {currentChat?.title ?? 'New Chat'}
                    </p>
                    {currentChat && (
                      <button
                        onClick={() => startEditingTitle(currentChatId!, currentChat.title ?? 'New Chat')}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-100 shrink-0"
                        aria-label="Rename chat"
                      >
                        <Pencil className="h-4 w-4 text-gray-400" />
                      </button>
                    )}
                  </>
                )}
              </div>
              {selectedCourseObjects.length > 0 && (
                <button
                  onClick={() => setActiveChatCollapsed(v => !v)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={activeChatCollapsed ? 'Expand active chat' : 'Collapse active chat'}
                >
                  {activeChatCollapsed
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronUp className="h-4 w-4" />
                  }
                </button>
              )}
            </div>
            {!activeChatCollapsed && selectedCourseObjects.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedCourseObjects.map(course => (
                  <div key={course.id} className="inline-flex items-center gap-2 border border-[#e5e7eb] rounded-full px-3.5 py-0.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: course.color }} />
                    <span className="text-sm font-medium text-[#101828] tracking-[-0.015em]">{course.code}</span>
                    <span className="text-sm text-[#6a7282]">·</span>
                    <span className="text-sm text-[#4a5565] tracking-[-0.015em]">{course.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <div className="max-w-3xl mx-auto">

              <DeadlineUrgencyBanner
                events={events.filter(e => activeCourses.some(c => c.id === e.courseId))}
                courses={activeCourses}
                activeSemesterId={activeSemester?.id}
              />

              {/* Welcome / Empty State */}
              {chatMessages.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                    Hi {user?.displayName?.split(' ')[0]}! 👋
                  </h2>
                  <p className="text-gray-600 mb-8">
                    I'm here to help you stay on top of your courses. Ask me anything about your syllabi!
                  </p>

                  {/* Suggested Prompts */}
                  {aiEnabled && selectedCourses.length > 0 && (
                    <div className="max-w-2xl mx-auto">
                      <p className="text-sm text-gray-500 mb-4">Try asking:</p>
                      <div className="grid md:grid-cols-2 gap-3">
                        {SUGGESTED_PROMPTS.map((prompt, index) => (
                          <button
                            key={index}
                            onClick={() => handlePromptClick(prompt)}
                            className="text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-sm"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No courses selected */}
                  {selectedCourses.length === 0 && (
                    <div className="mt-8">
                      <Card className="max-w-md mx-auto p-6 rounded-2xl">
                        <p className="text-gray-600 mb-4">
                          Select courses from the knowledge base to get started
                        </p>
                        <Button
                          onClick={() => setShowSettings(true)}
                          className="bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          Configure Knowledge Base
                        </Button>
                      </Card>
                    </div>
                  )}
                </div>
              )}

              {/* Chat Messages */}
              <div className="space-y-6">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                        message.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {message.role === 'assistant' ? (
                        <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-table:w-full prose-th:text-left prose-th:font-semibold prose-td:align-top prose-blockquote:border-l-indigo-400 prose-blockquote:text-gray-600">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      )}
                      <p
                        className={`text-xs mt-2 ${
                          message.role === 'user' ? 'text-indigo-200' : 'text-gray-500'
                        }`}
                      >
                        {format(new Date(message.timestamp), 'h:mm a')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {isTyping && (
                <div className="flex justify-start mt-6">
                  <div className="bg-gray-100 rounded-2xl px-5 py-3 flex items-center gap-1">
                    {[0, 200, 400].map((delay) => (
                      <div
                        key={delay}
                        className="w-2 h-2 bg-gray-400 rounded-full"
                        style={{ animation: `typingDot 1.2s ease-in-out ${delay}ms infinite` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 px-6 py-4 bg-white">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFeedbackOpen(true)}
                  disabled={!currentChatId}
                  className="shrink-0 rounded-full text-gray-400 hover:text-gray-600 h-12 w-12"
                  title="Submit feedback"
                >
                  <Flag className="h-4 w-4" />
                </Button>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    !aiEnabled
                      ? 'AI is currently disabled'
                      : !currentChatId && selectedCourses.length === 0
                      ? 'Select courses to start chatting...'
                      : 'Ask a question about your courses...'
                  }
                  disabled={!aiEnabled || (!currentChatId && selectedCourses.length === 0)}
                  className="rounded-full flex-1 px-6"
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || !aiEnabled || (!currentChatId && selectedCourses.length === 0)}
                  className="rounded-full bg-indigo-600 hover:bg-indigo-700 h-12 px-6"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AddSemesterModal open={showAddSemester} onClose={() => setShowAddSemester(false)} />
      {showEditSemester && activeSemester && (
        <EditSemesterModal
          open={showEditSemester}
          onClose={() => setShowEditSemester(false)}
          semester={activeSemester}
        />
      )}
      <AddCourseModal
        open={showAddCourse}
        onClose={() => {
          setShowAddCourse(false);
          setSelectedCourseForUpload(undefined);
        }}
        existingCourse={selectedCourseForUpload}
      />

      <AlertDialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <AlertDialogContent className="rounded-2xl shadow-lg max-w-[510px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[18px] font-semibold tracking-tight">
              Submit Feedback
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] text-gray-500 leading-5">
              Let us know if you encountered a bug or have any feedback about your experience.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Describe what happened..."
            className="h-[120px] resize-none rounded-[10px] bg-[#f3f3f5] border-0 shadow-[0_0_0_1.23px_rgba(161,161,161,0.21)] text-[14px] placeholder:text-gray-400"
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              className="rounded-[10px] border border-black/10 text-[14px] font-medium"
              onClick={() => { setFeedbackText(''); }}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={async () => {
                if (!feedbackText.trim()) return;
                setFeedbackSubmitting(true);
                try {
                  await submitFeedback(feedbackText.trim());
                  setFeedbackText('');
                  setFeedbackOpen(false);
                  toast.success('Feedback submitted successfully!', {
                    description: 'Thank you for helping us improve Syllabi.',
                  });
                } catch {
                  toast.error('Failed to submit feedback.', {
                    description: 'Please try again in a moment.',
                  });
                } finally {
                  setFeedbackSubmitting(false);
                }
              }}
              disabled={!feedbackText.trim() || feedbackSubmitting}
              className="rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-[14px] font-medium px-4"
            >
              Submit Feedback
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={chatToDelete !== null} onOpenChange={(open) => { if (!open) setChatToDelete(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This chat will be permanently deleted from your chat history forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[10px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-[10px] bg-[#e7000b] hover:bg-[#c50009] text-white"
              onClick={() => { if (chatToDelete) { deleteChat(chatToDelete); setChatToDelete(null); } }}
            >
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}