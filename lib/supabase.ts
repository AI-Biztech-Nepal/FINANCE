// lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { SecureAuthStorage } from './utils/secureAuthStorage';
import type { Database } from '../types/database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to your .env file.'
  );
}

// Pinned explicitly (rather than left to supabase-js's internal default)
// so useAuth.ts's signOut can force-clear this exact key itself as a
// belt-and-suspenders local wipe, without guessing at or depending on the
// library's internal key-naming scheme.
export const AUTH_STORAGE_KEY = 'store-books-auth-token';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  // This app's tables live in the `finance` schema of the shared AI Biz Tech Nepal platform database. The generated
  // Database type only knows `public`, hence the cast.
  db: { schema: 'finance' as 'public' },
  auth: {
    // OS-keychain-backed on native (chunked - see secureAuthStorage.ts),
    // AsyncStorage on web where SecureStore has no implementation. A leaked
    // refresh token grants the same account access as the password, so it
    // gets the same encrypted-at-rest storage the biometric-login password
    // already uses, not plaintext AsyncStorage.
    storage: SecureAuthStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // On the website an emailed confirmation link brings the person back with
    // their session in the address bar; reading it signs them straight in.
    // Phones have no address bar, so there it stays off.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
