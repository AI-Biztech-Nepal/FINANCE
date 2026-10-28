// lib/components/finance/EmiPanel.tsx
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { BookStat, BookStats, BookTable, Pill, money, type BookColumn } from './BookKit';
import { emiFigures } from '../../utils/emi';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { journalOf } from '../../utils/journalVoucher';
import { round2 } from '../../utils/money';
import { themeColors } from '../../theme/accent';

const key = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The EMI tab of Rent & EMI: every vehicle sold on instalments - what it comes to, what the customer has paid (their
 * Received entries naming the vehicle), what is overdue, what is left and when the next instalment falls. */
export function EmiPanel({ userId, basePath, full }: { userId: string | undefined; basePath: string; full: boolean }) {
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: plans, error } = useSupabaseQuery('emi_plans', { filters: owner, orderBy: { column: 'first_due', ascending: false }, all: true, enabled: !!userId });
  const { data: received } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId });

  const rows = useMemo(() => {
    // What each customer paid for each vehicle: their Received entries whose remark starts with it.
    const paidBy = new Map<string, number>();
    for (const e of received ?? []) {
      if (e.entry_type !== 'credit' || !e.note || journalOf(e.note)) continue;
      const k = `${e.customer_id}|${key(e.note.split(' · ')[0])}`;
      paidBy.set(k, (paidBy.get(k) ?? 0) + Number(e.amount));
    }
    return (plans ?? [])
      .map((p) => ({ p, ...emiFigures(p, paidBy.get(`${p.customer_id}|${key(p.car)}`) ?? 0, today) }))
      .sort((a, b) => Number(a.status.label === 'Completed') - Number(b.status.label === 'Completed') || b.overdue - a.overdue);
  }, [plans, received, today]);
  type Row = (typeof rows)[number];
  const sum = (f: (r: Row) => number) => round2(rows.reduce((s, r) => s + f(r), 0));

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
        { key: 'customer', label: 'Customer', width: 170, render: (r) => <Text className="text-[12.5px] font-medium text-gray-900" numberOfLines={1}>{r.p.customer_name || '—'}</Text> },
        { key: 'price', label: 'Sale price', width: 115, align: 'right', render: (r) => fig(Number(r.p.sale_price)) },
        { key: 'down', label: 'Down payment', width: 115, align: 'right', render: (r) => fig(Number(r.p.down_payment)) },
        {
          key: 'inst',
          label: 'Instalment',
          width: 140,
          align: 'right',
          render: (r) => (
            <View className="items-end">
              <Text className="text-[12.5px] font-medium text-gray-900">{money(Number(r.p.installment))}</Text>
              <Text className="text-[11px] text-gray-400">{`× ${r.p.months} months · ${r.dueCount} due`}</Text>
            </View>
          ),
        },
        { key: 'paid', label: 'Received', width: 115, align: 'right', render: (r) => fig(r.paid, '#047857', true) },
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
      <BookStats>
        <BookStat label="Running" value={String(rows.filter((r) => r.status.label !== 'Completed').length)} color={themeColors.c700} />
        <BookStat label="Received" value={`NPR ${money(sum((r) => r.paid))}`} color="#047857" />
        <BookStat label="Overdue" value={`NPR ${money(sum((r) => r.overdue))}`} color="#B91C1C" />
        <BookStat label="Remaining" value={`NPR ${money(sum((r) => r.remaining))}`} color="#111827" />
      </BookStats>
      {error ? (
        <View className="rounded-xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[13px] font-semibold text-red-700">EMI plans could not be loaded.</Text>
          <Text className="mt-1 text-[12px] text-red-600">Run supabase/migrations/0019_emi_plans.sql in Supabase first.</Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Text className="text-gray-500">No EMI sales yet. Add one with New EMI.</Text>
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
      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Received is what the customer paid for the vehicle on the Received page (pick the vehicle in Item). The down payment is due on the sale; each instalment on its day. The sale itself is its Sale bill.
      </Text>
    </>
  );
}
