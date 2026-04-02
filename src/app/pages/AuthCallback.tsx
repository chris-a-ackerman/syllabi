import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import type { Session } from '@supabase/supabase-js';

export function AuthCallback() {
  const navigate = useNavigate();
  const redirected = useRef(false);

  useEffect(() => {
    const doNavigate = async (session: Session) => {
      if (redirected.current) return;
      redirected.current = true;
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', session.user.id)
        .single();
      navigate(profile?.onboarding_completed ? '/dashboard' : '/onboarding', { replace: true });
    };

    // With PKCE flow, the code exchange may complete before this effect runs,
    // so the SIGNED_IN event would already be missed. Check for an existing
    // session first, then fall back to the auth state change listener.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) doNavigate(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        doNavigate(session);
      } else if (event === 'SIGNED_OUT' && !redirected.current) {
        navigate('/?error=auth_callback_failed', { replace: true });
      }
    });

    // Fallback: if no auth event fires within 10s, redirect to error
    const timeout = setTimeout(() => {
      if (!redirected.current) navigate('/?error=auth_callback_failed', { replace: true });
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
