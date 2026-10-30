// lib/components/finance/dashboard/FinanceDashboard.tsx
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../hooks/useAuth';
import { useSupabaseQuery } from '../../../hooks/useSupabase';
import { toBsHistoryLabel } from '../../../utils/nepaliDate';
import { useCalendarMode } from '../../../hooks/useCalendarMode';
import { LineChart } from './LineChart';
import { MONEY } from '../moneyColors';
import { tidyName } from '../../../utils/nameCaps';
import { PERIODS, buildRange, npr, seriesByBucket, sumType, txTime, type PeriodKey } from './dashboardData';

const SALES = MONEY.in.base;
const PURCHASE = MONEY.out.base;
const EXPENSE = MONEY.out.base;

export const CARD_SHADOW = {
  shadowColor: '#101828',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** The one card every block on the Finance page uses: white, 16px radius, 20px
 * padding, a 15px title with an optional caption, and it stretches to the
 * height of its row so neighbours always end on the same line. */
export function Card({
  title,
  subtitle,
  right,
  children,
  style,
  compact,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
  /** Less padding, for a page that has to fit on one screen. */
  compact?: boolean;
}) {
  return (
    <View className={`rounded-2xl bg-white ${compact ? 'p-4' : 'p-5'}`} style={[CARD_SHADOW, { flexGrow: 1 }, style]}>
      <View className={`${compact ? 'mb-2.5' : 'mb-4'} flex-row flex-wrap items-start justify-between`} style={{ gap: 12 }}>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 150 }}>
          <Text className="text-[15px] font-bold text-gray-900">{title}</Text>
          {!!subtitle && <Text className="mt-0.5 text-xs text-gray-400">{subtitle}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const TYPE_STYLE = {
  sale: { icon: 'trending-up', color: SALES, label: 'Sale' },
  purchase: { icon: 'cart', color: PURCHASE, label: 'Purchase' },
  expense: { icon: 'receipt', color: EXPENSE, label: 'Expenses' },
} as const;

function useTransactions() {
  const userId = useAuthStore((state) => state.ownerId ?? undefined);
  const { data } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  return useMemo(() => data ?? [], [data]);
}

/** The least height the chart is drawn at when it fills the card (see `fill`). */
const MIN_CHART_HEIGHT = 150;

/** Sales over time as a line, with a 7 days / 30 days / 6 months / 12 months switch.
 * With `fill` the chart takes whatever height the card has left (the page is
 * fitted to the screen); otherwise it is a fixed 270px. */
export function SalesTrendCard({ fill }: { fill?: boolean }) {
  const txs = useTransactions();
  const [period, setPeriod] = useState<PeriodKey>('1m');
  const [bodyHeight, setBodyHeight] = useState(0);

  const [calendarMode] = useCalendarMode();
  const range = useMemo(() => buildRange(period), [period, calendarMode]);
  const labels = useMemo(() => range.buckets.map((b) => b.label), [range]);
  const periodMeta = PERIODS.find((p) => p.key === period)!;
  // Today by the hour stops at the current hour rather than running down to zero.
  const sales = useMemo(() => seriesByBucket(txs, 'sale', range.buckets).slice(0, range.upTo), [txs, range]);
  const salesTotal = useMemo(() => sumType(txs, 'sale', range.from, range.to), [txs, range]);

  const chart = (height: number) => (
    <LineChart
      labels={labels}
      series={[{ key: 'sale', label: 'Sales', color: SALES, values: sales, area: true }]}
      height={height}
      formatValue={npr}
      emptyText="No sales recorded in this period yet"
    />
  );

  return (
    <Card
      compact={fill}
      title="Sales trend"
      subtitle={`${npr(salesTotal)} ${periodMeta.caption}`}
      right={
        <View className="flex-row rounded-xl bg-gray-100 p-1" style={{ gap: 2 }}>
          {PERIODS.map((p) => {
            const on = p.key === period;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                className="rounded-lg px-3 py-1.5"
                style={on ? { backgroundColor: '#fff', ...CARD_SHADOW, shadowOpacity: 0.1 } : undefined}
              >
                <Text className={`text-xs font-bold ${on ? 'text-blue-600' : 'text-gray-500'}`}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      }
    >
      {fill ? (
        // The space under the header, whatever it is. The chart is laid over it rather
        // than inside it, so the chart's own height can never change the space it is measured in.
        <View style={{ flex: 1, minHeight: MIN_CHART_HEIGHT }} onLayout={(e) => setBodyHeight(Math.floor(e.nativeEvent.layout.height))}>
          {bodyHeight > 0 && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: bodyHeight }}>{chart(bodyHeight)}</View>}
        </View>
      ) : (
        chart(270)
      )}
    </Card>
  );
}

/** One row of the recent-activity list: 20px of padding, two lines of text, a 1px rule -
 * a little over what it measures, so the last row shown is never clipped. */
const ACTIVITY_ROW_HEIGHT = 58;
const MIN_ACTIVITY_ROWS = 2;

/** The latest sales, purchases and expenses, newest first. With `fill` it shows as
 * many as fit the height the card has (2 to 10); otherwise the latest 6. */
export function RecentActivityCard({ basePath, fill }: { basePath: string; fill?: boolean }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const txs = useTransactions();
  const [bodyHeight, setBodyHeight] = useState(0);
  const limit = fill && bodyHeight > 0 ? Math.min(10, Math.max(MIN_ACTIVITY_ROWS, Math.floor(bodyHeight / ACTIVITY_ROW_HEIGHT))) : 6;
  const recent = useMemo(
    () => [...txs].sort((a, b) => txTime(b) - txTime(a) || b.created_at.localeCompare(a.created_at)).slice(0, limit),
    [txs, limit]
  );
  const go = (path: string) => router.push(`${basePath}${path}` as never);

  const list =
    recent.length === 0 ? (
      <View className="items-center justify-center py-10">
        <Text className="text-center text-sm text-gray-400">Nothing recorded yet</Text>
      </View>
    ) : (
      <View>
        {recent.map((t, i) => {
          const meta = TYPE_STYLE[t.type];
          return (
            <Pressable
              key={t.id}
              onPress={() => go(`/transactions?type=${t.type}`)}
              className={`flex-row items-center justify-between py-2.5 ${i < recent.length - 1 ? 'border-b border-gray-100' : ''}`}
              style={{ gap: 10 }}
            >
              <View className="flex-1 flex-row items-center" style={{ gap: 10, minWidth: 0 }}>
                <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.color}1A` }}>
                  <Ionicons name={meta.icon} size={14} color={meta.color} />
                </View>
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
                    {tidyName(t.party_name) || meta.label}
                  </Text>
                  <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                    {toBsHistoryLabel(t.bill_date ?? t.created_at)}
                  </Text>
                </View>
              </View>
              <Text className="text-[13px] font-bold" style={{ color: meta.color }} numberOfLines={1}>
                {t.type === 'sale' ? '+' : '−'} {npr(t.amount)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );

  return (
    <Card
      compact={fill}
      title="Recent activity"
      subtitle="Latest sales, purchases and expenses"
      right={
        <Pressable onPress={() => go('/transactions')}>
          <Text className="text-xs font-bold text-blue-600">View all</Text>
        </Pressable>
      }
    >
      {fill ? (
        // Measured, not sized by its rows: the rows shown are worked out from this height.
        <View style={{ flex: 1, minHeight: MIN_ACTIVITY_ROWS * ACTIVITY_ROW_HEIGHT, overflow: 'hidden' }} onLayout={(e) => setBodyHeight(Math.floor(e.nativeEvent.layout.height))}>
          {list}
        </View>
      ) : (
        list
      )}
    </Card>
  );
}
