// app/(auth)/reset-password.tsx
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { AuthScreen } from '../../lib/components/auth/AuthScreen';
import { NewPasswordForm } from '../../lib/components/auth/NewPasswordForm';

// Where the link in a password-reset email lands. Opening that link has
// already signed the person in (and set the store's isRecovering flag), so all
// that is left to ask for is the new password and its confirmation.
export default function ResetPassword() {
  const session = useAuthStore((state) => state.session);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isRecovering = useAuthStore((state) => state.isRecovering);

  // Signed in the normal way, not through a reset link (a typed address, or
  // the new password was just saved): nothing to do here, so go home.
  // Changing a password without the email link is deliberately not possible
  // from this screen. An explicit replace('/'), not <Redirect href="/">: from
  // inside the (auth) group that resolves to the sign-in screen.
  const leaving = !isLoading && !!session && !isRecovering;
  useEffect(() => {
    if (leaving) router.replace('/');
  }, [leaving]);

  if (isLoading || leaving) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  // A reset link that was already used or has timed out signs nobody in.
  if (!session) {
    return (
      <AuthScreen>
        <Text className="text-center text-2xl font-extrabold text-gray-900">Link expired</Text>
        <Text className="mb-7 mt-1.5 text-center text-sm text-gray-500">
          This reset link has already been used or has expired. Request a new one to choose a password.
        </Text>
        <Pressable
          onPress={() => router.replace('/(auth)/forgot-password')}
          className="items-center rounded-xl bg-orange-500 py-3.5"
        >
          <Text className="text-[15px] font-bold text-white">Request a new link</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(auth)/login')} className="mt-3 items-center py-2">
          <Text className="text-[12.5px] font-bold text-gray-500">Back to sign in</Text>
        </Pressable>
      </AuthScreen>
    );
  }

  async function handleCancel() {
    // Only this device's session: the reset link signed it in, and leaving
    // without a new password must not leave it signed in.
    await supabase.auth.signOut({ scope: 'local' });
    router.replace('/(auth)/login');
  }

  return (
    <AuthScreen>
      <Text className="text-center text-2xl font-extrabold text-gray-900">Choose a new password</Text>
      <Text className="mb-7 mt-1.5 text-center text-sm text-gray-500">
        for <Text className="font-semibold text-gray-700">{session.user.email}</Text>
      </Text>

      <NewPasswordForm email={session.user.email ?? ''} />

      <Pressable onPress={handleCancel} className="mt-1 items-center py-2">
        <Text className="text-[12.5px] font-bold text-gray-500">Cancel</Text>
      </Pressable>
    </AuthScreen>
  );
}
