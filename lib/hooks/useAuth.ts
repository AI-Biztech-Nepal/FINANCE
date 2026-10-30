// lib/hooks/useAuth.ts
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase, AUTH_STORAGE_KEY } from '../supabase';
import { SecureAuthStorage } from '../utils/secureAuthStorage';
import { queryClient } from '../providers/QueryProvider';
import { setOrgSellsVehicles } from '../utils/accountFeatures';
import type { Profile, UserRole } from '../../types/database.types';

/** True when this page was opened from the link in a password-reset email.
 * Supabase signs that visit in and puts `type=recovery` in the address; read
 * here, while the module loads, because supabase-js clears the address once it
 * has taken the session out of it. Only the website can be opened that way. */
function openedFromRecoveryLink(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return /[#&]type=recovery(&|$)/.test(window.location.hash);
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** The tenant of every Finance row: the active organization in the platform database (rows are `owner_id = org id`).
   * For a one-person account this equals the user's own id. */
  ownerId: string | null;
  isLoading: boolean;
  /** Signed in only by a reset link: the app shows "choose a new password"
   * until it's set, instead of the dashboard. */
  isRecovering: boolean;
  setSession: (session: Session | null) => void;
  setRecovering: (recovering: boolean) => void;
  setProfile: (profile: Profile | null) => void;
  setOwnerId: (ownerId: string | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  ownerId: null,
  isLoading: true,
  isRecovering: openedFromRecoveryLink(),
  setSession: (session) => set({ session }),
  setRecovering: (isRecovering) => set({ isRecovering }),
  setProfile: (profile) => set({ profile }),
  setOwnerId: (ownerId) => set({ ownerId }),
  setLoading: (isLoading) => set({ isLoading }),
  // Deliberately does NOT clear saved fingerprint sign-in credentials here -
  // signing out is the only way to ever reach the login screen's fingerprint
  // button, so wiping them on every sign-out would defeat the feature
  // entirely (see lib/utils/biometricLogin.ts - they're only cleared when
  // the saved password stops working, e.g. it was changed elsewhere).
  //
  // `scope: 'global'` revokes every refresh token this user has - not just
  // this device's - so "Sign Out" actually invalidates the session in the
  // database, not just the local app state. Best-effort: if that network
  // call throws or the server rejects it for a real reason (not one of the
  // already-tolerated 401/403/404/session-missing cases), supabase-js
  // deliberately skips clearing its own persisted session (see its
  // `_signOut`) - left alone, that session could silently resurrect on the
  // next app launch even though this screen already shows signed out. The
  // explicit storage removal below forces the local wipe unconditionally,
  // and clearing the query cache stops a second account signing in on this
  // device from briefly seeing the previous user's cached data.
  signOut: async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch {
      // Offline or the server errored - already logged nowhere useful to
      // surface this to the user for a Sign Out button, so fall through to
      // the unconditional local wipe below regardless.
    }
    await SecureAuthStorage.removeItem(AUTH_STORAGE_KEY);
    queryClient.clear();
    setOrgSellsVehicles(false);
    set({ session: null, profile: null, ownerId: null, isRecovering: false });
  },
}));

/**
 * Bootstraps the auth session and keeps it in sync with Supabase auth
 * state changes. Mount this once near the root of the app (see app/_layout.tsx).
 */
export function useAuthListener() {
  const { setSession, setProfile, setOwnerId, setLoading, setRecovering } = useAuthStore();

  useEffect(() => {
    let isMounted = true;

    async function loadProfile(userId: string) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!error && isMounted) setProfile(data as Profile);
      await loadOrg(userId);
    }

    // Rows belong to the active organization of the platform database (core), not to the user. The Database type
    // only describes this app's own schema, so these two calls are untyped.
    async function loadOrg(userId: string) {
      const db = supabase as any;
      const { data: ctx } = await db.schema('core').rpc('my_context');
      const orgId: string = ctx?.active_org_id ?? userId; // one-person accounts: the org shares the owner's id
      const { data: settings } = await db.from('org_settings').select('sells_vehicles').eq('org_id', orgId).maybeSingle();
      setOrgSellsVehicles(!!settings?.sells_vehicles);
      if (isMounted) setOwnerId(orgId);
    }

    // A separate getSession() call here used to race the INITIAL_SESSION
    // event below - on a cold start, whichever one happened to resolve
    // last would win and could stomp a real restored session with null,
    // silently forcing the user back to the login screen. onAuthStateChange
    // alone already fires once with the fully-restored session (or null)
    // as soon as the client finishes reading it from storage, so that's
    // the only source of truth this needs.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      // The reset link signs the person in; hold them on "choose a new
      // password" until they have (see app/(auth)/reset-password.tsx).
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(session);
      if (session?.user) {
        const profileLoaded = loadProfile(session.user.id);
        // A page refresh (the session is restored from storage): keep the app on its
        // spinner until the profile is in. Mounted earlier, the signed-in screens lose
        // the page the address points at, and every refresh landed on the dashboard.
        // A slow or failed fetch holds the spinner for a few seconds at most.
        if (event === 'INITIAL_SESSION') {
          const release = () => {
            if (isMounted) setLoading(false);
          };
          profileLoaded.finally(release);
          setTimeout(release, 8000);
          return;
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [setSession, setProfile, setOwnerId, setLoading, setRecovering]);
}

export function useRole(): UserRole | null {
  return useAuthStore((state) => state.profile?.role ?? null);
}
