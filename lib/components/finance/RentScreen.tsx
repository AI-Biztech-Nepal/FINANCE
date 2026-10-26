// lib/components/finance/RentScreen.tsx
import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { BackButton, BookPage, BookStat, BookStats, BookTable, Pill, ToolbarButton, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { useReportActions } from './PrintButton';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { round2 } from '../../utils/money';
import { rentalFigures, rentalStatus } from '../../utils/rental';
import type { PrintReport } from '../../utils/printReport';

const RED = '#B91C1C';
const GREEN = '#047857';

/** Rent: the cars given out on rent - who has each, from when, at what rate, what it comes to and what is
 * still due. Kept apart from Sale and Purchase bills: a car on rent comes back, so it is not a sale and does
 * not leave the stock. A rental is added and edited on its own page (see RentEntryScreen). */
export function RentScreen({ basePath }: { basePath: string }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: rentals, isLoading, error } = useSupabaseQuery('rentals', {
    filters: owner,
    orderBy: { column: 'start_date', ascending: false },
    all: true,
    enabled: !!userId,
  });

  const openEntry = (id?: string) => router.push((id ? `${basePath}/rent-entry?id=${id}` : `${basePath}/rent-entry`) as never);

  // Cars still out first, then the rest - newest first in each.
  const rows = useMemo(
    () =>
      [...(rentals ?? [])]
        .map((r) => ({ r, ...rentalFigures(r, today), status: rentalStatus(r, today) }))
        .sort((a, b) => Number(!!a.r.returned_on) - Number(!!b.r.returned_on) || b.r.start_date.localeCompare(a.r.start_date)),
    [rentals, today]
  );
  type Row = (typeof rows)[number];
  const stats = useMemo(
    () => ({
      out: rows.filter((x) => !x.r.returned_on).length,
      total: round2(rows.reduce((s, x) => s + x.total, 0)),
      received: round2(rows.reduce((s, x) => s + x.received, 0)),
      due: round2(rows.reduce((s, x) => s + x.due, 0)),
    }),
    [rows]
  );

  const buildReport = (): PrintReport => ({
    title: 'Rent',
    businessName: profile?.business_name ?? profile?.full_name ?? '',
    printedOn: toBsHistoryLabel(today),
    summary: [
      { label: 'Cars out now', value: String(stats.out) },
      { label: 'Rent', value: `NPR ${money(stats.total)}` },
      { label: 'Received', value: `NPR ${money(stats.received)}` },
      { label: 'Due', value: `NPR ${money(stats.due)}` },
    ],
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Car' },
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
        rows: rows.map((x, i) => {
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
            money(x.received),
            money(x.due),
            x.status.label,
          ];
        }),
        footer: ['', '', '', '', '', '', '', 'Total', money(stats.total), money(stats.received), money(stats.due), ''],
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
          {reportButtons}
          <ToolbarButton icon="add" label="New rental" onPress={() => openEntry()} />
        </>
      ),
    },
    [reportButtons]
  );

  const dateCell = (iso: string | null | undefined) =>
    iso ? <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(iso)}</Text> : <Text className="text-[12.5px] text-gray-300">—</Text>;
  const num = (text: string, color = '#374151', bold = false) => (
    <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
      {text}
    </Text>
  );
  const dueCell = (x: Row) =>
    x.due === 0 ? num('Cleared', GREEN, true) : num(money(Math.abs(x.due)), x.due > 0 ? RED : GREEN, true);
  const carCell = (x: Row, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
        {x.r.car}
      </Text>
      {!!x.r.model && !compact && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {x.r.model}
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

  const columns: BookColumn<Row>[] = layout.full
    ? [
        { key: 'car', label: 'Car', render: (x) => carCell(x, false) },
        { key: 'renter', label: 'Rented to', width: 170, render: (x) => (x.r.customer_name ? num(x.r.customer_name, '#111827') : num('—', '#D1D5DB')) },
        { key: 'from', label: 'From', width: 112, render: (x) => dateCell(x.r.start_date) },
        { key: 'to', label: 'To', width: 112, render: (x) => dateCell(x.r.returned_on ?? x.r.end_date) },
        { key: 'days', label: 'Days', width: 58, align: 'right', render: (x) => num(String(x.days)) },
        { key: 'rate', label: 'Rate / day', width: 96, align: 'right', render: (x) => num(money(x.r.rate_per_day)) },
        { key: 'total', label: 'Rent', width: 104, align: 'right', render: (x) => num(money(x.total), '#111827', true) },
        { key: 'received', label: 'Received', width: 104, align: 'right', render: (x) => num(x.received ? money(x.received) : '—', GREEN, true) },
        { key: 'due', label: 'Due', width: 104, align: 'right', render: dueCell },
        { key: 'status', label: 'Status', width: 96, render: (x) => <Pill text={x.status.label} color={x.status.color} bg={x.status.bg} /> },
      ]
    : [
        { key: 'car', label: 'Car', render: (x) => carCell(x, true) },
        { key: 'due', label: 'Due', width: 100, align: 'right', render: dueCell },
      ];

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label="Cars out now" value={String(stats.out)} color="#1D4ED8" />
        <BookStat label="Rent" value={`NPR ${money(stats.total)}`} color="#374151" />
        <BookStat label="Received" value={`NPR ${money(stats.received)}`} color={GREEN} />
        <BookStat label="Due" value={`NPR ${money(stats.due)}`} color={RED} />
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
        <BookTable columns={columns} rows={rows} rowKey={(x) => x.r.id} onRowPress={(x) => openEntry(x.r.id)} />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap a rental to edit it, add the payments received, or mark the car returned. A rental is billed by the day, counting the day it went out
        and the day it came back; while a car is out past its due date, every day more is added. Rent is kept apart from Sales, so a car on rent
        stays in your stock.
      </Text>
    </BookPage>
  );
}
