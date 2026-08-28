import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import * as authApi from '@/lib/api/auth';
import * as chatApi from '@/lib/api/chat';
import * as coursesApi from '@/lib/api/courses';
import * as eventsApi from '@/lib/api/events';
import * as semestersApi from '@/lib/api/semesters';
import type {
  Chat,
  ChatMessage,
  Course,
  Event,
  GradingComponent,
  Note,
  Semester,
  User,
} from '@/lib/types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

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
  authApi.fetchProfile(userId).then(({ data: profile }) => {
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
        { data: fetchedSemesters, error: semErr },
        { data: fetchedCourses, error: courseErr },
        { data: fetchedEvents, error: eventErr },
      ] = await Promise.all([
        semestersApi.fetchSemesters(),
        coursesApi.fetchCourses(),
        eventsApi.fetchEvents(),
      ]);

      if (semErr) console.error('Error fetching semesters:', semErr);
      if (courseErr) console.error('Error fetching courses:', courseErr);
      if (eventErr) console.error('Error fetching events:', eventErr);

      setSemesters(fetchedSemesters);
      setCourses(fetchedCourses);
      setEvents(fetchedEvents);
      if (fetchedCourses.length > 0) setChatOpen(true);

      const { data: mappedChats, error: chatErr } = await chatApi.fetchChats();
      if (chatErr) console.error('Error fetching chats:', chatErr);
      setChats(mappedChats);

      if (mappedChats.length > 0) {
        const mostRecentId = mappedChats[0].id;
        setCurrentChatId(mostRecentId);
        const { data: messages } = await chatApi.fetchChatMessages(mostRecentId);
        setChatMessages(messages);
      }
    };

    fetchData();
  }, [user?.id]);

  const addSemester = async (semester: Omit<Semester, 'id'>): Promise<string> => {
    if (!user) return '';

    // Deactivate all existing semesters if the new one is active
    if (semester.isActive) {
      await semestersApi.deactivateSemesters(user.id);
      setSemesters(prev => prev.map(s => ({ ...s, isActive: false })));
    }

    const { data: newSemester, error } = await semestersApi.upsertSemester(user.id, semester);

    if (error || !newSemester) {
      console.error('Error adding semester:', error);
      return '';
    }

    setSemesters(prev => {
      if (prev.some(s => s.id === newSemester.id)) return prev;
      return [newSemester, ...prev];
    });
    return newSemester.id;
  };

  const updateSemester = async (id: string, updates: { name: string; startDate: string; endDate: string; isActive: boolean }) => {
    if (!user) return;
    if (updates.isActive) {
      await semestersApi.deactivateSemesters(user.id);
      setSemesters(prev => prev.map(s => ({ ...s, isActive: false })));
    }
    await semestersApi.updateSemester(id, updates);
    setSemesters(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteSemester = async (id: string) => {
    if (!user) return;
    const courseIds = courses.filter(c => c.semesterId === id).map(c => c.id);
    await semestersApi.deleteSemesterWithCourses(id, courseIds);
    setCourses(prev => prev.filter(c => c.semesterId !== id));
    setSemesters(prev => {
      const remaining = prev.filter(s => s.id !== id);
      const wasActive = prev.find(s => s.id === id)?.isActive;
      if (wasActive && remaining.length > 0) {
        const next = remaining[0];
        semestersApi.activateSemester(next.id);
        return remaining.map(s => ({ ...s, isActive: s.id === next.id }));
      }
      return remaining;
    });
  };

  const markOnboardingComplete = async () => {
    if (!user) return;
    await authApi.markOnboardingComplete(user.id);
    setUser(prev => prev ? { ...prev, onboardingCompleted: true } : prev);
  };

  const setActiveSemester = async (id: string) => {
    if (!user) return;
    setSemesters(prev => prev.map(s => ({ ...s, isActive: s.id === id }))); // Optimistic update
    await semestersApi.deactivateSemesters(user.id);
    await semestersApi.activateSemester(id);
  };

  const addCourse = async (course: Omit<Course, 'id'>): Promise<string | undefined> => {
    if (!user) return undefined;

    const { data: newCourse, error } = await coursesApi.insertCourse(user.id, course);

    if (error || !newCourse) {
      console.error('Error adding course:', error);
      return undefined;
    }

    setCourses(prev => [newCourse, ...prev]);
    if (courses.length === 0) setChatOpen(true);
    return newCourse.id;
  };

  const deleteCourse = async (id: string) => {
    const { error } = await coursesApi.deleteCourse(id);
    if (error) {
      console.error('Error deleting course:', error);
      return;
    }
    setCourses(prev => prev.filter(c => c.id !== id));
  };

  const updateCourse = (id: string, updates: Partial<Course>) => {
    setCourses(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

    // Persist subset of fields that map 1:1 to DB columns
    coursesApi.updateCourse(id, updates)
      .then(({ error }) => { if (error) console.error('Error updating course:', error); });
  };

  const refreshCourses = async () => {
    const { data, error } = await coursesApi.fetchCourses();
    if (error) { console.error('Error refreshing courses:', error); return; }
    setCourses(data);
  };

  const refreshEvents = async () => {
    const { data, error } = await eventsApi.fetchEvents();
    if (error) { console.error('Error refreshing events:', error); return; }
    setEvents(data);
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
        const { data: newChat, error: chatError } = await chatApi.createChat(
          user.id,
          context.semesterId,
          message.role === 'user' ? message.content.slice(0, 100) : null,
          context.courseIds,
        );

        if (chatError || !newChat) {
          console.error('[chat] Error creating chat record:', chatError);
          setChatMessages(prev => [...prev, {
            id: `error-${Date.now()}`,
            role: 'assistant' as const,
            content: "Sorry, I couldn't start a new conversation. Please try again.",
            timestamp: new Date().toISOString(),
          }]);
          return;
        }

        chatId = newChat.id;
        setCurrentChatId(chatId);

        if (context.courseIds.length > 0) {
          await chatApi.linkChatCourses(newChat.id, context.courseIds);
        }

        setChats(prev => [newChat, ...prev]);
      }

      // For existing chats, look up semesterId from chats state
      if (!semesterId && chatId) {
        semesterId = chats.find(c => c.id === chatId)?.semesterId;
      }

      if (!chatId) return;

      const { data: userMessage, error: msgError } = await chatApi.insertChatMessage(
        chatId, userSequence, message.role, message.content,
      );

      if (msgError || !userMessage) {
        console.error('[chat] Error saving user message to DB:', msgError);
        return;
      }

      setChatMessages(prev => prev.map(m => m.id === tempId ? userMessage : m));

      if (message.role === 'user' && aiEnabled && semesterId) {
        const aiSequence = userSequence + 1;

        const courseIds = context?.courseIds ?? chats.find(c => c.id === chatId)?.courseIds ?? [];
        console.log('[chat] Calling edge function — semester_id:', semesterId, 'course_ids:', courseIds, 'history length:', conversationHistory.length);

        const { data: fnData, error: fnError } = await chatApi.sendChatQuery({
          message: message.content,
          semester_id: semesterId,
          conversation_history: conversationHistory,
          course_ids: courseIds,
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

        const { data: aiMessage, error: aiMsgError } = await chatApi.insertChatMessage(
          chatId, aiSequence, 'assistant', aiContent,
        );

        if (aiMsgError || !aiMessage) {
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

        setChatMessages(prev => [...prev, aiMessage]);
      }
    })();
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    setChatMessages([]);
  };

  const selectChat = async (chatId: string) => {
    setCurrentChatId(chatId);
    const { data, error } = await chatApi.fetchChatMessages(chatId);
    if (error) { console.error('Error fetching chat messages:', error); return; }
    setChatMessages(data);
  };

  const deleteChat = async (chatId: string) => {
    await chatApi.deleteChat(chatId);
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setChatMessages([]);
    }
  };

  const renameChat = async (chatId: string, title: string) => {
    await chatApi.renameChat(chatId, title);
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, title } : c));
  };

  const submitFeedback = async (description: string) => {
    if (!user || !currentChatId) return;

    const chat = chats.find(c => c.id === currentChatId);
    const lastMessage = chatMessages[chatMessages.length - 1];

    await chatApi.insertChatFeedback({
      userId: user.id,
      chatId: currentChatId,
      semesterId: chat?.semesterId ?? null,
      courseIds: chat?.courseIds ?? [],
      reportedAtSequence: lastMessage?.sequence ?? null,
      description,
      conversationSnapshot: chatMessages.map(m => ({
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
