// lib/components/finance/EmiPanel.tsx
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSupabaseInsert, useSupabaseQuery } from '../../hooks/useSupabase';
import { BookStat, BookStats, BookTable, money, type BookColumn } from './BookKit';
import { useConfirmSave } from './ConfirmSave';
import { EMI_STOCK_MONTHS, EMI_STOCK_RATE, addMonths, billedVehicle, emiDirection, emiFigures, emiSoldPlans, emiStockPlans, vendorsByVehicle } from '../../utils/emi';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { journalOf } from '../../utils/journalVoucher';
import { round2 } from '../../utils/money';
import { showAlert, getErrorMessage } from '../../utils/alert';
import type { EmiPlan } from '../../../types/database.types';

const key = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

type Direction = 'sale' | 'purchase';

/** Money in is green and money out red, as everywhere else in the books. */
const IN = '#047857';
const OUT = '#B91C1C';

/** Each column in the full table: [narrowest, its share of the room left over]. They add up to fit the narrowest window
 * that shows the full table, so every vehicle stays on one line, and wider windows go mostly to the names. */
const COLS = {
  sn: [30, 0],
  vehicle: [92, 3],
  party: [96, 3],
  price: [84, 1],
  inst: [70, 1],
  plan: [70, 1],
  started: [88, 1],
} as const;

/** The words of each side: customers paying us for vehicles we sold, or us paying vendors for stock we bought. */
const WORDS: Record<Direction, { price: string; color: string; tint: string; none: string; note: string }> = {
  sale: {
    price: 'Sale price',
    color: '#047857',
    tint: '#ECFDF5',
    none: 'No EMI sales yet. Add one with New EMI, or add all your sold vehicles above.',
    note: 'To receive takes off what the customer paid for the vehicle on the Received page (pick the vehicle in Item). It includes the down payment, which is entered once it is paid; each installment is due on its day. The sale itself is its Sale bill.',
  },
  purchase: {
    price: 'Purchase price',
    color: '#C2410C',
    tint: '#FFF7ED',
    none: 'No vehicles bought on EMI yet. Add one with New EMI, or add all your vehicles above.',
    note: 'To pay takes off what you paid the vendor for the item on the Paid page (pick the item in Item). It includes the down payment, which is entered once it is paid; each installment is due on its day. The purchase itself is its Purchase bill.',
  },
};

/** The EMI tab of Rent & EMI: one line a vehicle, its customer's plan and then its vendor's, so what comes in and what
 * goes out on it each month read side by side. There is a button that puts every vehicle bought in, 12 months at 10% a
 * year (reducing balance). The tiles above say what comes in and what goes out; picking one keeps the vehicles on that side. */
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
    const figures = (p: EmiPlan, dir: Direction) => ({
      p,
      ...emiFigures(p, paidBy.get(dir === 'purchase' ? `purchase|${key(p.car)}` : `sale|${p.customer_id}|${key(p.car)}`) ?? 0, today),
    });
    const byVehicle = new Map<string, Record<Direction, ReturnType<typeof figures>[]>>();
    for (const p of plans ?? []) {
      const dir = emiDirection(p);
      const k = key(p.car);
      if (!byVehicle.has(k)) byVehicle.set(k, { sale: [], purchase: [] });
      byVehicle.get(k)![dir].push(figures(p, dir));
    }
    const vendors = vendorsByVehicle(bills ?? []);
    // One line a vehicle. Should it have two plans on a side, each pair takes a line, so none is hidden.
    return [...byVehicle.entries()]
      .flatMap(([k, side]) =>
        Array.from({ length: Math.max(side.sale.length, side.purchase.length) }, (_, i) => {
          const sale = side.sale[i] ?? null;
          const purchase = side.purchase[i] ?? null;
          return {
            id: (sale ?? purchase)!.p.id,
            car: (sale ?? purchase)!.p.car,
            sale,
            purchase,
            // With no plan to the vendor, still who sold it.
            vendor: purchase?.p.customer_name || vendors.get(k) || '',
            // What its bills come to; with no bill, the plan's own price.
            salePrice: billedVehicle(bills ?? [], 'sale', sale?.p.car ?? purchase!.p.car)?.price ?? (Number(sale?.p.sale_price) || 0),
            purchasePrice: billedVehicle(bills ?? [], 'purchase', sale?.p.car ?? purchase!.p.car)?.price ?? (Number(purchase?.p.sale_price) || 0),
          };
        })
      )
      .sort((a, b) => Number(!a.sale) - Number(!b.sale) || a.car.localeCompare(b.car));
  }, [plans, received, paidOut, bills, today]);
  type Row = (typeof allRows)[number];
  const rows = useMemo(() => allRows.filter((r) => show === 'all' || r[show]), [allRows, show]);
  const sum = (f: (r: Row) => number, list: Row[] = rows) => round2(list.reduce((s, r) => s + f(r), 0));
  const toReceive = sum((r) => r.sale?.remaining ?? 0, allRows);
  const toPay = sum((r) => r.purchase?.remaining ?? 0, allRows);
  const net = round2(toReceive - toPay);
  // What falls due each month: the installment of every plan still running on a side.
  const monthly = (r: Row, d: Direction) => (!r[d] || r[d].status.label === 'Completed' ? 0 : Number(r[d].p.installment));
  const recurring = (d: Direction) => sum((r) => monthly(r, d), allRows);
  // The sides on screen: both, or the one picked.
  const sides: Direction[] = show === 'all' ? ['sale', 'purchase'] : [show];

  // The vehicles not in EMI yet on each side: every vehicle bought (we pay its vendor), or every one already sold
  // (the customer pays us).
  const batches = useMemo(() => {
    const input = { products: products ?? [], bills: bills ?? [], plans: plans ?? [], months: EMI_STOCK_MONTHS, rate: EMI_STOCK_RATE };
    return { purchase: emiStockPlans(input), sale: { ...emiSoldPlans(input), noPrice: [] as string[] } };
  }, [products, bills, plans]);

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
  // The amount on installments: the plan's price less its down payment.
  const emiAmount = (p?: EmiPlan) => (p ? round2(Math.max(0, Number(p.sale_price) - Number(p.down_payment))) : 0);
  const planText = (p?: EmiPlan) => (p ? `${p.months} mo${Number(p.interest_rate) > 0 ? ` · ${Number(p.interest_rate)}%` : ''}` : '—');
  // The date entered on the EMI form; the first installment falls a month after it. The customer's plan if it has one.
  const startedOn = (r: Row) => toBsHistoryLabel(addMonths((r.sale ?? r.purchase)!.p.first_due, -1));
  // A tap on the line opens the customer's plan; the vendor's name opens the vendor's.
  const vendorCell = (r: Row) =>
    r.sale && r.purchase ? (
      <Pressable onPress={() => open(r.purchase!.p.id)}>{line(r.vendor || '—')}</Pressable>
    ) : (
      line(r.vendor || '—')
    );
  const inAndOut = (inn: number, out: number) => (
    <View className="items-end">
      <Text className="text-[11.5px] font-semibold" style={{ color: IN }} numberOfLines={1}>{`Customer ${money(inn)}`}</Text>
      <Text className="text-[11.5px] font-semibold" style={{ color: OUT }} numberOfLines={1}>{`Vendor ${money(out)}`}</Text>
    </View>
  );
  const columns: BookColumn<Row>[] = full
    ? [
        { key: 'sn', label: 'SN', ...w('sn'), render: (_r, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'vehicle', label: 'Vehicle', ...w('vehicle'), render: (r) => line(r.car, 'font-semibold text-gray-900') },
        { key: 'customer', label: 'Customer', ...w('party'), render: (r) => line(r.sale?.p.customer_name || '—') },
        { key: 'saleIn', label: 'Sale price', ...w('price'), align: 'right', render: (r) => fig(r.salePrice) },
        { key: 'amountIn', label: 'EMI amount', ...w('price'), align: 'right', render: (r) => fig(emiAmount(r.sale?.p)) },
        { key: 'instIn', label: 'Customer EMI', ...w('inst'), align: 'right', render: (r) => fig(Number(r.sale?.p.installment), IN, true) },
        { key: 'planIn', label: 'Plan', ...w('plan'), render: (r) => line(planText(r.sale?.p), 'text-gray-500') },
        { key: 'vendor', label: 'Vendor', ...w('party'), render: vendorCell },
        { key: 'purchaseOut', label: 'Purchase price', ...w('price'), align: 'right', render: (r) => fig(r.purchasePrice) },
        { key: 'amountOut', label: 'EMI amount', ...w('price'), align: 'right', render: (r) => fig(emiAmount(r.purchase?.p)) },
        { key: 'instOut', label: 'Vendor EMI', ...w('inst'), align: 'right', render: (r) => fig(Number(r.purchase?.p.installment), OUT, true) },
        { key: 'planOut', label: 'Plan', ...w('plan'), render: (r) => line(planText(r.purchase?.p), 'text-gray-500') },
        { key: 'started', label: 'EMI started', ...w('started'), render: (r) => line(startedOn(r), 'text-gray-700') },
      ]
    : [
        {
          key: 'vehicle',
          label: 'Vehicle',
          render: (r) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              {line(r.car, 'font-semibold text-gray-900')}
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>{[r.sale?.p.customer_name, r.vendor].filter(Boolean).join(' · ') || '—'}</Text>
            </View>
          ),
        },
        { key: 'money', label: 'EMI a month', width: 140, align: 'right', render: (r) => inAndOut(Number(r.sale?.p.installment) || 0, Number(r.purchase?.p.installment) || 0) },
      ];

  const count = `${rows.length} ${rows.length === 1 ? 'vehicle' : 'vehicles'} · Total`;
  const table = (
    <BookTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowPress={(r) => open(r.id)}
      stickyHeader
      dense
      footer={{
        label: count,
        cells: full
          ? {
              saleIn: fig(sum((r) => r.salePrice)),
              amountIn: fig(sum((r) => emiAmount(r.sale?.p))),
              instIn: fig(sum((r) => monthly(r, 'sale')), IN, true),
              purchaseOut: fig(sum((r) => r.purchasePrice)),
              amountOut: fig(sum((r) => emiAmount(r.purchase?.p))),
              instOut: fig(sum((r) => monthly(r, 'purchase')), OUT, true),
            }
          : { money: inAndOut(sum((r) => monthly(r, 'sale')), sum((r) => monthly(r, 'purchase'))) },
      }}
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
                  ? `Every vehicle you bought and have sold: ${EMI_STOCK_MONTHS} monthly installments, ${EMI_STOCK_RATE}% interest a year on what is still unpaid (reducing balance), from the vendor on its purchase bill. What you already paid is taken off To pay.`
                  : `Every vehicle you have sold: ${EMI_STOCK_MONTHS} monthly installments, ${EMI_STOCK_RATE}% interest a year on what is still unpaid (reducing balance), from the customer on its sale bill. What they already paid is taken off To receive.`}
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
