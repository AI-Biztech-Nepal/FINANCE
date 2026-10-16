// lib/components/finance/ReportScreen.tsx
import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useBookLayout, useBookToolbar } from './BookKit';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { reportHtml, type PrintReport } from '../../utils/printReport';
import { ExcelButton, PrintButton, exportReportDocument, printReportDocument } from './PrintButton';
import { DateStepFilter, monthLabelOf, monthRange } from './DateRangeFilter';
import { useCalendarMode } from '../../hooks/useCalendarMode';

type Period = 'year' | 'all';

const BRAND_DARK = '#1E3A8A';
const BRAND = '#2563EB';
const BRAND_TINT = '#EFF6FF';

/** 1234567 -> "12,34,567" */
function inr(n: number): string {
  const v = Math.round(n);
  const s = String(Math.abs(v));
  const out = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
  return v < 0 ? `-${out}` : out;
}

function SideHead({ title }: { title: string }) {
  return (
    <View className="mb-1 flex-row justify-between border-b-2 pb-2" style={{ borderColor: BRAND_DARK }}>
      <Text className="text-[13px] font-bold" style={{ color: BRAND_DARK }}>{title}</Text>
      <Text className="text-[11px] font-semibold text-gray-500">NPR</Text>
    </View>
  );
}

function Line({ label, amount, tone, bold, muted, onPress }: { label: string; amount: number; tone?: 'profit' | 'loss'; bold?: boolean; muted?: boolean; onPress?: () => void }) {
  const color = tone ? BRAND_DARK : muted ? '#94A3B8' : '#0F172A';
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row justify-between border-b border-gray-100 py-2.5" style={tone ? { backgroundColor: BRAND_TINT, paddingHorizontal: 8, borderRadius: 6 } : undefined}>
      <Text className={`text-[14px] ${bold ? 'font-bold' : ''}`} style={{ color: muted ? '#94A3B8' : '#0F172A' }}>{label}</Text>
      <Text className={`text-[14px] ${bold ? 'font-bold' : 'font-semibold'}`} style={{ color }}>{inr(amount)}</Text>
    </Pressable>
  );
}

function TotalLine({ amount }: { amount: number }) {
  return (
    <View className="my-1 flex-row justify-between border-y-2 py-2.5" style={{ borderColor: BRAND_DARK }}>
      <Text className="text-[15px] font-bold" style={{ color: BRAND_DARK }}>Total</Text>
      <Text className="text-[15px] font-bold" style={{ color: BRAND_DARK }}>{inr(amount)}</Text>
    </View>
  );
}

function Group({ id, open, onToggle, label, amount, rows, onOpen }: { id: string; open: Set<string>; onToggle: (k: string) => void; label: string; amount: number; rows: [string, number][]; onOpen?: () => void }) {
  const isOpen = open.has(id);
  return (
    <View>
      <View className="flex-row items-center">
        {rows.length > 0 && (
          <Pressable onPress={() => onToggle(id)} hitSlop={6} className="pr-2 py-2.5">
            <Text className="text-[14px] font-bold text-gray-900">{isOpen ? '▾' : '▸'}</Text>
          </Pressable>
        )}
        <Pressable onPress={onOpen} disabled={!onOpen} className="flex-1 flex-row justify-between py-2.5">
          <Text className="text-[14px] font-bold text-gray-900">{label}</Text>
          <Text className="text-[14px] font-bold text-gray-900">{inr(amount)}</Text>
        </Pressable>
      </View>
      {isOpen && rows.map(([k, v]) => (
        <Pressable key={k} onPress={onOpen} disabled={!onOpen} className="flex-row justify-between border-b border-gray-50 py-1.5" style={{ paddingLeft: 20 }}>
          <Text className="text-[13px] text-gray-600">{k}</Text>
          <Text className="text-[13px] text-gray-600">{inr(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const PERIOD_LABEL: Record<Period, string> = { year: 'This Year', all: 'All Time' };

/** A profit & loss summary pulled from the same Finance data as everywhere
 * else - Sales, Purchase, and Expense already carry their own bill date, so
 * this just re-sums them for whichever period is selected instead of
 * introducing a second source of truth. */
export function ReportScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  // The period: one of the ready-made ones, or the dates picked with the date control.
  // It opens on this month - a Bikram Sambat month when the app is read in BS - and the arrows page
  // by month from there.
  const [calendarMode] = useCalendarMode();
  const monthNow = monthRange(localTodayIso(), 0, calendarMode);
  const thisMonth = { from: monthNow.start, to: monthNow.end };
  const [period, setPeriod] = useState<Period | 'range'>('range');
  const [range, setRange] = useState(thisMonth);

  const inRange = useMemo(() => {
    const now = new Date();
    return (transactions ?? []).filter((t) => {
      if (period === 'all') return true;
      if (period === 'range') {
        // A bill's own date as it is; a timestamp as the device's own day.
        let day = t.bill_date ? t.bill_date.slice(0, 10) : '';
        if (!day) {
          const c = new Date(t.created_at);
          day = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
        }
        return (!range.from || day >= range.from) && (!range.to || day <= range.to);
      }
      const d = new Date(t.bill_date ?? t.created_at);
      return d.getFullYear() === now.getFullYear();
    });
  }, [transactions, period, range.from, range.to]);

  const { data: categories } = useSupabaseQuery('expense_categories', { filters: userId ? { owner_id: userId } : {}, enabled: !!userId });
  const { data: products } = useSupabaseQuery('products', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { width } = useWindowDimensions();
  const twoSided = width >= 900;
  const go = (path: string) => router.push(`${basePath}${path}` as never);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['sales', 'purchase', 'direct', 'indirect']));
  const toggleGroup = (k: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Tally's Profit & Loss A/c: trading account first (sales, closing stock against opening stock, purchases
  // and direct expenses) to a gross profit or loss carried down, then indirect expenses to the net result.
  const periodText =
    period !== 'range'
      ? PERIOD_LABEL[period]
      : monthLabelOf(range.from, range.to, calendarMode) ||
        (range.from && range.from === range.to
          ? toBsHistoryLabel(range.from)
          : `${range.from ? toBsHistoryLabel(range.from) : 'Start'} - ${range.to ? toBsHistoryLabel(range.to) : 'Today'}`);
  const pl = useMemo(() => {
    const names = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const directNames = new Set((categories ?? []).filter((c) => c.expense_group === 'direct').map((c) => c.name));
    let items = 0;
    let services = 0;
    let purchase = 0;
    const expenses = new Map<string, number>();
    for (const t of inRange) {
      if (t.type === 'sale') {
        const svc = (t.service_charges ?? []).reduce((a, c) => a + (Number(c.amount) || 0), 0) + (Number(t.installation_charge) || 0);
        services += svc;
        items += t.amount - svc;
      } else if (t.type === 'purchase') purchase += t.amount;
      else {
        const name = (t.expense_category_id && names.get(t.expense_category_id)) || 'Uncategorised';
        expenses.set(name, (expenses.get(name) ?? 0) + t.amount);
      }
    }
    // an expense head is direct when it is a cost of getting goods or doing jobs
    const DIRECT = /(direct|freight|carriage|cartage|clearing|custom|import|repair|labour|labor|installation|job)/i;
    const direct: [string, number][] = [];
    const indirect: [string, number][] = [];
    [...expenses.entries()].sort((a, b) => b[1] - a[1]).forEach((e) => (directNames.has(e[0]) || (!(categories ?? []).some((c) => c.name === e[0] && c.expense_group) && DIRECT.test(e[0])) ? direct : indirect).push(e));
    const sum = (list: [string, number][]) => list.reduce((a, [, v]) => a + v, 0);
    // The stock held now, at cost. Stock has no history, so the period's opening stock is taken as the
    // same figure: stock moves through the purchase and sale bills themselves.
    const closing = (products ?? []).reduce((a, p) => a + (Number(p.stock_level) > 0 && p.purchase_price != null ? Number(p.stock_level) * Number(p.purchase_price) : 0), 0);
    const opening = closing;
    const sales = items + services;
    const directTotal = sum(direct);
    const indirectTotal = sum(indirect);
    const gross = sales + closing - opening - purchase - directTotal; // + profit, - loss
    const net = gross - indirectTotal;
    const bills = { sale: inRange.filter((t) => t.type === 'sale').length, purchase: inRange.filter((t) => t.type === 'purchase').length, expense: inRange.filter((t) => t.type === 'expense').length };
    return { items, services, sales, purchase, direct, indirect, directTotal, indirectTotal, opening, closing, gross, net, bills };
  }, [inRange, categories, products]);
  const grossProfit = pl.gross;
  const netProfit = pl.net;
  // each side of the trading account totals the same; likewise the second part
  const tradingTotal = pl.sales + pl.closing + (grossProfit < 0 ? -grossProfit : 0);
  const secondTotal = pl.indirectTotal + (grossProfit < 0 ? -grossProfit : 0) + (netProfit >= 0 ? netProfit : 0);
  const costOfGoods = pl.opening + pl.purchase + pl.directTotal - pl.closing;
  const companyName = useAuthStore((state) => state.profile)?.business_name ?? '';
  const totals = { sale: pl.sales, purchase: pl.purchase, expense: pl.directTotal + pl.indirectTotal };

  // The name (and the back button on a phone) are in the top bar, with Print: it opens the system's
  // print preview of the profit & loss for the period shown.
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);
  const buildReport = (): PrintReport => {
    const n = (v: number) => v.toLocaleString();
    return {
      title: 'Profit & Loss',
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle:
        period !== 'range'
          ? PERIOD_LABEL[period]
          : monthLabelOf(range.from, range.to, calendarMode) ||
            (range.from && range.from === range.to
              ? toBsHistoryLabel(range.from)
              : `${range.from ? toBsHistoryLabel(range.from) : 'Start'} - ${range.to ? toBsHistoryLabel(range.to) : 'Today'}`),
      printedOn: toBsHistoryLabel(localTodayIso()),
      sections: [
        {
          columns: [{ label: 'Account' }, { label: 'Amount (NPR)', align: 'right' }],
          rows: [
            ['Opening stock', n(pl.opening)],
            ['Purchase accounts', n(pl.purchase)],
            ['Direct expenses', n(pl.directTotal)],
            ...pl.direct.map(([k, v]) => ['    ' + k, n(v)]),
            [grossProfit >= 0 ? 'Gross profit c/o' : 'Gross loss c/o', n(Math.abs(grossProfit))],
            ['Sales accounts', n(pl.sales)],
            ['    Sales - items', n(pl.items)],
            ['    Installation & repair services', n(pl.services)],
            ['Closing stock', n(pl.closing)],
            ['Indirect expenses', n(pl.indirectTotal)],
            ...pl.indirect.map(([k, v]) => ['    ' + k, n(v)]),
            [netProfit >= 0 ? 'Net profit' : 'Net loss', n(Math.abs(netProfit))],
          ],
        },
      ],
      note: 'Sales, Purchase and Expenses are the bills dated in the period, paid or not. Stock is valued at cost as it stands now.',
    };
  };
  const printNow = useRef<() => void>(() => {});
  printNow.current = () => void printReportDocument(reportHtml(buildReport()));
  const excelNow = useRef<() => void>(() => {});
  excelNow.current = () => void exportReportDocument(buildReport());
  // The report date control - arrows that page by month, and a menu of This Year / All Time, This
  // month, Today, Yesterday, the last 7 / 14 / 30 days and a custom range - lives in the top bar with
  // Print and Excel, as on the Day Book, Statement and Total Received / Paid pages. Only a narrow
  // window, whose bar has no room for all three, shows them as a row at the top of the page.
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      inBarMinWidth: 1180,
      right: () => (
        <>
          <DateStepFilter
            from={period === 'range' ? range.from : ''}
            to={period === 'range' ? range.to : ''}
            idleLabel={period === 'range' ? 'This month' : PERIOD_LABEL[period]}
            onChange={(f, t) => {
              if (f || t) {
                setRange({ from: f, to: t });
                setPeriod('range');
              } else {
                setRange(thisMonth);
                setPeriod('range');
              }
            }}
            shortcuts={(['year', 'all'] as Period[]).map((p) => ({
              label: PERIOD_LABEL[p],
              on: period === p,
              onSelect: () => setPeriod(p),
            }))}
          />
          <PrintButton onPress={() => printNow.current()} />
          <ExcelButton onPress={() => excelNow.current()} />
        </>
      ),
    },
    // `thisMonth` follows the calendar (AD / BS), so a switch re-registers the control.
    [period, range.from, range.to, calendarMode]
  );

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {toolbar ? <View className="mb-4">{toolbar}</View> : null}

      {/* the report heading: one brand-blue band with the period and the key figures */}
      <View className="mb-4 overflow-hidden rounded-2xl" style={{ backgroundColor: BRAND_DARK }}>
        <View className="p-5" style={{ gap: 4 }}>
          <Text className="text-[11.5px] font-bold" style={{ color: '#BFDBFE', letterSpacing: 1.4 }}>FINANCE REPORT</Text>
          <Text className="text-[24px] font-extrabold text-white" style={{ letterSpacing: 0.5 }}>PROFIT &amp; LOSS ACCOUNT REPORT</Text>
          <Text className="text-[13px]" style={{ color: '#DBEAFE' }}>
            {companyName}{periodText ? `  ·  ${periodText}` : ''}
          </Text>
        </View>
        <View className="flex-row flex-wrap border-t" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
          {[
            { label: 'Net sales', value: pl.sales, sub: `${pl.bills.sale} sale ${pl.bills.sale === 1 ? 'bill' : 'bills'}`, path: '/sales-report' },
            { label: 'Cost of goods', value: costOfGoods, sub: `${pl.bills.purchase} purchase ${pl.bills.purchase === 1 ? 'bill' : 'bills'}`, path: '/purchase-report' },
            { label: grossProfit >= 0 ? 'Gross profit' : 'Gross loss', value: Math.abs(grossProfit), sub: pl.sales > 0 ? `${((Math.abs(grossProfit) / pl.sales) * 100).toFixed(1)}% of sales` : 'No sales', path: '/sales-report' },
            { label: 'Indirect expenses', value: pl.indirectTotal, sub: `${pl.indirect.length} expense ${pl.indirect.length === 1 ? 'head' : 'heads'}`, path: '/expense-report' },
            { label: netProfit >= 0 ? 'Net profit' : 'Net loss', value: Math.abs(netProfit), sub: pl.sales > 0 ? `${((Math.abs(netProfit) / pl.sales) * 100).toFixed(1)}% net margin` : 'No sales', path: '/expense-report' },
          ].map((k, i) => (
            <Pressable
              key={k.label}
              onPress={() => go(k.path)}
              className="px-5 py-4"
              style={{ flexGrow: 1, flexBasis: 170, borderLeftWidth: i === 0 ? 0 : 1, borderColor: 'rgba(255,255,255,0.18)' }}
            >
              <Text className="text-[11.5px] font-semibold" style={{ color: '#BFDBFE' }}>{k.label}</Text>
              <Text className="mt-0.5 text-[19px] font-bold text-white">NPR {inr(k.value)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* the account: expenses and cost on the left, income on the right */}
      <View className="mb-4 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <View className={twoSided ? 'flex-row' : ''}>
          <View className="flex-1 p-5" style={twoSided ? { borderRightWidth: 1, borderColor: '#E5E7EB' } : { borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
            <SideHead title="Particulars" />
            <Line label="Opening stock" amount={pl.opening} onPress={() => go('/inventory')} />
            <Group id="purchase" open={openGroups} onToggle={toggleGroup} label="Purchase accounts" amount={pl.purchase}
              rows={[['Purchase bills', pl.purchase]]} onOpen={() => go('/purchase-report')} />
            <Group id="direct" open={openGroups} onToggle={toggleGroup} label="Direct expenses" amount={pl.directTotal} rows={pl.direct} onOpen={() => go('/expense-report')} />
            {grossProfit >= 0 ? <Line label="Gross profit c/o" amount={grossProfit} tone="profit" bold /> : null}
            <TotalLine amount={tradingTotal} />
            {grossProfit < 0 ? <Line label="Gross loss b/f" amount={-grossProfit} tone="loss" bold /> : null}
            <Group id="indirect" open={openGroups} onToggle={toggleGroup} label="Indirect expenses" amount={pl.indirectTotal} rows={pl.indirect} onOpen={() => go('/expense-report')} />
            {netProfit >= 0 ? <Line label="Net profit" amount={netProfit} tone="profit" bold /> : null}
            <TotalLine amount={secondTotal} />
          </View>
          <View className="flex-1 p-5">
            <SideHead title="Particulars" />
            <Group id="sales" open={openGroups} onToggle={toggleGroup} label="Sales accounts" amount={pl.sales}
              rows={[['Sales - items', pl.items], ['Installation & repair services', pl.services]]} onOpen={() => go('/sales-report')} />
            <Line label="Closing stock" amount={pl.closing} onPress={() => go('/inventory')} />
            {grossProfit < 0 ? <Line label="Gross loss c/o" amount={-grossProfit} tone="loss" bold /> : null}
            <TotalLine amount={tradingTotal} />
            {grossProfit >= 0 ? <Line label="Gross profit b/f" amount={grossProfit} tone="profit" bold /> : null}
            <Line label="Indirect incomes" amount={0} muted />
            {netProfit < 0 ? <Line label="Net loss" amount={-netProfit} tone="loss" bold /> : null}
            <TotalLine amount={secondTotal} />
          </View>
        </View>
        <Text className="border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-500">
          Both sides total the same, as in Tally. Stock is valued at cost as it stands now, so opening and closing stock are the same figure.
        </Text>
      </View>

    </ScrollView>
  );
}
