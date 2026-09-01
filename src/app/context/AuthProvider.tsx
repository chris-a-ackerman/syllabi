import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * True once the profiles row for the current user has been fetched (or
   * confirmed absent). Until then user.isAdmin / user.onboardingCompleted are
   * the authUserFromSession placeholders and must not drive routing (SYL-55).
   */
  profileLoaded: boolean;
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
// Defined outside the component so it's a stable reference. onSettled fires
// once the fetch finishes either way, so routing can tell "profile not loaded
// yet" apart from "user really isn't an admin / hasn't onboarded" (SYL-55).
function enrichUserWithProfile(
  userId: string,
  setUser: React.Dispatch<React.SetStateAction<User | null>>,
  onSettled: (userId: string) => void,
) {
  authApi
    .fetchProfile(userId)
    .then(({ data: profile }) => {
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
    })
    .finally(() => onSettled(userId));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Which user's profile fetch has settled — compared against user.id so a
  // sign-out/sign-in never carries a stale "loaded" flag across accounts.
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);

  // Id of the user we've already adopted (setUser + kicked off a profile
  // fetch for). Every subsequent session event for the SAME id — including
  // auth-js's automatic TOKEN_REFRESHED (hourly) and the SIGNED_IN it fires
  // on tab refocus, plus the redundant getSession()/INITIAL_SESSION race —
  // is a no-op: it must not rebuild `user` with placeholders or refetch the
  // profile (SYL-59). A ref (not state) so the decision happens outside any
  // setUser updater — React StrictMode double-invokes updaters, and this has
  // a side effect (the profile fetch) that must only run once.
  const adoptedUserIdRef = useRef<string | null>(null);

  const adoptSessionUser = useCallback((sessionUser: SupabaseUser) => {
    if (adoptedUserIdRef.current === sessionUser.id) return;
    adoptedUserIdRef.current = sessionUser.id;
    // Set user immediately — no awaiting the profile fetch so loading clears fast.
    setUser(authUserFromSession(sessionUser));
    enrichUserWithProfile(sessionUser.id, setUser, setProfileLoadedFor);
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      if (isSupabaseConfigured()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            adoptSessionUser(session.user);
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
          adoptSessionUser(session.user);
        } else {
          adoptedUserIdRef.current = null;
          setUser(null);
          setProfileLoadedFor(null);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, [adoptSessionUser]);

  const markOnboardingComplete = useCallback(async () => {
    if (!user) return;
    await authApi.markOnboardingComplete(user.id);
    setUser(prev => prev ? { ...prev, onboardingCompleted: true } : prev);
  }, [user]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    adoptedUserIdRef.current = null;
    setUser(null);
    setProfileLoadedFor(null);
  }, []);

  const profileLoaded = user !== null && profileLoadedFor === user.id;

  const value = useMemo<AuthState>(
    () => ({ user, loading, profileLoaded, markOnboardingComplete, signOut }),
    [user, loading, profileLoaded, markOnboardingComplete, signOut],
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
