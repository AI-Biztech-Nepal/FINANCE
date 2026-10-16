// lib/components/finance/TransactionsBook.tsx
import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { shortDateLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { BackButton, BookPage, BookStat, BookStats, BookTable, FilterTabs, Pill, ToolbarButton, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { DateFilterButton } from './DateRangeFilter';
import { MONEY } from './moneyColors';
import { journalOf } from '../../utils/journalVoucher';
import { useAuthStore } from '../../hooks/useAuth';
import { localTodayIso } from '../../utils/localDate';
import type { PrintReport } from '../../utils/printReport';
import { useReportActions } from './PrintButton';
import type { FeedItem } from './TransactionsScreen';
import { tidyName } from '../../utils/nameCaps';
import type { AccountTransfer, BusinessTransaction, BusinessTransactionType } from '../../../types/database.types';

type FilterKey = 'all' | BusinessTransactionType;

interface PillStyle {
  label: string;
  color: string;
  bg: string;
}

const PILL = {
  received: { label: 'Received', color: '#047857', bg: '#ECFDF5' },
  paid: { label: 'Paid', color: '#B91C1C', bg: '#FEF2F2' },
  expense: { label: 'Expenses', color: '#B91C1C', bg: '#FEF2F2' },
  sale: { label: 'Sale bill', color: MONEY.in.text, bg: MONEY.in.bg },
  purchase: { label: 'Purchase bill', color: MONEY.out.text, bg: MONEY.out.bg },
  creditSale: { label: 'Credit sale', color: MONEY.in.text, bg: MONEY.in.bg },
  creditPurchase: { label: 'Credit purchase', color: MONEY.out.text, bg: MONEY.out.bg },
  transfer: { label: 'Transfer', color: '#4338CA', bg: '#EEF2FF' },
  journal: { label: 'Journal', color: '#B45309', bg: '#FFFBEB' },
} satisfies Record<string, PillStyle>;

interface Row {
  id: string;
  group: string;
  /** The entry's day, 'YYYY-MM-DD' - the Date column; `time` goes under it. */
  date: string;
  time: string;
  details: string;
  sub: string | null;
  pill: PillStyle;
  /** The bill's own number (its invoice / bill no.); null for anything that is not a bill. */
  invoiceNo: string | null;
  discount: number | null;
  amount: number | null;
  cashIn: number | null;
  cashOut: number | null;
  /** A journal voucher's entry: shown with its amount, but no cash moved and it is left out of the totals. */
  journal?: boolean;
  onPress?: () => void;
  onDelete?: () => void;
}

function localDate(date: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(date);
}

function groupLabel(date: string): string {
  const d = localDate(date);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - day) / 86_400_000);
  const rel = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff > 1 ? `${diff} days ago` : '';
  const bs = toBsHistoryLabel(date);
  return rel ? `${rel} · ${bs}` : bs;
}

/** The local calendar day ('YYYY-MM-DD') of an entry's date - a bare date as it is, a timestamp in local time. */
function ymdOf(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The Statement: every entry in the Day Book's cash-book layout - stat tiles and
 * one bordered table (grouped by day) with totals. Its title, type tabs
 * and date Filter live in the top bar on a wide screen (no card of their
 * own); on a phone, where the bar has no room, they sit in a plain row above
 * the tiles. */
export function TransactionsBook({
  feed,
  filters,
  filter,
  onFilter,
  locked,
  title,
  onBack,
  basePath,
  categoryNameById,
  bankAccountNameById,
  accountName,
  onOpenTx,
  onDeleteTx,
  onDeleteTransfer,
}: {
  feed: FeedItem[];
  filters: { key: FilterKey; label: string }[];
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  /** Arrived for one type (Sales/Purchase/Expense) - no type tabs. */
  locked: boolean;
  title: string;
  onBack?: () => void;
  basePath?: string;
  categoryNameById: Map<string, string>;
  bankAccountNameById: Map<string, string>;
  accountName: (id: string | null) => string;
  onOpenTx: (tx: BusinessTransaction) => void;
  onDeleteTx: (tx: BusinessTransaction) => void;
  onDeleteTransfer: (transfer: AccountTransfer) => void;
}) {
  const [calendarMode] = useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);

  // The date range filters everything on the page - the table, its totals and
  // the tiles. Empty on either side means no limit there.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const setRange = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const shownFeed = useMemo(() => {
    if (!from && !to) return feed;
    return feed.filter((item) => {
      const day = ymdOf(item.date);
      return (!from || day >= from) && (!to || day <= to);
    });
  }, [feed, from, to]);

  // The top bar renders from stable options, so tapping must go through the
  // latest callbacks rather than whichever render registered them.
  const live = useRef({ onFilter, onBack });
  live.current = { onFilter, onBack };
  const showTabs = !locked;
  const hasBack = !!onBack;
  // Print and Excel: the statement as it stands (see buildReport, below).
  const reportButtons = useReportActions(() => buildReport());
  // Import: the way into the statement import (bank / wallet file -> review -> add). It sits with the
  // statement itself, on the whole Statement only - not on a Sales or Purchases list.
  const canImport = !locked && !!basePath;
  const importHref = basePath ? `${basePath}/import-statement` : null;
  const toolbar = useBookToolbar(
    {
      title,
      resetTitle: 'Statement',
      wide: layout.wide,
      // The type tabs, the date filter, Print, Excel and Import are more than a narrow bar holds.
      inBarMinWidth: 1360,
      left: hasBack ? () => <BackButton onPress={() => live.current.onBack?.()} /> : undefined,
      right: () => (
        <>
          {showTabs && <FilterTabs options={filters} value={filter} onChange={(f) => live.current.onFilter(f)} />}
          <DateFilterButton from={from} to={to} onApply={setRange} />
          {reportButtons}
          {canImport && importHref && (
            <ToolbarButton label="Import" icon="cloud-upload-outline" onPress={() => router.push(importHref as never)} />
          )}
        </>
      ),
    },
    [showTabs, hasBack, filter, filters, from, to, canImport, importHref]
  );

  const rows = useMemo<Row[]>(() => {
    const goParty = (id: string) => () => basePath && router.push(`${basePath}/customer/${id}` as never);
    return shownFeed.map((item): Row => {
      const group = groupLabel(item.date);
      if (item.kind === 'business') {
        const t = item.tx;
        const isExpense = t.type === 'expense';
        const category = t.expense_category_id ? categoryNameById.get(t.expense_category_id) : null;
        const via = t.bank_account_id ? (bankAccountNameById.get(t.bank_account_id) ?? 'Bank') : 'Cash';
        const discount = t.discount_amount ?? 0;
        return {
          id: `b-${t.id}`,
          group,
          date: ymdOf(item.date),
          time: timeOf(t.created_at),
          details: isExpense
            ? tidyName(t.party_name) || category || 'Expenses'
            : tidyName(t.party_name) || (t.type === 'sale' ? 'Sale' : 'Purchase'),
          sub:
            [
              t.bill_no ? `Bill #${t.bill_no}` : null,
              isExpense && t.party_name ? category : null,
              t.note,
              isExpense ? via : t.payment_mode === 'credit' ? 'On credit' : null,
            ]
              .filter(Boolean)
              .join(' · ') || null,
          pill: isExpense ? PILL.expense : t.type === 'sale' ? PILL.sale : PILL.purchase,
          invoiceNo: isExpense ? null : t.bill_no?.trim() || null,
          discount: isExpense ? null : discount,
          amount: isExpense ? null : t.amount,
          cashIn: null,
          cashOut: isExpense ? t.amount : null,
          onPress: () => onOpenTx(t),
          onDelete: () => onDeleteTx(t),
        };
      }
      if (item.kind === 'ledger') {
        const e = item.entry;
        const isIn = e.entry_type === 'credit';
        const manual = e.source === 'manual';
        const name = item.customerName ?? 'Unknown customer';
        const voucher = journalOf(e.note);
        return {
          id: `l-${e.id}`,
          group,
          date: ymdOf(item.date),
          time: timeOf(e.created_at),
          details: voucher
            ? `Journal voucher · ${isIn ? 'out of' : 'onto'} ${name}`
            : isIn
              ? `Received from ${name}`
              : manual
                ? `Paid to ${name}`
                : `Receivable from ${name}`,
          sub: voucher
            ? [voucher.code, voucher.narration].filter(Boolean).join(' · ') || null
            : [e.receipt_no ? `${isIn ? 'Receipt' : 'Payment'} No. ${e.receipt_no}` : null, e.note ?? (manual ? null : 'From a booked job')].filter(Boolean).join(' · ') || null,
          pill: voucher ? PILL.journal : isIn ? PILL.received : manual ? PILL.paid : PILL.creditSale,
          invoiceNo: null,
          discount: null,
          amount: voucher ? e.amount : !isIn && !manual ? e.amount : null,
          cashIn: voucher ? null : isIn ? e.amount : null,
          cashOut: voucher ? null : !isIn && manual ? e.amount : null,
          journal: !!voucher,
          onPress: goParty(e.customer_id),
        };
      }
      if (item.kind === 'vendor') {
        const e = item.entry;
        const isPayment = e.entry_type === 'credit';
        const name = item.vendorName ?? 'Unknown vendor';
        const voucher = journalOf(e.note);
        return {
          id: `v-${e.id}`,
          group,
          date: ymdOf(item.date),
          time: timeOf(e.created_at),
          details: voucher ? `Journal voucher · ${isPayment ? 'onto' : 'out of'} ${name}` : isPayment ? `Paid to ${name}` : `Bought on credit · ${name}`,
          sub: voucher
            ? [voucher.code, voucher.narration].filter(Boolean).join(' · ') || null
            : [e.receipt_no ? `Payment No. ${e.receipt_no}` : null, e.note ?? (e.source === 'booking' ? 'From a credit purchase' : null)].filter(Boolean).join(' · ') || null,
          pill: voucher ? PILL.journal : isPayment ? PILL.paid : PILL.creditPurchase,
          invoiceNo: null,
          discount: null,
          amount: voucher ? e.amount : isPayment ? null : e.amount,
          cashIn: null,
          cashOut: voucher ? null : isPayment ? e.amount : null,
          journal: !!voucher,
          onPress: goParty(e.vendor_id),
        };
      }
      const tr = item.transfer;
      return {
        id: `t-${tr.id}`,
        group,
        date: ymdOf(item.date),
        time: timeOf(tr.created_at),
        details: `${accountName(tr.from_account_id)} → ${accountName(tr.to_account_id)}`,
        sub: tr.note ?? 'Between your own accounts',
        pill: PILL.transfer,
        invoiceNo: null,
        discount: null,
        amount: tr.amount,
        cashIn: null,
        cashOut: null,
        onDelete: () => onDeleteTransfer(tr),
      };
    });
  }, [shownFeed, basePath, categoryNameById, bankAccountNameById, accountName, onOpenTx, onDeleteTx, onDeleteTransfer, calendarMode]);

  const stats = useMemo(() => {
    const sums = { sale: 0, purchase: 0, expense: 0 };
    const counts = { sale: 0, purchase: 0, expense: 0 };
    let largest = 0;
    for (const item of shownFeed) {
      if (item.kind !== 'business') continue;
      sums[item.tx.type] += item.tx.amount;
      counts[item.tx.type] += 1;
      largest = Math.max(largest, item.tx.amount);
    }
    return { sums, counts, largest };
  }, [shownFeed]);

  const totals = useMemo(
    () => ({
      // A voucher's amount is not billed or paid - it is on the line for the record only.
      amount: rows.reduce((s, r) => s + (r.journal ? 0 : r.amount ?? 0), 0),
      cashIn: rows.reduce((s, r) => s + (r.cashIn ?? 0), 0),
      cashOut: rows.reduce((s, r) => s + (r.cashOut ?? 0), 0),
    }),
    [rows]
  );

  const num = (value: number | null, color: string, bold = false) =>
    value == null ? (
      <Text className="text-[12.5px] text-gray-400">—</Text>
    ) : (
      <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }}>
        {money(value)}
      </Text>
    );

  const trash = (row: Row) =>
    row.onDelete ? (
      <Pressable onPress={row.onDelete} hitSlop={6} accessibilityLabel="Delete entry" className="opacity-50">
        <Ionicons name="trash-outline" size={15} color="#6B7280" />
      </Pressable>
    ) : null;

  const detailsCell = (row: Row, withPill: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {row.details}
      </Text>
      {withPill && <Pill text={row.pill.label} color={row.pill.color} bg={row.pill.bg} />}
      {!!row.sub && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {row.sub}
        </Text>
      )}
    </View>
  );

  // SN, then the date with its time under it, then the bill's number, then what happened.
  const snCell = (index: number) => <Text className="text-[12.5px] text-gray-500">{index + 1}</Text>;
  const dateCell = (r: Row) => (
    <View style={{ minWidth: 0 }}>
      <Text className="text-[12.5px] font-medium text-gray-800" numberOfLines={1}>
        {toBsHistoryLabel(r.date)}
      </Text>
      <Text className="text-[11px] text-gray-400">{r.time}</Text>
    </View>
  );

  const columns: BookColumn<Row>[] = layout.full
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_r, index) => snCell(index) },
        { key: 'date', label: 'Date', width: 140, render: (r) => dateCell(r) },
        {
          // The bill's own number - INV/83-84/2217 - not an amount; anything that is not a bill has none.
          key: 'invoice',
          label: 'Invoice no.',
          width: 150,
          render: (r) =>
            r.invoiceNo ? (
              <Text className="text-[12.5px] font-semibold text-gray-700" numberOfLines={1}>
                {r.invoiceNo}
              </Text>
            ) : (
              <Text className="text-[12.5px] text-gray-400">—</Text>
            ),
        },
        { key: 'details', label: 'Transaction details', render: (r) => detailsCell(r, false) },
        { key: 'type', label: 'Type', width: 116, render: (r) => <Pill text={r.pill.label} color={r.pill.color} bg={r.pill.bg} /> },
        { key: 'discount', label: 'Discount', width: 76, align: 'right', render: (r) => num(r.discount, '#4B5563') },
        { key: 'amount', label: 'Bill amount', width: 100, align: 'right', render: (r) => num(r.amount, r.pill.color) },
        { key: 'cashIn', label: 'Cash in', width: 96, align: 'right', render: (r) => num(r.cashIn, '#047857', true) },
        { key: 'cashOut', label: 'Cash out', width: 96, align: 'right', render: (r) => num(r.cashOut, '#B91C1C', true) },
        { key: 'act', label: '', width: 40, align: 'right', render: trash },
      ]
    : [
        { key: 'sn', label: 'SN', width: 34, render: (_r, index) => snCell(index) },
        {
          key: 'date',
          label: 'Date',
          width: 84,
          render: (r) => (
            <View style={{ minWidth: 0 }}>
              <Text className="text-[11.5px] font-medium text-gray-700" numberOfLines={1}>
                {shortDateLabel(r.date)}
              </Text>
              <Text className="text-[10.5px] text-gray-400">{r.time}</Text>
            </View>
          ),
        },
        { key: 'details', label: 'Transaction details', render: (r) => detailsCell(r, true) },
        {
          key: 'amount',
          label: 'Amount',
          width: 92,
          align: 'right',
          render: (r) => {
            const signed = r.cashIn != null ? `+${money(r.cashIn)}` : r.cashOut != null ? `−${money(r.cashOut)}` : money(r.amount);
            const color = r.cashIn != null ? '#047857' : r.cashOut != null ? '#B91C1C' : r.pill.color;
            return (
              <Text className="text-[12.5px] font-bold" style={{ color }}>
                {signed}
              </Text>
            );
          },
        },
        { key: 'act', label: '', width: 34, align: 'right', render: trash },
      ];

  const footerLabel = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · Totals`;
  const footerCells = layout.full
    ? {
        amount: <Text className="text-[13px] font-extrabold text-gray-900">{money(totals.amount)}</Text>,
        cashIn: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{money(totals.cashIn)}</Text>,
        cashOut: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{money(totals.cashOut)}</Text>,
      }
    : { amount: <Text className="text-[13px] font-extrabold text-gray-900">{money(totals.amount + totals.cashIn - totals.cashOut)}</Text> };

  const lockedType = locked && filter !== 'all' ? filter : null;
  const lockedTotal = lockedType ? stats.sums[lockedType] : 0;
  const lockedCount = lockedType ? stats.counts[lockedType] : 0;

  // The statement as a document: the type and period on screen, every entry with its invoice no.,
  // amounts and cash in / out, and the totals.
  function buildReport(): PrintReport {
    const cell = (v: number | null) => (v == null ? '' : money(v));
    const typeLabel = !locked && filter !== 'all' ? filters.find((f) => f.key === filter)?.label : undefined;
    const period = from || to ? `${from ? toBsHistoryLabel(from) : 'Start'} - ${to ? toBsHistoryLabel(to) : 'Today'}` : 'All dates';
    return {
      title,
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: [typeLabel, period].filter(Boolean).join(' · '),
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary: lockedType
        ? [
            { label: 'Total', value: `NPR ${money(lockedTotal)}` },
            { label: 'Entries', value: String(lockedCount) },
            { label: 'Average', value: `NPR ${money(lockedCount ? lockedTotal / lockedCount : 0)}` },
            { label: 'Largest', value: `NPR ${money(stats.largest)}` },
          ]
        : [
            { label: 'Sales', value: `NPR ${money(stats.sums.sale)}` },
            { label: 'Purchases', value: `NPR ${money(stats.sums.purchase)}` },
            { label: 'Expenses', value: `NPR ${money(stats.sums.expense)}` },
            { label: 'Entries', value: String(rows.length) },
          ],
      sections: [
        {
          columns: [
            { label: 'SN' },
            { label: 'Date' },
            { label: 'Invoice no.' },
            { label: 'Transaction details' },
            { label: 'Type' },
            { label: 'Discount', align: 'right' },
            { label: 'Bill amount', align: 'right' },
            { label: 'Cash in', align: 'right' },
            { label: 'Cash out', align: 'right' },
          ],
          rows: rows.map((r, i) => [
            String(i + 1),
            `${toBsHistoryLabel(r.date)} ${r.time}`,
            r.invoiceNo ?? '',
            [r.details, r.sub].filter(Boolean).join(' · '),
            r.pill.label,
            cell(r.discount || null),
            cell(r.amount),
            cell(r.cashIn),
            cell(r.cashOut),
          ]),
          footer: ['', '', '', `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · Totals`, '', '', money(totals.amount), money(totals.cashIn), money(totals.cashOut)],
          emptyText: from || to ? 'Nothing in this date range.' : 'Nothing in the statement yet.',
        },
      ],
    };
  }

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        {lockedType ? (
          <>
            <BookStat label="Total" value={`NPR ${money(lockedTotal)}`} color={lockedType === 'sale' ? MONEY.in.text : MONEY.out.text} />
            <BookStat label="Entries" value={String(lockedCount)} color="#374151" />
            <BookStat label="Average" value={`NPR ${money(lockedCount ? lockedTotal / lockedCount : 0)}`} color="#374151" />
            <BookStat label="Largest" value={`NPR ${money(stats.largest)}`} color="#374151" />
          </>
        ) : (
          <>
            <BookStat label="Sales" value={`NPR ${money(stats.sums.sale)}`} color={MONEY.in.text} />
            <BookStat label="Purchases" value={`NPR ${money(stats.sums.purchase)}`} color={MONEY.out.text} />
            <BookStat label="Expenses" value={`NPR ${money(stats.sums.expense)}`} color={MONEY.out.text} />
            <BookStat label="Entries" value={String(rows.length)} color="#374151" />
          </>
        )}
      </BookStats>

      {rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{from || to ? 'Nothing in this date range.' : 'Nothing in the statement yet.'}</Text>
        </View>
      ) : (
        <BookTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowPress={(r) => r.onPress?.()}
          groupOf={(r) => r.group}
          footer={{ label: footerLabel, cells: footerCells }}
        />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap an entry to open it. Sale and purchase bills show what was billed - they don't change the balance until the money is received or paid, which appears as its own Received or Paid row.
      </Text>
    </BookPage>
  );
}
