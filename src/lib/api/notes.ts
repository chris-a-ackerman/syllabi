import { supabase } from '@/lib/supabase';
import { dbNoteToApp } from '@/lib/mappers';
import type { Note } from '@/lib/types';

// Data access for course notes (SYL-37). The `course_notes` table has existed
// since the first migration but the app kept notes in memory only; these are
// the first reads/writes against it.

export async function fetchNotes() {
  const { data, error } = await supabase
    .from('course_notes')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: (data ?? []).map(dbNoteToApp), error };
}

export async function insertNote(userId: string, note: Omit<Note, 'id' | 'createdAt'>) {
  const { data, error } = await supabase
    .from('course_notes')
    .insert({ user_id: userId, course_id: note.courseId, body: note.text })
    .select()
    .single();
  return { data: data ? dbNoteToApp(data) : null, error };
}

export async function deleteNote(id: string) {
  return supabase.from('course_notes').delete().eq('id', id);
}
