// lib/utils/biometric.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const storageKey = (userId: string) => `biometric_lock_enabled:${userId}`;

export async function isBiometricHardwareReady(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function isBiometricLockEnabled(userId: string): Promise<boolean> {
  const value = await AsyncStorage.getItem(storageKey(userId));
  return value === 'true';
}

export async function setBiometricLockEnabled(userId: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), enabled ? 'true' : 'false');
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  // disableDeviceFallback: true - this is a quick re-entry gate on an
  // already-authenticated session, not an account-recovery flow, so a
  // failed/cancelled fingerprint should just let the user retry the
  // fingerprint (or use the app's own login) rather than Android falling
  // back to the phone's device-credential prompt - which on some Samsung
  // devices surfaces as a Samsung account sign-in, not a local PIN.
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Finance Nepal',
    disableDeviceFallback: true,
    cancelLabel: 'Cancel',
  });
  return result.success;
}
