// lib/components/AppLogo.tsx
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themeColors } from '../theme/accent';

// Placeholder mark until the store has its own logo art.
export function AppLogo({ size = 44 }: { size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: themeColors.c600, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="storefront" size={size * 0.5} color="#fff" />
    </View>
  );
}
