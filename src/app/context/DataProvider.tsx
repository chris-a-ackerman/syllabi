import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import * as coursesApi from '@/lib/api/courses';
import * as eventsApi from '@/lib/api/events';
import * as notesApi from '@/lib/api/notes';
import * as semestersApi from '@/lib/api/semesters';
import type { Course, Event, Note, Semester } from '@/lib/types';

interface DataState {
  semesters: Semester[];
  courses: Course[];
  events: Event[];
  notes: Note[];
  addSemester: (semester: Omit<Semester, 'id'>) => Promise<string>;
  updateSemester: (id: string, updates: { name: string; startDate: string; endDate: string; isActive: boolean }) => Promise<void>;
  deleteSemester: (id: string) => Promise<void>;
  setActiveSemester: (id: string) => Promise<void>;
  addCourse: (course: Omit<Course, 'id'>) => Promise<string | undefined>;
  deleteCourse: (id: string) => Promise<void>;
  updateCourse: (id: string, updates: Partial<Course>) => void;
  refreshCourses: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  addNote: (note: Omit<Note, 'id' | 'createdAt'>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

const DataContext = createContext<DataState | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // Fetch the user's data whenever the logged-in user changes
  useEffect(() => {
    if (!user) {
      setSemesters([]);
      setCourses([]);
      setEvents([]);
      setNotes([]);
      return;
    }

    const fetchData = async () => {
      const [
        { data: fetchedSemesters, error: semErr },
        { data: fetchedCourses, error: courseErr },
        { data: fetchedEvents, error: eventErr },
        { data: fetchedNotes, error: noteErr },
      ] = await Promise.all([
        semestersApi.fetchSemesters(),
        coursesApi.fetchCourses(),
        eventsApi.fetchEvents(),
        notesApi.fetchNotes(),
      ]);

      if (semErr) console.error('Error fetching semesters:', semErr);
      if (courseErr) console.error('Error fetching courses:', courseErr);
      if (eventErr) console.error('Error fetching events:', eventErr);
      if (noteErr) console.error('Error fetching notes:', noteErr);

      setSemesters(fetchedSemesters);
      setCourses(fetchedCourses);
      setEvents(fetchedEvents);
      setNotes(fetchedNotes);
    };

    fetchData();
  }, [user?.id]);

  const addSemester = useCallback(async (semester: Omit<Semester, 'id'>): Promise<string> => {
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
  }, [user]);

  const updateSemester = useCallback(async (
    id: string,
    updates: { name: string; startDate: string; endDate: string; isActive: boolean },
  ) => {
    if (!user) return;
    if (updates.isActive) {
      await semestersApi.deactivateSemesters(user.id);
      setSemesters(prev => prev.map(s => ({ ...s, isActive: false })));
    }
    await semestersApi.updateSemester(id, updates);
    setSemesters(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, [user]);

  const deleteSemester = useCallback(async (id: string) => {
    if (!user) return;
    const courseIds = courses.filter(c => c.semesterId === id).map(c => c.id);
    await semestersApi.deleteSemesterWithCourses(id, courseIds);
    setCourses(prev => prev.filter(c => c.semesterId !== id));
    setNotes(prev => prev.filter(n => !courseIds.includes(n.courseId)));
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
  }, [user, courses]);

  const setActiveSemester = useCallback(async (id: string) => {
    if (!user) return;
    setSemesters(prev => prev.map(s => ({ ...s, isActive: s.id === id }))); // Optimistic update
    await semestersApi.deactivateSemesters(user.id);
    await semestersApi.activateSemester(id);
  }, [user]);

  const addCourse = useCallback(async (course: Omit<Course, 'id'>): Promise<string | undefined> => {
    if (!user) return undefined;

    const { data: newCourse, error } = await coursesApi.insertCourse(user.id, course);

    if (error || !newCourse) {
      console.error('Error adding course:', error);
      return undefined;
    }

    setCourses(prev => [newCourse, ...prev]);
    return newCourse.id;
  }, [user]);

  const deleteCourse = useCallback(async (id: string) => {
    const { error } = await coursesApi.deleteCourse(id);
    if (error) {
      console.error('Error deleting course:', error);
      return;
    }
    setCourses(prev => prev.filter(c => c.id !== id));
    setNotes(prev => prev.filter(n => n.courseId !== id));
  }, []);

  const updateCourse = useCallback((id: string, updates: Partial<Course>) => {
    setCourses(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

    // Persist subset of fields that map 1:1 to DB columns
    coursesApi.updateCourse(id, updates)
      .then(({ error }) => { if (error) console.error('Error updating course:', error); });
  }, []);

  const refreshCourses = useCallback(async () => {
    const { data, error } = await coursesApi.fetchCourses();
    if (error) { console.error('Error refreshing courses:', error); return; }
    setCourses(data);
  }, []);

  const refreshEvents = useCallback(async () => {
    const { data, error } = await eventsApi.fetchEvents();
    if (error) { console.error('Error refreshing events:', error); return; }
    setEvents(data);
  }, []);

  const addNote = useCallback(async (note: Omit<Note, 'id' | 'createdAt'>) => {
    if (!user) return;
    const { data: newNote, error } = await notesApi.insertNote(user.id, note);
    if (error || !newNote) {
      console.error('Error adding note:', error);
      return;
    }
    setNotes(prev => [newNote, ...prev]);
  }, [user]);

  const deleteNote = useCallback(async (id: string) => {
    const { error } = await notesApi.deleteNote(id);
    if (error) {
      console.error('Error deleting note:', error);
      return;
    }
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const value = useMemo<DataState>(() => ({
    semesters,
    courses,
    events,
    notes,
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
  }), [
    semesters, courses, events, notes,
    addSemester, updateSemester, deleteSemester, setActiveSemester,
    addCourse, deleteCourse, updateCourse, refreshCourses, refreshEvents,
    addNote, deleteNote,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
