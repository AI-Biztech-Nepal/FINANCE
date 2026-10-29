// lib/components/BiometricLockScreen.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppLogo } from './AppLogo';
import { unlockWithBiometrics } from '../hooks/useBiometricLock';

export function BiometricLockScreen() {
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleUnlock() {
    setAuthenticating(true);
    setFailed(false);
    const success = await unlockWithBiometrics();
    setAuthenticating(false);
    if (!success) setFailed(true);
  }

  useEffect(() => {
    handleUnlock();
    // Prompt automatically once as soon as the lock screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <AppLogo size={120} />
      <Text className="mb-1 mt-6 text-xl font-extrabold text-gray-900">Finance Nepal is locked</Text>
      <Text className="mb-8 text-center text-sm text-gray-500">
        {failed ? 'Authentication failed or was cancelled.' : 'Verify your identity to continue.'}
      </Text>
      <Pressable
        onPress={handleUnlock}
        disabled={authenticating}
        className="w-full flex-row items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 disabled:opacity-50"
      >
        <Ionicons name="finger-print" size={18} color="white" />
        <Text className="text-[15px] font-bold text-white">{authenticating ? 'Verifying…' : 'Unlock'}</Text>
      </Pressable>
    </View>
  );
}
