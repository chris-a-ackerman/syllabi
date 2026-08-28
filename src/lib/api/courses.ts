import { supabase } from '@/lib/supabase';
import { dbCourseToApp } from '@/lib/mappers';
import type { Course } from '@/lib/types';

// Data access for courses. Queries moved verbatim from AppContext (SYL-36);
// callers keep their own optimistic state updates and error handling.

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: (data ?? []).map(dbCourseToApp), error };
}

export async function insertCourse(userId: string, course: Omit<Course, 'id'>) {
  const { data, error } = await supabase
    .from('courses')
    .insert({
      user_id: userId,
      semester_id: course.semesterId,
      name: course.name,
      code: course.code,
      professor: course.professor,
      color: course.color,
    })
    .select()
    .single();
  return { data: data ? dbCourseToApp(data) : null, error };
}

/**
 * Persists the subset of Course fields that map 1:1 to DB columns.
 * Resolves with a null error when there is nothing to persist.
 */
export async function updateCourse(id: string, updates: Partial<Course>) {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.code !== undefined) dbUpdates.code = updates.code;
  if (updates.professor !== undefined) dbUpdates.professor = updates.professor;
  if (updates.color !== undefined) dbUpdates.color = updates.color;

  if (Object.keys(dbUpdates).length === 0) return { error: null };

  const { error } = await supabase.from('courses').update(dbUpdates).eq('id', id);
  return { error };
}

export async function deleteCourse(id: string) {
  return supabase.from('courses').delete().eq('id', id);
}
