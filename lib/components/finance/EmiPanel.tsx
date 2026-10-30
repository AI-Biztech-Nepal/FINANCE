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

/** Each column in the full table: [narrowest, its share of the room left over]. They add up to fit the narrowest window
 * that shows the full table, so every plan stays on one line, and wider windows go mostly to the names. */
const COLS = {
  sn: [36, 0],
  vehicle: [116, 3],
  party: [136, 3],
  inst: [92, 1],
  plan: [96, 1],
  paid: [96, 1],
  overdue: [96, 1],
  left: [104, 1],
  next: [116, 1],
  status: [84, 0],
} as const;

/** The words of each side: customers paying us for vehicles we sold, or us paying vendors for stock we bought. */
const WORDS: Record<Direction, { group: string; price: string; color: string; tint: string; none: string; note: string }> = {
  sale: {
    group: 'Receive from customers',
    price: 'Sale price',
    color: '#047857',
    tint: '#ECFDF5',
    none: 'No EMI sales yet. Add one with New EMI, or add all your sold vehicles above.',
    note: 'From customers: paid is what the customer paid for the vehicle on the Received page (pick the vehicle in Item). It includes the down payment, which is entered once it is paid; each installment is due on its day. The sale itself is its Sale bill.',
  },
  purchase: {
    group: 'Pay to vendors',
    price: 'Purchase price',
    color: '#C2410C',
    tint: '#FFF7ED',
    none: 'No vehicles bought on EMI yet. Add one with New EMI, or add all your vehicles above.',
    note: 'To vendors: paid is what you paid the vendor for the item on the Paid page (pick the item in Item). It includes the down payment, which is entered once it is paid; each installment is due on its day. The purchase itself is its Purchase bill.',
  },
};

/** The EMI tab of Rent & EMI: one table of both ways, one line a plan. Receive from customers: every vehicle sold on
 * installments - what the customer has paid (their Received entries naming the vehicle), what is overdue, what is left and
 * when the next installment falls. Pay to vendors: the stock bought on installments, the same figures from the Paid entries
 * on the vendor's ledger - with a button that puts every vehicle bought in, 12 months at 10% a year (reducing balance).
 * The tiles above it say what comes in and what goes out, and picking one narrows the table to that side. */
export function EmiPanel({ userId, basePath, full }: { userId: string | undefined; basePath: string; full: boolean }) {
  const today = localTodayIso();
  // The tile picked narrows the table to one side.
  const [show, setShow] = useState<'all' | Direction>('all');
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: plans, error } = useSupabaseQuery('emi_plans', { filters: owner, orderBy: { column: 'first_due', ascending: false }, all: true, enabled: !!userId });
  const { data: received } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: paidOut } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: products } = useSupabaseQuery('products', { filters: owner, all: true, enabled: !!userId });
  const { data: bills } = useSupabaseQuery('business_transactions', { filters: owner, all: true, enabled: !!userId });
  const createPlan = useSupabaseInsert('emi_plans');
  const { confirm, dialog: confirmDialog } = useConfirmSave();
  const [adding, setAdding] = useState(false);

  const allRows = useMemo(() => {
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
      .map((p) => {
        const dir = emiDirection(p);
        return { p, dir, ...emiFigures(p, paidBy.get(dir === 'purchase' ? `purchase|${key(p.car)}` : `sale|${p.customer_id}|${key(p.car)}`) ?? 0, today) };
      })
      .sort(
        (a, b) =>
          Number(a.dir === 'purchase') - Number(b.dir === 'purchase') ||
          Number(a.status.label === 'Completed') - Number(b.status.label === 'Completed') ||
          b.overdue - a.overdue
      );
  }, [plans, received, paidOut, today]);
  type Row = (typeof allRows)[number];
  const rows = useMemo(() => allRows.filter((r) => show === 'all' || r.dir === show), [allRows, show]);
  const sum = (f: (r: Row) => number, list: Row[] = rows) => round2(list.reduce((s, r) => s + f(r), 0));
  const sideOf = (d: Direction) => allRows.filter((r) => r.dir === d);
  const toReceive = sum((r) => r.remaining, sideOf('sale'));
  const toPay = sum((r) => r.remaining, sideOf('purchase'));
  const net = round2(toReceive - toPay);
  // What falls due each month: the installment of every plan still running on a side.
  const recurring = (d: Direction) => sum((r) => (r.status.label === 'Completed' ? 0 : Number(r.p.installment)), sideOf(d));
  // The sides on screen: both, or the one picked.
  const sides: Direction[] = show === 'all' ? ['sale', 'purchase'] : [show];

  // The vehicles not in EMI yet on each side: every vehicle bought (we pay its vendor), or every one already sold
  // (the customer pays us).
  const batches = useMemo(() => {
    const input = { products: products ?? [], bills: bills ?? [], plans: plans ?? [], months: EMI_STOCK_MONTHS, rate: EMI_STOCK_RATE };
    return { purchase: emiStockPlans({ ...input, today }), sale: { ...emiSoldPlans(input), noPrice: [] as string[] } };
  }, [products, bills, plans, today]);

  async function addAll(dir: Direction) {
    const batch = batches[dir];
    if (!userId || adding || batch.rows.length === 0) return;
    const n = batch.rows.length;
    const price = round2(batch.rows.reduce((s, r) => s + Number(r.sale_price), 0));
    const total = round2(batch.rows.reduce((s, r) => s + Number(r.down_payment) + Number(r.installment) * Number(r.months), 0));
    const ok = await confirm({
      title: `Add ${n} ${dir === 'purchase' ? (n === 1 ? 'vehicle' : 'vehicles') : n === 1 ? 'sold vehicle' : 'sold vehicles'} to EMI?`,
      rows: [
        { label: 'Vehicles', value: String(n) },
        { label: WORDS[dir].price, value: `NPR ${money(price)}` },
        { label: 'Plan', value: `${EMI_STOCK_MONTHS} months · ${EMI_STOCK_RATE}% a year, reducing balance` },
        ...(batch.noPrice.length ? [{ label: 'Left out (no purchase price)', value: String(batch.noPrice.length) }] : []),
      ],
      total: { label: dir === 'purchase' ? 'To pay with interest' : 'To collect with interest', value: `NPR ${money(total)}`, color: WORDS[dir].color },
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
  const w = (k: keyof typeof COLS) => ({ width: COLS[k][0], grow: COLS[k][1] });
  const line = (text: string, cls = 'font-medium text-gray-900') => (
    <Text className={`text-[12.5px] ${cls}`} numberOfLines={1}>
      {text}
    </Text>
  );
  const columns: BookColumn<Row>[] = full
    ? [
        { key: 'sn', label: 'SN', ...w('sn'), render: (_r, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'vehicle', label: 'Vehicle', ...w('vehicle'), render: (r) => line(r.p.car, 'font-semibold text-gray-900') },
        { key: 'party', label: 'Customer / Vendor', ...w('party'), render: (r) => line(r.p.customer_name || '—') },
        { key: 'inst', label: 'Installment', ...w('inst'), align: 'right', render: (r) => fig(Number(r.p.installment)) },
        { key: 'plan', label: 'Plan', ...w('plan'), render: (r) => line(`${r.p.months} mo${Number(r.p.interest_rate) > 0 ? ` · ${Number(r.p.interest_rate)}%` : ''}`, 'text-gray-500') },
        { key: 'paid', label: 'Paid', ...w('paid'), align: 'right', render: (r) => fig(r.paid, '#374151') },
        { key: 'overdue', label: 'Overdue', ...w('overdue'), align: 'right', render: (r) => fig(r.overdue, '#B91C1C', true) },
        { key: 'left', label: 'Remaining', ...w('left'), align: 'right', render: (r) => fig(r.remaining, WORDS[r.dir].color, true) },
        { key: 'next', label: 'Next due', ...w('next'), render: (r) => line(r.next ? toBsHistoryLabel(r.next) : '—', 'text-gray-700') },
        { key: 'status', label: 'Status', ...w('status'), render: (r) => <Pill text={r.status.label} color={r.status.color} bg={r.status.bg} /> },
      ]
    : [
        {
          key: 'vehicle',
          label: 'Vehicle',
          render: (r) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              {line(r.p.car, 'font-semibold text-gray-900')}
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>{r.p.customer_name || '—'}</Text>
            </View>
          ),
        },
        {
          key: 'left',
          label: 'Overdue / Left',
          width: 120,
          align: 'right',
          render: (r) => (
            <View className="items-end">
              {fig(r.overdue, '#B91C1C', true)}
              <Text className="text-[11px] font-semibold" style={{ color: WORDS[r.dir].color }} numberOfLines={1}>{`Left ${money(r.remaining)}`}</Text>
            </View>
          ),
        },
      ];

  // Each section says what it comes to; the two only add up as what is left once the vendors are paid.
  const groupOf = (r: Row) => {
    const side = sideOf(r.dir);
    const overdue = sum((x) => x.overdue, side);
    return `${WORDS[r.dir].group} · ${side.length} ${side.length === 1 ? 'plan' : 'plans'} · NPR ${money(sum((x) => x.remaining, side))}${overdue ? ` · Overdue NPR ${money(overdue)}` : ''}`;
  };
  const plansLabel = `${rows.length} ${rows.length === 1 ? 'plan' : 'plans'}`;
  const table = (
    <BookTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.p.id}
      onRowPress={(r) => open(r.p.id)}
      groupOf={groupOf}
      stickyHeader
      dense
      footer={
        show === 'all'
          ? { label: `${plansLabel} · Net ${net < 0 ? 'to pay' : 'to receive'}`, cells: { left: fig(Math.abs(net), net < 0 ? WORDS.purchase.color : WORDS.sale.color, true) } }
          : {
              label: `${plansLabel} · Total`,
              cells: full
                ? {
                    paid: fig(sum((r) => r.paid), '#374151'),
                    overdue: fig(sum((r) => r.overdue), '#B91C1C', true),
                    left: fig(sum((r) => r.remaining), WORDS[show].color, true),
                  }
                : { left: fig(sum((r) => r.remaining), WORDS[show].color, true) },
            }
      }
    />
  );

  return (
    <>
      {/* Every vehicle not in EMI yet on a side: one tap puts them all in. */}
      {sides.map((d) => {
        const batch = batches[d];
        if (batch.rows.length === 0 && batch.noPrice.length === 0) return null;
        return (
          <View key={d} className="flex-row flex-wrap items-center rounded-xl border border-gray-200 bg-white px-4 py-3" style={{ gap: 12 }}>
            <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
              <Text className="text-[13px] font-semibold text-gray-900">
                {batch.rows.length > 0
                  ? `${batch.rows.length} ${d === 'purchase' ? (batch.rows.length === 1 ? 'vehicle is' : 'vehicles are') : batch.rows.length === 1 ? 'sold vehicle is' : 'sold vehicles are'} not in EMI yet`
                  : 'Nothing left to add'}
              </Text>
              <Text className="text-[12px] text-gray-500">
                {d === 'purchase'
                  ? `Every vehicle you bought, in stock or sold: ${EMI_STOCK_MONTHS} monthly installments, ${EMI_STOCK_RATE}% interest a year on what is still unpaid (reducing balance), from the vendor on its purchase bill. What you already paid is taken off in Remaining.`
                  : `Every vehicle you have sold: ${EMI_STOCK_MONTHS} monthly installments, ${EMI_STOCK_RATE}% interest a year on what is still unpaid (reducing balance), from the customer on its sale bill. What they already paid is taken off in Remaining.`}
                {batch.noPrice.length > 0 ? ` ${batch.noPrice.length} with no purchase price yet ${batch.noPrice.length === 1 ? 'is' : 'are'} left out.` : ''}
              </Text>
            </View>
            {batch.rows.length > 0 && (
              <Pressable onPress={() => void addAll(d)} disabled={adding} className="rounded-lg bg-blue-600 px-4 py-2.5 disabled:opacity-50">
                <Text className="text-[13px] font-bold text-white">{adding ? 'Adding…' : `Add ${batch.rows.length} to EMI`}</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <BookStats>
        <BookStat label="To receive" value={`NPR ${money(toReceive)}`} color={WORDS.sale.color} tint={WORDS.sale.tint} onPress={() => setShow(show === 'sale' ? 'all' : 'sale')} active={show === 'sale'} />
        <BookStat label="Customer recurring EMI" value={`NPR ${money(recurring('sale'))}`} color={WORDS.sale.color} tint={WORDS.sale.tint} onPress={() => setShow(show === 'sale' ? 'all' : 'sale')} active={show === 'sale'} />
        <BookStat label="To pay" value={`NPR ${money(toPay)}`} color={WORDS.purchase.color} tint={WORDS.purchase.tint} onPress={() => setShow(show === 'purchase' ? 'all' : 'purchase')} active={show === 'purchase'} />
        <BookStat label="Vendor recurring EMI" value={`NPR ${money(recurring('purchase'))}`} color={WORDS.purchase.color} tint={WORDS.purchase.tint} onPress={() => setShow(show === 'purchase' ? 'all' : 'purchase')} active={show === 'purchase'} />
        <BookStat label={net < 0 ? 'Net to pay' : 'Net to receive'} value={`NPR ${money(Math.abs(net))}`} color="#1D4ED8" tint="#EFF6FF" onPress={() => setShow('all')} />
      </BookStats>
      {error ? (
        <View className="rounded-xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[13px] font-semibold text-red-700">EMI plans could not be loaded.</Text>
          <Text className="mt-1 text-[12px] text-red-600">Run supabase/migrations/0019_emi_plans.sql and 0021_emi_direction_interest.sql in Supabase first.</Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Text className="text-gray-500">{show === 'all' ? 'No EMI plans yet. Add one with New EMI.' : WORDS[show].none}</Text>
        </View>
      ) : (
        table
      )}
      {sides.map((d) => (
        <Text key={d} className="px-1 text-[11.5px] leading-[17px] text-gray-400">{WORDS[d].note}</Text>
      ))}
      {confirmDialog}
    </>
  );
}
