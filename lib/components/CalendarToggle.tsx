// lib/components/CalendarToggle.tsx
import { Pressable, Text, View } from 'react-native';
import { useCalendarMode, type CalendarMode } from '../hooks/useCalendarMode';

const OPTIONS: { mode: CalendarMode; label: string; help: string }[] = [
  { mode: 'ad', label: 'AD', help: 'Show dates in English (AD)' },
  { mode: 'bs', label: 'BS', help: 'Show dates in Nepali (BS)' },
];

/** The AD / BS switch in the top bar: whether the dates on every page are read in English (AD) or
 * Nepali (BS). It is the same choice as the one inside a date picker - it sets it for every date,
 * and is remembered across launches. What is stored never changes, only how it is drawn. */
export function CalendarToggle() {
  const [mode, setMode] = useCalendarMode();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Date calendar"
      className="flex-row rounded-lg bg-gray-100 p-0.5"
    >
      {OPTIONS.map((o) => {
        const on = o.mode === mode;
        return (
          <Pressable
            key={o.mode}
            onPress={() => setMode(o.mode)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.help}
            hitSlop={4}
            className="items-center justify-center rounded-md px-2.5 py-1"
            style={{ backgroundColor: on ? '#FFFFFF' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,24,40,0.12)' : undefined }}
          >
            <Text className="text-[12px] font-bold" style={{ color: on ? '#1D4ED8' : '#6B7280' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
