// lib/components/finance/EmiPanel.tsx
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSupabaseInsert, useSupabaseQuery } from '../../hooks/useSupabase';
import { BookStat, BookStats, BookTable, Pill, money, type BookColumn } from './BookKit';
import { useConfirmSave } from './ConfirmSave';
import { EMI_STOCK_MONTHS, EMI_STOCK_RATE, emiDirection, emiFigures, emiSoldPlans, emiStockPlans } from '../../utils/emi';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { journalOf } from '../../utils/journalVoucher';
import { round2 } from '../../utils/money';
import { showAlert, getErrorMessage } from '../../utils/alert';

const key = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

type Direction = 'sale' | 'purchase';

/** The words of each side: customers paying us for vehicles we sold, or us paying vendors for stock we bought. */
const WORDS: Record<Direction, { tab: string; party: string; price: string; paid: string; none: string; note: string }> = {
  sale: {
    tab: 'Customers pay us',
    party: 'Customer',
    price: 'Sale price',
    paid: 'Received',
    none: 'No EMI sales yet. Add one with New EMI, or add all your sold vehicles above.',
    note: 'Received is what the customer paid for the vehicle on the Received page (pick the vehicle in Item). The down payment is due on the sale; each instalment on its day. The sale itself is its Sale bill.',
  },
  purchase: {
    tab: 'We pay vendors',
    party: 'Vendor',
    price: 'Purchase price',
    paid: 'Paid',
    none: 'No vehicles bought on EMI yet. Add one with New EMI, or add all your vehicles above.',
    note: 'Paid is what you paid the vendor for the item on the Paid page (pick the item in Item). The down payment is due on the purchase; each instalment on its day. The purchase itself is its Purchase bill.',
  },
};

/** The EMI tab of Rent & EMI, both ways. Customers pay us: every vehicle sold on instalments - what it comes to, what the
 * customer has paid (their Received entries naming the vehicle), what is overdue, what is left and when the next
 * instalment falls. We pay vendors: the stock bought on instalments, the same figures from the Paid entries on the
 * vendor's ledger - with a button that puts every vehicle bought in, 12 months at 10% a month (flat). */
export function EmiPanel({ userId, basePath, full }: { userId: string | undefined; basePath: string; full: boolean }) {
  const today = localTodayIso();
  const [dir, setDir] = useState<Direction>('sale');
  const words = WORDS[dir];
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: plans, error } = useSupabaseQuery('emi_plans', { filters: owner, orderBy: { column: 'first_due', ascending: false }, all: true, enabled: !!userId });
  const { data: received } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: paidOut } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: products } = useSupabaseQuery('products', { filters: owner, all: true, enabled: !!userId });
  const { data: bills } = useSupabaseQuery('business_transactions', { filters: owner, all: true, enabled: !!userId });
  const createPlan = useSupabaseInsert('emi_plans');
  const { confirm, dialog: confirmDialog } = useConfirmSave();
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    // What was paid for each vehicle: the Received entries (customers) / Paid entries (vendors) whose remark starts with it.
    const paidBy = new Map<string, number>();
    for (const e of received ?? []) {
      if (e.entry_type !== 'credit' || !e.note || journalOf(e.note)) continue;
      const k = `sale|${e.customer_id}|${key(e.note.split(' · ')[0])}`;
      paidBy.set(k, (paidBy.get(k) ?? 0) + Number(e.amount));
    }
    // A vehicle bought on EMI: every payment naming it, whichever vendor it was recorded under - the way Stock and
    // Inventory and the Payable Report count what was paid on a car.
    for (const e of paidOut ?? []) {
      if (e.entry_type !== 'credit' || !e.note || journalOf(e.note)) continue;
      const k = `purchase|${key(e.note.split(' · ')[0])}`;
      paidBy.set(k, (paidBy.get(k) ?? 0) + Number(e.amount));
    }
    return (plans ?? [])
      .filter((p) => emiDirection(p) === dir)
      .map((p) => ({ p, ...emiFigures(p, paidBy.get(dir === 'purchase' ? `purchase|${key(p.car)}` : `sale|${p.customer_id}|${key(p.car)}`) ?? 0, today) }))
      .sort((a, b) => Number(a.status.label === 'Completed') - Number(b.status.label === 'Completed') || b.overdue - a.overdue);
  }, [plans, received, paidOut, dir, today]);
  type Row = (typeof rows)[number];
  const sum = (f: (r: Row) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const countOf = (d: Direction) => (plans ?? []).filter((p) => emiDirection(p) === d).length;

  // The vehicles not in EMI yet on this side: every vehicle bought (we pay its vendor), or every one already sold
  // (the customer pays us).
  const batch = useMemo(() => {
    const input = { products: products ?? [], bills: bills ?? [], plans: plans ?? [], months: EMI_STOCK_MONTHS, rate: EMI_STOCK_RATE };
    return dir === 'purchase' ? emiStockPlans({ ...input, today }) : { ...emiSoldPlans(input), noPrice: [] as string[] };
  }, [dir, products, bills, plans, today]);

  async function addAll() {
    if (!userId || adding || batch.rows.length === 0) return;
    const n = batch.rows.length;
    const price = round2(batch.rows.reduce((s, r) => s + Number(r.sale_price), 0));
    const total = round2(batch.rows.reduce((s, r) => s + Number(r.down_payment) + Number(r.installment) * Number(r.months), 0));
    const ok = await confirm({
      title: `Add ${n} ${dir === 'purchase' ? (n === 1 ? 'vehicle' : 'vehicles') : n === 1 ? 'sold vehicle' : 'sold vehicles'} to EMI?`,
      rows: [
        { label: 'Vehicles', value: String(n) },
        { label: words.price, value: `NPR ${money(price)}` },
        { label: 'Plan', value: `${EMI_STOCK_MONTHS} months · ${EMI_STOCK_RATE}% a month, flat` },
        ...(batch.noPrice.length ? [{ label: 'Left out (no purchase price)', value: String(batch.noPrice.length) }] : []),
      ],
      total: { label: dir === 'purchase' ? 'To pay with interest' : 'To collect with interest', value: `NPR ${money(total)}`, color: dir === 'purchase' ? '#B91C1C' : '#047857' },
    });
    if (!ok) return;
    setAdding(true);
    let added = 0;
    try {
      for (const row of batch.rows) {
        await createPlan.mutateAsync({ owner_id: userId, ...row });
        added += 1;
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      showAlert(
        `Added ${added} of ${n}`,
        /direction|interest_rate|product_id|schema cache/i.test(msg) ? 'Run supabase/migrations/0021_emi_direction_interest.sql in Supabase first, then try again.' : msg
      );
    } finally {
      setAdding(false);
    }
  }

  const open = (id?: string) => router.push((id ? `${basePath}/emi-entry?id=${id}` : `${basePath}/emi-entry`) as never);
  const fig = (v: number, color = '#111827', bold = false) =>
    v ? (
      <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
        {money(v)}
      </Text>
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const vehicle = (r: Row) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
        {r.p.car}
      </Text>
      <Text className="text-[11px] text-gray-400" numberOfLines={1}>
        {[r.p.model, r.p.customer_name].filter(Boolean).join(' · ') || '—'}
      </Text>
    </View>
  );
  const columns: BookColumn<Row>[] = full
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_r, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'vehicle', label: 'Vehicle', render: vehicle },
        { key: 'customer', label: words.party, width: 170, render: (r) => <Text className="text-[12.5px] font-medium text-gray-900" numberOfLines={1}>{r.p.customer_name || '—'}</Text> },
        { key: 'price', label: words.price, width: 115, align: 'right', render: (r) => fig(Number(r.p.sale_price)) },
        { key: 'down', label: 'Down payment', width: 115, align: 'right', render: (r) => fig(Number(r.p.down_payment)) },
        {
          key: 'inst',
          label: 'Instalment',
          width: 150,
          align: 'right',
          render: (r) => (
            <View className="items-end">
              <Text className="text-[12.5px] font-medium text-gray-900">{money(Number(r.p.installment))}</Text>
              <Text className="text-[11px] text-gray-400">{`× ${r.p.months} months${Number(r.p.interest_rate) > 0 ? ` · ${Number(r.p.interest_rate)}%/mo` : ''} · ${r.dueCount} due`}</Text>
            </View>
          ),
        },
        { key: 'paid', label: words.paid, width: 115, align: 'right', render: (r) => fig(r.paid, '#047857', true) },
        { key: 'overdue', label: 'Overdue', width: 110, align: 'right', render: (r) => fig(r.overdue, '#B91C1C', true) },
        { key: 'left', label: 'Remaining', width: 115, align: 'right', render: (r) => fig(r.remaining, '#111827', true) },
        { key: 'next', label: 'Next due', width: 125, render: (r) => <Text className="text-[12.5px] text-gray-700">{r.next ? toBsHistoryLabel(r.next) : '—'}</Text> },
        { key: 'status', label: 'Status', width: 100, render: (r) => <Pill text={r.status.label} color={r.status.color} bg={r.status.bg} /> },
      ]
    : [
        { key: 'vehicle', label: 'Vehicle', render: vehicle },
        {
          key: 'left',
          label: 'Overdue / Left',
          width: 120,
          align: 'right',
          render: (r) => (
            <View className="items-end">
              {fig(r.overdue, '#B91C1C', true)}
              <Text className="text-[11px] text-gray-400">{`Left ${money(r.remaining)}`}</Text>
            </View>
          ),
        },
      ];

  return (
    <>
      {/* Which way: customers paying us, or us paying vendors. */}
      <View className="flex-row" style={{ gap: 8 }}>
        {(['sale', 'purchase'] as const).map((d) => {
          const on = dir === d;
          return (
            <Pressable
              key={d}
              onPress={() => setDir(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              className="flex-row items-center rounded-full border px-4 py-2"
              style={{ gap: 8, borderColor: on ? '#2563EB' : '#D1D5DB', backgroundColor: on ? '#EFF6FF' : '#FFFFFF' }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: on ? '#1D4ED8' : '#4B5563' }}>{WORDS[d].tab}</Text>
              <Text className="text-[12px] font-bold" style={{ color: on ? '#1D4ED8' : '#9CA3AF' }}>{countOf(d)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Every vehicle not in EMI yet on this side: one tap puts them all in. */}
      {(batch.rows.length > 0 || batch.noPrice.length > 0) && (
        <View className="flex-row flex-wrap items-center rounded-xl border border-gray-200 bg-white px-4 py-3" style={{ gap: 12 }}>
          <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
            <Text className="text-[13px] font-semibold text-gray-900">
              {batch.rows.length > 0
                ? `${batch.rows.length} ${dir === 'purchase' ? (batch.rows.length === 1 ? 'vehicle is' : 'vehicles are') : batch.rows.length === 1 ? 'sold vehicle is' : 'sold vehicles are'} not in EMI yet`
                : 'Nothing left to add'}
            </Text>
            <Text className="text-[12px] text-gray-500">
              {dir === 'purchase'
                ? `Every vehicle you bought, in stock or sold: ${EMI_STOCK_MONTHS} monthly instalments, ${EMI_STOCK_RATE}% interest a month on the price (flat), from the vendor on its purchase bill. What you already paid is taken off in Remaining.`
                : `Every vehicle you have sold: ${EMI_STOCK_MONTHS} monthly instalments, ${EMI_STOCK_RATE}% interest a month on the sale price (flat), from the customer on its sale bill. What they already paid is taken off in Remaining.`}
              {batch.noPrice.length > 0 ? ` ${batch.noPrice.length} with no purchase price yet ${batch.noPrice.length === 1 ? 'is' : 'are'} left out.` : ''}
            </Text>
          </View>
          {batch.rows.length > 0 && (
            <Pressable onPress={() => void addAll()} disabled={adding} className="rounded-lg bg-blue-600 px-4 py-2.5 disabled:opacity-50">
              <Text className="text-[13px] font-bold text-white">{adding ? 'Adding…' : `Add ${batch.rows.length} to EMI`}</Text>
            </Pressable>
          )}
        </View>
      )}

      <BookStats>
        <BookStat label="Running" value={String(rows.filter((r) => r.status.label !== 'Completed').length)} color="#1D4ED8" />
        <BookStat label={words.paid} value={`NPR ${money(sum((r) => r.paid))}`} color="#047857" />
        <BookStat label="Overdue" value={`NPR ${money(sum((r) => r.overdue))}`} color="#B91C1C" />
        <BookStat label="Remaining" value={`NPR ${money(sum((r) => r.remaining))}`} color="#111827" />
      </BookStats>
      {error ? (
        <View className="rounded-xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[13px] font-semibold text-red-700">EMI plans could not be loaded.</Text>
          <Text className="mt-1 text-[12px] text-red-600">Run supabase/migrations/0019_emi_plans.sql and 0021_emi_direction_interest.sql in Supabase first.</Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Text className="text-gray-500">{words.none}</Text>
        </View>
      ) : (
        <BookTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.p.id}
          onRowPress={(r) => open(r.p.id)}
          stickyHeader
          footer={{
            label: `${rows.length} ${rows.length === 1 ? 'plan' : 'plans'} · Total`,
            cells: full
              ? {
                  paid: fig(sum((r) => r.paid), '#047857', true),
                  overdue: fig(sum((r) => r.overdue), '#B91C1C', true),
                  left: fig(sum((r) => r.remaining), '#111827', true),
                }
              : { left: fig(sum((r) => r.overdue), '#B91C1C', true) },
          }}
        />
      )}
      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">{words.note}</Text>
      {confirmDialog}
    </>
  );
}
