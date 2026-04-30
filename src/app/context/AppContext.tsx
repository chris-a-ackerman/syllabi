import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatar?: string;
  isAdmin: boolean;
  onboardingCompleted: boolean;
}

export interface Semester {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface CourseSchedule {
  // Meeting pattern
  meeting_days?: string[] | null;
  meeting_times?: { start: string | null; end: string | null } | null;
  location?: string | null;
  instructor?: {
    name?: string | null;
    email?: string | null;
    office?: string | null;
    office_hours?: string | null;
  } | null;
  // Semester structure
  semester_start?: string | null;
  semester_end?: string | null;
  total_weeks?: number | null;
  finals_period_start?: string | null;
  finals_period_end?: string | null;
  breaks?: Array<{ name: string; start_date: string; end_date: string }>;
  notes?: string | null;
}

export interface Policies {
  attendance?: string | null;
  late_work?: string | null;
  academic_integrity?: string | null;
  technology?: string | null;
  ai_policy?: string | null;
  recording?: string | null;
  other?: string[];
}

export interface GradingRulesComponent {
  name: string;
  weight: number;
  count?: number | null;
  description?: string | null;
  drop_lowest?: number;
}

export interface GradingRules {
  components: GradingRulesComponent[];
  late_policy?: string | null;
  grading_scale?: string | null;
}

export interface Course {
  id: string;
  semesterId: string;
  name: string;
  code: string;
  professor: string;
  color: string;
  status: 'processing' | 'ready' | 'failed';
  syllabusUrl?: string;
  extractionQuality?: 'complete' | 'partial' | 'minimal';
  extractedCount?: number;
  grading_rules?: GradingRules;
  policies?: Policies;
  schedule?: CourseSchedule;
}

export interface CanvasMetadata {
  points_possible: number | null;
  submission_types: string[] | null;
  assignment_group: string | null;
  description_summary: string | null;
  canvas_url: string | null;
  unlock_at: string | null;
  allowed_attempts: number | null;
  time_limit: number | null;
}

export interface Event {
  id: string;
  courseId: string;
  title: string;
  date: string | null;
  time?: string | null;
  type: 'exam' | 'deadline' | 'quiz' | 'presentation' | 'project_due' | 'no_class' | 'other';
  confidence?: 'low' | 'medium' | 'high';
  canvasMetadata?: CanvasMetadata | null;
}

export interface GradingComponent {
  id: string;
  courseId: string;
  name: string;
  weight: number;
  count?: number;
  dropPolicy?: string;
  latePolicy?: string;
}

export interface Note {
  id: string;
  courseId: string;
  text: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sequence?: number;
}

export interface Chat {
  id: string;
  semesterId: string;
  title: string | null;
  courseIds: string[];
  createdAt: string;
}

interface AppState {
  user: User | null;
  loading: boolean;
  semesters: Semester[];
  courses: Course[];
  events: Event[];
  gradingComponents: GradingComponent[];
  notes: Note[];
  chats: Chat[];
  currentChatId: string | null;
  chatMessages: ChatMessage[];
  aiEnabled: boolean;
  chatOpen: boolean;
  setUser: (user: User | null) => void;
  addSemester: (semester: Omit<Semester, 'id'>) => Promise<string>;
  updateSemester: (id: string, updates: { name: string; startDate: string; endDate: string; isActive: boolean }) => Promise<void>;
  deleteSemester: (id: string) => Promise<void>;
  markOnboardingComplete: () => Promise<void>;
  setActiveSemester: (id: string) => Promise<void>;
  addCourse: (course: Omit<Course, 'id'>) => Promise<string | undefined>;
  deleteCourse: (id: string) => Promise<void>;
  updateCourse: (id: string, updates: Partial<Course>) => void;
  refreshCourses: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  addNote: (note: Omit<Note, 'id' | 'createdAt'>) => void;
  deleteNote: (id: string) => void;
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>, context?: { semesterId: string; courseIds: string[] }) => void;
  startNewChat: () => void;
  selectChat: (chatId: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  setAiEnabled: (enabled: boolean) => void;
  setChatOpen: (open: boolean) => void;
  submitFeedback: (description: string) => Promise<void>;
  signOut: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

// ─── DB → App mappers ────────────────────────────────────────────────────────
// These will be replaced by generated Supabase types once `supabase gen types` is run.

function mapAnalysisStatus(dbStatus: string | null): Course['status'] {
  if (dbStatus === 'complete') return 'ready';
  if (dbStatus === 'failed') return 'failed';
  if (dbStatus === 'processing') return 'processing';
  return 'ready'; // null or 'pending' = no syllabus uploaded yet
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbSemesterToApp(row: any): Semester {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbCourseToApp(row: any): Course {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = row.syllabus_analysis as Record<string, any> | null;
  const gradingRules: GradingRules | undefined =
    row.grading_rules ?? analysis?.grading_rules ?? undefined;
  const policies: Policies | undefined =
    row.policies ?? analysis?.policies ?? undefined;
  const schedule: CourseSchedule | undefined =
    row.schedule ?? undefined;
  return {
    id: row.id,
    semesterId: row.semester_id,
    name: row.name,
    code: row.code ?? '',
    professor: row.professor ?? '',
    color: row.color ?? '#6366f1',
    status: mapAnalysisStatus(row.analysis_status),
    syllabusUrl: row.syllabus_file_path ?? undefined,
    extractionQuality: analysis?.extraction_quality ?? undefined,
    grading_rules: gradingRules,
    policies,
    schedule,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbEventToApp(row: any): Event {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    date: row.date ?? null,
    time: row.time ?? null,
    type: row.type as Event['type'],
    confidence: row.confidence as Event['confidence'],
    canvasMetadata: row.canvas_metadata ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbChatToApp(row: any, courseIds: string[]): Chat {
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title ?? null,
    courseIds,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbChatMessageToApp(row: any): ChatMessage {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.created_at,
    sequence: row.sequence,
  };
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Build a User immediately from Supabase auth tokens (no extra DB round-trip).
// isAdmin defaults to false and is corrected by enrichUserWithProfile below.
function authUserFromSession(supabaseUser: SupabaseUser): User {
  const displayName =
    supabaseUser.user_metadata?.display_name ||
    supabaseUser.email?.split('@')[0] ||
    'User';
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    displayName,
    avatar: getInitials(displayName),
    isAdmin: false,
    onboardingCompleted: false,
  };
}

// Fire-and-forget: fetch the profiles row and patch displayName + isAdmin.
// Defined outside the component so it's a stable reference.
function enrichUserWithProfile(
  userId: string,
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
) {
  supabase
    .from('profiles')
    .select('display_name, is_admin, onboarding_completed')
    .eq('id', userId)
    .single()
    .then(({ data: profile }) => {
      if (!profile) return;
      setUser(prev => {
        if (!prev || prev.id !== userId) return prev;
        const displayName = profile.display_name || prev.displayName;
        return {
          ...prev,
          displayName,
          avatar: getInitials(displayName),
          isAdmin: profile.is_admin ?? false,
          onboardingCompleted: profile.onboarding_completed ?? false,
        };
      });
    });
}

// ─────────────────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [gradingComponents] = useState<GradingComponent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      if (isSupabaseConfigured()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            // Set user immediately — no awaiting the profile fetch so loading clears fast.
            setUser(authUserFromSession(session.user));
            enrichUserWithProfile(session.user.id, setUser);
          }
        } catch (error) {
          console.error('Error checking session:', error);
        }
      }
      setLoading(false);
    };

    checkSession();

    if (isSupabaseConfigured()) {
      // Callback must be synchronous so setUser is called before navigate() in AuthScreen.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setUser(authUserFromSession(session.user));
          enrichUserWithProfile(session.user.id, setUser);
        } else {
          setUser(null);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  // Fetch semesters and courses whenever the logged-in user changes
  useEffect(() => {
    if (!user) {
      setSemesters([]);
      setCourses([]);
      setEvents([]);
      setChats([]);
      setCurrentChatId(null);
      setChatMessages([]);
      setChatOpen(false);
      return;
    }

    const fetchData = async () => {
      const [
        { data: semesterRows, error: semErr },
        { data: courseRows, error: courseErr },
        { data: eventRows, error: eventErr },
      ] = await Promise.all([
        supabase.from('semesters').select('*').order('created_at', { ascending: false }),
        supabase.from('courses').select('*').order('created_at', { ascending: false }),
        supabase.from('course_events').select('*').order('date', { ascending: true }),
      ]);

      if (semErr) console.error('Error fetching semesters:', semErr);
      if (courseErr) console.error('Error fetching courses:', courseErr);
      if (eventErr) console.error('Error fetching events:', eventErr);

      const fetchedCourses = (courseRows ?? []).map(dbCourseToApp);
      setSemesters((semesterRows ?? []).map(dbSemesterToApp));
      setCourses(fetchedCourses);
      setEvents((eventRows ?? []).map(dbEventToApp));
      if (fetchedCourses.length > 0) setChatOpen(true);

      const { data: chatRows, error: chatErr } = await supabase
        .from('chats')
        .select('*, chat_courses(course_id)')
        .order('created_at', { ascending: false });
      if (chatErr) console.error('Error fetching chats:', chatErr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedChats = (chatRows ?? []).map((row: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dbChatToApp(row, (row.chat_courses ?? []).map((cc: any) => cc.course_id))
      );
      setChats(mappedChats);

      if (mappedChats.length > 0) {
        const mostRecentId = mappedChats[0].id;
        setCurrentChatId(mostRecentId);
        const { data: msgRows } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('chat_id', mostRecentId)
          .order('sequence', { ascending: true });
        setChatMessages((msgRows ?? []).map(dbChatMessageToApp));
      }
    };

    fetchData();
  }, [user?.id]);

  const addSemester = async (semester: Omit<Semester, 'id'>): Promise<string> => {
    if (!user) return '';

    // Deactivate all existing semesters if the new one is active
    if (semester.isActive) {
      await supabase.from('semesters').update({ is_active: false }).eq('user_id', user.id);
      setSemesters(prev => prev.map(s => ({ ...s, isActive: false })));
    }

    const { data, error } = await supabase
      .from('semesters')
      .upsert(
        {
          user_id: user.id,
          name: semester.name,
          start_date: semester.startDate,
          end_date: semester.endDate,
          is_active: semester.isActive,
        },
        { onConflict: 'user_id,name' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error adding semester:', error);
      return '';
    }

    setSemesters(prev => {
      if (prev.some(s => s.id === data.id)) return prev;
      return [dbSemesterToApp(data), ...prev];
    });
    return data.id;
  };

  const updateSemester = async (id: string, updates: { name: string; startDate: string; endDate: string; isActive: boolean }) => {
    if (!user) return;
    if (updates.isActive) {
      await supabase.from('semesters').update({ is_active: false }).eq('user_id', user.id);
      setSemesters(prev => prev.map(s => ({ ...s, isActive: false })));
    }
    await supabase.from('semesters').update({
      name: updates.name,
      start_date: updates.startDate,
      end_date: updates.endDate,
      is_active: updates.isActive,
    }).eq('id', id);
    setSemesters(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteSemester = async (id: string) => {
    if (!user) return;
    const courseIds = courses.filter(c => c.semesterId === id).map(c => c.id);
    if (courseIds.length > 0) {
      await supabase.from('course_events').delete().in('course_id', courseIds);
      await supabase.from('grading_components').delete().in('course_id', courseIds);
      await supabase.from('notes').delete().in('course_id', courseIds);
      await supabase.from('courses').delete().in('id', courseIds);
    }
    await supabase.from('semesters').delete().eq('id', id);
    setCourses(prev => prev.filter(c => c.semesterId !== id));
    setSemesters(prev => {
      const remaining = prev.filter(s => s.id !== id);
      const wasActive = prev.find(s => s.id === id)?.isActive;
      if (wasActive && remaining.length > 0) {
        const next = remaining[0];
        supabase.from('semesters').update({ is_active: true }).eq('id', next.id);
        return remaining.map(s => ({ ...s, isActive: s.id === next.id }));
      }
      return remaining;
    });
  };

  const markOnboardingComplete = async () => {
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ onboarding_completed: true, onboarding_completed_at: new Date().toISOString() })
      .eq('id', user.id);
    setUser(prev => prev ? { ...prev, onboardingCompleted: true } : prev);
  };

  const setActiveSemester = async (id: string) => {
    if (!user) return;
    setSemesters(prev => prev.map(s => ({ ...s, isActive: s.id === id }))); // Optimistic update
    await supabase.from('semesters').update({ is_active: false }).eq('user_id', user.id);
    await supabase.from('semesters').update({ is_active: true }).eq('id', id);
  };

  const addCourse = async (course: Omit<Course, 'id'>): Promise<string | undefined> => {
    if (!user) return undefined;

    const { data, error } = await supabase
      .from('courses')
      .insert({
        user_id: user.id,
        semester_id: course.semesterId,
        name: course.name,
        code: course.code,
        professor: course.professor,
        color: course.color,
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding course:', error);
      return undefined;
    }

    const newCourse = dbCourseToApp(data);
    setCourses(prev => [newCourse, ...prev]);
    if (courses.length === 0) setChatOpen(true);
    return data.id;
  };

  const deleteCourse = async (id: string) => {
    const { error } = await supabase.from('courses').delete().eq('id', id);
    if (error) {
      console.error('Error deleting course:', error);
      return;
    }
    setCourses(prev => prev.filter(c => c.id !== id));
  };

  const updateCourse = (id: string, updates: Partial<Course>) => {
    setCourses(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

    // Persist subset of fields that map 1:1 to DB columns
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.code !== undefined) dbUpdates.code = updates.code;
    if (updates.professor !== undefined) dbUpdates.professor = updates.professor;
    if (updates.color !== undefined) dbUpdates.color = updates.color;

    if (Object.keys(dbUpdates).length > 0) {
      supabase.from('courses').update(dbUpdates).eq('id', id)
        .then(({ error }) => { if (error) console.error('Error updating course:', error); });
    }
  };

  const refreshCourses = async () => {
    const { data: courseRows, error } = await supabase
      .from('courses')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('Error refreshing courses:', error); return; }
    setCourses((courseRows ?? []).map(dbCourseToApp));
  };

  const refreshEvents = async () => {
    const { data: eventRows, error } = await supabase
      .from('course_events')
      .select('*')
      .order('date', { ascending: true });
    if (error) { console.error('Error refreshing events:', error); return; }
    setEvents((eventRows ?? []).map(dbEventToApp));
  };

  const addNote = (note: Omit<Note, 'id' | 'createdAt'>) => {
    const newNote = {
      ...note,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setNotes(prev => [newNote, ...prev]);
  };

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const addChatMessage = (
    message: Omit<ChatMessage, 'id' | 'timestamp'>,
    context?: { semesterId: string; courseIds: string[] },
  ) => {
    // Capture conversation history before adding the new message
    const conversationHistory = chatMessages.map(m => ({ role: m.role, content: m.content }));
    const userSequence = chatMessages.length + 1;
    const tempId = `temp-${Date.now()}`;
    setChatMessages(prev => [...prev, { ...message, id: tempId, timestamp: new Date().toISOString(), sequence: userSequence }]);

    (async () => {
      let chatId = currentChatId;
      let semesterId = context?.semesterId;

      if (!chatId && user && context) {
        const { data: chatData, error: chatError } = await supabase
          .from('chats')
          .insert({
            user_id: user.id,
            semester_id: context.semesterId,
            title: message.role === 'user' ? message.content.slice(0, 100) : null,
          })
          .select()
          .single();

        if (chatError || !chatData) {
          console.error('[chat] Error creating chat record:', chatError);
          setChatMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: "Sorry, I couldn't start a new conversation. Please try again.",
            timestamp: new Date().toISOString(),
          }]);
          return;
        }

        chatId = chatData.id;
        setCurrentChatId(chatId);

        if (context.courseIds.length > 0) {
          await supabase.from('chat_courses').insert(
            context.courseIds.map(cid => ({ chat_id: chatId, course_id: cid }))
          );
        }

        setChats(prev => [dbChatToApp(chatData, context.courseIds), ...prev]);
      }

      // For existing chats, look up semesterId from chats state
      if (!semesterId && chatId) {
        semesterId = chats.find(c => c.id === chatId)?.semesterId;
      }

      if (!chatId) return;

      const { data: msgData, error: msgError } = await supabase
        .from('chat_messages')
        .insert({ chat_id: chatId, sequence: userSequence, role: message.role, content: message.content })
        .select()
        .single();

      if (msgError || !msgData) {
        console.error('[chat] Error saving user message to DB:', msgError);
        return;
      }

      setChatMessages(prev => prev.map(m => m.id === tempId ? dbChatMessageToApp(msgData) : m));

      if (message.role === 'user' && aiEnabled && semesterId) {
        const aiSequence = userSequence + 1;

        const courseIds = context?.courseIds ?? chats.find(c => c.id === chatId)?.courseIds ?? [];
        console.log('[chat] Calling edge function — semester_id:', semesterId, 'course_ids:', courseIds, 'history length:', conversationHistory.length);

        const { data: fnData, error: fnError } = await supabase.functions.invoke('chat', {
          body: {
            message: message.content,
            semester_id: semesterId,
            conversation_history: conversationHistory,
            course_ids: courseIds,
          },
        });

        const addErrorMessage = (text: string) => {
          setChatMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: text,
            timestamp: new Date().toISOString(),
            sequence: aiSequence,
          }]);
        };

        if (fnError) {
          console.error('[chat] Edge function invocation error:', fnError);
          addErrorMessage("Sorry, I couldn't reach the assistant. Please check your connection and try again.");
          return;
        }

        if (fnData?.error) {
          console.error('[chat] Edge function returned error:', fnData.error);
          const msg = fnData.error === 'AI features are disabled'
            ? 'AI features are currently disabled by your administrator.'
            : "Sorry, something went wrong on the server. Please try again in a moment.";
          addErrorMessage(msg);
          return;
        }

        console.log('[chat] Edge function response — query_type:', fnData?.query_type, 'reply length:', fnData?.reply?.length);

        const aiContent: string = fnData?.reply ?? '';

        if (!aiContent) {
          addErrorMessage("I received an empty response. Please try rephrasing your question.");
          return;
        }

        const { data: aiMsgData, error: aiMsgError } = await supabase
          .from('chat_messages')
          .insert({ chat_id: chatId, sequence: aiSequence, role: 'assistant', content: aiContent })
          .select()
          .single();

        if (aiMsgError || !aiMsgData) {
          console.error('[chat] Error saving AI message to DB:', aiMsgError);
          // Still show the reply to the user even if DB persistence fails
          setChatMessages(prev => [...prev, {
            id: `local-${Date.now()}`,
            role: 'assistant' as const,
            content: aiContent,
            timestamp: new Date().toISOString(),
            sequence: aiSequence,
          }]);
          return;
        }

        setChatMessages(prev => [...prev, dbChatMessageToApp(aiMsgData)]);
      }
    })();
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    setChatMessages([]);
  };

  const selectChat = async (chatId: string) => {
    setCurrentChatId(chatId);
    const { data: msgRows, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('sequence', { ascending: true });
    if (error) { console.error('Error fetching chat messages:', error); return; }
    setChatMessages((msgRows ?? []).map(dbChatMessageToApp));
  };

  const deleteChat = async (chatId: string) => {
    await supabase.from('chat_messages').delete().eq('chat_id', chatId);
    await supabase.from('chat_courses').delete().eq('chat_id', chatId);
    await supabase.from('chats').delete().eq('id', chatId);
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setChatMessages([]);
    }
  };

  const renameChat = async (chatId: string, title: string) => {
    await supabase.from('chats').update({ title }).eq('id', chatId);
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, title } : c));
  };

  const submitFeedback = async (description: string) => {
    if (!user || !currentChatId) return;

    const chat = chats.find(c => c.id === currentChatId);
    const lastMessage = chatMessages[chatMessages.length - 1];

    await supabase.from('chat_feedback').insert({
      user_id: user.id,
      chat_id: currentChatId,
      semester_id: chat?.semesterId ?? null,
      course_ids: chat?.courseIds ?? [],
      reported_at_sequence: lastMessage?.sequence ?? null,
      description,
      conversation_snapshot: chatMessages.map(m => ({
        role: m.role,
        content: m.content,
        sequence: m.sequence,
      })),
    });
  };

  const signOut = async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    setUser(null);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        loading,
        semesters,
        courses,
        events,
        gradingComponents,
        notes,
        chats,
        currentChatId,
        chatMessages,
        aiEnabled,
        chatOpen,
        setUser,
        addSemester,
        updateSemester,
        deleteSemester,
        setActiveSemester,
        addCourse,
        deleteCourse,
        updateCourse,
        refreshCourses,
        refreshEvents,
        addNote,
        deleteNote,
        addChatMessage,
        startNewChat,
        selectChat,
        deleteChat,
        renameChat,
        setAiEnabled,
        setChatOpen,
        submitFeedback,
        signOut,
        markOnboardingComplete,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
