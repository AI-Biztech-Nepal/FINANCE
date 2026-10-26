// lib/components/auth/ChangePasswordForm.tsx
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { supabase } from '../../supabase';
import { authErrorMessage, passwordIssue } from '../../utils/authFlow';
import { updateBiometricPasswordIfSaved } from '../../utils/biometricLogin';
import { PasswordInput } from './PasswordInput';

/** Current password, new password, confirm new password. The current password is the
 * proof that it is really the owner at the keyboard (checked by signing in with it
 * before anything changes), so no email round-trip is needed. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Typing again clears the last message, so an old error never sits beside a new attempt.
  const edit = (set: (v: string) => void) => (value: string) => {
    set(value);
    setError(null);
    setDone(false);
  };

  async function handleSubmit() {
    if (isSubmitting) return;
    setDone(false);

    if (!current) return setError('Enter your current password.');
    const issue = passwordIssue(password);
    if (issue) return setError(`New password: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}`);
    if (password === current) return setError('Your new password must be different from the current one.');
    if (password !== confirm) return setError('The new password and the confirmation don’t match.');

    setError(null);
    setIsSubmitting(true);

    const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: current });
    if (wrong) {
      setIsSubmitting(false);
      setError(wrong.code === 'invalid_credentials' ? 'Your current password is wrong.' : authErrorMessage(wrong));
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setIsSubmitting(false);
      setError(authErrorMessage(updateError));
      return;
    }

    // Anyone else who had the old password is signed out; this device stays in.
    // Best-effort: the password itself is already changed.
    try {
      await supabase.auth.signOut({ scope: 'others' });
    } catch {}
    await updateBiometricPasswordIfSaved(email, password);

    setCurrent('');
    setPassword('');
    setConfirm('');
    setIsSubmitting(false);
    setDone(true);
  }

  const ready = !!current && !!password && !!confirm;

  return (
    <View>
      {/* The account the password belongs to, for the browser's password manager. Without it, the browser takes
          the last text box above (Registration no. on Company Details) for the username and fills a saved email in. */}
      {Platform.OS === 'web' && (
        <TextInput value={email} editable={false} autoComplete="username" style={{ display: 'none' }} accessibilityElementsHidden />
      )}
      <Text className="mb-1.5 text-xs font-semibold text-gray-500">Current password</Text>
      <PasswordInput
        value={current}
        onChangeText={edit(setCurrent)}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        containerClassName="mb-3.5"
      />

      <Text className="mb-1.5 text-xs font-semibold text-gray-500">New password</Text>
      <PasswordInput
        value={password}
        onChangeText={edit(setPassword)}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        containerClassName="mb-1.5"
      />
      <Text className="mb-3.5 text-[11px] text-gray-400">At least 8 characters, with letters and numbers.</Text>

      <Text className="mb-1.5 text-xs font-semibold text-gray-500">Confirm new password</Text>
      <PasswordInput
        value={confirm}
        onChangeText={edit(setConfirm)}
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
        containerClassName="mb-4"
      />

      {error ? (
        <View accessibilityRole="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <Text className="text-[12.5px] font-semibold text-red-700">{error}</Text>
        </View>
      ) : null}
      {done ? (
        <View accessibilityRole="alert" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <Text className="text-[12.5px] font-semibold text-emerald-700">
            Password updated. Other devices were signed out.
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={handleSubmit}
        disabled={isSubmitting || !ready}
        accessibilityRole="button"
        className="items-center rounded-xl bg-blue-600 py-3.5 disabled:opacity-50"
      >
        <Text className="text-[15px] font-bold text-white">{isSubmitting ? 'Updating…' : 'Change password'}</Text>
      </Pressable>
    </View>
  );
}
