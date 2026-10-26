// lib/components/finance/PartyBalancesScreen.tsx
import { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { BackButton, BookPage, BookStat, BookStats, BookTable, Pill, ToolbarSearch, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { usePartyDestination } from '../../hooks/usePartyDestination';
import { useYearCashTotals } from '../../hooks/useYearCashTotals';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { nameCaps } from '../../utils/nameCaps';
import { shortDateLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { entryDay } from '../../utils/ledgerStatement';
import { reportHtml, type PrintReport, type PrintSection } from '../../utils/printReport';
import { MONEY } from './moneyColors';
import { journalOf } from '../../utils/journalVoucher';
import { itemNamesOf, sellsVehicles } from '../../utils/accountFeatures';
import { PopupCard } from './FormKit';
import { ExcelButton, PrintButton, exportReportDocument, printReportDocument } from './PrintButton';

type Direction = 'receive' | 'give';

/** One entry on a ledger, as a line of the log inside its heading. `signed` is what it does to the
 * balance: what was billed adds to it, a payment takes from it - so the lines add up to the heading. */
interface LogEntry {
  id: string;
  /** 'YYYY-MM-DD' */
  day: string;
  createdAt: string;
  detail: string;
  label: string;
  color: string;
  bg: string;
  signed: number;
}

/** One heading: a customer who owes you / a vendor you owe, what they come to, and the entries behind it. */
interface Heading {
  partyId: string;
  name: string;
  /** The Ledger type they carry (Customer, Vendor ...); '' when they have none. */
  ledgerType: string;
  balance: number;
  entries: LogEntry[];
}

// Matches the dashboard's To Receive/To Give tiles (emerald-700 / red-600) so
// opening either one reads as the same figure, just expanded into a report.
const META: Record<
  Direction,
  {
    title: string;
    color: string;
    icon: keyof typeof Ionicons.glyphMap;
    who: string;
    empty: string;
    /** The second tile: money that actually moved this year, opening its full report. */
    cashLabel: string;
    cashPath: string;
    note: string;
  }
> = {
  receive: {
    title: 'Receivable',
    color: '#047857',
    icon: 'people-outline',
    who: 'Customer',
    empty: 'No customer owes you anything right now.',
    cashLabel: 'Total received',
    cashPath: '/received',
    note: 'Each heading is a customer who owes you: everything billed to their ledger, less what they have paid. Tap a heading to see the entries behind it.',
  },
  give: {
    title: 'Payable',
    color: '#DC2626',
    icon: 'cart-outline',
    who: 'Vendor',
    empty: "You don't owe any vendor right now.",
    cashLabel: 'Total paid',
    cashPath: '/paid',
    note: 'Each heading is a vendor you owe: everything they billed you, less what you have paid. Tap a heading to see the entries behind it.',
  },
};

const BILLED = { label: 'Billed', color: MONEY.in.text, bg: MONEY.in.bg };
const PAID_OUT = { label: 'Paid out', color: MONEY.out.text, bg: MONEY.out.bg };
const RECEIVED = { label: 'Received', color: MONEY.in.text, bg: MONEY.in.bg };
const PAID = { label: 'Paid', color: MONEY.out.text, bg: MONEY.out.bg };
const JOURNAL = { label: 'Journal voucher', color: '#B45309', bg: '#FFFBEB' };

/** Detail view behind the dashboard's To Receive / To Give tiles - who
 * specifically makes up that total, so it isn't just one opaque number.
 * Reads customer_ledger_entries for "receive" (customers who owe the
 * business) or vendor_ledger_entries for "give" (vendors the business
 * owes) - opposite tables with opposite polarity, see 0059_vendor_ledger.sql.
 *
 * Laid out as the Expenses report is: the figures in tiles, then one heading for each customer /
 * vendor with what they come to - tap it to open the log of entries inside it. */
export function PartyBalancesScreen({ basePath, direction }: { basePath: string; direction: Direction }) {
  const meta = META[direction];
  const layout = useBookLayout();
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  // `all`: balances are sums over every entry; a plain read stops at 1000 rows.
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId && direction === 'receive',
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId && direction === 'give',
  });
  // A vehicle account's entries that a bill posted read with the item (car) on the bill in place of its remark.
  const showItems = sellsVehicles(profile?.business_name?.trim() || profile?.full_name);
  const { data: itemBills } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    columns: 'id,items',
    all: true,
    enabled: !!userId && showItems,
  });
  const { nameById: partyTypeName } = usePartyTypes(userId);
  // Where a heading's ledger opens: the report for their Ledger type, else their ledger.
  const hrefFor = usePartyDestination(userId, basePath);

  const personById = useMemo(() => {
    const map = new Map<string, { name: string; ledgerType: string }>();
    for (const c of customers ?? []) {
      map.set(c.id, { name: c.name, ledgerType: (c.party_type_id && partyTypeName.get(c.party_type_id)) || '' });
    }
    return map;
  }, [customers, partyTypeName]);

  const headings = useMemo((): Heading[] => {
    const perParty = new Map<string, LogEntry[]>();
    const add = (partyId: string, entry: LogEntry) => {
      const list = perParty.get(partyId);
      if (list) list.push(entry);
      else perParty.set(partyId, [entry]);
    };
    const detailOf = (receiptNo: string | null, note: string | null, fallback: string) =>
      [receiptNo ? `No. ${receiptNo}` : null, note].filter(Boolean).join(' · ') || fallback;
    const itemsByBill = new Map((itemBills ?? []).map((b) => [b.id, b.items]));
    const noteOf = (e: { source: string; source_type: string | null; source_id: string | null; note: string | null }) =>
      showItems && e.source === 'booking' && e.source_type === 'business_transaction' && e.source_id
        ? itemNamesOf(itemsByBill.get(e.source_id)) || e.note
        : e.note;

    if (direction === 'receive') {
      for (const e of customerEntries ?? []) {
        const credit = e.entry_type === 'credit';
        // A debit made by hand is money given to the customer; one from a booking or bill is what they were billed.
        const voucher = journalOf(e.note);
        const kind = voucher ? JOURNAL : credit ? RECEIVED : e.source === 'manual' ? PAID_OUT : BILLED;
        add(e.customer_id, {
          id: e.id,
          day: entryDay(e.entry_date, e.created_at),
          createdAt: e.created_at,
          detail: voucher ? [voucher.code, voucher.narration].filter(Boolean).join(' · ') : detailOf(e.receipt_no, noteOf(e), kind.label),
          ...kind,
          signed: credit ? -Number(e.amount) : Number(e.amount),
        });
      }
    } else {
      for (const e of vendorEntries ?? []) {
        const credit = e.entry_type === 'credit';
        const voucher = journalOf(e.note);
        const kind = voucher ? JOURNAL : credit ? PAID : BILLED;
        add(e.vendor_id, {
          id: e.id,
          day: entryDay(e.entry_date, e.created_at),
          createdAt: e.created_at,
          detail: voucher ? [voucher.code, voucher.narration].filter(Boolean).join(' · ') : detailOf(e.receipt_no, noteOf(e), kind.label),
          ...kind,
          signed: credit ? -Number(e.amount) : Number(e.amount),
        });
      }
    }
    const out: Heading[] = [];
    for (const [partyId, entries] of perParty) {
      const balance = entries.reduce((sum, e) => sum + e.signed, 0);
      if (balance <= 0) continue;
      const person = personById.get(partyId);
      // Newest first, as the other reports' logs run.
      entries.sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt));
      out.push({ partyId, name: person?.name ?? 'Unknown', ledgerType: person?.ledgerType ?? '', balance, entries });
    }
    return out.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }, [direction, customerEntries, vendorEntries, personById, itemBills, showItems]);

  // The name typed in the search bar narrows the headings, the tiles and what prints.
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? headings.filter((h) => h.name.toLowerCase().includes(needle)) : headings),
    [headings, needle]
  );
  const shownTotal = shown.reduce((sum, h) => sum + h.balance, 0);
  const largest = shown.reduce((max, h) => Math.max(max, h.balance), 0);
  const cash = useYearCashTotals(userId);
  const cashTotal = direction === 'receive' ? cash.received : cash.paid;

  // The heading whose entries are open in a popup. A heading has nothing inside it to choose from, so
  // a tap on it is the popup - the log of entries behind its figure, scrollable.
  const [view, setView] = useState<Heading | null>(null);

  const entryWord = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

  // Print and Excel carry the page - the headings and what each comes to - or, from inside the popup,
  // that one heading's entries alone (`only`).
  const buildReport = (only?: Heading): PrintReport => {
    const opened = only ? [only] : [];
    const sections: PrintSection[] =
      opened.length === 0
        ? [
            {
              columns: [
                { label: 'SN' },
                { label: meta.who },
                { label: 'Ledger type' },
                { label: 'Entries', align: 'right' },
                { label: 'Balance (NPR)', align: 'right' },
              ],
              rows: shown.map((h, i) => [String(i + 1), nameCaps(h.name), h.ledgerType || '—', String(h.entries.length), money(h.balance)]),
              footer: ['', 'Total', '', String(shown.reduce((n, h) => n + h.entries.length, 0)), money(shownTotal)],
              emptyText: meta.empty,
            },
          ]
        : opened.map((h) => ({
            heading: `${nameCaps(h.name)} - NPR ${money(h.balance)} - ${entryWord(h.entries.length)}`,
            columns: [{ label: 'Date' }, { label: 'Details' }, { label: 'Type' }, { label: 'Amount (NPR)', align: 'right' as const }],
            rows: h.entries.map((e) => [
              toBsHistoryLabel(e.day),
              e.detail,
              e.label,
              `${e.signed < 0 ? '-' : '+'}${money(Math.abs(e.signed))}`,
            ]),
            footer: ['', '', 'Balance', money(h.balance)],
          }));
    return {
      title: `${meta.title} Report`,
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: direction === 'receive' ? 'Customers who owe you money' : 'Vendors you owe money to',
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary:
        opened.length === 0
          ? [
              { label: meta.title, value: `NPR ${money(shownTotal)}` },
              { label: `${meta.cashLabel} (this year)`, value: `NPR ${money(cashTotal)}` },
              { label: `${meta.who}s`, value: String(shown.length) },
            ]
          : undefined,
      sections,
    };
  };
  // The bar keeps the button it was given, so it reaches the current page through a ref.
  const printNow = useRef<() => void>(() => {});
  printNow.current = () => void printReportDocument(reportHtml(buildReport()));
  const excelNow = useRef<() => void>(() => {});
  excelNow.current = () => void exportReportDocument(buildReport());

  // The name is in the top bar already (and the back button on a phone), with the search and Print.
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: (inBar) => (
        <>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search by name" wide={inBar} />
          <PrintButton onPress={() => printNow.current()} />
          <ExcelButton onPress={() => excelNow.current()} />
        </>
      ),
    },
    [search]
  );

  const openLedger = (partyId: string) => router.push(hrefFor(partyId) as never);
  const signed = (e: LogEntry) => (
    <Text className="text-[12.5px] font-bold" style={{ color: e.signed < 0 ? '#6B7280' : meta.color }} numberOfLines={1}>
      {e.signed < 0 ? '−' : '+'}
      {money(Math.abs(e.signed))}
    </Text>
  );
  const logColumns: BookColumn<LogEntry>[] = layout.full
    ? [
        { key: 'date', label: 'Date', width: 140, render: (e) => <Text className="text-[12.5px] text-gray-500">{toBsHistoryLabel(e.day)}</Text> },
        {
          key: 'details',
          label: 'Details',
          render: (e) => (
            <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
              {e.detail}
            </Text>
          ),
        },
        { key: 'type', label: 'Type', width: 130, render: (e) => <Pill text={e.label} color={e.color} bg={e.bg} /> },
        { key: 'amount', label: 'Amount', width: 120, align: 'right', render: signed },
      ]
    : [
        {
          key: 'details',
          label: 'Details',
          render: (e) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
                {e.detail}
              </Text>
              <Pill text={e.label} color={e.color} bg={e.bg} />
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                {shortDateLabel(e.day)}
              </Text>
            </View>
          ),
        },
        { key: 'amount', label: 'Amount', width: 96, align: 'right', render: signed },
      ];

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label={meta.title} value={`NPR ${money(shownTotal)}`} color={meta.color} />
        <BookStat
          label={`${meta.cashLabel} · This year`}
          value={`NPR ${money(cashTotal)}`}
          color={meta.color}
          onPress={() => router.push(`${basePath}${meta.cashPath}` as never)}
        />
        <BookStat label={`${meta.who}s`} value={String(shown.length)} color="#374151" />
        <BookStat label="Largest" value={`NPR ${money(largest)}`} color="#374151" />
      </BookStats>

      {shown.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name={meta.icon} size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{needle ? `No name matches "${search.trim()}".` : meta.empty}</Text>
        </View>
      ) : (
        // Every heading, each a card - the name, how many entries and what they add up to. Tap one to
        // open the log of entries inside it.
        <View style={{ gap: 10 }}>
          {shown.map((h) => (
            <View key={h.partyId} className="overflow-hidden rounded-xl border border-gray-300 bg-white">
              <Pressable
                onPress={() => setView(h)}
                accessibilityRole="button"
                className="flex-row items-center px-3.5 py-3"
                style={{ gap: 10, backgroundColor: '#FFFFFF' }}
              >
                <Ionicons name="chevron-forward" size={16} color="#6B7280" />
                <Text className="flex-1 text-[14px] font-bold text-gray-900" numberOfLines={1}>
                  {nameCaps(h.name)}
                </Text>
                <Text className="text-[12px] text-gray-400">
                  {[h.ledgerType || null, entryWord(h.entries.length)].filter(Boolean).join(' · ')}
                </Text>
                <Text className="text-right text-[14px] font-extrabold" style={{ minWidth: 84, color: meta.color }}>
                  {money(h.balance)}
                </Text>
              </Pressable>
            </View>
          ))}
          <View className="flex-row items-center justify-end px-1" style={{ gap: 10 }}>
            <Text className="text-[12.5px] font-bold text-gray-600">
              {`${shown.length} ${shown.length === 1 ? meta.who.toLowerCase() : `${meta.who.toLowerCase()}s`} · Total`}
            </Text>
            <Text className="text-[14px] font-extrabold" style={{ color: meta.color }}>
              {money(shownTotal)}
            </Text>
          </View>
        </View>
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">{meta.note}</Text>

      {view && (
        // The heading's entries - the same log it used to open inline; Print and Excel for it alone are in the blue bar.
        <PopupCard
          title={nameCaps(view.name)}
          onClose={() => setView(null)}
          maxWidth={920}
          closeOnOutside
          headerRight={
            <>
              <PrintButton onPress={() => void printReportDocument(reportHtml(buildReport(view)))} />
              <ExcelButton onPress={() => void exportReportDocument(buildReport(view))} />
            </>
          }
        >
          <BookTable
            stickyHeader
            columns={logColumns}
            rows={view.entries}
            rowKey={(e) => e.id}
            onRowPress={() => {
              // An entry is edited on the ledger, so the card goes with the tap.
              const id = view.partyId;
              setView(null);
              openLedger(id);
            }}
          />
        </PopupCard>
      )}
    </BookPage>
  );
}
