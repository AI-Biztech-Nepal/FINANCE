// lib/components/PortalHeaderBar.tsx
import type { ReactNode } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../hooks/useAuth';
import { CalendarToggle } from './CalendarToggle';

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const PROFILE_ROUTE: Record<string, string> = {
  store: '/(store)/profile',
};

/** `backTo` turns on a back button for a screen opened from somewhere else
 * (not a tab): it goes back through history, or to `backTo` when there is
 * none - a web deep link or a refreshed page. */
export function PortalHeaderBar({
  title,
  backTo,
  hideAccount,
  left,
  right,
}: {
  title?: string;
  backTo?: string;
  /** Drops the account avatar from the right - where the layout already shows the account elsewhere (the web sidebar). */
  hideAccount?: boolean;
  /** A screen's own controls (see useScreenHeader): before the title, and between it and the avatar. */
  left?: ReactNode;
  right?: ReactNode;
}) {
  const profile = useAuthStore((state) => state.profile);
  const profileRoute = profile?.role ? PROFILE_ROUTE[profile.role] : undefined;
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 pb-2.5"
      style={{ paddingTop: insets.top + 16 }}
    >
      {!!backTo && (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace(backTo as never))}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="-my-1 -ml-3 -mr-1 h-11 w-11 items-center justify-center rounded-full active:bg-gray-100"
        >
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </Pressable>
      )}
      {left}
      <Text className="flex-1 text-xl font-bold text-gray-900" numberOfLines={1}>
        {title ?? ''}
      </Text>
      {/* On every page: dates in English (AD) or Nepali (BS). */}
      <CalendarToggle />
      {!!right && (
        <View className="flex-row items-center" style={{ gap: 8 }}>
          {right}
        </View>
      )}
      {!hideAccount && (
        <Pressable onPress={() => profileRoute && router.push(profileRoute as never)} hitSlop={8}>
          <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-orange-100">
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <Text className="text-xs font-bold text-orange-700">{initialsOf(profile?.full_name)}</Text>
            )}
          </View>
        </Pressable>
      )}
    </View>
  );
}
