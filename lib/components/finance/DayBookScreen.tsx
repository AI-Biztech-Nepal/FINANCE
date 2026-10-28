// lib/components/finance/DayBookScreen.tsx
import { Fragment, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery, useSupabaseInsert, useSupabaseUpdate, useSupabaseDelete } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { useAccountBalances } from '../../hooks/useAccountBalances';
import { DateField } from '../DateTimeFields';
import { FormSection } from './FormSection';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { ContactPickerModal } from '../ContactPickerModal';
import { useWideDetail } from '../detail/DetailLayout';
import { dateLabels, useCalendarMode } from '../../hooks/useCalendarMode';
import { shortDateLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { formatMoney, round2 } from '../../utils/money';
import { DateFilterButton, DayStepButton } from './DateRangeFilter';
import { BookTable, useBookToolbar, type BookColumn } from './BookKit';
import { MONEY } from './moneyColors';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { ENTRY_KINDS } from './entryKinds';
import { useReportActions } from './PrintButton';
import type { PrintReport } from '../../utils/printReport';
import { TransactionDetailModal } from './TransactionsScreen';
import { TransferForm } from './BankBalancesScreen';
import { Field, FieldRow, FormActions, PopupCard } from './FormKit';
import { journalOf } from '../../utils/journalVoucher';
import { supabase } from '../../supabase';
import { tidyName } from '../../utils/nameCaps';
import { itemNamesOf, sellsVehicles } from '../../utils/accountFeatures';
import type { BusinessTransaction } from '../../../types/database.types';
import { decimalInput } from '../../utils/number';

type Kind = 'opening' | 'received' | 'paid' | 'expense' | 'sale' | 'purchase' | 'transfer' | 'journal';

/** Where money sits: 'cash' for cash in hand, otherwise a bank_accounts id
 * (eSewa, Khalti, a bank...). */
type AccountKey = string;
const CASH: AccountKey = 'cash';
type AccountOption = { key: AccountKey; name: string };

/** One movement of money into or out of one account. A transfer has two (out
 * of one account, into the other); a sale or purchase bill has none. */
type Move = { account: AccountKey; amount: number; dir: 'in' | 'out' };

type BookRow = {
  id: string;
  kind: Kind;
  /** The day the entry sits on (YYYY-MM-DD); empty for the opening line. */
  date: string;
  time: string;
  details: string;
  sub: string | null;
  /** The bill's own number (its invoice / bill no.); null for anything that is not a bill. */
  invoiceNo: string | null;
  discount: number | null;
  /** Bill total (sale/purchase) or amount moved (transfer) - not cash. */
  amount: number | null;
  cashIn: number | null;
  cashOut: number | null;
  /** Running cash + bank balance after this row; null for non-cash rows. */
  balance: number | null;
  /** A vehicle account: what the vehicle this entry is about was bought for (its purchase bill), when known. */
  purchasePrice: number | null;
  /** Name of the account the money went through, for the row's tag. */
  account: string | null;
  /** The same movement per account, so one account can be viewed on its own. */
  moves: Move[];
  sortKey: string;
  /** The sale / purchase / expense bill behind this row: tapping it opens it in a popup, edit and all. */
  bill?: BusinessTransaction;
  /** What this row actually is in the database, so it can be edited here. */
  edit?: EditTarget;
  /** A journal voucher: the two ledger entries behind this one line (nothing moved through an account). */
  journal?: { entries: { table: 'customer_ledger_entries' | 'vendor_ledger_entries' | 'business_transactions'; id: string }[] };
};

type EditTable = 'customer_ledger_entries' | 'vendor_ledger_entries' | 'account_transfers';

type EditValues = {
  date: string;
  amount: string;
  party: string;
  billNo: string;
  discount: string;
  receiptNo: string;
  note: string;
  /** null means cash, like the Payment In form's method picker. */
  bankAccountId: string | null;
  /** The customer / vendor the entry sits on - changeable when it was put on the wrong one. */
  partyId: string | null;
  /** credit = Received, debit = Payment Out (customer entries only). */
  entryType: 'credit' | 'debit';
};

type EditTarget = {
  table: EditTable;
  id: string;
  title: string;
  /** Set when the entry belongs to something else (a job's payment, say) -
   * it is then shown read-only, since a change here would just be
   * overwritten by whatever created it. */
  lockedReason?: string;
  /** Which fields this kind of entry has. `reassign` lets its customer / vendor be changed;
   * `direction` lets a customer entry be switched between Received and Payment Out. */
  fields: { party?: boolean; billNo?: boolean; discount?: boolean; receiptNo?: boolean; method?: boolean; reassign?: boolean; direction?: boolean };
  /** Heading for the name section - "Customer", "Vendor", "Paid to"... */
  partyLabel?: string;
  /** Name to show when it isn't typed here but on the customer's own record. */
  subtitleParty?: string;
  /** Wording for the numbered field, as Payment In words it. */
  numberLabel?: string;
  values: EditValues;
};

const KIND: Record<Kind, { label: string; color: string; bg: string }> = {
  opening: { label: 'Opening', color: '#374151', bg: '#F3F4F6' },
  received: { label: 'Received', color: '#047857', bg: '#ECFDF5' },
  paid: { label: 'Paid', color: '#B91C1C', bg: '#FEF2F2' },
  expense: { label: 'Expenses', color: '#B91C1C', bg: '#FEF2F2' },
  sale: { label: 'Sale bill', color: MONEY.in.text, bg: MONEY.in.bg },
  purchase: { label: 'Purchase bill', color: MONEY.out.text, bg: MONEY.out.bg },
  transfer: { label: 'Contra', color: '#4338CA', bg: '#EEF2FF' },
  journal: { label: 'Journal', color: '#B45309', bg: '#FFFBEB' },
};

/** Local calendar day of a timestamp, as YYYY-MM-DD - going through
 * toISOString would use UTC and shift late-evening Nepal entries a day. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' moved by whole days (negative = earlier), in the device's own time zone. */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const moved = new Date(y, m - 1, d + delta);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(moved.getDate()).padStart(2, '0')}`;
}

function money(n: number | null | undefined): string {
  return n == null ? '—' : formatMoney(n);
}

function amountText(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

// Full-table column widths; Transaction details takes the rest. All nine
// columns need about this much window to fit beside the sidebar - narrower
// than that and the table falls back to the compact four-column form rather
// than cutting off Cash in / Cash out / Balance.
const COL = { sn: 52, date: 140, type: 116, invoice: 150, discount: 76, amount: 100, purchase: 112, cashIn: 96, cashOut: 96, balance: 112 };
const FULL_TABLE_MIN_WINDOW = 1280;

function TypePill({ kind }: { kind: Kind }) {
  const k = KIND[kind];
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: k.bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color: k.color }} numberOfLines={1}>
        {k.label}
      </Text>
    </View>
  );
}

/** Which account an entry went through - Cash, eSewa, a bank... */
function AccountPill({ row }: { row: BookRow }) {
  if (!row.account) return null;
  const name = row.account;
  return (
    <View className="flex-row items-center self-start rounded-full border border-gray-300 bg-white px-2 py-0.5" style={{ gap: 3 }}>
      <Ionicons name={row.moves[0]?.account === CASH ? 'cash-outline' : 'business-outline'} size={10} color="#4B5563" />
      <Text className="text-[10.5px] font-semibold text-gray-600" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/** Every entry of the day (or week / month) in one cash-book table, in date and
 * time order: opening balance first, then cash in / paid out / expenses (which
 * move the running balance) mixed with the sales and purchase bills and
 * transfers (which don't), closing balance last. It is the same table as the
 * Statement's (BookTable, the same columns, widths and styles), with the
 * running Balance after Cash out. `dayLabel` is given for a view of more than
 * one day, and puts a date band above each day's entries. */
function DayBookTable({ rows, opening, totalIn, totalOut, closing, full, dayLabel, onOpenRow, withPurchase }: {
  rows: BookRow[];
  /** A vehicle account: a Purchase price column - what the vehicle each entry is about was bought for. */
  withPurchase?: boolean;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** Show every column; otherwise Date | Details | Amount | Balance. */
  full: boolean;
  dayLabel?: (date: string) => string;
  onOpenRow: (row: BookRow) => void;
}) {
  const [calendarMode] = useCalendarMode();
  // SN, then the date with its time under it (the opening line has neither), as on the Statement.
  const snCell = (r: BookRow, index: number) => <Text className="text-[12.5px] text-gray-500">{r.kind === 'opening' ? '' : index}</Text>;
  const dateCell = (r: BookRow, short: boolean) =>
    r.kind === 'opening' ? null : (
      <View style={{ minWidth: 0 }}>
        <Text className={`${short ? 'text-[11.5px]' : 'text-[12.5px]'} font-medium text-gray-800`} numberOfLines={1}>
          {short ? shortDateLabel(r.date) : dateLabels(r.date, calendarMode)[0]}
        </Text>
        <Text className={short ? 'text-[10.5px] text-gray-400' : 'text-[11px] text-gray-400'}>{r.time}</Text>
      </View>
    );
  const num = (value: number | null, color: string, bold = false) =>
    value == null ? (
      <Text className="text-[12.5px] text-gray-400">—</Text>
    ) : (
      <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
        {money(value)}
      </Text>
    );
  const balanceCell = (r: BookRow) => (
    <Text className="text-[13px] font-bold" style={{ color: r.balance == null ? '#6B7280' : '#111827' }} numberOfLines={1}>
      {money(r.balance)}
    </Text>
  );
  const detailsCell = (r: BookRow, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className={`text-[13px] text-gray-900 ${r.kind === 'opening' ? 'font-bold' : 'font-medium'}`} numberOfLines={compact ? 2 : 1}>
        {r.details}
      </Text>
      {compact && (
        <View className="flex-row flex-wrap" style={{ gap: 4 }}>
          <TypePill kind={r.kind} />
          <AccountPill row={r} />
        </View>
      )}
      {!!r.sub && (
        <Text className="text-[11px] text-gray-400" numberOfLines={r.kind === 'opening' ? undefined : compact ? 2 : 1}>
          {r.sub}
        </Text>
      )}
      {compact && (r.invoiceNo != null || !!r.discount || (withPurchase && r.purchasePrice != null)) && (
        <Text className="text-[11px] text-gray-400">
          {[
            r.invoiceNo ? `Invoice no. ${r.invoiceNo}` : null,
            r.discount ? `Discount ${money(r.discount)}` : null,
            withPurchase && r.purchasePrice != null ? `Purchase price ${money(r.purchasePrice)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
    </View>
  );

  const columns: BookColumn<BookRow>[] = full
    ? [
        { key: 'sn', label: 'SN', width: COL.sn, render: (r, index) => snCell(r, index) },
        { key: 'date', label: 'Date', width: COL.date, render: (r) => dateCell(r, false) },
        {
          // The bill's own number - not an amount; anything that is not a bill has none.
          key: 'invoice',
          label: 'Invoice no.',
          width: COL.invoice,
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
        {
          key: 'type',
          label: 'Type',
          width: COL.type,
          render: (r) => (
            <View style={{ gap: 3 }}>
              <TypePill kind={r.kind} />
              <AccountPill row={r} />
            </View>
          ),
        },
        { key: 'discount', label: 'Discount', width: COL.discount, align: 'right', render: (r) => num(r.discount, '#4B5563') },
        // A sale or purchase bill's amount is plain black: only money paid (red) and received (green) is coloured.
        { key: 'amount', label: 'Bill amount', width: COL.amount, align: 'right', render: (r) => num(r.amount, r.kind === 'sale' || r.kind === 'purchase' ? '#111827' : KIND[r.kind].color) },
        ...(withPurchase ? [{ key: 'purchase', label: 'Purchase price', width: COL.purchase, align: 'right' as const, render: (r: BookRow) => num(r.purchasePrice, '#4B5563') }] : []),
        { key: 'cashIn', label: 'Cash in', width: COL.cashIn, align: 'right', render: (r) => num(r.cashIn, '#047857', true) },
        { key: 'cashOut', label: 'Cash out', width: COL.cashOut, align: 'right', render: (r) => num(r.cashOut, '#B91C1C', true) },
        { key: 'balance', label: 'Balance', width: COL.balance, align: 'right', render: balanceCell },
      ]
    : [
        { key: 'sn', label: 'SN', width: 34, render: (r, index) => snCell(r, index) },
        { key: 'date', label: 'Date', width: 84, render: (r) => dateCell(r, true) },
        { key: 'details', label: 'Transaction details', render: (r) => detailsCell(r, true) },
        {
          key: 'amount',
          label: 'Amount',
          width: 92,
          align: 'right',
          render: (r) => {
            if (r.kind === 'opening') return <Text className="text-[12.5px] text-gray-400">—</Text>;
            const signed = r.cashIn != null ? `+${money(r.cashIn)}` : r.cashOut != null ? `−${money(r.cashOut)}` : money(r.amount);
            const color = r.cashIn != null ? '#047857' : r.cashOut != null ? '#B91C1C' : '#6B7280';
            return (
              <Text className="text-[12.5px] font-bold" style={{ color }}>
                {signed}
              </Text>
            );
          },
        },
        { key: 'balance', label: 'Balance', width: 92, align: 'right', render: balanceCell },
      ];

  const closingColor = closing >= 0 ? '#2563EB' : '#DC2626';
  const footer = full
    ? {
        label: `Opening ${money(opening)} + In ${money(totalIn)} − Out ${money(totalOut)} = Closing balance`,
        cells: {
          cashIn: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{money(totalIn)}</Text>,
          cashOut: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{money(totalOut)}</Text>,
          balance: <Text className="text-[14px] font-extrabold" style={{ color: closingColor }}>{money(closing)}</Text>,
        },
      }
    : {
        label: 'Closing balance',
        cells: { balance: <Text className="text-[14px] font-extrabold" style={{ color: closingColor }}>{money(closing)}</Text> },
      };

  return (
    <BookTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      // Tapping an entry opens it for editing; the opening-balance line and anything without a record behind it stays inert.
      onRowPress={onOpenRow}
      rowPressable={(r) => !!(r.edit || r.bill || r.journal)}
      highlight={(r) => r.kind === 'opening'}
      // A date band above each day's entries, when the view spans more than one day (the opening line has none).
      groupOf={dayLabel ? (((r: BookRow) => (r.kind === 'opening' ? undefined : dayLabel(r.date))) as unknown as (row: BookRow) => string) : undefined}
      footer={footer}
    />
  );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mb-3.5">
      <Text className="mb-1.5 text-sm font-medium text-gray-700">{label}</Text>
      {children}
    </View>
  );
}

function EditInput(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      className={`rounded-lg border px-3 py-2.5 text-sm ${props.editable === false ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-300 bg-white text-gray-900'}`}
    />
  );
}

/** Edit or delete one entry without leaving the Day Book. Writes go to the
 * row's own table, so the ledgers, balances and the rest of Finance follow
 * along - a sale's customer debit, for one, is kept in step by a database
 * trigger. */
function EditEntryModal({ target, onClose }: { target: EditTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.session?.user.id);
  const bankAccounts = useBankAccounts(userId);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const createCustomer = useSupabaseInsert('customers');
  const { data: allParties } = useSupabaseQuery('customers', { filters: userId ? { owner_id: userId } : {}, enabled: !!userId });
  const updates = {
    customer_ledger_entries: useSupabaseUpdate('customer_ledger_entries'),
    vendor_ledger_entries: useSupabaseUpdate('vendor_ledger_entries'),
    account_transfers: useSupabaseUpdate('account_transfers'),
  };
  const removals = {
    customer_ledger_entries: useSupabaseDelete('customer_ledger_entries'),
    vendor_ledger_entries: useSupabaseDelete('vendor_ledger_entries'),
    account_transfers: useSupabaseDelete('account_transfers'),
  };
  const [form, setForm] = useState<EditValues | undefined>(target?.values);
  const [busy, setBusy] = useState(false);
  // Deleting asks a second time in the sheet itself rather than through a
  // pop-up: the confirmation sits under the reader's finger, right where
  // the first tap was, and can't be missed behind this window.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setForm(target?.values);
    setConfirmingDelete(false);
  }, [target]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  if (!target || !form) return null;
  const locked = !!target.lockedReason;
  const accountName = form.bankAccountId
    ? (bankAccounts.accounts.find((a) => a.id === form.bankAccountId)?.name ?? 'Bank')
    : 'Cash';
  const set = (key: keyof EditValues) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));

  // Each table keeps its own column names; the Day Book only ever changes
  // what is actually visible on the row.
  function valuesFor(values: EditValues): Record<string, unknown> {
    const amount = Number(values.amount);
    const note = values.note.trim() || null;
    switch (target!.table) {
      case 'customer_ledger_entries':
      case 'vendor_ledger_entries':
        return {
          entry_date: values.date,
          amount,
          receipt_no: values.receiptNo.trim() || null,
          bank_account_id: values.bankAccountId,
          note,
          // Moved to another party / switched between Received and Payment Out.
          ...(target!.fields.reassign && values.partyId
            ? target!.table === 'customer_ledger_entries'
              ? { customer_id: values.partyId }
              : { vendor_id: values.partyId }
            : null),
          ...(target!.fields.direction ? { entry_type: values.entryType } : null),
        };
      case 'account_transfers':
        return { transfer_date: values.date, amount, note };
    }
  }

  async function refreshEverything() {
    // A bill's trigger writes to the ledgers, so refresh all of them.
    await Promise.all(
      ['business_transactions', 'customer_ledger_entries', 'vendor_ledger_entries', 'account_transfers'].map((t) =>
        queryClient.invalidateQueries({ queryKey: [t] })
      )
    );
  }

  async function handleSave() {
    const values = form!;
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showAlert('Check the amount', 'Enter an amount greater than zero.');
      return;
    }
    if (!values.date) {
      showAlert('Pick a date', 'Every entry needs a date.');
      return;
    }
    setBusy(true);
    try {
      await updates[target!.table].mutateAsync({ id: target!.id, values: valuesFor(values) as never });
      await refreshEverything();
      onClose();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    try {
      await removals[target!.table].mutateAsync(target!.id);
      await refreshEverything();
      onClose();
    } catch (err) {
      showAlert('Could not delete', getErrorMessage(err));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  // A popup like the others (the ledger's entry editor): the fields side by side, Remove / Cancel / Save under them.
  return (
    <>
      {/* A click on the dimmed area closes it (as this popup always did), and so do the cross, Cancel and Esc. */}
      <PopupCard title={`${locked ? 'Entry details' : 'Edit entry'} · ${target.title}`} onClose={onClose} maxWidth={1000} closeOnOutside>
        {locked && (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <Ionicons name="lock-closed-outline" size={16} color="#B45309" />
            <Text className="flex-1 text-xs leading-[17px] text-amber-900">{target.lockedReason}</Text>
          </View>
        )}

        {/* Same order and the same field blocks as the Payment In form, so an entry reads the way it was written. */}
        <FieldRow>
          <Field label="Date" basis={190}>
            {locked ? <EditInput value={form.date} editable={false} /> : <DateField value={form.date} onChange={(v) => v && set('date')(v)} />}
          </Field>
          {(target.fields.receiptNo || target.fields.billNo) && (
            <Field label={target.numberLabel ?? 'Receipt No.'} basis={150}>
              <EditInput
                value={target.fields.billNo ? form.billNo : form.receiptNo}
                onChangeText={target.fields.billNo ? set('billNo') : set('receiptNo')}
                placeholder="Optional"
                editable={!locked}
              />
            </Field>
          )}
          {target.fields.method && (
            <Field label="Payment method" basis={220}>
              <Pressable
                onPress={() => !locked && setShowAccountPicker(true)}
                disabled={locked}
                className={`flex-row items-center justify-between rounded-lg border px-3 py-2.5 ${locked ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}
              >
                <View className="flex-row items-center gap-2">
                  <Ionicons name={form.bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
                  <Text className={`text-sm ${locked ? 'text-gray-500' : 'text-gray-900'}`}>{accountName}</Text>
                </View>
                {!locked && <Ionicons name="chevron-down" size={16} color="#9CA3AF" />}
              </Pressable>
            </Field>
          )}
        </FieldRow>

        {(target.fields.party || !!target.subtitleParty || (target.fields.direction && !locked)) && (
          <FieldRow>
            {target.fields.party && (
              <Field label={target.partyLabel ?? 'Customer'} basis={260}>
                <EditInput value={form.party} onChangeText={set('party')} placeholder="Name" editable={!locked} />
              </Field>
            )}
            {!target.fields.party && !!target.subtitleParty && (
              <Field label={target.partyLabel ?? 'Customer'} basis={260}>
                {target.fields.reassign && !locked ? (
                  <Pressable
                    onPress={() => setShowPartyPicker(true)}
                    className="flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
                    accessibilityRole="button"
                    accessibilityLabel="Change the name on this entry"
                  >
                    <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
                      {(allParties ?? []).find((c) => c.id === form.partyId)?.name ?? target.subtitleParty}
                    </Text>
                    <Text className="text-xs font-semibold text-blue-700">Change</Text>
                  </Pressable>
                ) : (
                  <EditInput value={target.subtitleParty} editable={false} />
                )}
              </Field>
            )}
            {target.fields.direction && !locked && (
              <Field label="Entry type" basis={240}>
                <View className="flex-row" style={{ gap: 8 }}>
                  {([
                    { key: 'credit', label: 'Received', color: '#047857' },
                    { key: 'debit', label: 'Paid', color: '#B91C1C' },
                  ] as const).map((o) => {
                    const on = form.entryType === o.key;
                    return (
                      <Pressable
                        key={o.key}
                        onPress={() => setForm((f) => (f ? { ...f, entryType: o.key } : f))}
                        className="flex-1 items-center rounded-lg border py-2.5"
                        style={{ borderColor: on ? o.color : '#D1D5DB', backgroundColor: on ? `${o.color}14` : '#FFFFFF' }}
                        accessibilityState={{ selected: on }}
                      >
                        <Text className="text-sm font-semibold" style={{ color: on ? o.color : '#6B7280' }}>
                          {o.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>
            )}
          </FieldRow>
        )}

        <FieldRow>
          <Field label="Amount (NPR)" basis={170}>
            <EditInput value={form.amount} onChangeText={(v) => set('amount')(decimalInput(v))} keyboardType="decimal-pad" editable={!locked} />
          </Field>
          {target.fields.discount && (
            <Field label="Discount (NPR)" basis={170}>
              <EditInput value={form.discount} onChangeText={(v) => set('discount')(decimalInput(v))} keyboardType="decimal-pad" editable={!locked} />
            </Field>
          )}
          <Field label="Remarks" basis={280}>
            <EditInput value={form.note} onChangeText={set('note')} placeholder="Optional" multiline style={{ minHeight: 44, textAlignVertical: 'top' }} editable={!locked} />
          </Field>
        </FieldRow>

        {!locked && (
          <>
            <FormActions onCancel={onClose} onSave={handleSave} saving={busy} saveLabel="Save changes" onRemove={handleDelete} />
            {confirmingDelete && (
              <Text className="text-center text-xs text-gray-500">
                Press Remove again to delete this entry for good. It disappears from the Day Book and from every total that counted it.
              </Text>
            )}
          </>
        )}
      </PopupCard>

      <ContactPickerModal
        visible={showPartyPicker}
        initialQuery=""
        customers={allParties ?? []}
        phoneContacts={[]}
        title="Move this entry to"
        placeholder="Search by name or phone"
        matchPhone
        onSelectCustomer={(c) => {
          setForm((f) => (f ? { ...f, partyId: c.id } : f));
          setShowPartyPicker(false);
        }}
        // A person who is not saved yet is added (after the confirmation popup) and the entry moves to them.
        onSelectNew={async (name, phone, partyTypeId) => {
          if (!userId) return;
          const existing = phone ? (allParties ?? []).find((c) => c.phone === phone) : undefined;
          try {
            const person = existing ?? (await createCustomer.mutateAsync({ owner_id: userId, name, phone, ...(partyTypeId ? { party_type_id: partyTypeId } : {}) }));
            setForm((f) => (f ? { ...f, partyId: person.id } : f));
          } catch (err) {
            showAlert('Could not add this person', getErrorMessage(err));
          }
        }}
        onClose={() => setShowPartyPicker(false)}
      />

      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={form.bankAccountId}
        onSelect={(id) => setForm((f) => (f ? { ...f, bankAccountId: id } : f))}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
    </>
  );
}

/** The five things a day can gain, one button each - the same forms the
 * Finance menu opens, without leaving the Day Book to find them. */
const NEW_ENTRY_KINDS = ENTRY_KINDS.map((kind) => ({
  key: kind.key,
  label: kind.menuLabel ?? kind.label,
  icon: kind.icon,
  color: kind.color,
  path: kind.path,
}));

function NewEntryButtons({ basePath, onVoucher, onContra }: { basePath: string; onVoucher: () => void; onContra: () => void }) {
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
      {NEW_ENTRY_KINDS.map((kind) => (
        <Pressable
          key={kind.key}
          accessibilityRole="button"
          accessibilityLabel={`New ${kind.label}`}
          onPress={() => router.push(`${basePath}${kind.path}` as any)}
          className="flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3"
          style={{ minHeight: 36 }}
        >
          <Ionicons name={kind.icon} size={16} color={kind.color} />
          <Text className="text-[13px] font-semibold text-gray-800">{kind.label}</Text>
        </Pressable>
      ))}
      {/* A journal voucher moves an amount from one person's ledger to another's - no cash: a popup, not a page. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New Voucher"
        onPress={onVoucher}
        className="flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3"
        style={{ minHeight: 36 }}
      >
        <Ionicons name="document-text" size={16} color="#B45309" />
        <Text className="text-[13px] font-semibold text-gray-800">Voucher</Text>
      </Pressable>
      {/* A contra moves money between your own accounts (cash <-> bank, bank <-> wallet): a popup, not a page. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New Contra"
        onPress={onContra}
        className="flex-row items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3"
        style={{ minHeight: 36 }}
      >
        <Ionicons name="swap-horizontal" size={16} color="#4338CA" />
        <Text className="text-[13px] font-semibold text-gray-800">Contra</Text>
      </Pressable>
    </View>
  );
}

/** A button floating over the bottom corner of the page that picks which account
 * the Day Book shows: all of them together, Cash, or one bank / wallet. It names
 * the account in use, and opens a small menu above itself; tapping anywhere else
 * closes the menu. */
function AccountPicker({ options, selected, onSelect, userId }: {
  options: AccountOption[];
  /** null is every account together. */
  selected: AccountKey | null;
  onSelect: (key: AccountKey | null) => void;
  /** Whose books the balances beside each account are read from - only while the menu is open. */
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const books = useAccountBalances(open ? userId : undefined);
  // What each bank / wallet holds, and all of them together. Cash has no figure: cash in hand is not tracked.
  const amountOf = (key: AccountKey | null): number | undefined => {
    if (!books.ready) return undefined;
    if (key == null) return round2(books.perAccount.reduce((sum, a) => sum + a.balance, 0));
    const account = books.perAccount.find((a) => a.id === key);
    return account ? round2(account.balance) : undefined;
  };
  const insets = useSafeAreaInsets();
  type IconName = ComponentProps<typeof Ionicons>['name'];
  const iconFor = (key: AccountKey | null): IconName => (key == null ? 'wallet-outline' : key === CASH ? 'cash-outline' : 'business-outline');
  const current = options.find((o) => o.key === selected);
  const choices: { key: AccountKey | null; name: string }[] = [{ key: null, name: 'All accounts' }, ...options];

  return (
    <>
      {open && (
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityLabel="Close account menu"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}
        />
      )}
      <View style={{ position: 'absolute', right: 16 + insets.right, bottom: 16 + insets.bottom, alignItems: 'flex-end', gap: 8, zIndex: 11 }}>
        {open && (
          <View
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            style={{ minWidth: 210, maxHeight: 340, boxShadow: '0 12px 32px rgba(16,24,40,0.22)' }}
          >
            <Text className="border-b border-gray-100 px-4 py-2 text-xs font-semibold capitalize tracking-wide text-gray-500">
              Show money through
            </Text>
            <ScrollView>
              {choices.map((c) => {
                const on = c.key === (current?.key ?? null);
                return (
                  <Pressable
                    key={c.key ?? 'all'}
                    onPress={() => {
                      onSelect(c.key);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    className="flex-row items-center px-4 py-3"
                    style={{ gap: 10, backgroundColor: on ? '#EFF6FF' : undefined }}
                  >
                    <Ionicons name={iconFor(c.key)} size={17} color={on ? '#1D4ED8' : '#6B7280'} />
                    <Text className={`flex-1 text-[14px] ${on ? 'font-bold text-blue-700' : 'font-medium text-gray-900'}`} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {amountOf(c.key) !== undefined && (
                      <Text className="text-xs font-bold" style={{ color: (amountOf(c.key) ?? 0) < 0 ? '#DC2626' : '#374151' }}>
                        NPR {formatMoney(amountOf(c.key) ?? 0)}
                      </Text>
                    )}
                    {on && <Ionicons name="checkmark" size={17} color="#1D4ED8" />}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">Balances are bank and wallet accounts; cash is not counted.</Text>
          </View>
        )}
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={`Showing ${current?.name ?? 'all accounts'}. Choose an account`}
          accessibilityState={{ expanded: open }}
          className="flex-row items-center rounded-full px-4"
          style={{ minHeight: 44, gap: 8, backgroundColor: '#1D4ED8', boxShadow: '0 8px 20px rgba(29,78,216,0.35)' }}
        >
          <Ionicons name={iconFor(current?.key ?? null)} size={17} color="#FFFFFF" />
          <Text className="max-w-[180px] text-[14px] font-semibold text-white" numberOfLines={1}>
            {current?.name ?? 'All accounts'}
          </Text>
          <Ionicons name={open ? 'chevron-down' : 'chevron-up'} size={15} color="#FFFFFF" />
        </Pressable>
      </View>
    </>
  );
}

/** The day's money laid out like a paper cash book, as one table. Uses the
 * dashboard's definitions - a sale or purchase books a debt rather than
 * moving cash, the ledger rows it creates are skipped so nothing counts
 * twice, and entries sit on the date the user gave them. The opening balance
 * is every cash movement dated before this day, the same formula as the
 * Available Balance (useAccountBalances), so the two always agree. */
export function DayBookScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const wide = useWideDetail();
  const { width: windowWidth } = useWindowDimensions();
  const fullTable = wide && windowWidth >= FULL_TABLE_MIN_WINDOW;
  const [calendarMode] = useCalendarMode();
  const today = localDay(new Date().toISOString());
  // What the Filter button sets: today by default, otherwise a range. An empty
  // From reaches back to the start of the books (so nothing is carried in as an
  // opening balance); an empty To runs through today.
  const [range, setRange] = useState({ from: today, to: today });
  const from = range.from;
  const day = range.to || today;
  const singleDay = from === day;
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // The Contra popup: money moved between your own accounts. The Voucher popup: an amount moved from
  // one person's ledger to another's.
  const [showContra, setShowContra] = useState(false);
  // A bill opened from its row: shown in a popup, and edited in it.
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);
  const queryClient = useQueryClient();
  const deleteTx = useSupabaseDelete('business_transactions');
  // null shows every account together; otherwise just what went through that one.
  const [selectedAccount, setSelectedAccount] = useState<AccountKey | null>(null);

  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  // `all`: the book sums every entry before the day shown to carry its opening balance, and a plain read
  // stops at the API's first 1000 rows (in no set order) - past that, the newest entries went missing
  // from the book and the opening balance was short.
  const { data: transactions, isLoading } = useSupabaseQuery('business_transactions', { filters: owner, all: true, enabled: !!userId });
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, all: true, enabled: !!userId });
  const { data: transfers } = useSupabaseQuery('account_transfers', { filters: owner, all: true, enabled: !!userId });
  const { data: contacts } = useSupabaseQuery('customers', { filters: owner, enabled: !!userId });
  const { data: accounts } = useSupabaseQuery('bank_accounts', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: categories } = useSupabaseQuery('expense_categories', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });

  // A vehicle account's sale and purchase bills read with the car on them (the item) in place of the remark.
  const showItems = sellsVehicles(profile?.business_name?.trim() || profile?.full_name);
  const { data: products } = useSupabaseQuery('products', { filters: owner, enabled: !!userId && showItems });

  const book = useMemo(() => {
    const contactName = new Map((contacts ?? []).map((c) => [c.id, c.name]));
    const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
    const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const via = (bankId: string | null) => (bankId ? (accountName.get(bankId) ?? 'Other account') : 'Cash');
    const keyOf = (bankId: string | null): AccountKey => bankId ?? CASH;
    const blank = { invoiceNo: null, discount: null, amount: null, cashIn: null, cashOut: null, balance: null, purchasePrice: null, account: null, moves: [] as Move[] };
    // A vehicle account: each vehicle's purchase price - its purchase bill's rate (the latest bill), else its stock
    // item's cost price - looked up by the vehicle an entry names (a bill's item, a payment's remark).
    const vehicleKey = (name: string | null | undefined) => (name ?? '').split(' · ')[0].trim().replace(/\s+/g, ' ').toLowerCase();
    const costByVehicle = new Map<string, number>();
    if (showItems) {
      for (const p of products ?? []) if (p.purchase_price != null) costByVehicle.set(vehicleKey(p.name), Number(p.purchase_price));
      const purchases = (transactions ?? []).filter((t) => t.type === 'purchase').sort((a, b) => (a.bill_date ?? a.created_at).localeCompare(b.bill_date ?? b.created_at));
      for (const t of purchases) for (const i of t.items ?? []) if (Number(i.rate) > 0) costByVehicle.set(vehicleKey(i.description), Number(i.rate));
    }
    const costOf = (name: string | null | undefined) => (showItems ? costByVehicle.get(vehicleKey(name)) ?? null : null);

    // Every account's balance at the start of the day. Transfers count here -
    // they leave one account and enter another - though they net to nothing in
    // the combined `opening`, so that total is unchanged by them.
    const openingBy: Record<AccountKey, number> = {};
    const carry = (account: AccountKey, delta: number) => {
      openingBy[account] = (openingBy[account] ?? 0) + delta;
    };
    let opening = 0;
    const rows: BookRow[] = [];
    const voucherExpense = new Map<string, { id: string; head: string; amount: number }[]>();

    for (const t of transactions ?? []) {
      const date = t.bill_date ?? localDay(t.created_at);
      const viaVoucher = t.type === 'expense' && !!journalOf(t.note);
      if (t.type === 'expense' && !viaVoucher && date < from) {
        opening -= t.amount;
        carry(keyOf(t.bank_account_id), -t.amount);
      }
      // An expense posted by a journal voucher is listed as that voucher's one line, below.
      if (viaVoucher) {
        const code = journalOf(t.note)?.code;
        if (code) voucherExpense.set(code, [...(voucherExpense.get(code) ?? []), { id: t.id, head: categoryName.get(t.expense_category_id ?? '') ?? 'Expense', amount: Number(t.amount) }]);
        continue;
      }
      if (date < from || date > day) continue;
      const discount = t.discount_amount ?? 0;
      const category = t.expense_category_id ? categoryName.get(t.expense_category_id) : null;
      const isExpense = t.type === 'expense';
      rows.push({
        ...blank,
        id: t.id,
        kind: isExpense ? 'expense' : t.type === 'sale' ? 'sale' : 'purchase',
        // A sale / purchase names the vehicle as its item; an expense on a vehicle is made out to it.
        purchasePrice: isExpense ? costOf(t.party_name) : costOf((t.items ?? [])[0]?.description),
        date,
        time: timeOf(t.created_at),
        details: isExpense
          ? tidyName(t.party_name) || category || 'Expenses'
          : tidyName(t.party_name) || (t.type === 'sale' ? 'Sale' : 'Purchase'),
        sub:
          [
            t.bill_no ? `Bill #${t.bill_no}` : null,
            isExpense && t.party_name ? category : null,
            // The item (car) where the account shows it; a bill with no items keeps its remark.
            !isExpense && showItems ? itemNamesOf(t.items) || t.note : t.note,
            !isExpense && t.payment_mode === 'credit' ? 'On credit' : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        // The bill's own number - what the Invoice column shows (an expense has none).
        invoiceNo: isExpense ? null : t.bill_no?.trim() || null,
        discount,
        // An expense is paid on the spot, so it's cash out; a sale or
        // purchase bill is a debt until its payment is recorded.
        amount: isExpense ? null : t.amount,
        cashOut: isExpense ? t.amount : null,
        account: isExpense ? via(t.bank_account_id) : null,
        moves: isExpense ? [{ account: keyOf(t.bank_account_id), amount: t.amount, dir: 'out' }] : [],
        sortKey: t.created_at,
        // A bill opens in a popup right here, to read; its Edit button goes to the edit page.
        bill: t,
      });
    }

    for (const e of customerEntries ?? []) {
      // A journal voucher's halves are listed as one line below, and are not cash.
      if (journalOf(e.note)) continue;
      const isIn = e.entry_type === 'credit';
      // Booking debits are the Sale itself, not cash.
      if (!isIn && e.source !== 'manual') continue;
      const date = e.entry_date ?? localDay(e.created_at);
      if (date < from) {
        opening += isIn ? e.amount : -e.amount;
        carry(keyOf(e.bank_account_id), isIn ? e.amount : -e.amount);
      }
      if (date < from || date > day) continue;
      rows.push({
        ...blank,
        id: e.id,
        kind: isIn ? 'received' : 'paid',
        purchasePrice: costOf(e.note),
        date,
        time: timeOf(e.created_at),
        details: `${isIn ? 'Received from' : 'Paid to'} ${contactName.get(e.customer_id) ?? 'customer'}`,
        sub: [e.receipt_no ? `${isIn ? 'Receipt' : 'Payment'} No. ${e.receipt_no}` : null, e.note].filter(Boolean).join(' · ') || null,
        cashIn: isIn ? e.amount : null,
        cashOut: isIn ? null : e.amount,
        account: via(e.bank_account_id),
        moves: [{ account: keyOf(e.bank_account_id), amount: e.amount, dir: isIn ? 'in' : 'out' }],
        sortKey: e.created_at,
        edit: {
          table: 'customer_ledger_entries',
          id: e.id,
          title: `${isIn ? 'Received from' : 'Paid to'} ${contactName.get(e.customer_id) ?? 'customer'}`,
          lockedReason:
            e.source === 'manual'
              ? undefined
              : 'This was recorded by a job when its payment was collected. Change it on the job, and this entry follows.',
          fields: { receiptNo: true, method: true, reassign: true, direction: true },
          partyLabel: 'Customer',
          numberLabel: isIn ? 'Receipt No.' : 'Payment No.',
          subtitleParty: contactName.get(e.customer_id) ?? 'Customer',
          values: {
            date,
            amount: amountText(e.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: e.receipt_no ?? '',
            note: e.note ?? '',
            bankAccountId: e.bank_account_id ?? null,
            partyId: e.customer_id,
            entryType: e.entry_type === 'credit' ? 'credit' : 'debit',
          },
        },
      });
    }

    for (const e of vendorEntries ?? []) {
      if (journalOf(e.note)) continue;
      // Only payments to a vendor move money; debits are the Purchase.
      if (e.entry_type !== 'credit') continue;
      const date = e.entry_date ?? localDay(e.created_at);
      if (date < from) {
        opening -= e.amount;
        carry(keyOf(e.bank_account_id), -e.amount);
      }
      if (date < from || date > day) continue;
      rows.push({
        ...blank,
        id: e.id,
        kind: 'paid',
        purchasePrice: costOf(e.note),
        date,
        time: timeOf(e.created_at),
        details: `Paid to ${contactName.get(e.vendor_id) ?? 'vendor'}`,
        sub: [e.receipt_no ? `Payment No. ${e.receipt_no}` : null, e.note].filter(Boolean).join(' · ') || null,
        cashOut: e.amount,
        account: via(e.bank_account_id),
        moves: [{ account: keyOf(e.bank_account_id), amount: e.amount, dir: 'out' }],
        sortKey: e.created_at,
        edit: {
          table: 'vendor_ledger_entries',
          id: e.id,
          title: `Paid to ${contactName.get(e.vendor_id) ?? 'vendor'}`,
          lockedReason:
            e.source === 'manual'
              ? undefined
              : 'This was recorded by a purchase bill. Edit the bill and this entry follows.',
          fields: { receiptNo: true, method: true, reassign: true },
          partyLabel: 'Vendor',
          numberLabel: 'Payment No.',
          subtitleParty: contactName.get(e.vendor_id) ?? 'Vendor',
          values: {
            date,
            amount: amountText(e.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: e.receipt_no ?? '',
            note: e.note ?? '',
            bankAccountId: e.bank_account_id ?? null,
            partyId: e.vendor_id,
            entryType: 'credit',
          },
        },
      });
    }

    // A journal voucher is two entries - one on each person's ledger - that carry the same code in their
    // remark. It is one line here: its amount in the Bill amount column, and no cash in or out.
    // A voucher is any number of debit and credit lines carrying one code; its day-book line names both
    // sides and shows the total debited.
    type VoucherParts = {
      date: string;
      createdAt: string;
      debitTotal: number;
      narration: string;
      debits: string[];
      credits: string[];
      entries: NonNullable<BookRow['journal']>['entries'];
    };
    const vouchers = new Map<string, VoucherParts>();
    const voucherOf = (code: string, date: string, createdAt: string, narration: string) => {
      let v = vouchers.get(code);
      if (!v) {
        v = { date, createdAt, debitTotal: 0, narration, debits: [], credits: [], entries: [] };
        vouchers.set(code, v);
      }
      return v;
    };
    const named = (who: string, amount: number) => `${who} ${formatMoney(amount)}`;
    for (const e of customerEntries ?? []) {
      const j = journalOf(e.note);
      if (!j) continue;
      const v = voucherOf(j.code, e.entry_date ?? localDay(e.created_at), e.created_at, j.narration);
      v.entries.push({ table: 'customer_ledger_entries', id: e.id });
      const who = contactName.get(e.customer_id) ?? 'Customer';
      const amount = Number(e.amount);
      // Received = the person credited; Paid = the person debited.
      if (e.entry_type === 'credit') v.credits.push(named(who, amount));
      else {
        v.debits.push(named(who, amount));
        v.debitTotal += amount;
      }
    }
    for (const e of vendorEntries ?? []) {
      const j = journalOf(e.note);
      if (!j) continue;
      const v = voucherOf(j.code, e.entry_date ?? localDay(e.created_at), e.created_at, j.narration);
      v.entries.push({ table: 'vendor_ledger_entries', id: e.id });
      const who = contactName.get(e.vendor_id) ?? 'Vendor';
      const amount = Number(e.amount);
      if (e.entry_type === 'credit') {
        v.debits.push(named(who, amount));
        v.debitTotal += amount;
      } else v.credits.push(named(who, amount));
    }
    for (const [code, v] of vouchers) {
      for (const exp of voucherExpense.get(code) ?? []) {
        v.entries.push({ table: 'business_transactions', id: exp.id });
        v.debits.push(named(exp.head, exp.amount));
        v.debitTotal += exp.amount;
      }
      if (v.date < from || v.date > day) continue;
      rows.push({
        ...blank,
        id: `journal-${code}`,
        kind: 'journal',
        date: v.date,
        time: timeOf(v.createdAt),
        details: `Journal voucher ${code}`,
        sub: [`Dr ${v.debits.join(', ') || '…'} · Cr ${v.credits.join(', ') || '…'}`, v.narration || null].filter(Boolean).join(' · '),
        amount: v.debitTotal,
        sortKey: v.createdAt,
        journal: { entries: v.entries },
      });
    }

    // A transfer only moves money between the owner's own accounts, so it
    // never changes the combined balance - listed for reference only.
    for (const tr of transfers ?? []) {
      const date = tr.transfer_date ?? localDay(tr.created_at);
      if (date < from) {
        carry(keyOf(tr.from_account_id), -tr.amount);
        carry(keyOf(tr.to_account_id), tr.amount);
      }
      if (date < from || date > day) continue;
      rows.push({
        ...blank,
        id: tr.id,
        kind: 'transfer',
        date,
        time: timeOf(tr.created_at),
        details: `${via(tr.from_account_id)} → ${via(tr.to_account_id)}`,
        sub: tr.note,
        amount: tr.amount,
        moves: [
          { account: keyOf(tr.from_account_id), amount: tr.amount, dir: 'out' },
          { account: keyOf(tr.to_account_id), amount: tr.amount, dir: 'in' },
        ],
        sortKey: tr.created_at,
        edit: {
          table: 'account_transfers',
          id: tr.id,
          title: `${via(tr.from_account_id)} to ${via(tr.to_account_id)}`,
          fields: {},
          partyLabel: 'Between accounts',
          subtitleParty: `${via(tr.from_account_id)} to ${via(tr.to_account_id)}`,
          values: {
            date: tr.transfer_date ?? localDay(tr.created_at),
            amount: amountText(tr.amount),
            party: '',
            billNo: '',
            discount: '',
            receiptNo: '',
            note: tr.note ?? '',
            bankAccountId: null,
            partyId: null,
            entryType: 'credit',
          },
        },
      });
    }

    // By the day each entry sits on, then by when it was entered - so a longer
    // view reads in date order and the running balance follows it.
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.sortKey.localeCompare(b.sortKey));

    // Where the opening balance sits, account by account - what each account held
    // at the start of the period, which adds up to the Opening balance.
    // An entry can point at an account that isn't in the list (one that was
    // removed, say); it still gets its own place here, so the accounts always
    // add up to the opening balance.
    const listed = [{ key: CASH, name: 'Cash' }, ...(accounts ?? []).map((a) => ({ key: a.id, name: a.name }))];
    const listedKeys = new Set(listed.map((o) => o.key));
    // Accounts seen either before the period (an opening balance) or in it (an entry).
    const seen = new Set([...Object.keys(openingBy), ...rows.flatMap((r) => r.moves.map((m) => m.account))]);
    const stray = accounts ? [...seen].filter((k) => !listedKeys.has(k)) : [];
    const openingByAccount = [...listed, ...stray.map((key) => ({ key, name: 'Other account' }))]
      .map((o) => ({ name: o.name, amount: openingBy[o.key] ?? 0 }))
      .filter((a) => round2(a.amount) !== 0);

    // One account on its own: its opening balance, and only the entries that
    // touched it. A transfer is a real in or out there, unlike in the combined
    // view where it nets to nothing.
    const accountOptions: AccountOption[] = [...listed, ...stray.map((key) => ({ key, name: 'Other account' }))];
    const selected = accountOptions.find((o) => o.key === selectedAccount) ?? null;
    let viewRows = rows;
    let viewOpening = opening;
    if (selected) {
      viewOpening = openingBy[selected.key] ?? 0;
      viewRows = rows
        .filter((r) => r.moves.some((m) => m.account === selected.key))
        .map((r) => {
          const mine = r.moves.filter((m) => m.account === selected.key);
          const cashIn = mine.filter((m) => m.dir === 'in').reduce((sum, m) => sum + m.amount, 0);
          const cashOut = mine.filter((m) => m.dir === 'out').reduce((sum, m) => sum + m.amount, 0);
          return { ...r, cashIn: cashIn || null, cashOut: cashOut || null, amount: r.kind === 'transfer' ? null : r.amount };
        });
    }

    let running = viewOpening;
    let totalIn = 0;
    let totalOut = 0;
    for (const r of viewRows) {
      if (r.cashIn != null || r.cashOut != null) {
        totalIn += r.cashIn ?? 0;
        totalOut += r.cashOut ?? 0;
        running += (r.cashIn ?? 0) - (r.cashOut ?? 0);
        r.balance = running;
      }
    }

    // "Cash -13,259  +  Esewa -103,771  +  Jyoti Bikash Bank 416,777  =  299,747" - only
    // when more than one account holds money; with one (or none) there is nothing to add up.
    const openingSub = selected
      ? `${selected.name} at the start of ${singleDay ? 'the day' : 'this period'}`
      : openingByAccount.length > 1
        ? `${openingByAccount.map((a) => `${a.name} ${money(a.amount)}`).join('  +  ')}  =  ${money(opening)}`
        : null;

    const openingRow: BookRow = {
      ...blank,
      id: 'opening',
      kind: 'opening',
      date: '',
      time: '',
      details: 'Opening balance',
      sub: openingSub,
      balance: viewOpening,
      sortKey: '',
    };

    return {
      rows: [openingRow, ...viewRows],
      entryCount: viewRows.length,
      opening: viewOpening,
      totalIn,
      totalOut,
      closing: running,
      openingByAccount,
      accountOptions,
      selected,
    };
  }, [transactions, customerEntries, vendorEntries, transfers, contacts, accounts, categories, day, from, singleDay, selectedAccount, showItems, products]);

  // A bill's triggers write to the ledgers, so after it is changed the ledgers are read again too.
  const refreshBooks = () =>
    Promise.all(
      ['business_transactions', 'customer_ledger_entries', 'vendor_ledger_entries', 'account_transfers'].map((table) =>
        queryClient.invalidateQueries({ queryKey: [table] })
      )
    );
  const closeBill = () => {
    setViewingTx(null);
    void refreshBooks();
  };
  // Edit: the bill's own edit page - the one New opens, with the bill loaded.
  const editBill = () => {
    if (viewingTx) router.push(`${basePath}/transactions?type=${viewingTx.type}&add=1&edit=${viewingTx.id}` as never);
    setViewingTx(null);
  };
  // A journal voucher is two entries: removing it takes both.
  const removeJournal = (row: BookRow) => {
    const entries = row.journal?.entries ?? [];
    showAlert('Remove this journal voucher?', [row.details, row.sub].filter(Boolean).join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            for (const entry of entries) {
              const { error } = await (supabase.from(entry.table) as any).delete().eq('id', entry.id);
              if (error) throw error;
            }
            await refreshBooks();
          } catch (err) {
            showAlert('Could not remove the voucher', getErrorMessage(err));
          }
        },
      },
    ]);
  };
  const removeBill = (tx: BusinessTransaction) => {
    setViewingTx(null);
    showAlert(`Delete this ${tx.type}?`, `${tidyName(tx.party_name) || 'Unnamed'} · NPR ${formatMoney(tx.amount)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTx.mutateAsync(tx.id);
            await refreshBooks();
          } catch (err) {
            showAlert('Could not delete', getErrorMessage(err));
          }
        },
      },
    ]);
  };

  // The date band above each day of a longer view.
  const dayLabel = (date: string) => dateLabels(date, calendarMode).join('  ·  ');

  // Today is the resting state, so the button reads "Today" and carries no
  // range; anything else shows as the range, and clearing it comes back to today.
  const isToday = from === today && day === today;
  const applyRange = (f: string, t: string) => setRange(f || t ? { from: f, to: t } : { from: today, to: today });

  // The arrows beside the date button walk the book one day at a time, always by exactly one:
  // yesterday, the day before ... and forward again as far as today. On a longer period the whole
  // period moves a day (its start with it, unless it reaches back to the start of the books).
  // Nothing past today - there is nothing to look at there.
  const canStepForward = day < today;
  const stepDays = (delta: number) =>
    setRange((r) => {
      const to = addDays(r.to || today, delta);
      if (to > today) return r;
      return { from: r.from ? addDays(r.from, delta) : '', to };
    });

  // Print and Excel carry the book as it stands: the period and account picked, the opening balance,
  // every entry with its cash in / out and the running balance, and the totals.
  const reportButtons = useReportActions((): PrintReport => {
    const period = singleDay
      ? dateLabels(day, calendarMode)[0]
      : `${from ? toBsHistoryLabel(from) : 'Start'} - ${toBsHistoryLabel(day)}`;
    const cell = (v: number | null) => (v == null ? '' : money(v));
    const entries = book.rows.filter((r) => r.kind !== 'opening');
    return {
      title: 'Day Book',
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: [period, book.selected?.name].filter(Boolean).join(' · '),
      printedOn: toBsHistoryLabel(today),
      summary: [
        { label: 'Opening balance', value: `NPR ${money(book.opening)}` },
        { label: 'Cash in', value: `NPR ${money(book.totalIn)}` },
        { label: 'Cash out', value: `NPR ${money(book.totalOut)}` },
        { label: 'Closing balance', value: `NPR ${money(book.closing)}` },
        { label: 'Entries', value: String(book.entryCount) },
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
            ...(showItems ? [{ label: 'Purchase price', align: 'right' as const }] : []),
            { label: 'Cash in', align: 'right' },
            { label: 'Cash out', align: 'right' },
            { label: 'Balance', align: 'right' },
          ],
          rows: [
            ['', '', '', 'Opening balance', '', '', '', ...(showItems ? [''] : []), '', '', money(book.opening)],
            ...entries.map((r, i) => [
              String(i + 1),
              `${toBsHistoryLabel(r.date)} ${r.time}`,
              r.invoiceNo ?? '',
              [r.details, r.sub].filter(Boolean).join(' · '),
              [KIND[r.kind].label, r.account].filter(Boolean).join(' · '),
              cell(r.discount || null),
              cell(r.amount),
              ...(showItems ? [cell(r.purchasePrice)] : []),
              cell(r.cashIn),
              cell(r.cashOut),
              cell(r.balance),
            ]),
          ],
          footer: ['', '', '', 'Totals', '', '', '', ...(showItems ? [''] : []), money(book.totalIn), money(book.totalOut), money(book.closing)],
        },
      ],
    };
  });

  // The date filter, Print and Excel always live in the top bar (a plain row above the tiles only on
  // a narrow window). The New entry buttons - Received, Paid, Sales, Purchase, Expenses, Voucher,
  // Contra - join them there when the window is wide enough for all of it, and otherwise sit in a row
  // of their own under the heading.
  const entriesInBar = wide && windowWidth >= 1640;
  const newEntryButtons = (
    <NewEntryButtons basePath={basePath} onVoucher={() => router.push(`${basePath}/voucher` as never)} onContra={() => setShowContra(true)} />
  );
  const toolbar = useBookToolbar(
    {
      wide,
      right: () => (
        <>
          {entriesInBar && newEntryButtons}
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <DayStepButton direction="back" onPress={() => stepDays(-1)} />
            <DateFilterButton
              dropdown
              from={isToday ? '' : range.from}
              to={isToday ? '' : range.to}
              idleLabel="Today"
              onApply={applyRange}
              shortcuts={[{ label: 'Today', on: isToday, onSelect: () => setRange({ from: today, to: today }) }]}
            />
            <DayStepButton direction="forward" disabled={!canStepForward} onPress={() => stepDays(1)} />
          </View>
          {reportButtons}
        </>
      ),
    },
    [range, isToday, today, basePath, canStepForward, entriesInBar]
  );

  const loaded = !(isLoading && !transactions);

  return (
    <View className="flex-1 bg-gray-50">
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: wide ? 24 : 12, paddingTop: wide ? 24 : 12, paddingBottom: 96, gap: 14 }}
    >
      {toolbar}
      {!entriesInBar && newEntryButtons}

      {isLoading && !transactions ? (
        <Text className="px-1 text-sm text-gray-500">Loading…</Text>
      ) : (
        <>
          <DayBookTable
            rows={book.rows}
            opening={book.opening}
            totalIn={book.totalIn}
            totalOut={book.totalOut}
            closing={book.closing}
            full={fullTable}
            withPurchase={showItems}
            dayLabel={singleDay ? undefined : dayLabel}
            onOpenRow={(row) => {
              if (row.bill) setViewingTx(row.bill);
              else if (row.journal) removeJournal(row);
              else if (row.edit) setEditing(row.edit);
            }}
          />

          <EditEntryModal target={editing} onClose={() => setEditing(null)} />
          {showContra && userId && (
            <PopupCard title="Contra" onClose={() => setShowContra(false)}>
              <TransferForm bare userId={userId} onDone={() => setShowContra(false)} />
            </PopupCard>
          )}
          <TransactionDetailModal
            tx={viewingTx}
            categoryName={
              viewingTx?.expense_category_id ? (categories ?? []).find((c) => c.id === viewingTx.expense_category_id)?.name ?? null : null
            }
            bankAccountName={
              viewingTx?.bank_account_id ? (accounts ?? []).find((a) => a.id === viewingTx.bank_account_id)?.name ?? null : null
            }
            onClose={closeBill}
            onEdit={editBill}
            editOnPage
            onDelete={viewingTx ? () => removeBill(viewingTx) : undefined}
          />

          {book.entryCount === 0 && (
            <Text className="px-1 text-[13px] text-gray-500">
              {`No ${book.selected ? `${book.selected.name} entries` : 'entries'} ${singleDay ? 'on this day.' : 'in this period.'}`}
            </Text>
          )}

          <Text className="px-1 text-xs leading-[17px] text-gray-500">
            Tap any entry to open it. A bill opens with an Edit button that takes you to its edit page; a payment or transfer is edited right there. The button at the bottom picks Cash, Esewa, a bank or all
            accounts - a transfer shows under an account as money in or out. Sale and purchase bills show what was billed that day - they
            don't change the balance until the money is received or paid, which appears as its own Received or Payment
            Out row.
          </Text>
        </>
      )}
    </ScrollView>
    {loaded && <AccountPicker options={book.accountOptions} selected={book.selected?.key ?? null} onSelect={setSelectedAccount} userId={userId} />}
    </View>
  );
}
