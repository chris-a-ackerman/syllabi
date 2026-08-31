import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

/**
 * Fetch the .ics from generate-ics (a GET with query params, so
 * supabase.functions.invoke can't make the call) and hand it to the browser
 * as a file download.
 */
export async function downloadCalendar(
  semesterId: string,
  courseId?: string,
  fileName = 'schedule.ics',
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = new URL(`${supabaseUrl}/functions/v1/generate-ics`);
  url.searchParams.set('semester_id', semesterId);
  if (courseId) url.searchParams.set('course_id', courseId);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: supabaseAnonKey,
    },
  });
  if (!res.ok) throw new Error(`generate-ics failed (${res.status})`);

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}
