// lib/components/finance/TrendChartCard.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { BarChart } from '../BarChart';
import { NetTrendChart } from '../NetTrendChart';
import { toBsDayChartLabel, toBsMonthChartLabel } from '../../utils/nepaliDate';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import type { BusinessTransaction, BusinessTransactionType } from '../../../types/database.types';
import { formatMoney } from '../../utils/money';
import { themeColors } from '../../theme/accent';

export type TrendMetric = 'all' | BusinessTransactionType;
export type Granularity = 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

const METRIC_META: Record<TrendMetric, { label: string; color: string }> = {
  all: { label: 'Available Balance', get color() { return themeColors.c600; } },
  sale: { label: 'Sales', color: '#059669' },
  purchase: { label: 'Purchase', color: '#dc2626' },
  expense: { label: 'Expenses', color: '#dc2626' },
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date) {
  const day = startOfDay(d);
  const dow = day.getDay() === 0 ? 7 : day.getDay(); // Monday = 1 ... Sunday = 7
  return new Date(day.getTime() - (dow - 1) * DAY_MS);
}

const DEFAULT_COUNTS: Record<Granularity, number> = { week: 12, month: 12 };

// Bucket boundaries for the trend chart - week (last N weeks) or month
// (last N months, capped at the 12 months of the current year), shared by
// every metric so switching granularity re-buckets consistently. `count`
// lets a narrower chart (e.g. a dual bar-per-bucket layout) ask for fewer,
// wider buckets than the default single-bar charts.
export function periodBuckets(granularity: Granularity, count = DEFAULT_COUNTS[granularity]): { start: number; end: number; label: string }[] {
  const now = new Date();
  if (granularity === 'week') {
    const thisWeekStart = startOfWeek(now).getTime();
    return Array.from({ length: count }, (_, i) => {
      const start = thisWeekStart - (count - 1 - i) * 7 * DAY_MS;
      return { start, end: start + 7 * DAY_MS, label: toBsDayChartLabel(start) };
    });
  }
  const monthCount = Math.min(count, 12);
  const year = now.getFullYear();
  return Array.from({ length: monthCount }, (_, i) => {
    const month = 12 - monthCount + i;
    const start = new Date(year, month, 1).getTime();
    const end = new Date(year, month + 1, 1).getTime();
    return { start, end, label: toBsMonthChartLabel(start) };
  });
}

export function formatBucketLabel(granularity: Granularity, label: string, i: number, total: number) {
  if (granularity === 'week') return i % 3 === 0 || i === total - 1 ? label : null;
  return label;
}

// A Day/Week/Month bar chart for one or more transaction metrics - a single
// type (Sales/Purchase/Expense) sums to a plain bar chart, "Available
// Balance" nets sale - purchase - expense per period (which can swing either
// way) via the diverging NetTrendChart instead. Pass a single-item `metrics`
// list to lock the metric with no tabs (e.g. a screen already filtered to
// one type); pass several to let the user switch between them.
export function TrendChartCard({
  transactions,
  metrics,
  initialMetric,
}: {
  transactions: BusinessTransaction[];
  metrics: TrendMetric[];
  initialMetric?: TrendMetric;
}) {
  const [metric, setMetric] = useState<TrendMetric>(initialMetric ?? metrics[0]);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [calendarMode] = useCalendarMode();
  const buckets = useMemo(() => periodBuckets(granularity), [granularity, calendarMode]);

  const typeChartData = useMemo(() => {
    if (metric === 'all') return [];
    return buckets.map((b) => ({
      label: b.label,
      value: transactions
        .filter((t) => t.type === metric && new Date(t.created_at).getTime() >= b.start && new Date(t.created_at).getTime() < b.end)
        .reduce((sum, t) => sum + t.amount, 0),
    }));
  }, [transactions, metric, buckets]);

  const netChartData = useMemo(() => {
    if (metric !== 'all') return [];
    return buckets.map((b) => {
      const inRange = transactions.filter((t) => {
        const tm = new Date(t.created_at).getTime();
        return tm >= b.start && tm < b.end;
      });
      const net = inRange.reduce((sum, t) => sum + (t.type === 'sale' ? t.amount : -t.amount), 0);
      return { label: b.label, net };
    });
  }, [transactions, metric, buckets]);

  const accentColor = METRIC_META[metric].color;

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      {metrics.length > 1 && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {metrics.map((m) => {
            const selected = metric === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMetric(m)}
                className={`rounded-full px-3 py-1.5 ${selected ? '' : 'border border-gray-200 bg-white'}`}
                style={selected ? { backgroundColor: METRIC_META[m].color } : undefined}
              >
                <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>
                  {METRIC_META[m].label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text className="mb-3 text-sm font-semibold text-gray-900">{METRIC_META[metric].label} trend</Text>

      <View className="mb-3 flex-row gap-2">
        {(['week', 'month'] as Granularity[]).map((g) => {
          const selectedG = granularity === g;
          return (
            <Pressable
              key={g}
              onPress={() => setGranularity(g)}
              className={`flex-1 items-center rounded-full py-1.5 ${selectedG ? '' : 'border border-gray-200 bg-white'}`}
              style={selectedG ? { backgroundColor: accentColor } : undefined}
            >
              <Text className={`text-xs font-semibold capitalize ${selectedG ? 'text-white' : 'text-gray-600'}`}>{g}</Text>
            </Pressable>
          );
        })}
      </View>

      {metric === 'all' ? (
        <NetTrendChart
          data={netChartData}
          positiveLabel="Net gain"
          negativeLabel="Net loss"
          formatLabel={(label, i) => formatBucketLabel(granularity, label, i, netChartData.length)}
        />
      ) : (
        <BarChart
          data={typeChartData}
          color={accentColor}
          selectedColor={accentColor}
          formatValue={(v) => `NPR ${formatMoney(v)}`}
          formatLabel={(label, i) => formatBucketLabel(granularity, label, i, typeChartData.length)}
        />
      )}
    </View>
  );
}
