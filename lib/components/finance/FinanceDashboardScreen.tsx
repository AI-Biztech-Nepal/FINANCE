// lib/components/finance/FinanceDashboardScreen.tsx
import { useMemo, useState } from 'react';
import { journalOf } from '../../utils/journalVoucher';
import { View, Text, Pressable, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useAccountBalances, isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { WEB_SIDEBAR_MIN_WIDTH } from '../web/WebSidebarShell';
import { MONEY, type MoneyTone } from './moneyColors';
import { CARD_SHADOW, Card, RecentActivityCard, SalesTrendCard } from './dashboard/FinanceDashboard';
import { ENTRY_KINDS } from './entryKinds';
import { formatMoney } from '../../utils/money';

const BLUE = '#2563EB';

/** Space between blocks, and the gutter around the page - one value, so the
 * rhythm is the same between cards as it is at the edges. */
const GAP = 24;
/** Below this the two columns stack. */
const TWO_COLUMN_MIN = 900;
/** Metric grid: three across once the card is wide enough, else two. */
const METRIC_GAP = 12;
const THREE_ACROSS_MIN = 560;

/** Epoch ms for a bill/entry date. A bare 'YYYY-MM-DD' is read as local
 * midnight (new Date() would read it as UTC midnight); a full timestamp
 * (the created_at fallback) is used as-is. */
function dayTime(date: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(date).getTime();
}

/** The Finance pages that use the wider content column on the web (see
 * WebSidebarShell's `wideRoutes`) - tables and ledgers that use the room. */
export const FINANCE_WIDE_ROUTES = [
  '/finance',
  '/daybook',
  '/transactions',
  '/customers',
  '/customer',
  '/quick-payment',
  '/received',
  '/paid',
  '/sales-report',
  '/purchase-report',
  '/expense-report',
  '/party-report',
  '/to-receive',
  '/to-give',
  '/bank-accounts',
  '/bank-balances',
  '/import-statement',
  '/inventory',
  '/stock',
  '/report',
];

export function shortcuts(basePath: string): {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
}[] {
  return [
    { key: 'daybook', label: 'Day Book', icon: 'book', href: `${basePath}/daybook` },
    { key: 'transactions', label: 'Statement', icon: 'document-text', href: `${basePath}/transactions` },
    { key: 'customers', label: 'Ledger', icon: 'people', href: `${basePath}/customers` },
    ...ENTRY_KINDS.map((kind) => ({
      key: kind.key,
      label: kind.label,
      icon: kind.icon as keyof typeof Ionicons.glyphMap,
      href: `${basePath}${kind.path}`,
    })),
    { key: 'bank-accounts', label: 'Bank Accounts', icon: 'business', href: `${basePath}/bank-accounts` },
    // Import Statement is not a page of its own in the menu any more: it is the Import button in the
    // Statement page's header, which opens the same import flow (the /import-statement route).
    { key: 'inventory', label: 'Stock and Inventory', icon: 'cube', href: `${basePath}/inventory` },
    { key: 'report', label: 'Report', icon: 'bar-chart', href: `${basePath}/report` },
    // Quotation only exists under (reseller) for now - a wholesaler basePath has no matching
    // route, so it would be a dead link there. Buying stock is not a page of its own here any more:
    // it is the Buy Stock button on Stock and Inventory.
    ...(basePath === '/(reseller)'
      ? [{ key: 'quotation', label: 'Quotation', icon: 'document-text' as const, href: `${basePath}/quotation/new` }]
      : []),
  ];
}

// Purely a rendering hint (icon badge color per shortcut) - not part of the
// shortcuts() data/routing above, so restyling the grid can never touch the
// key/label/icon/href it returns.
const SHORTCUT_COLORS: Record<string, { bg: string; fg: string }> = {
  daybook: { bg: '#EFF6FF', fg: '#1D4ED8' },
  transactions: { bg: '#EFF6FF', fg: '#2563EB' },
  customers: { bg: '#EFF6FF', fg: '#2563EB' },
  'payment-in': { bg: '#ECFDF5', fg: '#059669' },
  'payment-out': { bg: '#FEF2F2', fg: '#DC2626' },
  sales: { bg: '#ECFDF5', fg: '#059669' },
  purchase: { bg: '#FEF2F2', fg: '#DC2626' },
  expenses: { bg: MONEY.out.bg, fg: MONEY.out.base },
  'bank-accounts': { bg: '#EEF2FF', fg: '#4F46E5' },
  inventory: { bg: '#F5F3FF', fg: '#7C3AED' },
  report: { bg: '#EFF6FF', fg: '#2563EB' },
  quotation: { bg: '#FDF4FF', fg: '#A21CAF' },
};

function CircularProgress({
  percent,
  size = 44,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percent / 100);
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.3)" strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="white"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

/** The largest font size (down to `min`) at which `text` still fits `width`
 * px on one line. Bold digits run about 0.62em wide, so this is a safe
 * estimate - a long figure shrinks instead of being cut off. */
function fitFont(text: string, width: number, max: number, min = 11): number {
  let size = max;
  while (size > min && text.length * size * 0.62 > width) size -= 0.5;
  return size;
}

/** One headline figure. Every tile is the same size (the grid hands it an exact
 * width) and its value is fitted to that width, so none can overflow. `compact`
 * is the tighter tile for a page fitted to the screen: no icon badge, less
 * padding, and it takes its share of the row (and of its height) instead of a
 * fixed width. */
function Metric({
  label,
  value,
  caption,
  icon,
  color,
  width,
  compact,
  onPress,
}: {
  label: string;
  value: number;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  width: number;
  compact?: boolean;
  onPress: () => void;
}) {
  const text = `${value < 0 ? '−' : ''}NPR ${formatMoney(Math.abs(value))}`;
  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="justify-center overflow-hidden rounded-xl bg-white px-3 py-2"
        style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: `${color}40` }}
      >
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Ionicons name={icon} size={14} color={color} />
          <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text className="mt-0.5 font-extrabold" style={{ color, fontSize: fitFont(text, width - 2 * 12 - 2, 16), lineHeight: 20 }} numberOfLines={1}>
          {text}
        </Text>
        <Text className="text-xs text-gray-500" numberOfLines={1}>
          {caption}
        </Text>
      </Pressable>
    );
  }
  const inner = width - 2 * 14 - 2; // padding and border
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="overflow-hidden rounded-2xl bg-white p-3.5"
      style={{ width, borderWidth: 1, borderColor: `${color}40` }}
    >
      <View className="mb-2.5 h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1A` }}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text className="text-xs font-semibold text-gray-500" numberOfLines={1}>
        {label}
      </Text>
      <Text className="mt-0.5 font-extrabold" style={{ color, fontSize: fitFont(text, inner, 17), lineHeight: 22 }} numberOfLines={1}>
        {text}
      </Text>
      <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

export function FinanceDashboardScreen({ basePath }: { basePath: string }) {
  // Percentage widths (e.g. '31%') combined with a flex `gap` are computed
  // differently by React Native's native layout engine than by the browser,
  // so 3-across shortcut tiles that render correctly on web can wrap to 2 on
  // a real device. Computing an exact pixel width up front avoids that.
  const { width: screenWidth } = useWindowDimensions();
  const SCREEN_PADDING = 24; // px-6
  const GRID_GAP = 12; // gap-3
  const thirdTileWidth = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * 2) / 3;
  // With the sidebar showing, every shortcut is already a link on the left,
  // so the shortcut grid is only for phones (and phone-width browsers).
  const hasSidebar = Platform.OS === 'web' && screenWidth >= WEB_SIDEBAR_MIN_WIDTH;

  // The column split is worked out from the real width of the page body, not
  // the window: the sidebar and gutters have already taken their share. One
  // third / two thirds, shared by both rows so the card edges line up.
  const [bodyWidth, setBodyWidth] = useState(0);
  const twoColumn = bodyWidth >= TWO_COLUMN_MIN;
  // With the sidebar and room for two columns the page is fitted to the window instead of
  // scrolling: everything is a little tighter, and the two cards at the bottom take
  // whatever height is left. (Narrower than that, or on a phone, it scrolls as before.)
  const fit = hasSidebar && twoColumn;
  const rowGap = fit ? 16 : GAP;
  const leftWidth = twoColumn ? Math.floor((bodyWidth - GAP) / 3) : bodyWidth;
  const rightWidth = twoColumn ? bodyWidth - GAP - leftWidth : bodyWidth;

  // The overview is one card: the balance on the left, the key figures beside
  // it (under it on a phone), split one third / two thirds like the row below.
  const CARD_PAD = fit ? 16 : 20; // the card's own padding
  const ZONE_GAP = fit ? 20 : 24; // either side of the divider
  const innerWidth = bodyWidth - 2 * CARD_PAD;
  const zoneLeft = twoColumn ? Math.floor((innerWidth - (2 * ZONE_GAP + 1)) / 3) : innerWidth;
  const zoneRight = twoColumn ? innerWidth - (2 * ZONE_GAP + 1) - zoneLeft : innerWidth;
  const metricCols = zoneRight >= THREE_ACROSS_MIN ? 3 : 2;
  const metricWidth = Math.floor((zoneRight - METRIC_GAP * (metricCols - 1)) / metricCols);

  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  // `all`: every tile below is a sum over these rows; a plain read stops at 1000.
  const { data: allEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });

  const totals = useMemo(() => {
    const result = { sale: 0, purchase: 0, expense: 0 };
    for (const t of transactions ?? []) {
      result[t.type] += t.amount;
    }
    return result;
  }, [transactions]);

  // To Receive = customers who owe the business (customer_ledger_entries).
  // To Give = vendors the business owes (vendor_ledger_entries) - a
  // separate ledger with the opposite polarity, so a customer overpayment
  // never gets misread as a supplier debt and vice versa.
  const toReceive = useMemo(() => {
    const perCustomer: Record<string, number> = {};
    for (const e of allEntries ?? []) {
      perCustomer[e.customer_id] = (perCustomer[e.customer_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
    }
    return Object.values(perCustomer)
      .filter((balance) => balance > 0)
      .reduce((sum, balance) => sum + balance, 0);
  }, [allEntries]);

  const toGive = useMemo(() => {
    const perVendor: Record<string, number> = {};
    for (const e of vendorEntries ?? []) {
      perVendor[e.vendor_id] = (perVendor[e.vendor_id] ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount);
    }
    return Object.values(perVendor)
      .filter((balance) => balance > 0)
      .reduce((sum, balance) => sum + balance, 0);
  }, [vendorEntries]);

  // The combined cash-in-hand + bank balance across every account - shared
  // with the Bank Accounts screen's per-account breakdown so the two can
  // never drift apart (see useAccountBalances for the full formula).
  const accountBalances = useAccountBalances(userId);
  const availableBalance = accountBalances.total;

  // Matches TotalsReportScreen's definitions: "received" is a payment
  // actually collected from a customer (Payment In, or a synced job
  // payment) - NOT a Sale, which is its own separate figure (the Sales
  // tile) and, since 0061_sale_purchase_always_ledger.sql, books a debt
  // rather than cash received. "paid" is every expense, every manual
  // Payment Out to a customer, and every payment actually made to a vendor
  // (a Purchase itself is a debt too now, not cash spent) - booking-sourced
  // debit entries are excluded since those represent money owed, not money
  // that's actually left the business yet.
  const { yearReceived, yearPaid } = useMemo(() => {
    const year = new Date().getFullYear();
    let received = 0;
    let paid = 0;
    const inYear = (date: string) => new Date(dayTime(date)).getFullYear() === year;
    for (const t of transactions ?? []) {
      if (!inYear(t.bill_date ?? t.created_at)) continue;
      if (t.type === 'expense') paid += t.amount;
      if (isSettledOnTheSpot(t)) {
        if (t.type === 'sale') received += t.amount;
        else paid += t.amount;
      }
    }
    for (const e of allEntries ?? []) {
      // A journal voucher's halves are not money received or paid.
      if (journalOf(e.note)) continue;
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') received += e.amount;
      if (e.entry_type === 'debit' && e.source === 'manual') paid += e.amount;
    }
    for (const e of vendorEntries ?? []) {
      if (journalOf(e.note)) continue;
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') paid += e.amount;
    }
    return { yearReceived: received, yearPaid: paid };
  }, [transactions, allEntries, vendorEntries]);

  const profileCompletion = useMemo(() => {
    const fields = [profile?.full_name, profile?.phone, profile?.avatar_url, profile?.city];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }, [profile]);

  const go = (path: string) => () => router.push(`${basePath}${path}` as never);
  const netProfit = totals.sale - totals.purchase - totals.expense;

  // Overview figures sit in half-width tiles; their text is fitted too.
  const halfTile = (zoneLeft - 12) / 2;
  const overviewTile = (label: string, caption: string, value: number, tone: MoneyTone, path: string) => {
    const text = `NPR ${formatMoney(value)}`;
    return (
      <Pressable onPress={go(path)} accessibilityRole="button" accessibilityLabel={label} className={`flex-1 overflow-hidden rounded-xl ${fit ? 'px-3 py-2' : 'p-3'}`} style={{ backgroundColor: tone.bg }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone.base }} />
          <Text className="text-xs font-semibold text-gray-600">{label}</Text>
        </View>
        <Text className="mt-1 font-extrabold" style={{ color: tone.text, fontSize: fitFont(text, halfTile - 24, 15) }} numberOfLines={1}>
          {text}
        </Text>
        <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
          {caption}
        </Text>
      </Pressable>
    );
  };

  const balanceText = `NPR ${formatMoney(availableBalance)}`;
  const metrics = [
    { label: 'Sales', value: totals.sale, caption: 'All time', icon: 'trending-up' as const, color: MONEY.in.base, path: '/transactions?type=sale' },
    { label: 'Purchase', value: totals.purchase, caption: 'All time', icon: 'cart' as const, color: MONEY.out.base, path: '/transactions?type=purchase' },
    { label: 'Expenses', value: totals.expense, caption: 'All time', icon: 'receipt' as const, color: MONEY.out.base, path: '/transactions?type=expense' },
    { label: 'Total received', value: yearReceived, caption: 'This year', icon: 'arrow-down-circle' as const, color: MONEY.in.base, path: '/received' },
    { label: 'Total paid', value: yearPaid, caption: 'This year', icon: 'arrow-up-circle' as const, color: MONEY.out.base, path: '/paid' },
    {
      label: 'Net profit',
      value: netProfit,
      caption: 'After all costs',
      icon: 'stats-chart' as const,
      color: netProfit >= 0 ? MONEY.in.base : MONEY.out.base,
      path: '/report',
    },
  ];
  const metricTile = (m: (typeof metrics)[number]) => (
    <Metric key={m.label} width={metricWidth} compact={fit} label={m.label} value={m.value} caption={m.caption} icon={m.icon} color={m.color} onPress={go(m.path)} />
  );
  const overview = (
    // Fitted to the screen it is only as tall as its content - the cards below take the rest.
    <Card title="Financial overview" compact={fit} style={fit ? { flexGrow: 0 } : undefined}>
      <View style={{ flexDirection: twoColumn ? 'row' : 'column', gap: ZONE_GAP, alignItems: 'stretch' }}>
        <View style={{ width: zoneLeft }}>
          {/* Grows to take whatever height the row gives it, so it never ends in a blank strip. */}
          <Pressable onPress={go('/bank-balances')} accessibilityRole="button" accessibilityLabel="Available balance" style={{ flexGrow: 1 }}>
            {/* A quiet neutral tile like the ones beside it - the amount in dark ink,
                red only when the balance is below zero - so it doesn't pull the eye
                away from everything else on the page. */}
            <View
              style={{
                flexGrow: 1,
                justifyContent: 'center',
                borderRadius: 16,
                padding: fit ? 14 : 18,
                backgroundColor: '#F9FAFB',
                borderWidth: 1,
                borderColor: '#E5E7EB',
              }}
            >
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Ionicons name="wallet-outline" size={14} color="#6B7280" />
                <Text className="text-xs font-semibold text-gray-600">Available balance</Text>
              </View>
              <Text
                className="mt-1 font-extrabold"
                style={{
                  color: availableBalance < 0 ? '#DC2626' : '#111827',
                  fontSize: fitFont(balanceText, zoneLeft - 2 * (fit ? 14 : 18), fit ? 24 : 26, 18),
                  lineHeight: fit ? 30 : 32,
                }}
                numberOfLines={1}
              >
                {balanceText}
              </Text>
              <Text className="mt-1 text-xs text-gray-500">Cash in hand + all bank accounts</Text>
            </View>
          </Pressable>

          <View className={`${fit ? 'mt-2.5' : 'mt-3'} flex-row`} style={{ gap: 12 }}>
            {overviewTile('Receivable', 'Customers owe you', toReceive, MONEY.in, '/to-receive')}
            {overviewTile('Payable', 'You owe vendors', toGive, MONEY.out, '/to-give')}
          </View>
        </View>

        {twoColumn && <View style={{ width: 1, backgroundColor: '#F1F2F4' }} />}

        <View style={{ width: zoneRight, ...(fit ? { gap: METRIC_GAP } : null) }}>
          {fit ? (
            // Two rows of three that share the height the left side needs, so the tiles line up with it.
            <>
              <View className="flex-row" style={{ flex: 1, gap: METRIC_GAP }}>
                {metrics.slice(0, 3).map(metricTile)}
              </View>
              <View className="flex-row" style={{ flex: 1, gap: METRIC_GAP }}>
                {metrics.slice(3).map(metricTile)}
              </View>
            </>
          ) : (
            <View className="flex-row flex-wrap" style={{ gap: METRIC_GAP }}>
              {metrics.map(metricTile)}
            </View>
          )}
        </View>
      </View>
    </Card>
  );

  // Every shortcut is already a link in the sidebar, so this grid is for phones.
  const shortcutGrid = hasSidebar ? null : (
    <View>
      <Text className="mb-2 text-sm font-semibold text-gray-900">Shortcuts</Text>
      <View className="flex-row flex-wrap gap-3">
        {shortcuts(basePath).map((s) => {
          const color = SHORTCUT_COLORS[s.key] ?? { bg: '#EFF6FF', fg: BLUE };
          return (
            <Pressable
              key={s.key}
              onPress={() => router.push(s.href as any)}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              className="items-center rounded-2xl bg-white py-4"
              style={{ width: thirdTileWidth, ...CARD_SHADOW }}
            >
              <View className="mb-1.5 h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: color.bg }}>
                <Ionicons name={s.icon} size={22} color={color.fg} />
              </View>
              <Text className="text-center text-xs font-semibold text-gray-700">{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const profileCompletionCard = profileCompletion < 100 && (
    <Pressable onPress={go('/profile')} accessibilityRole="button" accessibilityLabel="Complete your profile" className="overflow-hidden rounded-2xl">
      <LinearGradient
        colors={['#2563EB', '#1D4ED8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: fit ? 12 : 14, padding: fit ? 10 : 16 }}
      >
        <View style={{ width: fit ? 30 : 44, height: fit ? 30 : 44 }} className="items-center justify-center">
          <View style={{ position: 'absolute' }}>
            <CircularProgress percent={profileCompletion} size={fit ? 30 : 44} strokeWidth={fit ? 3 : 4} />
          </View>
          <Text className={`${fit ? 'text-[9px]' : 'text-xs'} font-extrabold text-white`}>{profileCompletion}%</Text>
        </View>
        {/* One line when the page is fitted to the screen; two otherwise. */}
        <View className="flex-1" style={fit ? { flexDirection: 'row', alignItems: 'center', gap: 10 } : undefined}>
          <Text className="text-sm font-bold text-white">Complete your profile</Text>
          <Text className={`${fit ? 'flex-1' : 'mt-0.5'} text-xs text-white/80`} numberOfLines={fit ? 1 : undefined}>
            Add your remaining details so customers and technicians trust your business.
          </Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color="white" />
      </LinearGradient>
    </Pressable>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      // flexGrow lets the page body be exactly as tall as the window when it is fitted to it;
      // if the window is shorter than the least the cards need, it still scrolls.
      contentContainerStyle={{
        paddingHorizontal: GAP,
        paddingTop: fit ? 16 : GAP,
        paddingBottom: fit ? 16 : hasSidebar ? GAP : 40,
        flexGrow: 1,
      }}
    >
      <View onLayout={(e) => setBodyWidth(e.nativeEvent.layout.width)} style={{ gap: rowGap, ...(fit ? { flex: 1 } : null) }}>
        {bodyWidth > 0 && (
          <>
            {overview}
            {shortcutGrid}
            {profileCompletionCard}

            {/* Stacked on a phone, the trend leads and the activity list follows. */}
            <View
              style={{
                flexDirection: twoColumn ? 'row' : 'column-reverse',
                gap: GAP,
                alignItems: 'stretch',
                ...(fit ? { flex: 1, minHeight: 210 } : null),
              }}
            >
              <View style={{ width: leftWidth }}>
                <RecentActivityCard basePath={basePath} fill={fit} />
              </View>
              <View style={{ width: rightWidth }}>
                <SalesTrendCard fill={fit} />
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}
