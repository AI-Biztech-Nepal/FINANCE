// lib/components/finance/TotalsReportScreen.tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery, useSupabaseRow } from '../../hooks/useSupabase';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { isStaffLedgerType, reportKindOfType, usePartyDestination } from '../../hooks/usePartyDestination';
import { isSettledOnTheSpot } from '../../hooks/useAccountBalances';
import { monthGroupLabel, shortDateLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { formatMoney, round2 } from '../../utils/money';
import { journalOf } from '../../utils/journalVoucher';
import { reportHtml, type PrintReport, type PrintSection } from '../../utils/printReport';
import { SALARY_HEADER, expenseHeading, groupExpenseNames, isSalaryName, nameKey, reportCategoryName } from '../../utils/expenseGroups';
import { ExcelButton, PrintButton, exportReportDocument, printReportDocument } from './PrintButton';
import { DateStepFilter, monthLabelOf } from './DateRangeFilter';
import { useFreshLedgerArea } from '../../hooks/useFreshLedgerArea';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { MONEY } from './moneyColors';
import { PopupCard } from './FormKit';
import { BackButton, BookPage, BookStat, BookStats, BookTable, Pill, ToolbarButton, ToolbarSearch, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { BalanceFigure, EditableDetails } from './CustomerDetailScreen';
import { TransactionDetailModal } from './TransactionsScreen';
import { tidyName } from '../../utils/nameCaps';
import type { BusinessTransaction } from '../../../types/database.types';

/** Total Received / Total Paid are money that actually moved; Sales / Purchase / Expense are the bills themselves, paid or not. */
type Kind = 'received' | 'paid' | 'sale' | 'purchase' | 'expense';

type NavTarget = { kind: 'transactions'; type: 'expense' | 'sale' | 'purchase' } | { kind: 'party'; partyId: string };

interface PillStyle {
  label: string;
  color: string;
  bg: string;
}

const PILL = {
  sale: { label: 'Sale', color: MONEY.in.text, bg: MONEY.in.bg },
  purchase: { label: 'Purchase', color: MONEY.out.text, bg: MONEY.out.bg },
  expense: { label: 'Expenses', color: MONEY.out.text, bg: MONEY.out.bg },
  paymentReceived: { label: 'Received', color: MONEY.in.text, bg: MONEY.in.bg },
  jobPayment: { label: 'Job payment', color: MONEY.in.text, bg: MONEY.in.bg },
  paymentOut: { label: 'Paid', color: MONEY.out.text, bg: MONEY.out.bg },
  paidVendor: { label: 'Paid', color: MONEY.out.text, bg: MONEY.out.bg },
  // Only on a person's own report, for the rest of their ledger (see partyLedgerRows).
  receivable: { label: 'Receivable', color: MONEY.in.text, bg: MONEY.in.bg },
  onCredit: { label: 'Bought on credit', color: MONEY.out.text, bg: MONEY.out.bg },
} satisfies Record<string, PillStyle>;

interface Entry {
  id: string;
  date: string;
  amount: number;
  /** Who it was with - a customer, vendor or the bill's party; empty if none. */
  party: string;
  note: string;
  type: PillStyle;
  nav: NavTarget;
  /** The bill itself, for a Sales / Purchase / Expense report - what a person's own report opens in place. */
  tx?: BusinessTransaction;
  /** What an expense is filed under - its category, or the ledger a payment went to. The Expense
   * Report is grouped by it (see groupExpenseNames). */
  category?: string;
  /** Who or what an expense was for - the bike or person paid, the payee on a bill. Inside a
   * heading the Expense Report shows one line for each (the payments to it are one tap away). */
  subject?: string;
  /** Money received or paid on a ledger, listed beside a Sales / Purchase report's bills. It settles
   * bills, so it is not part of what was billed (that would count a sale and its receipt twice). */
  payment?: boolean;
  /** The bill's own number, for a Sales / Purchase bill. */
  billNo?: string;
  /** The Ledger type (Vendor, Customer, Employee ...) of who it was with; '' when they have none. */
  ledgerType?: string;
  /** Where tapping it goes, when that is not the person's ledger page (see usePartyDestination). */
  href?: string;
}

const KIND_META: Record<Kind, { title: string; subtitle: string; color: string }> = {
  received: { title: 'Total Received', subtitle: 'Money actually collected, newest first', color: '#059669' },
  paid: { title: 'Total Paid', subtitle: 'Money that actually left the business, newest first', color: '#DC2626' },
  sale: { title: 'Sales Report', subtitle: 'Every sale bill, newest first', color: '#059669' },
  purchase: { title: 'Purchase Report', subtitle: 'Every purchase bill, newest first', color: '#DC2626' },
  expense: { title: 'Expenses Report', subtitle: 'Every expense you recorded, newest first', color: '#DC2626' },
};

/** An Expense heading's entries as one line for each subject (a bike, a person, a payee): what was
 * paid to it added up, how many payments, and the latest of them - biggest first. */
function subjectsOf(rows: Entry[]) {
  const bySubject = new Map<string, { key: string; name: string; total: number; latest: string; rows: Entry[] }>();
  for (const e of rows) {
    const name = (e.subject ?? e.category ?? '').trim() || 'Other';
    const key = nameKey(name);
    let subject = bySubject.get(key);
    if (!subject) {
      subject = { key, name, total: 0, latest: e.date, rows: [] };
      bySubject.set(key, subject);
    }
    subject.total += e.amount;
    subject.rows.push(e);
    if (e.date > subject.latest) subject.latest = e.date;
  }
  return [...bySubject.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The table's month rows - "Aswin 2083", or "Oct 2026" when dates are read in AD. Dates are stored
 * as AD strings ('YYYY-MM-DD' or a full timestamp). */
function bsMonthGroup(date: string): string {
  return monthGroupLabel(date.slice(0, 10));
}
/** The Date column - "Aswin 15", or "Oct 12" in AD. */
function bsShortDate(date: string): string {
  return shortDateLabel(date.slice(0, 10));
}

/** The day ('YYYY-MM-DD') an entry's date falls on: a bill's own date as it is, a timestamp as the
 * device's own day. */
function dayOf(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `partyId` scopes a Sales / Purchase / Expense report to one person, under their name card - what
 * a person opens from the Ledger list (see usePartyDestination). It lists their bills of that kind,
 * and under them the rest of what is on their ledger (payments in and out), so nothing recorded
 * for them is missing from the page. */
export function TotalsReportScreen({ kind, basePath, partyId }: { kind: Kind; basePath: string; partyId?: string }) {
  const meta = KIND_META[kind];
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);
  // The Expenses Report's individual (a person, a bike, a payee) whose payments are open in a popup:
  // the same table that is under it, on a card of its own that scrolls.
  const [subjectView, setSubjectView] = useState<{ name: string; rows: Entry[] } | null>(null);
  // Print opens the system's print preview of what is open on the page - nothing goes to the printer
  // until Print is pressed there. The top bar keeps the Print button it was last given, so it reaches
  // the current page through a ref.
  const printNow = useRef<() => void>(() => {});
  const excelNow = useRef<() => void>(() => {});
  // The person's own two ledgers, every entry (a balance is a sum over all of them) - for the
  // balance on their name card. Not read for the plain reports.
  const { data: partyCustomerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: { customer_id: partyId ?? '' },
    all: true,
    enabled: !!partyId,
  });
  const { data: partyVendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: { vendor_id: partyId ?? '' },
    all: true,
    enabled: !!partyId,
  });
  const { data: partyRow } = useSupabaseRow('customers', partyId);
  // Every bill of this report's kind, not the capped first 1000 of all bills the plain reports
  // read - a person's report must not lose a bill just because the account has grown. Matched to
  // the person in `entries` below.
  const { data: kindBills } = useSupabaseQuery('business_transactions', {
    filters: userId && partyId ? { owner_id: userId, type: kind } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId && !!partyId,
  });
  // Every row: a plain read stops at the API's first 1000, unordered, and a report that quietly
  // drops its older rows is worse than a slow one. (The ordering gives each read a cache entry of
  // its own - the key ignores `columns`, so these must not share one with a narrow read.)
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId,
  });
  const { data: allLedgerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId,
  });
  const { data: allVendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId,
  });
  // A journal voucher's halves are not money received or paid: the reports leave them out.
  const ledgerEntries = useMemo(() => (allLedgerEntries ?? []).filter((e) => !journalOf(e.note)), [allLedgerEntries]);
  const vendorEntries = useMemo(() => (allVendorEntries ?? []).filter((e) => !journalOf(e.note)), [allVendorEntries]);
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { nameById: partyTypeName } = usePartyTypes(userId);
  // Where a person opens from a report (the report for their Ledger type, else their ledger).
  const hrefFor = usePartyDestination(userId, basePath);
  // What is paid to a ledger typed Expense or Employee is an expense even though it is a payment on
  // their ledger, not through the Expense form, so the Expense Report lists it:
  //  - An Expense ledger is itself a category: its payments are filed under its name.
  //  - An Employee ledger is a person, not a category: their payments are filed under the existing
  //    category the remark names ("FUEL" -> Fuel), else Salary Expenses. The category list is never
  //    added to by a person.
  // Sales and Purchase are their bills only; what was received or paid is Total Received / Total Paid's.
  const { expenseLedgerIds, staffLedgerIds } = useMemo(() => {
    const expense = new Set<string>();
    const staff = new Set<string>();
    for (const c of customers ?? []) {
      const typeName = c.party_type_id ? partyTypeName.get(c.party_type_id) : undefined;
      if (reportKindOfType(typeName) === 'expense') expense.add(c.id);
      else if (isStaffLedgerType(typeName)) staff.add(c.id);
    }
    return { expenseLedgerIds: expense, staffLedgerIds: staff };
  }, [customers, partyTypeName]);
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);
  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);
  // Each saved customer / vendor's Ledger type (Vendor, Customer, Employee ...), by id.
  const ledgerTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers ?? []) {
      const type = c.party_type_id ? partyTypeName.get(c.party_type_id) : undefined;
      if (type) map.set(c.id, type);
    }
    return map;
  }, [customers, partyTypeName]);

  const year = new Date().getFullYear();
  const [calendarMode] = useCalendarMode();
  // The period the report covers, set with the date control beside Print. Both '' is the page's
  // resting view: this year's entries, or every date on a person's own page.
  const [range, setRange] = useState({ from: '', to: '' });
  const rangeActive = !!range.from || !!range.to;
  // The name typed in the search bar: the page narrows to the entries whose name has it.
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const restingLabel = partyId ? 'All dates' : 'This year';
  const totalLabel = partyId || rangeActive ? 'Total' : `${year} total`;
  const periodNote = rangeActive ? 'For the period picked above.' : partyId ? '' : 'This year only.';
  // The period in words, for the printed page.
  const monthName = monthLabelOf(range.from, range.to, calendarMode);
  const periodText = rangeActive
    ? monthName
      ? monthName
      : range.from && range.from === range.to
        ? toBsHistoryLabel(range.from)
        : `${range.from ? toBsHistoryLabel(range.from) : 'Start'} - ${range.to ? toBsHistoryLabel(range.to) : 'Today'}`
    : partyId
      ? 'All dates'
      : `Year ${year}`;
  const inPeriod = (date: string) => {
    const day = dayOf(date);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  };

  // A person's report is a page of its own, titled for its kind, with a way back to the list they
  // came from and to their full ledger (statement, payments, Print, Excel).
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/customers` as never);
  };
  // The person's page is titled for what they are - their Ledger type, as on their ledger page - and
  // never says "Report"; failing a type, the kind it lists (Expense, Sales, Purchase).
  const personType = partyRow?.party_type_id ? partyTypeName.get(partyRow.party_type_id) : undefined;
  const personTitle = personType || meta.title.replace(/\s*report$/i, '');
  const toolbar = useBookToolbar(
    {
      title: partyId ? personTitle : undefined,
      wide: layout.wide,
      left: layout.wide && !partyId ? undefined : () => <BackButton onPress={goBack} />,
      // The date control, Print and Excel (and Open ledger) are more than a narrow bar holds.
      inBarMinWidth: 1240,
      right: (inBar) => (
        <>
          {/* One person's own page has nobody to search for. */}
          {!partyId && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search by name" wide={inBar} />}
          <DateStepFilter
            from={range.from}
            to={range.to}
            onChange={(f, t) => setRange({ from: f, to: t })}
            idleLabel={restingLabel}
            shortcuts={[{ label: restingLabel, on: !range.from && !range.to, onSelect: () => setRange({ from: '', to: '' }) }]}
          />
          <PrintButton onPress={() => printNow.current()} />
          <ExcelButton onPress={() => excelNow.current()} />
          {partyId && (
            <ToolbarButton icon="book-outline" label="Open ledger" onPress={() => router.push(`${basePath}/customer/${partyId}` as never)} />
          )}
        </>
      ),
    },
    [partyId, basePath, range.from, range.to, restingLabel, search]
  );

  // "Received" = every payment actually collected from a customer, whether
  // logged manually (Payment In) or synced from a paid booking - NOT Sales,
  // which since 0061_sale_purchase_always_ledger.sql book a debt rather than
  // cash received. "Paid" = real cash out: Expenses, manual Payment Out to a
  // customer, and payments actually made to a vendor - a Purchase itself is
  // a debt too now, not cash spent, same as booking-sourced debit entries
  // are excluded since those represent money owed, not money that's left
  // the business yet.
  const entries = useMemo((): Entry[] => {
    // A Sales / Purchase / Expense report is just that kind of bill - every one, whether or not the
    // money has moved yet - so none of the cash rules below apply to it.
    if (kind === 'sale' || kind === 'purchase' || kind === 'expense') {
      // On a person's own report: a bill linked to them - or one not linked to anybody but made out to
      // their exact name (a payee typed in, or an expense category named for them), as those are
      // the bills their ledger would otherwise seem to be missing.
      const personName = partyRow?.name.trim().toLowerCase() ?? '';
      const named = (s: string | null | undefined) => !!personName && !!s && s.trim().toLowerCase() === personName;
      const isTheirs = (t: BusinessTransaction) =>
        t.customer_id === partyId ||
        (!t.customer_id &&
          (named(t.party_name) || (kind === 'expense' && named(t.expense_category_id ? categoryById.get(t.expense_category_id) : null))));
      const rows = (partyId ? kindBills ?? [] : transactions ?? [])
        .filter((t) => t.type === kind && (!partyId || isTheirs(t)))
        // A sale bill is only in the Sales Report once it has a bill number - until then it is
        // still a draft, listed under Completed on the Requests page.
        .filter((t) => kind !== 'sale' || !!t.bill_no?.trim())
        .map((t): Entry => {
          // The expense report shows the category (same one picked in the entry portal) in
          // place of the generic "Expense" type - the title still falls back to it when there's no party.
          // Shown under the report's own name for it (Salary Advance -> Salary Expenses).
          const savedCategory = t.expense_category_id ? categoryById.get(t.expense_category_id) : undefined;
          const category = savedCategory ? reportCategoryName(savedCategory) : undefined;
          return {
            id: t.id,
            date: t.bill_date ?? t.created_at,
            amount: t.amount,
            party: tidyName(t.party_name),
            note:
              kind === 'expense'
                ? t.note ?? ''
                : [t.bill_no ? `Bill #${t.bill_no}` : null, t.note].filter(Boolean).join(' · '),
            type: kind === 'expense' ? { label: category ?? 'Uncategorized', color: MONEY.out.text, bg: MONEY.out.bg } : PILL[kind],
            // A bill to a saved customer / vendor opens that party's ledger; a walk-in or expense has none.
            nav: t.customer_id && kind !== 'expense' ? { kind: 'party', partyId: t.customer_id } : { kind: 'transactions', type: kind },
            tx: t,
            // Expense: filed under its category. Sales / Purchase: under who it was with, which is what
            // those reports are grouped by.
            category:
              kind === 'expense'
                ? category ?? 'Uncategorized'
                : tidyName((t.customer_id ? nameById.get(t.customer_id) : undefined) || t.party_name?.trim()) || 'No party',
            subject: kind === 'expense' ? tidyName(t.party_name?.trim()) || category || 'Uncategorized' : undefined,
            billNo: t.bill_no?.trim() || '',
            ledgerType: (t.customer_id ? ledgerTypeById.get(t.customer_id) : undefined) ?? '',
          };
        });
      // An expense is often not a bill at all: money paid to a ledger typed Expense (Bike Repair, Fuel
      // ...) is recorded as a payment on that ledger. So the Expense Report - and an Expense ledger's
      // own page - lists what is on those ledgers too, filed under the ledger's name (its category):
      //   Paid (money out)                    -> an expense, added;
      //   Received (money back from them)     -> a refund, taken off: a negative row.
      // Whatever is entered from the ledger's own page is in here, so it is in the report. (The
      // copy a Sale / Purchase posts is the bill itself, listed above, so it is left out.)
      if (kind === 'expense') {
        // The categories that exist: the expense categories and the Expense ledgers' names - a
        // payment to an employee is filed under one of these when its remark names it.
        const knownCategory = new Map<string, string>();
        for (const c of categories ?? []) knownCategory.set(nameKey(c.name), c.name.trim());
        for (const id of expenseLedgerIds) {
          const name = nameById.get(id);
          if (name) knownCategory.set(nameKey(name), name.trim());
        }
        const ledgerRow = (
          e: { id: string; entry_date: string | null; created_at: string; amount: number; receipt_no: string | null; note: string | null },
          ledgerId: string,
          refund: boolean
        ): Entry => {
          const name = nameById.get(ledgerId) ?? partyRow?.name ?? 'Expense ledger';
          const tone = refund ? MONEY.in : MONEY.out;
          // An Expense ledger is its own category; an employee's payment goes under the category its
          // remark names, else Salary Expenses - so a person is never a header of their own, and
          // never lands in Uncategorized.
          const isStaff = staffLedgerIds.has(ledgerId);
          const category = reportCategoryName(isStaff ? knownCategory.get(nameKey(e.note ?? '')) ?? SALARY_HEADER : name);
          // A journal voucher is listed too (it is how an advance is moved onto what it was spent on: out
          // of Dilip's ledger, onto Fuel), as what it is - no cash, so no receipt number, but its code and
          // narration.
          const voucher = journalOf(e.note);
          return {
            id: e.id,
            date: e.entry_date ?? e.created_at,
            amount: refund ? -Number(e.amount) : Number(e.amount),
            party: voucher ? `Journal voucher · ${refund ? 'out of' : 'onto'} ${name}` : `${refund ? 'Received from' : 'Paid to'} ${name}`,
            note: voucher
              ? [voucher.code, voucher.narration].filter(Boolean).join(' · ')
              : [e.receipt_no ? `${refund ? 'Receipt' : 'Payment'} no. ${e.receipt_no}` : null, refund ? 'Refund' : null, e.note]
                  .filter(Boolean)
                  .join(' · '),
            type: { label: category, color: tone.text, bg: tone.bg },
            nav: { kind: 'party', partyId: ledgerId },
            category,
            subject: name,
            // On the ledger's own page a row goes to its ledger, where it can be edited.
            href: partyId ? `${basePath}/customer/${ledgerId}` : hrefFor(ledgerId),
          };
        };
        // Every entry, journal vouchers included (the received / paid reports leave those out - no cash).
        const customerSide = partyId ? partyCustomerEntries ?? [] : allLedgerEntries ?? [];
        const vendorSide = partyId ? partyVendorEntries ?? [] : allVendorEntries ?? [];
        const counts = (ledgerId: string) =>
          partyId ? ledgerId === partyId : expenseLedgerIds.has(ledgerId) || staffLedgerIds.has(ledgerId);
        for (const e of customerSide) {
          if (counts(e.customer_id) && e.source === 'manual') rows.push(ledgerRow(e, e.customer_id, e.entry_type === 'credit'));
        }
        for (const e of vendorSide) {
          if (counts(e.vendor_id) && e.entry_type === 'credit') rows.push(ledgerRow(e, e.vendor_id, false));
        }
      } else {
        // The Sales and Purchase reports are their bills and nothing else: what was received or paid on
        // a ledger belongs to Total Received / Total Paid, and is not listed here.
        //
        // The one exception is a person's own page, which shows everything recorded for that person:
        // their payments sit beside their bills. A person with bills of this kind has theirs listed but
        // not added (they settle those bills - a sale and its receipt would count twice); a person with
        // NO bills of this kind has had nothing else recorded, so what was received / paid is the
        // sale / purchase. The copy a bill posts to the ledger is the bill itself, so it is left out.
        if (partyId) {
          const salesSide = kind === 'sale';
          const hasBills = rows.length > 0;
          const ledgerRow = (
            e: { id: string; entry_date: string | null; created_at: string; amount: number; receipt_no: string | null; note: string | null },
            moneyIn: boolean
          ): Entry => {
            const name = partyRow?.name ?? nameById.get(partyId) ?? 'Ledger';
            return {
              id: e.id,
              date: e.entry_date ?? e.created_at,
              amount: Number(e.amount),
              party: `${moneyIn ? 'Received from' : 'Paid to'} ${name}`,
              note: [e.receipt_no ? `${moneyIn ? 'Receipt' : 'Payment'} no. ${e.receipt_no}` : null, e.note].filter(Boolean).join(' · '),
              type: moneyIn ? PILL.paymentReceived : PILL.paymentOut,
              nav: { kind: 'party', partyId },
              category: name,
              // Listed but not added up when it settles a bill of theirs.
              payment: hasBills,
              href: `${basePath}/customer/${partyId}`,
            };
          };
          for (const e of partyCustomerEntries ?? []) {
            if (e.source_type === 'business_transaction') continue;
            if (salesSide && e.entry_type === 'credit') rows.push(ledgerRow(e, true));
            // Money paid out on the customer ledger (the older way of recording a payment) is a purchase's.
            else if (!salesSide && e.entry_type === 'debit' && e.source === 'manual') rows.push(ledgerRow(e, false));
          }
          if (!salesSide) {
            for (const e of partyVendorEntries ?? []) {
              if (e.entry_type === 'credit' && e.source_type !== 'business_transaction') rows.push(ledgerRow(e, false));
            }
          }
        }
      }
      return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    const list: Entry[] = [];
    for (const t of transactions ?? []) {
      // A Sale/Purchase with no party has no ledger to settle it later (a
      // paid walk-in job, a delivered cash-on-delivery order) - its money
      // moved on the spot. Same rule as useAccountBalances.
      if (isSettledOnTheSpot(t) && (kind === 'received') === (t.type === 'sale')) {
        list.push({
          id: t.id,
          date: t.bill_date ?? t.created_at,
          amount: t.amount,
          party: tidyName(t.party_name),
          note: t.note ?? '',
          type: t.type === 'sale' ? PILL.sale : PILL.purchase,
          nav: { kind: 'transactions', type: t.type === 'sale' ? 'sale' : 'purchase' },
        });
      }
      if (kind === 'paid' && t.type === 'expense') {
        // Same as the Transactions list: the payee if there is one, else the category.
        const category = t.expense_category_id ? categoryById.get(t.expense_category_id) : undefined;
        list.push({
          id: t.id,
          date: t.bill_date ?? t.created_at,
          amount: t.amount,
          party: tidyName(t.party_name) || category || '',
          note: [t.party_name ? category : null, t.note].filter(Boolean).join(' · '),
          type: PILL.expense,
          nav: { kind: 'transactions', type: 'expense' },
        });
      }
    }
    for (const e of ledgerEntries ?? []) {
      const customerName = nameById.get(e.customer_id) ?? 'Unknown customer';
      if (kind === 'received' && e.entry_type === 'credit') {
        list.push({
          id: e.id,
          date: e.entry_date ?? e.created_at,
          amount: e.amount,
          party: customerName,
          note: e.note ?? '',
          type: e.source === 'booking' ? PILL.jobPayment : PILL.paymentReceived,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
      if (kind === 'paid' && e.entry_type === 'debit' && e.source === 'manual') {
        list.push({
          id: e.id,
          date: e.entry_date ?? e.created_at,
          amount: e.amount,
          party: customerName,
          note: e.note ?? '',
          type: PILL.paymentOut,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
    }
    if (kind === 'paid') {
      for (const e of vendorEntries ?? []) {
        if (e.entry_type === 'credit') {
          list.push({
            id: e.id,
            date: e.entry_date ?? e.created_at,
            amount: e.amount,
            party: nameById.get(e.vendor_id) ?? 'Unknown vendor',
            note: e.note ?? '',
            type: PILL.paidVendor,
            nav: { kind: 'party', partyId: e.vendor_id },
          });
        }
      }
    }
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [
    transactions,
    kindBills,
    partyRow,
    ledgerEntries,
    vendorEntries,
    allLedgerEntries,
    allVendorEntries,
    partyCustomerEntries,
    partyVendorEntries,
    nameById,
    ledgerTypeById,
    categoryById,
    categories,
    expenseLedgerIds,
    staffLedgerIds,
    hrefFor,
    basePath,
    kind,
    partyId,
  ]);

  // The rest of what is on a person's ledger - money received from or paid to them, and what they
  // owe or are owed outside a bill - listed under their bills so the page shows all of it. The
  // entry a Sale / Purchase posts is left out: it is the bill itself, listed above.
  const partyLedgerRows = useMemo((): Entry[] => {
    if (!partyId) return [];
    const rows: Entry[] = [];
    const nav: NavTarget = { kind: 'party', partyId };
    // What is already one of the report's own rows above (see `entries`) is not repeated here. What
    // is left is what has no place there: for Sales what they owe and what was paid out to them, for
    // Purchase what was received from them and what was bought on credit, for an Expense ledger what
    // they owe and what was bought on credit.
    for (const e of partyCustomerEntries ?? []) {
      if (e.source_type === 'business_transaction') continue;
      const manual = e.source === 'manual';
      const inReport =
        kind === 'expense' ? manual : kind === 'sale' ? e.entry_type === 'credit' : e.entry_type === 'debit' && manual;
      if (inReport) continue;
      rows.push({
        id: e.id,
        date: e.entry_date ?? e.created_at,
        amount: Number(e.amount),
        party: '',
        note: [e.receipt_no ? `No. ${e.receipt_no}` : null, e.note].filter(Boolean).join(' · '),
        type: e.entry_type === 'credit' ? (manual ? PILL.paymentReceived : PILL.jobPayment) : manual ? PILL.paymentOut : PILL.receivable,
        nav,
      });
    }
    for (const e of partyVendorEntries ?? []) {
      if (e.source_type === 'business_transaction') continue;
      // A payment out (credit) is one of Expense's and Purchase's own rows.
      if (e.entry_type === 'credit' && kind !== 'sale') continue;
      rows.push({
        id: e.id,
        date: e.entry_date ?? e.created_at,
        amount: Number(e.amount),
        party: '',
        note: [e.receipt_no ? `No. ${e.receipt_no}` : null, e.note].filter(Boolean).join(' · '),
        type: e.entry_type === 'credit' ? PILL.paidVendor : PILL.onCredit,
        nav,
      });
    }
    return rows.filter((e) => inPeriod(e.date)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, kind, partyCustomerEntries, partyVendorEntries, range.from, range.to]);

  // What the page shows: the period picked with the date control; with none, the plain reports are
  // this year's, and a person's own report is all of their bills - one person has few, and an old one
  // should not look like there is nothing.
  const yearEntries = useMemo(
    () => {
      const inPeriodEntries = rangeActive
        ? entries.filter((e) => inPeriod(e.date))
        : partyId
          ? entries
          : entries.filter((e) => new Date(e.date).getFullYear() === year);
      // Searched by name: who it was with, the category it is filed under, the bike / person paid.
      if (!needle || partyId) return inPeriodEntries;
      return inPeriodEntries.filter((e) =>
        [e.party, e.category, e.subject].some((v) => !!v && v.toLowerCase().includes(needle))
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, year, partyId, range.from, range.to, needle]
  );

  // The Expense Report is laid out by category - Fuel, Bike Repair, Salary Expenses ... - each with
  // what it adds up to, biggest first, and the individual ledgers / categories under it (Fuel
  // Aviator, Fuel Manish ...; the category pill on every row says which). Categories come from the
  // words the names start with, so there is nothing to set up. Every expense category and every
  // ledger typed Expense has its place, spent on this year or not, so each is there to pick from the
  // dropdown.
  //
  // Total Received and Total Paid have one heading for each name: the same name is never listed twice,
  // and everything recorded for it - every receipt or payment - is inside that one heading.
  //
  // The Sales and Purchase reports are one table of bills with no headings - the customer / vendor is
  // a column. (The groups here still total each customer / vendor, for those pages' figures.)
  const grouped = useMemo(() => {
    if (partyId) return null;
    const UNFILED = kind === 'expense' ? 'Uncategorized' : kind === 'received' || kind === 'paid' ? 'No name' : 'No party';
    // What an entry is grouped under: its category (Expense); who it was with (everything else).
    const groupName = (e: Entry) =>
      kind === 'received' || kind === 'paid' ? e.party.trim() || UNFILED : e.category ?? UNFILED;
    const names: string[] = [];
    const known = new Set<string>();
    const addName = (name: string | null | undefined) => {
      const clean = (name ?? '').trim();
      if (clean && !known.has(nameKey(clean))) {
        known.add(nameKey(clean));
        names.push(clean);
      }
    };
    for (const e of yearEntries) addName(groupName(e));
    // A search lists only what matches, so the unused categories are left out then.
    if (kind === 'expense' && !needle) {
      for (const c of categories ?? []) addName(c.name);
      // Only Expense ledgers are categories; an employee is a person and never is one.
      for (const c of customers ?? []) if (expenseLedgerIds.has(c.id)) addName(c.name);
    }

    // Expense names are merged by the words they start with; a customer or vendor is its own heading.
    const labelOf =
      kind === 'expense' ? groupExpenseNames(names) : new Map(names.map((n) => [nameKey(n), n.trim()] as const));
    // Salary, Employee and Staff advances and salary expenses are one header - Salary Expenses -
    // whatever the words they start with.
    if (kind === 'expense') {
      for (const n of names) if (isSalaryName(n)) labelOf.set(nameKey(n), SALARY_HEADER);
    }
    const groups = new Map<string, { key: string; label: string; total: number; rows: Entry[] }>();
    const groupOf = (name: string) => {
      const label = labelOf.get(nameKey(name)) ?? name.trim();
      let group = groups.get(nameKey(label));
      if (!group) {
        // An Expense heading always ends in "Expenses" (Fuel -> Fuel Expenses); the key stays the name.
        group = { key: nameKey(label), label: kind === 'expense' ? expenseHeading(label) : label, total: 0, rows: [] };
        groups.set(group.key, group);
      }
      return group;
    };
    for (const name of names) groupOf(name);
    for (const e of yearEntries) {
      const group = groupOf(groupName(e));
      // A payment that settles a bill is listed under its heading but is not added to its figure.
      if (!e.payment) group.total += e.amount;
      group.rows.push(e);
    }

    // Biggest first; the rows inside one stay newest first.
    const ordered = [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    return { groups: ordered };
  }, [kind, partyId, yearEntries, categories, customers, expenseLedgerIds, needle]);

  // Which headings are open to show their transactions. They all start closed: the headings are the
  // overview, and the log of one is a tap away instead of a scroll.
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // A heading opens in place only when there are names inside it to choose from (more than one, in the
  // Expenses Report). One with none - or a single one - is the end of the line: tapping it is the popup.
  const openableKeys = (grouped?.groups ?? [])
    .filter((g) => kind === 'expense' && subjectsOf(g.rows).length > 1)
    .map((g) => g.key);
  const allOpen = openableKeys.length > 0 && openableKeys.every((k) => openKeys.has(k));
  const shownEntries = yearEntries;
  // What the column that names who it was with is called.
  const pickWord = {
    one: kind === 'expense' ? 'Category' : kind === 'sale' ? 'Customer' : kind === 'purchase' ? 'Vendor' : 'Name',
  };

  const stats = useMemo(() => {
    const now = new Date();
    let total = 0;
    let thisMonth = 0;
    let largest = 0;
    // Money received / paid on a Sales / Purchase ledger: its own figure, apart from what was billed.
    let payments = 0;
    let paymentCount = 0;
    for (const e of shownEntries) {
      if (e.payment) {
        payments += e.amount;
        paymentCount += 1;
        continue;
      }
      total += e.amount;
      largest = Math.max(largest, e.amount);
      const d = new Date(e.date);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth += e.amount;
    }
    return { total, thisMonth, largest, payments, paymentCount };
  }, [shownEntries]);

  // Where the person stands, both of their ledgers netted - the same figure and wording as on
  // their ledger page's name card.
  const partyBalance = useMemo(() => {
    const sum = (rows: { entry_type: string; amount: number }[]) =>
      rows.reduce((s, e) => s + (e.entry_type === 'debit' ? Number(e.amount) : -Number(e.amount)), 0);
    const net = round2(sum(partyCustomerEntries ?? []) - sum(partyVendorEntries ?? []));
    const words =
      net > 0
        ? { label: 'To receive', color: MONEY.in.text }
        : net < 0
          ? { label: 'To pay', color: MONEY.out.text }
          : { label: 'Balance', color: '#374151' };
    return { ...words, value: `NPR ${formatMoney(Math.abs(net))}` };
  }, [partyCustomerEntries, partyVendorEntries]);

  const open = (e: Entry) => {
    // A bill opens in place - its items and what it is made of - rather than leaving for the ledger or
    // for a list of every bill.
    if (e.tx) {
      setViewingTx(e.tx);
      return;
    }
    router.push(
      (e.href ??
        (e.nav.kind === 'transactions' ? `${basePath}/transactions?type=${e.nav.type}` : `${basePath}/customer/${e.nav.partyId}`)) as never
    );
  };

  // --- Print and Excel: what is open on the page, as a document - Print shows it in the system's print
  // preview, Excel saves it as a spreadsheet. ---
  // Only what has been opened prints, not the whole report: the headings that are open; with
  // nothing open, the page as it stands (the headings and what each adds up to). A person's own report
  // is that person alone. `only` is one name's payments - the card open on screen - and prints alone.
  const buildReport = (only?: { name: string; rows: Entry[] }): PrintReport => {
    const dateOf = (e: Entry) => toBsHistoryLabel(e.date.slice(0, 10));
    const printRow = (e: Entry) => [
      dateOf(e),
      [e.party || e.type.label, e.note].filter(Boolean).join(' · '),
      e.type.label,
      money(e.amount),
    ];
    const printColumns = [
      { label: 'Date' },
      { label: 'Details' },
      { label: kind === 'expense' ? 'Category' : 'Type' },
      { label: 'Amount (NPR)', align: 'right' as const },
    ];
    const entryWord = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
    // A Sales / Purchase report's bills read as they do on screen: SN, date, bill no., who, their
    // ledger type, amount.
    const billLog = kind === 'sale' || kind === 'purchase';
    const billColumnsPrint = [
      { label: 'SN' },
      { label: 'Date' },
      { label: 'Bill No.' },
      { label: pickWord.one },
      { label: 'Ledger type' },
      { label: 'Amount (NPR)', align: 'right' as const },
    ];
    const billRowPrint = (e: Entry, i: number) => [
      String(i + 1),
      dateOf(e),
      e.billNo || '-',
      e.category || e.party || '-',
      e.ledgerType || '-',
      money(e.amount),
    ];
    const logSection = (heading: string, rows: Entry[], total: number): PrintSection =>
      billLog
        ? { heading, columns: billColumnsPrint, rows: rows.map(billRowPrint), footer: ['', '', '', '', 'Total', money(total)] }
        : { heading, columns: printColumns, rows: rows.map(printRow), footer: ['', '', 'Total', money(total)] };

    const sections: PrintSection[] = [];
    // True once something specific was opened: the page-wide figures would then not be about what
    // prints, so each table carries its own total instead.
    let narrowed = false;
    if (only) {
      narrowed = true;
      const onlyTotal = only.rows.reduce((sum, e) => sum + e.amount, 0);
      sections.push(logSection(`${only.name} - NPR ${money(onlyTotal)} - ${entryWord(only.rows.length)}`, only.rows, onlyTotal));
    } else if (grouped && billLog) {
      // Sales / Purchase: one table of bills, as on screen.
      sections.push({
        columns: billColumnsPrint,
        rows: shownEntries.map(billRowPrint),
        footer: ['', '', '', '', 'Total', money(stats.total)],
        emptyText: 'Nothing here yet.',
      });
    } else if (grouped) {
      const withRows = grouped.groups.filter((g) => g.rows.length > 0);
      const opened = withRows.filter((g) => openKeys.has(g.key));
      if (opened.length === 0) {
        sections.push({
          columns: [{ label: pickWord.one }, { label: 'Entries', align: 'right' }, { label: 'Amount (NPR)', align: 'right' }],
          rows: withRows.map((g) => [g.label, String(g.rows.length), money(g.total)]),
          footer: ['Total', String(shownEntries.length), money(stats.total)],
          emptyText: 'Nothing here yet.',
        });
      } else {
        narrowed = true;
        for (const g of opened) {
          const subjects = kind === 'expense' ? subjectsOf(g.rows) : [];
          if (subjects.length > 1) {
            // A heading opened as it shows on screen: one line for each bike / person.
            sections.push({
              heading: `${g.label} - NPR ${money(g.total)} - ${entryWord(g.rows.length)}`,
              columns: [
                { label: 'Name' },
                { label: 'Payments', align: 'right' },
                { label: 'Last payment' },
                { label: 'Amount (NPR)', align: 'right' },
              ],
              rows: subjects.map((x) => [x.name, String(x.rows.length), toBsHistoryLabel(x.latest.slice(0, 10)), money(x.total)]),
              footer: ['Total', String(g.rows.length), '', money(g.total)],
            });
          } else {
            sections.push(logSection(`${g.label} - NPR ${money(g.total)} - ${entryWord(g.rows.length)}`, g.rows, g.total));
          }
        }
      }
    } else {
      sections.push({
        columns: printColumns,
        rows: yearEntries.map(printRow),
        footer: ['', '', `Total (${entryWord(yearEntries.length)})`, money(stats.total)],
        emptyText: partyId ? `No ${kind} bills recorded for ${partyRow?.name ?? 'this person'}.` : 'Nothing here yet.',
      });
      if (partyId && partyLedgerRows.length > 0) {
        sections.push({
          heading: 'Payments and other ledger entries',
          columns: [{ label: 'Date' }, { label: 'Details' }, { label: 'Type' }, { label: 'Amount (NPR)', align: 'right' as const }],
          rows: partyLedgerRows.map(printRow),
        });
      }
    }

    const summary = narrowed
      ? undefined
      : [
          { label: totalLabel, value: `NPR ${money(stats.total)}` },
          { label: 'This month', value: `NPR ${money(stats.thisMonth)}` },
          { label: 'Entries', value: String(shownEntries.length) },
          { label: 'Largest', value: `NPR ${money(stats.largest)}` },
          ...(stats.paymentCount > 0
            ? [{ label: kind === 'sale' ? 'Received on bills' : 'Paid on bills', value: `NPR ${money(stats.payments)}` }]
            : []),
        ];
    const title = partyId ? `${meta.title} - ${partyRow?.name ?? ''}`.trim() : meta.title;
    return {
      title,
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: periodText,
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary,
      sections,
      note:
        kind === 'sale' || kind === 'purchase'
          ? `What was ${kind === 'sale' ? 'received' : 'paid'} on a ledger that has ${kind} bills settles them and is not added again; on one with none it counts as the ${kind}.`
          : undefined,
    };
  };
  // Print and Excel carry the same document: what is open on the page.
  printNow.current = () => void printReportDocument(reportHtml(buildReport()));
  excelNow.current = () => void exportReportDocument(buildReport());

  const amountCell = (e: Entry) => (
    <Text className="text-[12.5px] font-bold" style={{ color: meta.color }} numberOfLines={1}>
      {money(e.amount)}
    </Text>
  );
  const chevron = () => <Ionicons name="chevron-forward" size={14} color="#D1D5DB" />;

  const detailsCell = (e: Entry, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {e.party || e.type.label}
      </Text>
      {compact && <Pill text={e.type.label} color={e.type.color} bg={e.type.bg} />}
      {(!!e.note || compact) && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {[compact ? bsShortDate(e.date) : null, e.note].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );

  const columnsFor = (typeLabel: string, amount: (e: Entry) => ReactNode): BookColumn<Entry>[] =>
    layout.full
      ? [
          { key: 'date', label: 'Date', width: 104, render: (e) => <Text className="text-[12.5px] text-gray-500">{bsShortDate(e.date)}</Text> },
          { key: 'details', label: 'Details', render: (e) => detailsCell(e, false) },
          { key: 'type', label: typeLabel, width: 150, render: (e) => <Pill text={e.type.label} color={e.type.color} bg={e.type.bg} /> },
          { key: 'amount', label: 'Amount', width: 130, align: 'right', render: amount },
          { key: 'act', label: '', width: 34, align: 'right', render: chevron },
        ]
      : [
          { key: 'details', label: 'Details', render: (e) => detailsCell(e, true) },
          { key: 'amount', label: 'Amount', width: 96, align: 'right', render: amount },
          { key: 'act', label: '', width: 30, align: 'right', render: chevron },
        ];
  const columns = columnsFor(kind === 'expense' ? 'Category' : 'Type', amountCell);
  // The Sales / Purchase bills are laid out SN, date, bill no., who it was with, their Ledger type
  // and the amount.
  const ledgerTypePill = (e: Entry) =>
    e.ledgerType ? (
      <Pill text={e.ledgerType} color="#374151" bg="#F3F4F6" />
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const billColumns: BookColumn<Entry>[] = layout.full
    ? [
        { key: 'sn', label: 'SN', width: 56, render: (_e, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'date', label: 'Date', width: 140, render: (e) => <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(e.date.slice(0, 10))}</Text> },
        {
          key: 'bill',
          label: 'Bill No.',
          width: 200,
          render: (e) => (
            <Text className="text-[12.5px] font-semibold text-gray-800" numberOfLines={1}>
              {e.billNo || '—'}
            </Text>
          ),
        },
        {
          key: 'who',
          label: pickWord.one,
          render: (e) => (
            <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
              {e.category || e.party || '—'}
            </Text>
          ),
        },
        { key: 'ledger', label: 'Ledger type', width: 150, render: ledgerTypePill },
        { key: 'amount', label: 'Amount', width: 130, align: 'right', render: amountCell },
        { key: 'act', label: '', width: 34, align: 'right', render: chevron },
      ]
    : [
        { key: 'sn', label: 'SN', width: 38, render: (_e, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        {
          key: 'who',
          label: pickWord.one,
          render: (e) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
                {e.category || e.party || '—'}
              </Text>
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                {[toBsHistoryLabel(e.date.slice(0, 10)), e.billNo ? `Bill ${e.billNo}` : null, e.ledgerType || null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ),
        },
        { key: 'amount', label: 'Amount', width: 96, align: 'right', render: amountCell },
        { key: 'act', label: '', width: 30, align: 'right', render: chevron },
      ];
  // A payment's colour is its own direction (green in, red out), not the report's.
  const ledgerColumns = columnsFor('Type', (e) => (
    <Text className="text-[12.5px] font-bold" style={{ color: e.type.color }} numberOfLines={1}>
      {money(e.amount)}
    </Text>
  ));

  return (
    <>
    <BookPage wide={layout.wide}>
      {toolbar}

      {partyId && (
        <EditableDetails
          customerId={partyId}
          basePath={basePath}
          summary={<BalanceFigure label={partyBalance.label} value={partyBalance.value} color={partyBalance.color} />}
        />
      )}

      <BookStats>
        <BookStat label={totalLabel} value={`NPR ${money(stats.total)}`} color={meta.color} />
        <BookStat label="This month" value={`NPR ${money(stats.thisMonth)}`} color="#374151" />
        <BookStat label="Entries" value={String(shownEntries.length)} color="#374151" />
        <BookStat label="Largest" value={`NPR ${money(stats.largest)}`} color="#374151" />
        {stats.paymentCount > 0 && (
          <BookStat label={kind === 'sale' ? 'Received on bills' : 'Paid on bills'} value={`NPR ${money(stats.payments)}`} color={meta.color} />
        )}
      </BookStats>

      {grouped !== null && kind !== 'sale' && kind !== 'purchase' && openableKeys.length > 1 && (
        <View className="flex-row items-center justify-end px-1">
          <Pressable
            onPress={() => setOpenKeys(allOpen ? new Set() : new Set(openableKeys))}
            accessibilityRole="button"
            hitSlop={6}
          >
            <Text className="text-[12.5px] font-semibold text-blue-700">{allOpen ? 'Close all' : 'Open all'}</Text>
          </Pressable>
        </View>
      )}

      {shownEntries.length === 0 && !(grouped !== null && kind !== 'sale' && kind !== 'purchase' && grouped.groups.length > 0) ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">
            {needle
              ? `No name matches "${search.trim()}".`
              : rangeActive
              ? 'Nothing recorded in this period.'
              : partyId
                ? `No ${kind} bills recorded for ${partyRow?.name ?? 'this person'}.`
                : 'Nothing here yet.'}
          </Text>
        </View>
      ) : grouped !== null && kind !== 'sale' && kind !== 'purchase' ? (
        // Expenses / Total Received / Total Paid: every heading, each a card - its name, how many entries
        // and what they add up to. A heading with names inside it opens to show them, and a name's payments
        // are a popup; one with none is itself the popup. A name appears once however many entries it has.
        <View style={{ gap: 10 }}>
          {grouped.groups.map((g) => {
            const empty = g.rows.length === 0;
            // Expenses: inside a heading each bike / person is one line, the payments to it added up. With
            // more than one of them the heading has children - a tap opens them, and a child's payments
            // are the popup. With one or none (Total Received / Paid) it has no child: a tap is the popup.
            const subjects = kind === 'expense' ? subjectsOf(g.rows) : [];
            const hasChildren = subjects.length > 1;
            const isOpen = !empty && hasChildren && openKeys.has(g.key);
            return (
              <View key={g.key} className="overflow-hidden rounded-xl border border-gray-300 bg-white">
                <Pressable
                  onPress={() => (hasChildren ? toggleGroup(g.key) : setSubjectView({ name: g.label, rows: g.rows }))}
                  disabled={empty}
                  accessibilityRole="button"
                  accessibilityState={hasChildren ? { expanded: isOpen } : undefined}
                  className="flex-row items-center px-3.5 py-3"
                  style={{ gap: 10, backgroundColor: isOpen ? '#F9FAFB' : '#FFFFFF' }}
                >
                  <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={empty ? '#D1D5DB' : '#6B7280'} />
                  <Text className={`flex-1 text-[14px] font-bold ${empty ? 'text-gray-400' : 'text-gray-900'}`} numberOfLines={1}>
                    {g.label}
                  </Text>
                  <Text className="text-[12px] text-gray-400">
                    {empty ? 'No entries' : `${g.rows.length} ${g.rows.length === 1 ? 'entry' : 'entries'}`}
                  </Text>
                  <Text className="text-right text-[14px] font-extrabold" style={{ minWidth: 84, color: empty ? '#D1D5DB' : meta.color }}>
                    {money(g.total)}
                  </Text>
                </Pressable>
                {isOpen && (
                  <View className="border-t border-gray-200">
                    {subjects.map((s, i) => {
                      const single = s.rows.length === 1;
                      return (
                        <View key={s.key} className={i > 0 ? 'border-t border-gray-100' : ''}>
                          {/* One payment opens as it is; several open on a card of their own - the same table, scrollable. */}
                          <Pressable
                            onPress={() => (single ? open(s.rows[0]) : setSubjectView({ name: s.name, rows: s.rows }))}
                            accessibilityRole="button"
                            className="flex-row items-center py-2.5 pl-9 pr-3.5"
                            style={{ gap: 10, backgroundColor: '#FFFFFF' }}
                          >
                            <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
                            <Text className="flex-1 text-[13px] font-semibold text-gray-900" numberOfLines={1}>
                              {s.name}
                            </Text>
                            <Text className="text-[11.5px] text-gray-400">
                              {single ? bsShortDate(s.latest) : `${s.rows.length} payments · last ${bsShortDate(s.latest)}`}
                            </Text>
                            <Text className="text-right text-[13px] font-bold" style={{ minWidth: 84, color: meta.color }}>
                              {money(s.total)}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
          <View className="flex-row items-center justify-end px-1" style={{ gap: 10 }}>
            <Text className="text-[12.5px] font-bold text-gray-600">
              {`${shownEntries.length} ${shownEntries.length === 1 ? 'entry' : 'entries'} · Total`}
            </Text>
            <Text className="text-[14px] font-extrabold" style={{ color: meta.color }}>
              {money(stats.total)}
            </Text>
          </View>
        </View>
      ) : (
        // Everything else is one table. Sales / Purchase: the bills, with no headings in between -
        // the customer / vendor is a column - newest first. The other pages keep their month rows.
        <BookTable
          columns={grouped !== null ? billColumns : columns}
          rows={shownEntries}
          rowKey={(e) => e.id}
          onRowPress={open}
          groupOf={grouped !== null ? undefined : (e) => bsMonthGroup(e.date)}
          footer={{
            label: `${shownEntries.length} ${shownEntries.length === 1 ? 'entry' : 'entries'} · Total`,
            cells: { amount: <Text className="text-[13px] font-extrabold" style={{ color: meta.color }}>{money(stats.total)}</Text> },
          }}
        />
      )}

      {partyId && partyLedgerRows.length > 0 && (
        <>
          <Text className="px-1 pt-1 text-[13px] font-bold text-gray-700">
            Payments and other ledger entries ({partyLedgerRows.length})
          </Text>
          <BookTable
            columns={ledgerColumns}
            rows={partyLedgerRows}
            rowKey={(e) => e.id}
            onRowPress={open}
            groupOf={(e) => bsMonthGroup(e.date)}
          />
        </>
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        {partyId
          ? kind === 'expense'
            ? 'Tap a bill to open it; tap a payment to open this ledger, where it can be edited. Money paid to this ledger counts as an expense, and money received back is taken off. The balance above counts every entry of both ledgers.'
            : `Tap a bill to open it; tap a ${kind === 'sale' ? 'receipt' : 'payment'} to open their ledger, where it can be edited. What was ${kind === 'sale' ? 'received' : 'paid'} is listed with the bills. With bills recorded it settles them and is not added again (a bill and its payment would count twice); with none, it is the ${kind === 'sale' ? 'sale' : 'purchase'} and counts. The balance above counts every entry of both ledgers.`
          : kind === 'received'
            ? `Each name is listed once - tap it to see everything recorded for it. Only money actually collected counts here - a sale bill on credit shows up once the customer pays. ${periodNote}`
            : kind === 'paid'
              ? `Each name is listed once - tap it to see everything recorded for it. Only money that actually left counts here - a purchase bill on credit shows up once you pay the vendor. ${periodNote}`
              : kind === 'expense'
                ? `Each heading is a category - names that start with the same words (Fuel Aviator, Fuel Manish) sit under one. Tap a heading to open the names inside it, and a name to see its payments. Tap a payment to open it. Counts every expense bill, and money paid to a ledger typed Expense or Employee (listed under that ledger's name). ${periodNote}`
                : `Tap a bill to open it with its items. Every ${kind} bill counts here, whether or not the money has moved yet - what was ${kind === 'sale' ? 'received' : 'paid'} is in Total ${kind === 'sale' ? 'Received' : 'Paid'}. ${periodNote}`}
      </Text>
    </BookPage>
    {subjectView && (
      // The individual's payments - the same table the dropdown used to show; Print and Excel for it are in the blue bar.
      <PopupCard
        title={subjectView.name}
        onClose={() => setSubjectView(null)}
        maxWidth={920}
        closeOnOutside
        headerRight={
          <>
            <PrintButton onPress={() => void printReportDocument(reportHtml(buildReport(subjectView)))} />
            <ExcelButton onPress={() => void exportReportDocument(buildReport(subjectView))} />
          </>
        }
      >
        <BookTable
          stickyHeader
          columns={columns}
          rows={subjectView.rows}
          rowKey={(e) => e.id}
          onRowPress={(e) => {
            // A bill opens as a bill on top of this card; a payment goes to its ledger, so this card goes.
            if (e.tx) {
              setViewingTx(e.tx);
              return;
            }
            setSubjectView(null);
            open(e);
          }}
        />
      </PopupCard>
    )}
    <TransactionDetailModal
      tx={viewingTx}
      categoryName={viewingTx?.expense_category_id ? categoryById.get(viewingTx.expense_category_id) ?? null : null}
      bankAccountName={null}
      onClose={() => setViewingTx(null)}
      onEdit={() => {
        if (viewingTx) router.push(`${basePath}/transactions?type=${viewingTx.type}&add=1&edit=${viewingTx.id}` as never);
        setViewingTx(null);
      }}
      editOnPage
    />
    </>
  );
}

/** A person's own Sales / Purchase / Expense report: what a person with that Ledger type opens
 * from the Ledger list (see usePartyDestination). Its own route rather than a parameter on the
 * plain reports, because tab screens stay mounted - a filter left on one would still be there the
 * next time the plain report was opened from the side panel. */
export function PartyReportScreen({ basePath }: { basePath: string }) {
  const { id, kind } = useLocalSearchParams<{ id: string; kind: string }>();
  const visit = useFreshLedgerArea();
  if (!id || (kind !== 'sale' && kind !== 'purchase' && kind !== 'expense')) {
    return <Redirect href={`${basePath}/customers` as never} />;
  }
  // Keyed, so another person's report starts from its own state - and a visit that has ended from nothing.
  return <TotalsReportScreen key={`${id}-${kind}-${visit}`} kind={kind} basePath={basePath} partyId={id} />;
}
