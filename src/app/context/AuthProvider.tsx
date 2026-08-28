import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import * as authApi from '@/lib/api/auth';
import type { User } from '@/lib/types';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  loading: boolean;
  markOnboardingComplete: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Build a User immediately from Supabase auth tokens (no extra DB round-trip).
// isAdmin defaults to false and is corrected by enrichUserWithProfile below.
function authUserFromSession(supabaseUser: SupabaseUser): User {
  const displayName =
    supabaseUser.user_metadata?.display_name ||
    supabaseUser.email?.split('@')[0] ||
    'User';
  return {
    id: supabaseUser.id,
    email: supabaseUser.email || '',
    displayName,
    avatar: getInitials(displayName),
    isAdmin: false,
    onboardingCompleted: false,
  };
}

// Fire-and-forget: fetch the profiles row and patch displayName + isAdmin.
// Defined outside the component so it's a stable reference.
function enrichUserWithProfile(
  userId: string,
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
) {
  authApi.fetchProfile(userId).then(({ data: profile }) => {
    if (!profile) return;
    setUser(prev => {
      if (!prev || prev.id !== userId) return prev;
      const displayName = profile.display_name || prev.displayName;
      return {
        ...prev,
        displayName,
        avatar: getInitials(displayName),
        isAdmin: profile.is_admin ?? false,
        onboardingCompleted: profile.onboarding_completed ?? false,
      };
    });
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      if (isSupabaseConfigured()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            // Set user immediately — no awaiting the profile fetch so loading clears fast.
            setUser(authUserFromSession(session.user));
            enrichUserWithProfile(session.user.id, setUser);
          }
        } catch (error) {
          console.error('Error checking session:', error);
        }
      }
      setLoading(false);
    };

    checkSession();

    if (isSupabaseConfigured()) {
      // Callback must be synchronous so setUser is called before navigate() in AuthScreen.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setUser(authUserFromSession(session.user));
          enrichUserWithProfile(session.user.id, setUser);
        } else {
          setUser(null);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  const markOnboardingComplete = useCallback(async () => {
    if (!user) return;
    await authApi.markOnboardingComplete(user.id);
    setUser(prev => prev ? { ...prev, onboardingCompleted: true } : prev);
  }, [user]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, markOnboardingComplete, signOut }),
    [user, loading, markOnboardingComplete, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
