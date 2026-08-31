import { supabase } from '@/lib/supabase';
import { dbEventToApp } from '@/lib/mappers';

// Data access for course events. Queries moved verbatim from AppContext (SYL-36).

export async function fetchEvents() {
  const { data, error } = await supabase
    .from('course_events')
    .select('*')
    .order('date', { ascending: true });
  return { data: (data ?? []).map(dbEventToApp), error };
}
