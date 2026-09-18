import { supabase } from '@/lib/supabase';

// Profile reads/writes backing the auth layer. Queries moved verbatim from
// AppContext (SYL-36). Session handling itself stays with the provider, which
// needs the React lifecycle for the auth-state subscription.

export async function fetchProfile(userId: string) {
  return supabase
    .from('profiles')
    .select('display_name, is_admin, onboarding_completed')
    .eq('id', userId)
    .single();
}

export async function markOnboardingComplete(userId: string) {
  return supabase
    .from('profiles')
    .update({ onboarding_completed: true, onboarding_completed_at: new Date().toISOString() })
    .eq('id', userId);
}
