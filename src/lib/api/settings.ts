import { supabase } from '@/lib/supabase';

// Global app settings. `app_settings` holds a single row, id = 'global'.
// RLS: anyone may read it; only profiles with is_admin may update it.

export async function fetchAiEnabled() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('ai_enabled')
    .eq('id', 'global')
    .single();
  return { data: data?.ai_enabled ?? null, error };
}

/**
 * Flips the global AI kill switch.
 *
 * Selects the row back deliberately: a non-admin's UPDATE is filtered out by
 * RLS and returns success with zero rows, so without the `.select().single()`
 * a failed write would look like a successful one.
 */
export async function updateAiEnabled(enabled: boolean, userId: string) {
  const { data, error } = await supabase
    .from('app_settings')
    .update({
      ai_enabled: enabled,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', 'global')
    .select('ai_enabled')
    .single();
  return { data: data?.ai_enabled ?? null, error };
}
