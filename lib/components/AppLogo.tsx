// lib/components/AppLogo.tsx
import { Image } from 'react-native';

/** The Finance Nepal logo (the blue and red F with the bar chart, without the words), kept in a square `size` box. Also the app icon on the phone
 * (assets/icon.png and the android-icon-*.png layers are made from the same artwork). */
export function AppLogo({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/logos/finance-logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Finance Nepal"
    />
  );
}
