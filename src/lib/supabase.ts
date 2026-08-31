import { createClient } from '@supabase/supabase-js';

// Use placeholder values if environment variables are not set.
// Exported for the few API calls that fetch Edge Functions directly (GET with
// query params, which supabase.functions.invoke does not support).
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
  },
});

// Helper to check if Supabase is properly configured
export const isSupabaseConfigured = () => {
  return import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;
};