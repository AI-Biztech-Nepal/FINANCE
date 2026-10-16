// lib/components/finance/FormSection.tsx
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** A labeled group within a transaction form (Sale/Purchase/Expense,
 * Payment In/Out) - these forms had grown into one long flat list of
 * fields with no visual grouping, so it was hard to tell at a glance what
 * belonged together. `first` skips the top divider for the opening section. */
export function FormSection({
  icon,
  title,
  first,
  tight,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  first?: boolean;
  /** Skips the divider/top-padding that normally separates sections - for a
   * section that should sit close under the one above it instead of reading
   * as a clearly separate group. */
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={first ? 'mb-4' : tight ? '-mt-2 mb-4' : 'mb-4 mt-1 border-t border-gray-100 pt-4'}>
      <View className="mb-3 flex-row items-center gap-1.5">
        <Ionicons name={icon} size={13} color="#9CA3AF" />
        <Text className="text-[11px] font-bold capitalize tracking-wide text-gray-400">{title}</Text>
      </View>
      {children}
    </View>
  );
}
