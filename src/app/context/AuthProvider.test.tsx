// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User as SupabaseUser } from '@supabase/supabase-js';

// SYL-59: the onAuthStateChange listener used to rebuild `user` with fresh
// isAdmin: false / onboardingCompleted: false placeholders on every emission
// that carried a session — including auth-js's automatic TOKEN_REFRESHED
// (hourly, jwt_expiry) and the SIGNED_IN it fires on tab refocus — without
// resetting profileLoadedFor. That left a window where profileLoaded stayed
// true while isAdmin had just been reset to false; ProtectedRoute's
// adminOnly guard reads that combination as "confirmed not admin" and
// bounces the admin to /dashboard. This file pins: a session event for the
// user we already have must never move isAdmin/profileLoaded backwards, and
// must not re-fetch the profile.

type ProfileRow = { display_name: string; is_admin: boolean; onboarding_completed: boolean };
type SessionEvent = { user: SupabaseUser } | null;
type AuthChangeCallback = (event: string, session: SessionEvent) => void;

const { mockFetchProfile, mockGetSession, mockOnAuthStateChange, mockSignOut } = vi.hoisted(() => ({
  mockFetchProfile: vi.fn(),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({
  fetchProfile: mockFetchProfile,
  markOnboardingComplete: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
  },
}));

// Imported after the mocks above are declared — vi.mock calls are hoisted
// above this import by Vitest regardless of source order, but keeping the
// import last matches how the module will actually resolve.
import { AuthProvider, useAuth } from './AuthProvider';

function makeSessionUser(id: string, email: string): SupabaseUser {
  return { id, email, user_metadata: {} } as unknown as SupabaseUser;
}

type LogEntry = { isAdmin: boolean | undefined; profileLoaded: boolean; user: ReturnType<typeof useAuth>['user'] };
let renderLog: LogEntry[] = [];

function Probe() {
  const { user, profileLoaded } = useAuth();
  renderLog.push({ isAdmin: user?.isAdmin, profileLoaded, user });
  return null;
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

let authChangeCallback: AuthChangeCallback | null = null;
let sessionForGetSession: SessionEvent = null;
let pendingProfileCalls: Array<{ userId: string; resolve: (value: { data: ProfileRow | null }) => void }> = [];

/** Resolves the current test's captured onAuthStateChange callback, inside act. */
async function emit(event: string, session: SessionEvent) {
  await act(async () => {
    authChangeCallback?.(event, session);
  });
}

/** Drains microtask chains (promise resolutions, their .then/.finally) inside act. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Resolves the oldest pending fetchProfile() call and flushes the resulting update. */
async function resolvePendingProfile(profile: ProfileRow | null) {
  const call = pendingProfileCalls.shift();
  if (!call) throw new Error('resolvePendingProfile: no pending fetchProfile() call to resolve');
  await act(async () => {
    call.resolve({ data: profile });
    await Promise.resolve();
    await Promise.resolve();
  });
}

const ADMIN_PROFILE: ProfileRow = { display_name: 'Admin', is_admin: true, onboarding_completed: true };
const STUDENT_PROFILE: ProfileRow = { display_name: 'Student', is_admin: false, onboarding_completed: true };

beforeEach(() => {
  renderLog = [];
  authChangeCallback = null;
  sessionForGetSession = null;
  pendingProfileCalls = [];

  mockFetchProfile.mockReset();
  mockFetchProfile.mockImplementation(
    (userId: string) =>
      new Promise<{ data: ProfileRow | null }>(resolve => {
        pendingProfileCalls.push({ userId, resolve });
      })
  );

  mockGetSession.mockReset();
  mockGetSession.mockImplementation(() => Promise.resolve({ data: { session: sessionForGetSession } }));

  mockOnAuthStateChange.mockReset();
  mockOnAuthStateChange.mockImplementation((cb: AuthChangeCallback) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });

  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('AuthProvider session-id gating (SYL-59)', () => {
  it('fetches the profile once even though getSession() and an INITIAL_SESSION emission both deliver the session', async () => {
    const admin = makeSessionUser('user-1', 'admin@example.com');
    sessionForGetSession = { user: admin };

    renderProvider();

    // Fires before mockGetSession()'s promise has resolved — the real race
    // between the mount-time getSession() call and the subscription's own
    // INITIAL_SESSION emission for the same session.
    await emit('INITIAL_SESSION', { user: admin });
    await flush();

    expect(mockFetchProfile).toHaveBeenCalledTimes(1);

    await resolvePendingProfile(ADMIN_PROFILE);

    const last = renderLog[renderLog.length - 1];
    expect(last.isAdmin).toBe(true);
    expect(last.profileLoaded).toBe(true);
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps isAdmin and profileLoaded intact across a same-user TOKEN_REFRESHED then SIGNED_IN', async () => {
    const admin = makeSessionUser('user-1', 'admin@example.com');
    sessionForGetSession = { user: admin };

    renderProvider();
    await flush();
    await resolvePendingProfile(ADMIN_PROFILE);

    const enriched = renderLog[renderLog.length - 1];
    expect(enriched.isAdmin).toBe(true);
    expect(enriched.profileLoaded).toBe(true);
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);

    const renderCountBefore = renderLog.length;
    const userBefore = enriched.user;

    // auth-js emits TOKEN_REFRESHED on every automatic token refresh, and
    // SIGNED_IN again on tab refocus — both for the SAME already-signed-in
    // user. A fresh session-user object (same id) stands in for the new
    // token/session Supabase would hand back on refresh.
    await emit('TOKEN_REFRESHED', { user: makeSessionUser('user-1', 'admin@example.com') });
    await emit('SIGNED_IN', { user: makeSessionUser('user-1', 'admin@example.com') });
    await flush();

    // Neither emission should have produced a render at all: adoptSessionUser
    // short-circuits before calling setUser for an already-adopted id.
    expect(renderLog.length).toBe(renderCountBefore);
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);

    const after = renderLog[renderLog.length - 1];
    expect(after.profileLoaded).toBe(true);
    expect(after.isAdmin).toBe(true);
    // No render anywhere in the log ever pairs profileLoaded=true with
    // isAdmin=false for this user — the exact SYL-59 race.
    expect(renderLog.some(r => r.profileLoaded && !r.isAdmin)).toBe(false);
    // Bonus: the user object identity survived untouched.
    expect(after.user).toBe(userBefore);
  });

  it('re-fetches the profile and holds the guard when a different user signs in', async () => {
    const admin = makeSessionUser('user-1', 'admin@example.com');
    sessionForGetSession = { user: admin };

    renderProvider();
    await flush();
    await resolvePendingProfile(ADMIN_PROFILE);
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);

    await emit('SIGNED_OUT', null);
    const afterSignOut = renderLog[renderLog.length - 1];
    expect(afterSignOut.user).toBeNull();
    expect(afterSignOut.profileLoaded).toBe(false);

    const student = makeSessionUser('user-2', 'student@example.com');
    await emit('SIGNED_IN', { user: student });

    // The placeholder render for the new user — fetchProfile is in flight but
    // deliberately unresolved here — must hold the guard (profileLoaded
    // false) instead of looking like a confirmed non-admin.
    const placeholder = renderLog[renderLog.length - 1];
    expect(placeholder.user?.id).toBe('user-2');
    expect(placeholder.profileLoaded).toBe(false);
    expect(placeholder.isAdmin).toBe(false);
    expect(mockFetchProfile).toHaveBeenCalledTimes(2);

    await resolvePendingProfile(STUDENT_PROFILE);
    const settled = renderLog[renderLog.length - 1];
    expect(settled.profileLoaded).toBe(true);
    expect(settled.isAdmin).toBe(false);
    expect(mockFetchProfile).toHaveBeenCalledTimes(2);
  });
});
