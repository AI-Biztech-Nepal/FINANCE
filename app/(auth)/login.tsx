// app/(auth)/login.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, ScrollView, Platform, Keyboard } from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { AppLogo } from '../../lib/components/AppLogo';
import { PasswordInput } from '../../lib/components/auth/PasswordInput';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { resendSignupCode } from '../../lib/utils/authEmail';
import { authErrorMessage, normalizeEmail } from '../../lib/utils/authFlow';
import { isBiometricHardwareReady, authenticateWithBiometrics } from '../../lib/utils/biometric';
import {
  hasBiometricCredentials,
  saveBiometricCredentials,
  getBiometricCredentials,
  clearBiometricCredentials,
} from '../../lib/utils/biometricLogin';

// Slows down repeated password guessing through the app's own UI (Supabase
// Auth rate-limits at the API level regardless, but that's no reason for the
// app itself to let someone hammer the button with no friction at all).
// Only kicks in after a few genuine wrong-password rejections - the first
// couple of typos are never penalized.
const LOCKOUT_THRESHOLD = 3;
function lockoutSecondsFor(failedAttempts: number): number {
  if (failedAttempts < LOCKOUT_THRESHOLD) return 0;
  return Math.min(30, 10 * (failedAttempts - LOCKOUT_THRESHOLD + 1));
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showBiometricButton, setShowBiometricButton] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);

  useEffect(() => {
    (async () => {
      const [hasCreds, hardwareReady] = await Promise.all([hasBiometricCredentials(), isBiometricHardwareReady()]);
      setShowBiometricButton(hasCreds && hardwareReady);
    })();
  }, []);

  // Ticks the countdown shown on the disabled button and clears the lock
  // itself once it expires - a plain setTimeout for the unlock wouldn't
  // update the displayed "Try again in Ns" text in between.
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockSecondsLeft(secondsLeft);
      if (secondsLeft === 0) setLockedUntil(null);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const isLocked = lockedUntil != null && lockSecondsLeft > 0;

  // On some Android devices KeyboardAvoidingView's automatic resize doesn't
  // kick in (edge-to-edge layouts can make its measurement unreliable), so
  // track the keyboard's real height directly and pad the scroll content by
  // that amount - that guarantees the fields stay reachable by scrolling.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // showAlert (RN's Alert.alert) doesn't return a promise - it fires the
  // dialog and returns immediately, well before the user taps anything.
  // Wrapping it lets the caller actually wait for the user's choice instead
  // of racing ahead (see handleLogin, which used to navigate away before
  // this alert's "Enable" handler had a chance to run).
  //
  // The device holds one fingerprint login at a time. When someone else signs
  // in on a phone that already has another person's saved, the offer must
  // still appear (as a switch) - otherwise the fingerprint button keeps
  // signing the next person into the first person's books.
  async function offerBiometricSignIn(loggedInEmail: string, loggedInPassword: string): Promise<void> {
    const [saved, hardwareReady] = await Promise.all([getBiometricCredentials(), isBiometricHardwareReady()]);
    if (!hardwareReady) return;
    if (saved && saved.email === loggedInEmail) {
      // Same person, and they just typed a working password - keep the saved
      // copy current if they changed it since.
      if (saved.password !== loggedInPassword) await saveBiometricCredentials(loggedInEmail, loggedInPassword);
      return;
    }
    const title = saved ? 'Use fingerprint for this account?' : 'Sign in with fingerprint next time?';
    const message = saved
      ? `Fingerprint sign-in on this device is set up for ${saved.email}. Switch it to ${loggedInEmail}?`
      : 'Skip typing your password on this device.';
    await new Promise<void>((resolve) => {
      showAlert(title, message, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve() },
        {
          text: saved ? 'Switch' : 'Enable',
          onPress: async () => {
            try {
              const verified = await authenticateWithBiometrics();
              if (!verified) {
                showAlert('Not enabled', "Fingerprint wasn't verified, so this wasn't turned on. You can try again next time you log in.");
                return;
              }
              await saveBiometricCredentials(loggedInEmail, loggedInPassword);
              showAlert('Fingerprint sign-in enabled', "You'll be able to use it next time.");
            } catch (err) {
              showAlert('Could not enable fingerprint sign-in', getErrorMessage(err));
            } finally {
              resolve();
            }
          },
        },
      ]);
    });
  }

  async function handleLogin() {
    if (isLocked) return;

    const trimmedEmail = normalizeEmail(email);
    // Checked locally so an empty tap never reaches the server - or counts
    // toward the wrong-password lockout.
    if (!trimmedEmail || !password) {
      showAlert('Enter your details', 'Type your email and password to sign in.');
      return;
    }
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
    setIsSubmitting(false);

    if (error) {
      // Signed up but never entered the code. The password was right, so this
      // isn't a failed attempt - send a fresh code and go finish verifying.
      if (error.code === 'email_not_confirmed') {
        await resendSignupCode(trimmedEmail);
        router.push({ pathname: '/(auth)/verify-email', params: { email: trimmedEmail } });
        return;
      }
      const nextFailedAttempts = failedAttempts + 1;
      setFailedAttempts(nextFailedAttempts);
      const lockSeconds = lockoutSecondsFor(nextFailedAttempts);
      if (lockSeconds > 0) {
        setLockedUntil(Date.now() + lockSeconds * 1000);
        showAlert('Too many attempts', `Wait ${lockSeconds}s before trying again.`);
      } else {
        showAlert('Login failed', authErrorMessage(error));
      }
      return;
    }
    setFailedAttempts(0);
    await offerBiometricSignIn(trimmedEmail, password);
    router.replace('/');
  }

  async function handleBiometricLogin() {
    setBiometricBusy(true);
    try {
      // Checked before the scan (not just at screen-mount time) so a stale
      // button never wastes a fingerprint scan on credentials that are
      // already gone - and so we can tell the two failure modes apart.
      const creds = await getBiometricCredentials();
      if (!creds) {
        setShowBiometricButton(false);
        showAlert('Fingerprint sign-in unavailable', 'Sign in with your password to set it up again.');
        return;
      }
      const verified = await authenticateWithBiometrics();
      if (!verified) {
        showAlert('Fingerprint not recognized', 'Try again, or sign in with your password below.');
        return;
      }
      // A slow/flaky connection used to leave this spinning with no way
      // out - bound it so a stall becomes a clear, retryable error instead
      // of "hangs there".
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Sign-in is taking too long. Check your connection and try again.')), 15000)
      );
      const { error } = await Promise.race([supabase.auth.signInWithPassword(creds), timeout]);
      if (error) {
        // Only clear the saved credentials when the server actually
        // rejected them (changed elsewhere, etc.) - a network hiccup or
        // server error isn't proof the password is stale, and wiping it
        // for those used to silently disable fingerprint sign-in until the
        // reseller re-entered their password for no real reason.
        const isInvalidCredentials = /invalid login credentials/i.test(error.message);
        if (isInvalidCredentials) {
          await clearBiometricCredentials();
          setShowBiometricButton(false);
          showAlert('Sign-in failed', `${error.message} Sign in with your password to set up fingerprint sign-in again.`);
        } else {
          showAlert('Could not sign in', `${error.message} Please try again.`);
        }
        return;
      }
      router.replace('/');
    } catch (err) {
      showAlert('Could not sign in', getErrorMessage(err));
    } finally {
      setBiometricBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        className="px-6"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingBottom: keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-5 items-center">
          <AppLogo size={140} />
        </View>
        <Text className="text-center text-2xl font-extrabold text-gray-900">Welcome back</Text>
        <Text className="mb-7 mt-1.5 text-center text-sm text-gray-500">Sign in to your company books</Text>

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">Password</Text>
        <PasswordInput
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          containerClassName="mb-2"
        />

        <Link
          href={{ pathname: '/(auth)/forgot-password', params: email.trim() ? { email: normalizeEmail(email) } : {} }}
          className="mb-5 self-end text-[12.5px] font-bold text-orange-600"
        >
          Forgot password?
        </Link>

        <View className="mb-4 flex-row gap-2.5">
          <Pressable
            onPress={handleLogin}
            disabled={isSubmitting || isLocked}
            className="flex-1 items-center rounded-xl bg-orange-500 py-3.5 disabled:opacity-50"
          >
            <Text className="text-[15px] font-bold text-white">
              {isLocked ? `Try again in ${lockSecondsLeft}s` : isSubmitting ? 'Signing in…' : 'Sign in'}
            </Text>
          </Pressable>
          {showBiometricButton && (
            <Pressable
              onPress={handleBiometricLogin}
              disabled={biometricBusy}
              className="items-center justify-center rounded-xl border-[1.5px] border-orange-500 px-4 py-3.5 disabled:opacity-50"
            >
              <Ionicons name="finger-print" size={22} color="#f97316" />
            </Pressable>
          )}
        </View>

        <Link href="/(auth)/register" className="text-center text-[12.5px] text-gray-500">
          New here? <Text className="font-bold text-orange-600">Create account</Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
