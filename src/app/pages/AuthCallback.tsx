import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase auto-exchanges the ?code= param via detectSessionInUrl.
    // We just wait for the resulting auth state change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', session.user.id)
          .single();
        navigate(profile?.onboarding_completed ? '/dashboard' : '/onboarding', { replace: true });
      } else if (event === 'SIGNED_OUT') {
        navigate('/?error=auth_callback_failed', { replace: true });
      }
    });

    // Fallback: if no auth event fires within 10s, redirect to error
    const timeout = setTimeout(() => {
      navigate('/?error=auth_callback_failed', { replace: true });
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Signing you in…</p>
      </div>
    </div>
  );
}
