// lib/components/finance/RentScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useRentalWageSync } from '../../hooks/useRentalWageSync';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { usePartyDestination } from '../../hooks/usePartyDestination';
import { journalOf } from '../../utils/journalVoucher';
import { BackButton, BookPage, BookStat, BookStats, BookTable, FilterTabs, Pill, ToolbarButton, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { EmiPanel } from './EmiPanel';
import { useReportActions } from './PrintButton';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { round2 } from '../../utils/money';
import { rentalFigures, rentalStatus } from '../../utils/rental';
import type { PrintReport } from '../../utils/printReport';

/** Rent: the items given out on rent - who has each, from when, at what rate, and what it comes to. Kept
 * apart from Sale and Purchase bills: an item on rent comes back, so it is not a sale and does not leave
 * the stock. A rental is added and edited on its own page (see RentEntryScreen). */
export function RentScreen({ basePath }: { basePath: string }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  // The renters' daily rent lines up to today (see useRentalWageSync).
  useRentalWageSync(userId);
  const profile = useAuthStore((state) => state.profile);
  // Rent & EMI: two tabs - vehicles sold on instalments, and vehicles given on rent. It opens on EMI (`?tab=rent` opens on Rent).
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'emi' | 'rent'>(tabParam === 'rent' ? 'rent' : 'emi');
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: rentals, isLoading, error } = useSupabaseQuery('rentals', {
    filters: owner,
    orderBy: { column: 'start_date', ascending: false },
    all: true,
    enabled: !!userId,
  });

  // What each renter paid for the vehicle they rent: their Received entries whose remark starts with it (pick the
  // vehicle in Item on the Received page). Payments for anything else - a vehicle they bought - are not rent.
  const { data: renterLedger } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const rentPaid = useMemo(() => {
    const key = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const map = new Map<string, number>();
    for (const e of renterLedger ?? []) {
      if (e.entry_type !== 'credit' || !e.note || journalOf(e.note)) continue;
      const k = `${e.customer_id}|${key(e.note.split(' · ')[0])}`;
      map.set(k, (map.get(k) ?? 0) + Number(e.amount));
    }
    return (r: { customer_id: string | null; car: string }) => (r.customer_id ? map.get(`${r.customer_id}|${key(r.car)}`) ?? 0 : 0);
  }, [renterLedger]);
  // The tile picked narrows the table: still out, paid something, or still owing.
  const [show, setShow] = useState<'all' | 'out' | 'received' | 'due'>('all');

  const openEntry = (id?: string) => router.push((id ? `${basePath}/rent-entry?id=${id}` : `${basePath}/rent-entry`) as never);
  // A rental opens its renter's ledger (the way the Ledger opens a person); one with no renter picked opens the rental.
  const hrefFor = usePartyDestination(userId, basePath);
  const openRenter = (r: { id: string; customer_id: string | null }) =>
    r.customer_id ? router.push(hrefFor(r.customer_id) as never) : openEntry(r.id);

  // Items still out first, then the rest - newest first in each.
  const rows = useMemo(
    () =>
      [...(rentals ?? [])]
        .map((r) => {
          const f = rentalFigures(r, today);
          const paid = round2(rentPaid(r));
          return { r, ...f, paid, left: round2(Math.max(0, f.total - paid)), status: rentalStatus(r, today) };
        })
        .sort((a, b) => Number(!!a.r.returned_on) - Number(!!b.r.returned_on) || b.r.start_date.localeCompare(a.r.start_date)),
    [rentals, today, rentPaid]
  );
  type Row = (typeof rows)[number];
  const shown = rows.filter((x) => (show === 'out' ? !x.r.returned_on : show === 'received' ? x.paid > 0 : show === 'due' ? x.left > 0 : true));
  const stats = useMemo(
    () => ({
      out: rows.filter((x) => !x.r.returned_on).length,
      total: round2(rows.reduce((s, x) => s + x.total, 0)),
      paid: round2(rows.reduce((s, x) => s + x.paid, 0)),
      left: round2(rows.reduce((s, x) => s + x.left, 0)),
    }),
    [rows]
  );

  const buildReport = (): PrintReport => ({
    title: 'Rent',
    businessName: profile?.business_name ?? profile?.full_name ?? '',
    printedOn: toBsHistoryLabel(today),
    summary: [
      { label: 'Out now', value: String(stats.out) },
      { label: 'Rent', value: `NPR ${money(stats.total)}` },
      { label: 'Received', value: `NPR ${money(stats.paid)}` },
      { label: 'Due', value: `NPR ${money(stats.left)}` },
      { label: 'Rentals', value: String(rows.length) },
    ],
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Item' },
          { label: 'Model' },
          { label: 'Rented to' },
          { label: 'From' },
          { label: 'To' },
          { label: 'Days', align: 'right' },
          { label: 'Rate/day', align: 'right' },
          { label: 'Rent', align: 'right' },
          { label: 'Received', align: 'right' },
          { label: 'Due', align: 'right' },
          { label: 'Status' },
        ],
        rows: shown.map((x, i) => {
          const to = x.r.returned_on ?? x.r.end_date;
          return [
            String(i + 1),
            x.r.car,
            x.r.model ?? '',
            x.r.customer_name ?? '',
            toBsHistoryLabel(x.r.start_date),
            to ? toBsHistoryLabel(to) : '',
            String(x.days),
            money(x.r.rate_per_day),
            money(x.total),
            x.paid ? money(x.paid) : '',
            x.left ? money(x.left) : '',
            x.status.label,
          ];
        }),
        footer: ['', '', '', '', '', '', '', 'Total', money(stats.total), money(stats.paid), money(stats.left), ''],
        emptyText: 'No rentals yet.',
      },
    ],
  });
  const reportButtons = useReportActions(buildReport);

  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: () => (
        <>
          {tab === 'rent' && reportButtons}
          {tab === 'rent' ? (
            <ToolbarButton icon="add" label="New rental" onPress={() => openEntry()} />
          ) : (
            <ToolbarButton icon="add" label="New EMI" onPress={() => router.push(`${basePath}/emi-entry` as never)} />
          )}
        </>
      ),
    },
    [reportButtons, tab]
  );

  const dateCell = (iso: string | null | undefined) =>
    iso ? <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(iso)}</Text> : <Text className="text-[12.5px] text-gray-300">—</Text>;
  const num = (text: string, color = '#374151', bold = false) => (
    <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
      {text}
    </Text>
  );
  const itemCell = (x: Row, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
        {x.r.car}
      </Text>
      {(!!x.r.model || !!x.r.note) && !compact && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {[x.r.model, x.r.note].filter(Boolean).join(' · ')}
        </Text>
      )}
      {compact && (
        <>
          <Text className="text-[11px] text-gray-500" numberOfLines={1}>
            {[x.r.customer_name, x.r.model].filter(Boolean).join(' · ') || '—'}
          </Text>
          <Pill text={x.status.label} color={x.status.color} bg={x.status.bg} />
          <Text className="text-[11px] text-gray-400" numberOfLines={1}>
            {`${toBsHistoryLabel(x.r.start_date)} · ${x.days} ${x.days === 1 ? 'day' : 'days'}`}
          </Text>
        </>
      )}
    </View>
  );

  const figure = (v: number, color: string) => (v ? num(money(v), color, true) : num('—', '#D1D5DB'));
  // The pencil at the end of a row: edit the rental itself (the row opens the renter's ledger).
  const editColumn: BookColumn<Row> = {
    key: 'edit',
    label: '',
    width: 40,
    align: 'right',
    render: (x) => (
      <Pressable onPress={() => openEntry(x.r.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit this rental">
        <Ionicons name="create-outline" size={16} color="#6B7280" />
      </Pressable>
    ),
  };
  // The Ledger's table layout: SN, the rental, its days and rate, then the money - rent, received (green), due (red).
  const columns: BookColumn<Row>[] = layout.full
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_x, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'item', label: 'Item', render: (x) => itemCell(x, false) },
        { key: 'renter', label: 'Rented to', width: 190, render: (x) => (x.r.customer_name ? num(x.r.customer_name, '#111827') : num('—', '#D1D5DB')) },
        { key: 'from', label: 'From', width: 120, render: (x) => dateCell(x.r.start_date) },
        { key: 'to', label: 'To', width: 120, render: (x) => dateCell(x.r.returned_on ?? x.r.end_date) },
        { key: 'days', label: 'Days', width: 64, align: 'right', render: (x) => num(String(x.days)) },
        { key: 'rate', label: 'Rate / day', width: 104, align: 'right', render: (x) => num(money(x.r.rate_per_day)) },
        { key: 'total', label: 'Rent', width: 112, align: 'right', render: (x) => num(money(x.total), '#111827', true) },
        { key: 'paid', label: 'Received', width: 112, align: 'right', render: (x) => figure(x.paid, '#047857') },
        { key: 'left', label: 'Due', width: 112, align: 'right', render: (x) => figure(x.left, '#B91C1C') },
        { key: 'status', label: 'Status', width: 100, render: (x) => <Pill text={x.status.label} color={x.status.color} bg={x.status.bg} /> },
        editColumn,
      ]
    : [
        { key: 'item', label: 'Item', render: (x) => itemCell(x, true) },
        { key: 'total', label: 'Rent', width: 100, align: 'right', render: (x) => num(money(x.total), '#111827', true) },
        { key: 'left', label: 'Due', width: 96, align: 'right', render: (x) => figure(x.left, '#B91C1C') },
        editColumn,
      ];
  const sum = (f: (x: Row) => number) => round2(shown.reduce((s, x) => s + f(x), 0));
  const footer = {
    label: `${shown.length} ${shown.length === 1 ? 'rental' : 'rentals'} · Total`,
    cells: layout.full
      ? {
          total: num(money(sum((x) => x.total)), '#111827', true),
          paid: figure(sum((x) => x.paid), '#047857'),
          left: figure(sum((x) => x.left), '#B91C1C'),
        }
      : { total: num(money(sum((x) => x.total)), '#111827', true), left: figure(sum((x) => x.left), '#B91C1C') },
  };
  const pick = (k: typeof show) => setShow((cur) => (cur === k ? 'all' : k));

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <View className="flex-row">
        <FilterTabs
          options={[
            { key: 'emi', label: 'EMI' },
            { key: 'rent', label: 'Rent' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'emi' ? (
        <EmiPanel userId={userId} basePath={basePath} full={layout.full} />
      ) : (
      <>
      <BookStats>
        {/* Each tile narrows the table to its rentals; a second tap (or Rent / Rentals) shows them all again. */}
        <BookStat label="Out now" value={String(stats.out)} color="#1D4ED8" onPress={() => pick('out')} active={show === 'out'} />
        <BookStat label="Rent" value={`NPR ${money(stats.total)}`} color="#374151" onPress={() => setShow('all')} />
        <BookStat label="Received" value={`NPR ${money(stats.paid)}`} color="#047857" onPress={() => pick('received')} active={show === 'received'} />
        <BookStat label="Due" value={`NPR ${money(stats.left)}`} color="#B91C1C" onPress={() => pick('due')} active={show === 'due'} />
        <BookStat label="Rentals" value={String(rows.length)} color="#374151" onPress={() => setShow('all')} active={show === 'all'} />
      </BookStats>

      {error ? (
        <View className="rounded-xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[13px] font-semibold text-red-700">Rentals could not be loaded.</Text>
          <Text className="mt-1 text-[12px] text-red-600">
            If this is the first time, the rentals table has not been created yet - run supabase/migrations/0009_rentals.sql in Supabase.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="car-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{isLoading ? 'Loading…' : 'No rentals yet. Tap New rental.'}</Text>
        </View>
      ) : (
        <BookTable columns={columns} rows={shown} rowKey={(x) => x.r.id} onRowPress={(x) => openRenter(x.r)} footer={footer} stickyHeader />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap a rental to open the renter's ledger; the pencil edits the rental. Received is what the renter paid on the Received page with the vehicle picked in Item. A rental is billed by the day, counting the day it was rented and every day since. Rent is kept apart from Sales,
        so an item on rent stays in your stock.
      </Text>
      </>
      )}
    </BookPage>
  );
}
