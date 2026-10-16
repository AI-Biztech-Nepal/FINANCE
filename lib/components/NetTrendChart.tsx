// lib/components/NetTrendChart.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { formatMoney } from '../utils/money';

// A per-period NET value that can swing positive or negative (e.g. Available
// Balance's sale - purchase - expense), rendered as bars diverging from a
// zero baseline - green above, red below. Unlike BarChart this can't just
// clamp negatives to a flat bar, so it gets its own small renderer.
export function NetTrendChart({
  data,
  positiveLabel = 'Net in',
  negativeLabel = 'Net out',
  formatLabel,
}: {
  data: { label: string; net: number }[];
  positiveLabel?: string;
  negativeLabel?: string;
  formatLabel?: (label: string, index: number) => string | null;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  // Switching granularity (e.g. Day -> Month) swaps in a shorter `data`
  // array - a selected index from the old, longer array would otherwise
  // point past the end of the new one and crash on data[selected].label.
  useEffect(() => {
    setSelected(null);
  }, [data]);
  const half = 56;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.net)));

  return (
    <View>
      <View className="relative flex-row items-stretch" style={{ height: half * 2, gap: 2 }}>
        <View className="absolute left-0 right-0 h-px bg-gray-200" style={{ top: half }} />
        {data.map((d, i) => {
          const barHeight = d.net === 0 ? 0 : Math.max(3, (Math.abs(d.net) / maxAbs) * half);
          const isPositive = d.net >= 0;
          const isSelected = selected === i;
          return (
            <Pressable
              key={i}
              onPress={() => setSelected(isSelected ? null : i)}
              className="flex-1"
              style={{ height: half * 2 }}
            >
              <View style={{ height: half, justifyContent: 'flex-end' }}>
                {isPositive && barHeight > 0 && (
                  <View
                    style={{ height: barHeight, backgroundColor: isSelected ? '#059669' : '#6ee7b7' }}
                    className="w-full rounded-t"
                  />
                )}
              </View>
              <View style={{ height: half, justifyContent: 'flex-start' }}>
                {!isPositive && barHeight > 0 && (
                  <View
                    style={{ height: barHeight, backgroundColor: isSelected ? '#dc2626' : '#fca5a5' }}
                    className="w-full rounded-b"
                  />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1.5 flex-row" style={{ gap: 2 }}>
        {data.map((d, i) => {
          const label = formatLabel ? formatLabel(d.label, i) : d.label;
          return (
            <View key={i} className="flex-1 items-center">
              {label ? (
                <Text className="text-[8.5px] text-gray-400" numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {selected != null && data[selected] && (
        <View className="mt-2.5 self-start rounded-lg bg-gray-900 px-3 py-1.5">
          <Text className="text-xs font-semibold text-white">
            {data[selected].label}: {data[selected].net >= 0 ? positiveLabel : negativeLabel} NPR{' '}
            {formatMoney(Math.abs(data[selected].net))}
          </Text>
        </View>
      )}
      <View className="mt-2.5 flex-row items-center gap-4">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <Text className="text-[11px] text-gray-500">{positiveLabel}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <Text className="text-[11px] text-gray-500">{negativeLabel}</Text>
        </View>
      </View>
    </View>
  );
}
