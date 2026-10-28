// lib/components/finance/BalanceSheetScreen.tsx
//
// The Finance tab as the company's Balance Sheet: what the business owns (cash and bank, what
// customers owe, stock) against what it owes (vendors, customer advances) and the owner's equity that
// balances the two. Everything is read from the books the app already keeps - nothing is typed here.
//
// Cash and bank come from useAccountBalances, a day's position from its activity lines; what is owed
// either way comes from the two party ledgers up to that day; stock is the product list at cost (it has
// no history, so earlier columns use today's stock). Equity is the balancing figure, so the sheet always
// balances - the check at the bottom states it.
import { useMemo, useState } from 'react';
import { withFrom } from '../../hooks/useCameFrom';
import { View, Text, Pressable, ScrollView, Modal, Platform, useWindowDimensions, type TextStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useAccountBalances } from '../../hooks/useAccountBalances';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { adStringToBs, bsToAdString, bsDaysInMonth, numericDateLabel, BS_MONTHS } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { round2 } from '../../utils/money';
import { WEB_SIDEBAR_MIN_WIDTH } from '../web/WebSidebarShell';
import { shortcuts } from './FinanceDashboardScreen';

const DAY_MS = 24 * 60 * 60 * 1000;
const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const BRAND_DARK = '#1E3A8A';
const BRAND = '#2563EB';
const BRAND_TINT = '#EFF6FF';
const RED = BRAND_DARK;
const GREEN = BRAND_DARK;
const AMBER = BRAND_DARK;
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

// ---------- numbers ----------
/** 2316130 -> "23,16,130" (the South Asian grouping), with paise when there are some; a minus sign for a negative. */
function inr(n: number): string {
  const v = round2(n);
  const sign = v < 0 ? '-' : '';
  const [s, paise] = Math.abs(v).toFixed(2).split('.');
  const dec = paise === '00' ? '' : `.${paise}`;
  if (s.length <= 3) return sign + s + dec;
  const tail = s.slice(-3);
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head},${tail}${dec}`;
}
function lakh(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}k`;
  return `${s}${Math.round(a)}`;
}
const pct = (now: number, before: number): number | null => (Math.abs(before) < 1 ? null : ((now - before) / Math.abs(before)) * 100);

// ---------- dates ----------
const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const addDays = (day: string, n: number) => iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS));
const dayOf = (s: string | null | undefined) => (s ?? '').slice(0, 10);

/** First day of the month `back` months before the one holding `day`, in the chosen calendar. */
function monthStart(day: string, back: number, mode: 'bs' | 'ad'): string {
  const bs = adStringToBs(day);
  if (mode === 'bs' && bs) {
    let y = bs.year;
    let m = bs.month - back;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    return bsToAdString(y, m, 1);
  }
  return iso(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 - back, 1)));
}
function fiscalStart(day: string): string {
  const bs = adStringToBs(day);
  if (!bs) return `${day.slice(0, 4)}-07-16`;
  return bsToAdString(bs.month >= 3 ? bs.year : bs.year - 1, 3, 1);
}
function monthLabel(day: string, mode: 'bs' | 'ad'): string {
  const bs = adStringToBs(day);
  if (mode === 'bs' && bs) return BS_MONTHS[bs.month].slice(0, 3);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

type AsOn = 'today' | 'last_month' | 'last_fy';
type Compare = 'fy_start' | 'month_start' | 'year_ago' | 'none';
const AS_ON: { key: AsOn; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last_month', label: 'End of last month' },
  { key: 'last_fy', label: 'End of last fiscal year' },
];
const COMPARE: { key: Compare; label: string }[] = [
  { key: 'fy_start', label: 'Start of fiscal year' },
  { key: 'month_start', label: 'Start of this month' },
  { key: 'year_ago', label: 'Same day last year' },
  { key: 'none', label: 'No comparison' },
];

/** A ledger typed Director, Owner, Partner, Proprietor, Shareholder, Investor or Capital holds what that person has put
 * into the business: it is the owner's capital (equity), not money owed to or by a customer or vendor. */
const CAPITAL_TYPE = /\b(directors?|owners?|partners?|proprietors?|shareholders?|investors?|capital)\b/i;

type Snapshot = {
  cash: number;
  banks: { id: string; name: string; balance: number }[];
  bankTotal: number;
  debtors: number;
  debtorCount: number;
  vendorAdvances: number;
  stock: number;
  creditors: number;
  creditorCount: number;
  customerAdvances: number;
  /** What each director / owner has put into the business, net of what they took out (see CAPITAL_TYPE). */
  capital: { id: string; name: string; amount: number }[];
  capitalTotal: number;
  assets: number;
  liabilities: number;
  equity: number;
  currentRatio: number | null;
};

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value)?.label ?? '';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="flex-row items-center rounded-xl border border-gray-200 bg-white px-3.5 py-2.5" style={{ gap: 8 }}>
        <Text className="text-[12px] text-gray-500">{label}</Text>
        <Text className="text-[13px] font-semibold text-gray-900">{current}</Text>
        <Ionicons name="chevron-down" size={14} color="#6B7280" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.25)', alignItems: 'center', justifyContent: 'center', padding: 24 }} onPress={() => setOpen(false)}>
          <View className="rounded-2xl bg-white py-2" style={{ minWidth: 260, maxWidth: 360 }}>
            <Text className="px-4 pb-2 pt-2 text-[12px] font-bold uppercase text-gray-500">{label}</Text>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                className="flex-row items-center px-4 py-3"
                style={{ backgroundColor: o.key === value ? '#EFF6FF' : undefined }}
              >
                <Text className="flex-1 text-[14px]" style={{ color: o.key === value ? '#1D4ED8' : INK, fontWeight: o.key === value ? '700' : '500' }}>{o.label}</Text>
                {o.key === value && <Ionicons name="checkmark" size={16} color="#1D4ED8" />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

type RowSpec = { label: string; sub?: string; amount: number; onPress?: () => void; note?: string };

function SheetRow({ r }: { r: RowSpec }) {
  const negative = r.amount < 0;
  return (
    <Pressable onPress={r.onPress} disabled={!r.onPress} className="flex-row items-center border-b border-gray-100 py-2.5" style={{ gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-[14px] text-gray-900" numberOfLines={2}>
          {r.onPress ? '▸ ' : ''}
          {r.label}
          {r.sub ? <Text className="text-gray-400">  ·  {r.sub}</Text> : null}
        </Text>
        {!!r.note && <Text className="mt-0.5 text-[11.5px]" style={{ color: RED }}>{r.note}</Text>}
      </View>
      <Text className="text-[14px] font-bold" style={[{ color: negative ? RED : INK }, TABULAR]}>{inr(r.amount)}</Text>
    </Pressable>
  );
}

function Group({ title, rows, subtotalLabel, subtotal }: { title: string; rows: RowSpec[]; subtotalLabel: string; subtotal: number }) {
  return (
    <View className="mt-4">
      <Text className="text-[11px] font-bold uppercase text-gray-500" style={{ letterSpacing: 0.6 }}>{title}</Text>
      {rows.length === 0 ? <Text className="py-3 text-[13px] text-gray-400">Nothing recorded</Text> : rows.map((r) => <SheetRow key={r.label} r={r} />)}
      <View className="flex-row items-center pt-2" style={{ gap: 8 }}>
        <Text className="flex-1 text-[12.5px] font-semibold text-gray-600">{subtotalLabel}</Text>
        <Text className="text-[13px] font-bold text-gray-800" style={[{ color: subtotal < 0 ? RED : '#1F2937' }, TABULAR]}>{inr(subtotal)}</Text>
      </View>
    </View>
  );
}

function TrendChart({ labels, assets, liabilities }: { labels: string[]; assets: number[]; liabilities: number[] }) {
  const W = 720;
  const H = 230;
  const left = 50;
  const right = 16;
  const top = 18;
  const bottom = 30;
  const hi = Math.max(...assets, ...liabilities, 1);
  const lo = Math.min(...assets, ...liabilities, 0);
  const span = hi - lo || 1;
  const n = Math.max(labels.length - 1, 1);
  const x = (i: number) => left + (i / n) * (W - left - right);
  const y = (v: number) => top + (1 - (v - lo) / span) * (H - top - bottom);
  const path = (vs: number[]) => vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const ticks = [0, 1, 2, 3];
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <SvgGradient id="bsFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1D4ED8" stopOpacity={0.18} />
          <Stop offset="1" stopColor="#1D4ED8" stopOpacity={0.01} />
        </SvgGradient>
      </Defs>
      {ticks.map((t) => {
        const gy = top + (t / 3) * (H - top - bottom);
        return (
          <G key={t}>
            <Line x1={left} x2={W - right} y1={gy} y2={gy} stroke={LINE} strokeDasharray="4 5" />
            <SvgText x={left - 8} y={gy + 4} fontSize={11} fill={MUTED} textAnchor="end">{lakh(hi - (t / 3) * span)}</SvgText>
          </G>
        );
      })}
      <Path d={`${path(assets)} L${x(assets.length - 1)},${H - bottom} L${x(0)},${H - bottom} Z`} fill="url(#bsFill)" />
      <Path d={path(liabilities)} fill="none" stroke="#93C5FD" strokeWidth={3} strokeLinejoin="round" />
      <Path d={path(assets)} fill="none" stroke="#1D4ED8" strokeWidth={3} strokeLinejoin="round" />
      {assets.map((v, i) => (
        <Circle key={`a${i}`} cx={x(i)} cy={y(v)} r={4} fill="#FFFFFF" stroke="#1D4ED8" strokeWidth={2.5} />
      ))}
      {liabilities.map((v, i) => (
        <Circle key={`l${i}`} cx={x(i)} cy={y(v)} r={4} fill="#FFFFFF" stroke="#93C5FD" strokeWidth={2.5} />
      ))}
      {assets.length > 0 && (
        <G>
          <Path
            d={`M${W - right - 170},${top} h170 a8,8 0 0 1 8,8 v34 a8,8 0 0 1 -8,8 h-170 a8,8 0 0 1 -8,-8 v-34 a8,8 0 0 1 8,-8 Z`}
            fill="#0F172A"
            transform="translate(-8 0)"
          />
          <SvgText x={W - right - 178} y={top + 19} fontSize={11} fill="#CBD5E1">Latest month end</SvgText>
          <SvgText x={W - right - 178} y={top + 38} fontSize={12.5} fontWeight="700" fill="#FFFFFF">
            {`Gap  ${assets[assets.length - 1] - liabilities[liabilities.length - 1] < 0 ? '-' : '+'}${lakh(Math.abs(assets[assets.length - 1] - liabilities[liabilities.length - 1]))}`}
          </SvgText>
        </G>
      )}
      {labels.map((l, i) => (
        <SvgText key={`${l}${i}`} x={x(i)} y={H - 9} fontSize={11.5} fill={MUTED} textAnchor="middle">{l}</SvgText>
      ))}
    </Svg>
  );
}

export function BalanceSheetScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const profile = useAuthStore((s) => s.profile);
  const [mode] = useCalendarMode();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const twoColumns = width >= 980;
  // What a line opens is marked as opened from here, so it shows a way back (see useCameFrom).
  const go = (path: string) => router.push(withFrom(`${basePath}${path}`, 'balance-sheet') as never);

  const [asOnKey, setAsOnKey] = useState<AsOn>('today');
  const [compareKey, setCompareKey] = useState<Compare>('fy_start');

  const balances = useAccountBalances(userId);
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', { filters: userId ? { owner_id: userId } : {}, all: true, enabled: !!userId });
  // The parties whose Ledger type makes them the business's owners (see CAPITAL_TYPE).
  const { data: parties } = useSupabaseQuery('customers', { filters: userId ? { owner_id: userId } : {}, enabled: !!userId });
  const { nameById: partyTypeName } = usePartyTypes(userId);
  const capitalParties = useMemo(
    () =>
      new Map(
        (parties ?? [])
          .filter((c) => c.party_type_id && CAPITAL_TYPE.test(partyTypeName.get(c.party_type_id) ?? ''))
          .map((c) => [c.id, c.name] as const)
      ),
    [parties, partyTypeName]
  );
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', { filters: userId ? { owner_id: userId } : {}, all: true, enabled: !!userId });
  const { data: products } = useSupabaseQuery('products', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });

  const today = localTodayIso();
  const asOn = useMemo(() => {
    if (asOnKey === 'last_month') return addDays(monthStart(today, 0, mode), -1);
    if (asOnKey === 'last_fy') return addDays(fiscalStart(today), -1);
    return today;
  }, [asOnKey, today, mode]);
  const compareOn = useMemo(() => {
    if (compareKey === 'none') return null;
    if (compareKey === 'fy_start') return addDays(fiscalStart(asOn), -1);
    if (compareKey === 'month_start') return addDays(monthStart(asOn, 0, mode), -1);
    return addDays(asOn, -365);
  }, [compareKey, asOn, mode]);

  const stock = useMemo(
    () => (products ?? []).reduce((s, p) => s + (Number(p.stock_level) > 0 && p.purchase_price != null ? Number(p.stock_level) * Number(p.purchase_price) : 0), 0),
    [products]
  );

  /** The whole sheet as it stood at the end of `day`. */
  const snapshot = useMemo(() => {
    const upTo = (items: { date: string; isInflow: boolean; amount: number }[], day: string) =>
      items.reduce((s, a) => (dayOf(a.date) <= day ? s + (a.isInflow ? a.amount : -a.amount) : s), 0);
    return (day: string): Snapshot => {
      const cash = upTo(balances.cashActivity, day);
      const banks = balances.perAccount.map((a) => ({ id: a.id, name: a.name, balance: upTo(a.activity, day) }));
      const bankTotal = banks.reduce((s, b) => s + b.balance, 0);
      const cust = new Map<string, number>();
      (customerEntries ?? []).forEach((e) => {
        if (dayOf(e.entry_date ?? e.created_at) > day) return;
        cust.set(e.customer_id, (cust.get(e.customer_id) ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount));
      });
      const vend = new Map<string, number>();
      (vendorEntries ?? []).forEach((e) => {
        if (dayOf(e.entry_date ?? e.created_at) > day) return;
        vend.set(e.vendor_id, (vend.get(e.vendor_id) ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount));
      });
      // An owner's two ledgers are their capital: what they put in (money received from them, owed to them) less what
      // they took out. They are not debtors, creditors or advances.
      const capital = [...capitalParties].map(([id, name]) => ({ id, name, amount: round2((vend.get(id) ?? 0) - (cust.get(id) ?? 0)) }));
      for (const id of capitalParties.keys()) {
        cust.delete(id);
        vend.delete(id);
      }
      const capitalTotal = capital.reduce((s, c) => s + c.amount, 0);
      let debtors = 0;
      let debtorCount = 0;
      let customerAdvances = 0;
      cust.forEach((v) => {
        if (v > 0.5) {
          debtors += v;
          debtorCount += 1;
        } else if (v < -0.5) customerAdvances += -v;
      });
      let creditors = 0;
      let creditorCount = 0;
      let vendorAdvances = 0;
      vend.forEach((v) => {
        if (v > 0.5) {
          creditors += v;
          creditorCount += 1;
        } else if (v < -0.5) vendorAdvances += -v;
      });
      const assets = cash + bankTotal + debtors + vendorAdvances + stock;
      const liabilities = creditors + customerAdvances;
      return {
        cash, banks, bankTotal, debtors, debtorCount, vendorAdvances, stock, creditors, creditorCount, customerAdvances,
        capital, capitalTotal,
        assets, liabilities, equity: assets - liabilities,
        currentRatio: liabilities > 0 ? assets / liabilities : null,
      };
    };
  }, [balances, customerEntries, vendorEntries, stock, capitalParties]);

  const now = useMemo(() => snapshot(asOn), [snapshot, asOn]);
  const before = useMemo(() => (compareOn ? snapshot(compareOn) : null), [snapshot, compareOn]);

  // month ends for the trend: the last seven months up to the day shown
  const trend = useMemo(() => {
    const points: { label: string; assets: number; liabilities: number }[] = [];
    for (let back = 6; back >= 0; back--) {
      const start = monthStart(asOn, back, mode);
      const end = back === 0 ? asOn : addDays(monthStart(asOn, back - 1, mode), -1);
      const s = snapshot(end);
      points.push({ label: monthLabel(start, mode), assets: s.assets, liabilities: s.liabilities });
    }
    return points;
  }, [snapshot, asOn, mode]);

  // receivables older than 60 days: a customer's balance counts when their last debit is that old
  const overdue = useMemo(() => {
    const lastDebit = new Map<string, number>();
    const net = new Map<string, number>();
    (customerEntries ?? []).forEach((e) => {
      const d = dayOf(e.entry_date ?? e.created_at);
      if (d > asOn) return;
      net.set(e.customer_id, (net.get(e.customer_id) ?? 0) + (e.entry_type === 'debit' ? e.amount : -e.amount));
      if (e.entry_type === 'debit') lastDebit.set(e.customer_id, Math.max(lastDebit.get(e.customer_id) ?? 0, new Date(d).getTime()));
    });
    const limit = new Date(asOn).getTime() - 60 * DAY_MS;
    let total = 0;
    net.forEach((v, id) => {
      if (v > 0.5 && (lastDebit.get(id) ?? Infinity) < limit) total += v;
    });
    return total;
  }, [customerEntries, asOn]);

  const company = profile?.business_name?.trim() || profile?.full_name || 'Your company';
  const compareLabel = COMPARE.find((c) => c.key === compareKey)?.label ?? '';
  const ready = balances.ready && !!customerEntries && !!vendorEntries;

  // ---- the two sides ----
  const bankRows: RowSpec[] = now.banks
    .filter((b) => b.balance !== 0 || true)
    .map((b) => ({
      label: b.name,
      amount: b.balance,
      onPress: () => go('/bank-balances'),
      note: b.balance < 0 ? 'Overdrawn: more has gone out than came in' : undefined,
    }));
  const cashRows: RowSpec[] = [{ label: 'Cash in hand', amount: now.cash, onPress: () => go('/bank-balances'), note: now.cash < 0 ? 'Negative cash: check entries' : undefined }, ...bankRows];
  const cashTotal = now.cash + now.bankTotal;
  const receivableRows: RowSpec[] = [
    { label: 'Sundry debtors', sub: `${now.debtorCount} ${now.debtorCount === 1 ? 'party' : 'parties'}`, amount: now.debtors, onPress: () => go('/to-receive') },
    ...(now.vendorAdvances > 0 ? [{ label: 'Advances paid to vendors', amount: now.vendorAdvances, onPress: () => go('/to-give') }] : []),
    { label: 'Stock in hand', sub: 'at cost', amount: now.stock, onPress: () => go('/inventory') },
  ];
  const receivableTotal = now.debtors + now.vendorAdvances + now.stock;
  const liabilityRows: RowSpec[] = [
    { label: 'Sundry creditors', sub: `${now.creditorCount} ${now.creditorCount === 1 ? 'vendor' : 'vendors'}`, amount: now.creditors, onPress: () => go('/to-give') },
    ...(now.customerAdvances > 0 ? [{ label: 'Advances received from customers', amount: now.customerAdvances, onPress: () => go('/to-receive') }] : []),
  ];
  // Each owner's capital invested (their ledger opens from it), then the rest of equity - retained earnings, the
  // balancing figure - so the total is still assets less liabilities.
  const equityRows: RowSpec[] = [
    ...now.capital.map((c) => ({
      label: 'Capital invested',
      sub: c.name,
      amount: c.amount,
      onPress: () => router.push(withFrom(`${basePath}/customer/${c.id}`, 'balance-sheet') as never),
    })),
    {
      label: now.capital.length ? 'Retained earnings' : "Owner's capital & retained earnings",
      sub: 'balancing figure',
      amount: round2(now.equity - now.capitalTotal),
      note: now.equity < 0 ? 'Deficit: liabilities are more than assets' : undefined,
    },
  ];

  // ---- watch list ----
  const alerts: { tone: 'critical' | 'warning' | 'ok'; text: string }[] = [];
  if (now.equity < 0) alerts.push({ tone: 'critical', text: `Liabilities exceed total assets by NPR ${inr(-now.equity)} (negative net worth)` });
  if (overdue > 0) alerts.push({ tone: 'warning', text: `NPR ${inr(overdue)} of receivables is more than 60 days old` });
  now.banks.filter((b) => b.balance < 0).forEach((b) => alerts.push({ tone: 'warning', text: `${b.name} is overdrawn by NPR ${inr(-b.balance)}` }));
  if (now.cash < 0) alerts.push({ tone: 'warning', text: `Cash in hand is negative (NPR ${inr(now.cash)})` });
  if (now.currentRatio != null && now.currentRatio < 1) alerts.push({ tone: 'warning', text: `Current ratio is ${now.currentRatio.toFixed(2)}: below 1.0` });
  if (now.creditors > 0) {
    const cover = (Math.max(0, cashTotal) / now.creditors) * 100;
    alerts.push({ tone: cover >= 100 ? 'ok' : 'warning', text: `Cash & bank cover ${cover.toFixed(0)}% of what you owe vendors` });
  }
  if (alerts.every((a) => a.tone === 'ok')) alerts.unshift({ tone: 'ok', text: 'No problems found in the balance sheet' });
  const toneColor = { critical: BRAND_DARK, warning: BRAND, ok: '#93C5FD' } as const;

  // ---- export ----
  const exportCsv = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const rows: (string | number)[][] = [
      [company, 'Balance sheet', `As on ${asOn}`],
      [],
      ['Side', 'Group', 'Item', 'Amount (NPR)'],
      ...cashRows.map((r) => ['Assets', 'Cash & bank', r.label, round2(r.amount)]),
      ...receivableRows.map((r) => ['Assets', 'Receivables & stock', r.label, round2(r.amount)]),
      ['Assets', '', 'Total assets', round2(now.assets)],
      ...liabilityRows.map((r) => ['Liabilities', 'Current liabilities', r.label, round2(r.amount)]),
      ...equityRows.map((r) => ['Equity', 'Capital', [r.label, r.sub].filter(Boolean).join(' · '), round2(r.amount)]),
      ['', '', 'Total liabilities & equity', round2(now.liabilities + now.equity)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `balance-sheet-${asOn}.csv`;
    a.click();
  };
  const print = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.print();
  };

  const actionBtn = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, primary?: boolean) =>
    Platform.OS === 'web' ? (
      <Pressable key={label} onPress={onPress} className="flex-row items-center rounded-xl px-3.5 py-2.5" style={{ gap: 6, backgroundColor: primary ? '#1D4ED8' : '#FFFFFF', borderWidth: primary ? 0 : 1, borderColor: LINE }}>
        <Ionicons name={icon} size={15} color={primary ? '#FFFFFF' : '#1D4ED8'} />
        <Text className="text-[13px] font-semibold" style={{ color: primary ? '#FFFFFF' : INK }}>{label}</Text>
      </Pressable>
    ) : null;

  const liabilitySide = (
    <View className="flex-1" style={{ minWidth: 0, paddingVertical: 4 }}>
      <View className="flex-row justify-between border-b-2 pb-2.5" style={{ borderColor: BRAND_DARK }}>
        <Text className="text-[14px] font-bold text-gray-900">LIABILITIES &amp; CAPITAL</Text>
        <Text className="text-[12px] font-semibold text-gray-500">NPR</Text>
      </View>
      <Group title="Current liabilities" rows={liabilityRows} subtotalLabel="Total liabilities" subtotal={now.liabilities} />
      <Group title="Capital & reserves" rows={equityRows} subtotalLabel="Total equity" subtotal={now.equity} />
      <View className="mt-4 flex-row border-t-2 pt-3" style={{ borderColor: BRAND_DARK }}>
        <Text className="flex-1 text-[15px] font-bold text-gray-900">Total liabilities &amp; equity</Text>
        <Text className="text-[15px] font-bold text-gray-900" style={TABULAR}>{inr(now.liabilities + now.equity)}</Text>
      </View>
    </View>
  );
  const assetSide = (
    <View className="flex-1" style={{ minWidth: 0, paddingVertical: 4 }}>
      <View className="flex-row justify-between border-b-2 pb-2.5" style={{ borderColor: BRAND_DARK }}>
        <Text className="text-[14px] font-bold text-gray-900">ASSETS</Text>
        <Text className="text-[12px] font-semibold text-gray-500">NPR</Text>
      </View>
      <Group title="Cash & bank" rows={cashRows} subtotalLabel="Total cash & bank" subtotal={cashTotal} />
      <Group title="Receivables & stock" rows={receivableRows} subtotalLabel="Total receivables & stock" subtotal={receivableTotal} />
      <View className="mt-4 flex-row border-t-2 pt-3" style={{ borderColor: BRAND_DARK }}>
        <Text className="flex-1 text-[15px] font-bold text-gray-900">Total assets</Text>
        <Text className="text-[15px] font-bold text-gray-900" style={TABULAR}>{inr(now.assets)}</Text>
      </View>
    </View>
  );

  const balanced = Math.abs(now.assets - (now.liabilities + now.equity)) < 0.5;

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: '#F6F7FB' }} contentContainerStyle={{ padding: wide ? 28 : 14, gap: 16, paddingBottom: 60 }}>
      {/* header and controls */}
      <View className="flex-row flex-wrap items-center" style={{ gap: 12 }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Text className="text-[12px] font-semibold text-gray-500">Choose the date and what to compare with</Text>
        </View>
        <Select label="As on" value={asOnKey} options={AS_ON} onChange={setAsOnKey} />
        <Select label="Compare" value={compareKey} options={COMPARE} onChange={setCompareKey} />
        {actionBtn('Export CSV', 'download-outline', exportCsv)}
        {actionBtn('Print / PDF', 'print-outline', print, true)}
      </View>

      {!ready ? <Text className="py-6 text-center text-sm text-gray-400">Reading your books…</Text> : null}

      {/* the heading band: the same brand-blue band as the Profit & Loss report */}
      <View className="overflow-hidden rounded-2xl" style={{ backgroundColor: BRAND_DARK }}>
        <View className="p-5" style={{ gap: 4 }}>
          <Text className="text-[11.5px] font-bold" style={{ color: '#BFDBFE', letterSpacing: 1.4 }}>FINANCE REPORT</Text>
          <Text className="text-[24px] font-extrabold text-white" style={{ letterSpacing: 0.5 }}>BALANCE SHEET</Text>
          <Text className="text-[13px]" style={{ color: '#DBEAFE' }}>{company}  ·  as on {numericDateLabel(asOn)}</Text>
        </View>
        <View className="flex-row flex-wrap border-t" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
          {[
            { label: 'Total assets', value: `NPR ${inr(now.assets)}`, delta: before ? pct(now.assets, before.assets) : null },
            { label: 'Total liabilities', value: `NPR ${inr(now.liabilities)}`, delta: before ? pct(now.liabilities, before.liabilities) : null },
            { label: now.equity < 0 ? "Owner's equity (deficit)" : "Owner's equity", value: `NPR ${inr(now.equity)}`, delta: before ? pct(now.equity, before.equity) : null },
            { label: 'Current ratio', value: now.currentRatio == null ? '–' : now.currentRatio.toFixed(2), delta: null },
          ].map((k, i) => (
            <View key={k.label} className="px-5 py-4" style={{ flexGrow: 1, flexBasis: 200, borderLeftWidth: i === 0 ? 0 : 1, borderColor: 'rgba(255,255,255,0.18)' }}>
              <Text className="text-[11.5px] font-semibold" style={{ color: '#BFDBFE' }}>{k.label}</Text>
              <Text className="mt-0.5 text-[19px] font-bold text-white" style={TABULAR}>{k.value}</Text>
              {k.delta != null && (
                <Text className="text-[11.5px]" style={{ color: '#93C5FD' }}>
                  {k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta) > 999 ? '999%+' : `${Math.abs(k.delta).toFixed(1)}%`} vs {compareLabel.toLowerCase()}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* the sheet */}
      <View className="rounded-2xl bg-white" style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.05)', overflow: 'hidden' }}>
        <View className={twoColumns ? 'flex-row' : ''}>
          <View className="flex-1 p-5" style={twoColumns ? { borderRightWidth: 1, borderColor: LINE } : { borderBottomWidth: 1, borderColor: LINE }}>{liabilitySide}</View>
          <View className="flex-1 p-5">{assetSide}</View>
        </View>
        <View className="flex-row items-center border-t px-5 py-3" style={{ gap: 8, borderColor: LINE, backgroundColor: BRAND_TINT }}>
          <Ionicons name={balanced ? 'checkmark-circle' : 'alert-circle'} size={18} color={BRAND} />
          <Text className="flex-1 text-[13px] font-semibold" style={{ color: BRAND_DARK }}>
            {balanced ? 'Balanced: Assets = Liabilities + Equity' : 'Out of balance'}  ·  {inr(now.assets)} = {inr(now.liabilities)} + ({inr(now.equity)})
          </Text>
        </View>
      </View>

      {/* trend and watch list */}
      <View className={twoColumns ? 'flex-row' : ''} style={{ gap: 14 }}>
        <View className="rounded-2xl bg-white p-5" style={{ flex: 1.5, minWidth: 0, boxShadow: '0 1px 2px rgba(16,24,40,0.05)' }}>
          <View className="flex-row flex-wrap items-center" style={{ gap: 10 }}>
            <Text className="flex-1 text-[15px] font-bold text-gray-900">Assets vs liabilities</Text>
            <View className="flex-row" style={{ gap: 14 }}>
              <View className="flex-row items-center" style={{ gap: 6 }}><View style={{ width: 12, height: 3, backgroundColor: '#1D4ED8' }} /><Text className="text-[12px] text-gray-600">Assets</Text></View>
              <View className="flex-row items-center" style={{ gap: 6 }}><View style={{ width: 12, height: 3, backgroundColor: '#93C5FD' }} /><Text className="text-[12px] text-gray-600">Liabilities</Text></View>
            </View>
          </View>
          <Text className="mb-1 text-[12px] text-gray-500">Month end, last 7 months</Text>
          <TrendChart labels={trend.map((t) => t.label)} assets={trend.map((t) => t.assets)} liabilities={trend.map((t) => t.liabilities)} />
        </View>
        <View className="rounded-2xl bg-white p-5" style={{ flex: 1, minWidth: 0, boxShadow: '0 1px 2px rgba(16,24,40,0.05)', marginTop: twoColumns ? 0 : 14 }}>
          <Text className="mb-3 text-[15px] font-bold text-gray-900">Watch list</Text>
          <View style={{ gap: 12 }}>
            {alerts.map((a, i) => (
              <View key={i} className="flex-row items-start" style={{ gap: 10 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 5, backgroundColor: toneColor[a.tone] }} />
                <Text className="flex-1 text-[13px] text-gray-800">{a.text}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <Text className="text-[11.5px] text-gray-400">
        Stock is valued at purchase cost at today's quantities. Equity is the balancing figure: assets minus liabilities. Tap a line to open its detail.
      </Text>

      {/* shortcuts: on a phone the sidebar is not there */}
      {!wide && (
        <View className="flex-row flex-wrap" style={{ gap: 10 }}>
          {shortcuts(basePath).map((s) => (
            <Pressable key={s.key} onPress={() => router.push(s.href as never)} className="flex-row items-center rounded-xl border border-gray-200 bg-white px-3 py-2.5" style={{ gap: 8 }}>
              <Ionicons name={s.icon} size={16} color="#1D4ED8" />
              <Text className="text-[13px] font-semibold text-gray-800">{s.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
