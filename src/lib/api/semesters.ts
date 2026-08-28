import { supabase } from '@/lib/supabase';
import { dbSemesterToApp } from '@/lib/mappers';
import type { Semester } from '@/lib/types';

// Data access for semesters. Queries moved verbatim from AppContext (SYL-36);
// callers keep their own optimistic state updates and error handling.

export async function fetchSemesters() {
  const { data, error } = await supabase
    .from('semesters')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: (data ?? []).map(dbSemesterToApp), error };
}

/** Clears is_active on every semester belonging to the user. */
export async function deactivateSemesters(userId: string) {
  return supabase.from('semesters').update({ is_active: false }).eq('user_id', userId);
}

export async function activateSemester(id: string) {
  return supabase.from('semesters').update({ is_active: true }).eq('id', id);
}

/** Upsert on (user_id, name) so re-adding an existing semester returns the existing row. */
export async function upsertSemester(userId: string, semester: Omit<Semester, 'id'>) {
  const { data, error } = await supabase
    .from('semesters')
    .upsert(
      {
        user_id: userId,
        name: semester.name,
        start_date: semester.startDate,
        end_date: semester.endDate,
        is_active: semester.isActive,
      },
      { onConflict: 'user_id,name' }
    )
    .select()
    .single();
  return { data: data ? dbSemesterToApp(data) : null, error };
}

export async function updateSemester(
  id: string,
  updates: { name: string; startDate: string; endDate: string; isActive: boolean }
) {
  return supabase
    .from('semesters')
    .update({
      name: updates.name,
      start_date: updates.startDate,
      end_date: updates.endDate,
      is_active: updates.isActive,
    })
    .eq('id', id);
}

/**
 * Deletes a semester and everything hanging off its courses.
 *
 * NOTE (SYL-36): the `grading_components` and `notes` deletes below are carried
 * over verbatim from AppContext. Neither table exists in this schema, so both
 * are silently-failing no-ops. Left as-is here to keep this a pure relocation.
 */
export async function deleteSemesterWithCourses(id: string, courseIds: string[]) {
  if (courseIds.length > 0) {
    await supabase.from('course_events').delete().in('course_id', courseIds);
    await supabase.from('grading_components').delete().in('course_id', courseIds);
    await supabase.from('notes').delete().in('course_id', courseIds);
    await supabase.from('courses').delete().in('id', courseIds);
  }
  return supabase.from('semesters').delete().eq('id', id);
}
