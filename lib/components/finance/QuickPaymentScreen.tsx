// lib/components/finance/QuickPaymentScreen.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useIsWideWeb } from '../../hooks/useWideGrid';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { usePhoneContacts } from '../../hooks/usePhoneContacts';
import { useScanBill } from '../../hooks/useScanBill';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { ContactPickerModal } from '../ContactPickerModal';
import { DateField } from '../DateTimeFields';
import { FormSection } from './FormSection';
import { PaymentEntryTable, type PaymentEntryTableHandle, type PaymentRow } from './PaymentEntryTable';
import { KeyboardDateInput } from './KeyboardDateInput';
import { KeyboardSelect } from './KeyboardSelect';
import { useConfirmSave } from './ConfirmSave';
import { optionLabel } from '../../hooks/useAvailableAmounts';
import { useAccountBalances } from '../../hooks/useAccountBalances';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { MONEY } from './moneyColors';
import { readKey } from '../../utils/webKeys';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import type { Customer } from '../../../types/database.types';
import { localTodayIso } from '../../utils/localDate';
import { round2, formatMoney } from '../../utils/money';
import { itemListOf, sellsVehicles } from '../../utils/accountFeatures';
import type { SuggestOption } from './SuggestInput';

// Local date, not UTC - see localTodayIso.
const todayIso = localTodayIso;

let rowKeySeq = 0;
function makeRowKey() {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

function emptyPaymentRow(): PaymentRow {
  return { key: makeRowKey(), customerName: '', selectedCustomer: null, pendingPhone: null, amount: '', note: '', item: '', model: '' };
}

export function QuickPaymentScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  // Received and Payment Out are the same (kept-mounted) route with a
  // different ?type - key the form on it so a half-filled Received form
  // never carries over into Payment Out and gets saved the wrong way round.
  return <QuickPaymentForm key={type === 'out' ? 'out' : 'in'} />;
}

function QuickPaymentForm() {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  // The keyboard-driven desk layout is for a wide web screen; a phone (or a
  // phone browser) gets the same touch form the native app does.
  const desktopWeb = useIsWideWeb();
  // voice* params arrive from the Finance dashboard's voice-command button,
  // routed here the same way a Shortcuts tap is (?type=in/out) - applied
  // once on mount below, same "review before save" rule as Scan Bill.
  const { type, voiceAmount, voiceParty, voiceDate, voiceNote } = useLocalSearchParams<{
    type?: string;
    voiceAmount?: string;
    voiceParty?: string;
    voiceDate?: string;
    voiceNote?: string;
  }>();
  const isOut = type === 'out';
  const userId = useAuthStore((state) => state.session?.user.id);
  // Customers and vendors share one contacts list, but they're opposite
  // ledgers (see PartyBalancesScreen) - a Payment Out settling a Purchase
  // must reduce vendor_ledger_entries (what you owe), never
  // customer_ledger_entries (what a customer owes you), or it inflates "To
  // Receive" for someone you only ever bought from. This used to be a
  // manual Customer/Vendor toggle, but Payment Out is a vendor payment and
  // Payment In is a customer payment in every real case that comes through
  // here, so it's just the fixed direction now instead of an extra choice.
  const payTarget: 'customer' | 'vendor' = isOut ? 'vendor' : 'customer';
  const targetTable = payTarget === 'vendor' ? 'vendor_ledger_entries' : 'customer_ledger_entries';
  const entryType: 'debit' | 'credit' =
    payTarget === 'customer' ? (isOut ? 'debit' : 'credit') : isOut ? 'credit' : 'debit';
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'name' },
    enabled: !!userId,
  });
  // A vehicle account's Paid table also names the car each payment is for (its number) and its model.
  const profile = useAuthStore((state) => state.profile);
  const withCar = isOut && sellsVehicles(profile?.business_name?.trim() || profile?.full_name);
  const { data: purchaseBills } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId, type: 'purchase' } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId && withCar,
  });
  // The cars bought from each vendor, newest bill first - by the saved vendor, or by the name on a bill
  // made out to one with no link.
  const carsByVendor = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const bill of purchaseBills ?? []) {
      const key = bill.customer_id ? `id:${bill.customer_id}` : `name:${(bill.party_name ?? '').trim().toLowerCase()}`;
      const list = map.get(key) ?? [];
      for (const name of itemListOf(bill.items)) if (!list.includes(name)) list.push(name);
      map.set(key, list);
    }
    return map;
  }, [purchaseBills]);
  const carOptionsFor = (vendor: Customer | null, typed: string): SuggestOption[] => {
    const mine = vendor ? [...(carsByVendor.get(`id:${vendor.id}`) ?? []), ...(carsByVendor.get(`name:${vendor.name.trim().toLowerCase()}`) ?? [])] : [];
    const q = typed.trim().toLowerCase();
    // Only this vendor's cars - never the rest of the stock. A vendor with none leaves the box a plain one.
    return [...new Set(mine)]
      .filter((name) => !q || name.toLowerCase().includes(q))
      .map((name) => ({ key: name, label: name }));
  };
  // Same-direction, same-target manual entries only - counts Payment In
  // separately from Payment Out (and vendor separately from customer), and
  // skips booking-synced credits (job payments), which never carry a
  // receipt_no of their own.
  const { data: sameDirectionEntries } = useSupabaseQuery(targetTable, {
    filters: userId ? { owner_id: userId, entry_type: entryType, source: 'manual' } : {},
    enabled: !!userId,
  });
  const insertEntry = useSupabaseInsert(targetTable);
  const createCustomer = useSupabaseInsert('customers');
  const updateCustomer = useSupabaseUpdate('customers');
  const bankAccounts = useBankAccounts(userId);
  // Money in each bank / wallet account, shown beside it in the Payment method dropdown - receiving and
  // paying alike: the books' own figures (the same as the account lists show). Cash has none.
  const balances = useAccountBalances(userId);
  const available = useMemo(
    () => (balances.ready ? { byId: Object.fromEntries(balances.perAccount.map((a) => [a.id, round2(a.balance)])) } : null),
    [balances]
  );
  const phoneContacts = usePhoneContacts();
  const { scanning, pickAndScan } = useScanBill();
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();

  const [customerName, setCustomerName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // Pre-fills the customer picker's search box with whatever name Scan Bill
  // read off the slip - still needs a tap to confirm, same reasoning as the
  // Sale/Purchase/Expense form's version of this.
  const [pickerQuery, setPickerQuery] = useState('');
  // Lets a typo in a just-added (or existing) customer's name get fixed
  // right here instead of hunting it down in Customers afterward.
  const [showRenameCustomer, setShowRenameCustomer] = useState(false);
  const [renameCustomerValue, setRenameCustomerValue] = useState('');
  const [renamingCustomer, setRenamingCustomer] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [receiptNo, setReceiptNo] = useState('');
  // Only true once the reseller has actually typed in the field - lets the
  // auto-filled next number keep updating (e.g. once real data loads in) up
  // until they've made it their own, without ever overwriting an edit.
  const [receiptNoTouched, setReceiptNoTouched] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedAccountName = bankAccountId
    ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash'
    : 'Cash';

  // 001, 002, 003... ascending off the highest number already used in this
  // direction - padded to 3 digits until there are enough entries to need
  // more. Entries saved before this auto-numbering existed have no
  // receipt_no at all, so falling back to "how many entries are there"
  // when none of them parse keeps the count moving forward instead of
  // resetting to 1 forever just because the earliest ones weren't numbered.
  const nextReceiptNo = useMemo(() => {
    const entries = sameDirectionEntries ?? [];
    const nums = entries
      .map((e) => Number((e.receipt_no ?? '').replace(/\D/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0);
    const next = (nums.length ? Math.max(...nums) : entries.length) + 1;
    return String(next).padStart(3, '0');
  }, [sameDirectionEntries]);

  useEffect(() => {
    if (!receiptNoTouched) setReceiptNo(nextReceiptNo);
  }, [nextReceiptNo, receiptNoTouched]);

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerName(c.name);
    setShowPicker(false);
  }

  // Picking a phone contact not already saved (or typing a brand new name
  // in the popup's own search box) saves them now - payments must link to
  // a real customer_id, so this shouldn't mean a trip to Your Customers
  // first. If the phone number already matches someone saved, use that
  // record instead of creating an unlinked duplicate.
  async function handleSelectNew(name: string, phone: string | null) {
    if (!userId) return;
    setShowPicker(false);
    if (phone) {
      const existing = (customers ?? []).find((c) => c.phone === phone);
      if (existing) {
        selectCustomer(existing);
        return;
      }
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name, phone });
      selectCustomer(created);
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  async function handleRenameCustomer() {
    if (!selectedCustomer || !renameCustomerValue.trim()) return;
    setRenamingCustomer(true);
    try {
      await updateCustomer.mutateAsync({ id: selectedCustomer.id, values: { name: renameCustomerValue.trim() } });
      setCustomerName(renameCustomerValue.trim());
      setSelectedCustomer({ ...selectedCustomer, name: renameCustomerValue.trim() });
      setShowRenameCustomer(false);
    } catch (err) {
      showAlert('Could not rename', getErrorMessage(err));
    } finally {
      setRenamingCustomer(false);
    }
  }

  async function handleSave() {
    if (!userId) return;
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      showAlert('Add a customer', 'Tap the field to search or add a customer for this payment.');
      return;
    }
    const value = round2(Number(amount));
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    const ok = await confirmSave({
      title: `Save this ${isOut ? 'Paid' : 'Received'} entry?`,
      rows: [
        { label: payTarget === 'vendor' ? 'Vendor' : 'Customer', value: trimmedName },
        ...(receiptNo.trim() ? [{ label: isOut ? 'Payment no.' : 'Receipt no.', value: receiptNo.trim() }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Amount', value: `NPR ${formatMoney(value)}`, color: isOut ? MONEY.out.base : MONEY.in.base },
    });
    if (!ok) return;
    setSaving(true);
    try {
      // Typed a name that doesn't match anyone picked/selected above - save
      // them as a new customer on the spot rather than making this a dead
      // end that sends the reseller off to Your Customers first.
      const customer = selectedCustomer ?? (await createCustomer.mutateAsync({ owner_id: userId, name: trimmedName, phone: null }));
      await insertEntry.mutateAsync({
        [payTarget === 'vendor' ? 'vendor_id' : 'customer_id']: customer.id,
        owner_id: userId,
        entry_type: entryType,
        amount: value,
        note: note.trim() || null,
        source: 'manual',
        bank_account_id: bankAccountId,
        entry_date: date || null,
        receipt_no: receiptNo.trim() || null,
      } as any);
      showAlert(
        isOut ? 'Paid saved' : 'Received saved',
        `NPR ${formatMoney(value)} for ${customer.name}.`
      );
      setAmount('');
      setNote('');
      setSelectedCustomer(null);
      setCustomerName('');
      setBankAccountId(null);
      setDate(todayIso());
      setReceiptNoTouched(false);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Applies whatever the voice-command button understood - same "review
  // before save" rule as Scan Bill below: this only fills fields, the party
  // still needs a tap to confirm via the picker it opens, and nothing here
  // saves on its own. Depends on the actual param values (not just "on
  // mount") because Expo Router doesn't always have them hydrated on the
  // very first render of a freshly-pushed route; a `[]` effect would fire
  // once while they were still undefined and never get another chance.
  useEffect(() => {
    if (!voiceAmount && !voiceParty && !voiceDate && !voiceNote) return;
    if (voiceAmount) setAmount(voiceAmount);
    if (voiceDate) setDate(voiceDate);
    if (voiceNote) setNote(voiceNote);
    if (voiceParty) {
      setPickerQuery(voiceParty);
      setShowPicker(true);
    }
  }, [voiceAmount, voiceParty, voiceDate, voiceNote]);

  async function handleScan() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;
    if (scanned.amount) setAmount(String(scanned.amount));
    if (scanned.date) setDate(scanned.date);
    if (scanned.note) setNote(scanned.note);
    if (scanned.vendor_name) {
      setPickerQuery(scanned.vendor_name);
      setShowPicker(true);
    }
  }

  // Web only: recording several people's payments under one Date/Receipt
  // No./Payment method in a single save, instead of one form per person -
  // see the `rows` table below. Native keeps the original single-entry
  // form untouched (customerName/selectedCustomer/amount/note above).
  const [rows, setRows] = useState<PaymentRow[]>([emptyPaymentRow()]);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [rowPickerQuery, setRowPickerQuery] = useState('');
  const rowsTotal = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // "What did I just enter recently" reference list below the live summary
  // card - reuses sameDirectionEntries (already fetched for the receipt-no
  // auto-numbering above), just re-sorted and capped to the last 5.
  const recentEntries = useMemo(() => {
    return [...(sameDirectionEntries ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  }, [sameDirectionEntries]);

  function recentEntryPartyName(entry: (typeof recentEntries)[number]): string {
    const id = payTarget === 'vendor' ? (entry as any).vendor_id : (entry as any).customer_id;
    return customers?.find((c) => c.id === id)?.name ?? 'Unnamed';
  }

  const tableRef = useRef<PaymentEntryTableHandle>(null);
  const receiptRef = useRef<TextInput>(null);
  const methodRef = useRef<HTMLSelectElement | null>(null);
  const saveButtonRef = useRef<View>(null);

  function addRow(): string {
    const row = emptyPaymentRow();
    setRows((prev) => [...prev, row]);
    return row.key;
  }

  function focusFirstRow() {
    tableRef.current?.focusRow(rows[0]?.key ?? '', 0);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function updateRow(key: string, patch: Partial<PaymentRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function selectCustomerForRow(c: Customer) {
    if (activeRowKey) updateRow(activeRowKey, { selectedCustomer: c, customerName: c.name });
    setActiveRowKey(null);
  }

  // Same "typed a name that isn't saved yet -> save it now" behavior as
  // handleSelectNew above, just targeting whichever row's picker is open.
  async function handleSelectNewForRow(name: string, phone: string | null) {
    if (!userId || !activeRowKey) return;
    const key = activeRowKey;
    setActiveRowKey(null);
    if (phone) {
      const existing = (customers ?? []).find((c) => c.phone === phone);
      if (existing) {
        updateRow(key, { selectedCustomer: existing, customerName: existing.name });
        return;
      }
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name, phone });
      updateRow(key, { selectedCustomer: created, customerName: created.name });
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  // Scanning a bill in the multi-entry table adds a fresh row for it
  // instead of overwriting whichever row is already being edited.
  async function handleScanForRow() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;
    const key = makeRowKey();
    setRows((prev) => [
      ...prev,
      {
        key,
        customerName: scanned.vendor_name ?? '',
        selectedCustomer: null,
        pendingPhone: null,
        amount: scanned.amount ? String(scanned.amount) : '',
        note: scanned.note ?? '',
        item: '',
        model: '',
      },
    ]);
    if (scanned.date) setDate(scanned.date);
    if (scanned.vendor_name) {
      setRowPickerQuery(scanned.vendor_name);
      setActiveRowKey(key);
    }
  }

  async function handleSaveAll() {
    if (!userId) return;
    // A row with a name but no valid amount (or an amount but no name) used
    // to be dropped silently - point it out instead of saving without it.
    const incomplete = rows.filter(
      (r) => (r.customerName.trim() || r.amount.trim()) && !(r.customerName.trim() && Number(r.amount) > 0)
    );
    if (incomplete.length > 0) {
      showAlert(
        'Finish every row',
        `${incomplete.length} ${incomplete.length === 1 ? 'row needs' : 'rows need'} both a person and an amount above 0 - fill it in or remove it.`
      );
      return;
    }
    const validRows = rows.filter((r) => r.customerName.trim() && Number(r.amount) > 0);
    if (validRows.length === 0) {
      showAlert('Add a payment', 'Add at least one person and a valid amount to record.');
      return;
    }
    const sum = validRows.reduce((s, r) => s + Number(r.amount), 0);
    const ok = await confirmSave({
      title: `Save ${validRows.length === 1 ? 'this' : `these ${validRows.length}`} ${isOut ? 'Paid' : 'Received'} ${validRows.length === 1 ? 'entry' : 'entries'}?`,
      rows: [
        ...validRows.slice(0, 5).map((r) => ({
          label: [r.customerName.trim(), r.item.trim(), r.model.trim()].filter(Boolean).join(' · '),
          value: `NPR ${formatMoney(Number(r.amount))}`,
        })),
        ...(validRows.length > 5 ? [{ label: `+ ${validRows.length - 5} more` }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Total', value: `NPR ${formatMoney(sum)}`, color: isOut ? MONEY.out.base : MONEY.in.base },
    });
    if (!ok) return;
    setSaving(true);
    try {
      // Each row leaves the table the moment it's saved (and a customer
      // created for it is kept on the row first), so if a later row fails,
      // pressing Save again only retries what's left - never re-records the
      // ones already saved or creates their customer twice.
      for (const row of validRows) {
        const trimmedName = row.customerName.trim();
        let customer = row.selectedCustomer;
        if (!customer) {
          // A name typed in full without picking it from the list still
          // means the saved customer of that name, not a duplicate of them.
          customer =
            (customers ?? []).find((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()) ?? null;
        }
        if (!customer) {
          customer = await createCustomer.mutateAsync({ owner_id: userId, name: trimmedName, phone: row.pendingPhone });
        }
        if (customer !== row.selectedCustomer) {
          updateRow(row.key, { selectedCustomer: customer, customerName: customer.name });
        }
        await insertEntry.mutateAsync({
          [payTarget === 'vendor' ? 'vendor_id' : 'customer_id']: customer.id,
          owner_id: userId,
          entry_type: entryType,
          amount: round2(Number(row.amount)),
          // The car and its model go first in the remark, so the ledger and Total Paid name them.
          note: [row.item.trim(), row.model.trim(), row.note.trim()].filter(Boolean).join(' · ') || null,
          source: 'manual',
          bank_account_id: bankAccountId,
          entry_date: date || null,
          receipt_no: receiptNo.trim() || null,
        } as any);
        setRows((prev) => {
          const rest = prev.filter((r) => r.key !== row.key);
          return rest.length ? rest : [emptyPaymentRow()];
        });
      }
      showAlert(
        isOut ? 'Paid saved' : 'Received saved',
        `${validRows.length} ${validRows.length === 1 ? 'entry' : 'entries'} saved, NPR ${formatMoney(
          validRows.reduce((sum, r) => sum + Number(r.amount), 0)
        )} total.`
      );
      const fresh = emptyPaymentRow();
      setRows([fresh]);
      setBankAccountId(null);
      setDate(todayIso());
      setReceiptNoTouched(false);
      // Ready for the next voucher - caret straight back in the first cell.
      tableRef.current?.focusRow(fresh.key, 0);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const meta = isOut
    ? { label: 'Paid', color: '#DC2626', gradient: ['#DC2626', '#B91C1C'] as const, bg: 'bg-red-50', icon: 'arrow-up-circle' as const }
    : { label: 'Received', color: '#059669', gradient: ['#059669', '#047857'] as const, bg: 'bg-emerald-50', icon: 'arrow-down-circle' as const };

  const scanBillButton = (
    <Pressable
      onPress={handleScan}
      disabled={scanning}
      className="flex-row items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-50 px-4 py-2.5 disabled:opacity-50"
    >
      <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={16} color="#2563EB" />
      <Text className="text-sm font-semibold text-blue-700">{scanning ? 'Reading the slip…' : 'Scan Bill'}</Text>
    </Pressable>
  );

  const customerSection = (
    <FormSection icon="person-outline" title={payTarget === 'vendor' ? 'Vendor' : 'Customer'} first>
      <View className="mb-1 flex-row items-center gap-2">
        <Pressable
          onPress={() => {
            phoneContacts.request();
            setPickerQuery('');
            setShowPicker(true);
          }}
          className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
        >
          <Text className={`flex-1 text-sm ${customerName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
            {customerName ||
              (payTarget === 'vendor'
                ? isOut
                  ? 'Which vendor are you paying?'
                  : 'Which vendor is this refund from?'
                : isOut
                  ? 'Who are you paying?'
                  : 'Who is this payment from?')}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
        </Pressable>
        {!!selectedCustomer && (
          <Pressable
            onPress={() => {
              setRenameCustomerValue(selectedCustomer.name);
              setShowRenameCustomer(true);
            }}
            hitSlop={8}
            className="rounded-lg border border-gray-300 bg-white p-2.5"
          >
            <Ionicons name="pencil-outline" size={16} color="#6B7280" />
          </Pressable>
        )}
      </View>
      {showRenameCustomer && (
        <View className="mb-1 flex-row items-center gap-2">
          <TextInput
            value={renameCustomerValue}
            onChangeText={setRenameCustomerValue}
            autoFocus
            placeholder="Name"
            placeholderTextColor="#9CA3AF"
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          />
          <Pressable onPress={handleRenameCustomer} disabled={renamingCustomer} hitSlop={8}>
            <Ionicons name="checkmark-circle" size={22} color="#059669" />
          </Pressable>
          <Pressable onPress={() => setShowRenameCustomer(false)} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color="#9CA3AF" />
          </Pressable>
        </View>
      )}
      {selectedCustomer ? (
        <View className="flex-row items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2">
          <Ionicons name="checkmark-circle" size={14} color="#1d4ed8" />
          <Text className="flex-1 text-xs font-medium text-blue-700">
            Using saved {payTarget === 'vendor' ? 'vendor' : 'customer'}
          </Text>
        </View>
      ) : (
        <Text className="text-[11px] text-gray-400">Tap to search your saved customers and phone contacts.</Text>
      )}
    </FormSection>
  );

  const paymentMethodSection = (
    <FormSection icon="wallet-outline" title="Payment method">
      <Pressable
        onPress={() => setShowAccountPicker(true)}
        className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
          <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>
    </FormSection>
  );

  const pickerModals = (
    <>
      {confirmDialog}
      <ContactPickerModal
        visible={showPicker}
        initialQuery={pickerQuery}
        customers={customers ?? []}
        phoneContacts={phoneContacts.contacts}
        onSelectCustomer={selectCustomer}
        onSelectNew={handleSelectNew}
        onClose={() => setShowPicker(false)}
      />
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
        available={available}
      />
    </>
  );

  // On web the page's name and its Scan Bill button live in the top bar; the
  // heading that used to repeat the name under it is gone.
  const scanRowRef = useRef<() => void>(() => {});
  scanRowRef.current = handleScanForRow;
  useScreenHeader(
    desktopWeb
      ? {
          title: meta.label,
          resetTitle: 'Quick Payment',
          headerRight: () => (
            <Pressable
              onPress={() => scanRowRef.current()}
              disabled={scanning}
              className="h-9 flex-row items-center justify-center rounded-lg border border-blue-600 bg-blue-50 px-3.5 disabled:opacity-50"
              style={{ gap: 6 }}
            >
              <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={15} color="#2563EB" />
              <Text className="text-[13px] font-semibold text-blue-700">{scanning ? 'Reading…' : 'Scan Bill'}</Text>
            </Pressable>
          ),
        }
      : {},
    [meta.label, scanning]
  );

  if (desktopWeb) {
    const accent = FINANCE_ENTRY_ACCENT;
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View className="px-8 pt-6">
          <View className="flex-row" style={{ gap: 24 }}>
            <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
              {/* Date/Receipt No. and Payment method apply to every row in
                  the table below - one voucher covering several people,
                  not a separate form per person. Everything here is
                  reachable and fillable from the keyboard alone: Tab/Enter
                  walk Date -> Receipt No. -> Payment method -> the table. */}
              <View
                className="mb-4 rounded-2xl border border-gray-200 bg-white px-5 py-4"
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)' }}
              >
                <View className="mb-3 flex-row items-center gap-2">
                  <Ionicons name="document-text-outline" size={14} color="#6B7280" />
                  <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">Details</Text>
                </View>
                <View className="flex-row" style={{ gap: 14 }}>
                  <View style={{ flex: 1.3, minWidth: 0 }}>
                    <Text className="mb-1.5 text-xs font-semibold text-gray-600">Date</Text>
                    <KeyboardDateInput
                      value={date}
                      onChange={setDate}
                      accent={accent}
                      onEnter={() => receiptRef.current?.focus()}
                      onRequestSave={handleSaveAll}
                    />
                  </View>
                  <View style={{ flex: 0.8, minWidth: 0 }}>
                    <Text className="mb-1.5 text-xs font-semibold text-gray-600">{isOut ? 'Payment No.' : 'Receipt No.'}</Text>
                    <TextInput
                      ref={receiptRef}
                      value={receiptNo}
                      onChangeText={(v) => {
                        setReceiptNo(v);
                        setReceiptNoTouched(true);
                      }}
                      onKeyPress={(e) => {
                        const k = readKey(e);
                        if (k.key !== 'Enter') return;
                        k.prevent();
                        if (k.ctrl) handleSaveAll();
                        else methodRef.current?.focus();
                      }}
                      placeholder="Optional"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="numeric"
                      selectTextOnFocus
                      accessibilityLabel={isOut ? 'Payment number' : 'Receipt number'}
                      className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-900"
                      style={{ outlineStyle: 'none' } as object}
                    />
                  </View>
                  <View style={{ flex: 1.1, minWidth: 0 }}>
                    <Text className="mb-1.5 text-xs font-semibold text-gray-600">Payment method</Text>
                    <KeyboardSelect
                      value={bankAccountId ?? '__cash__'}
                      options={[
                        { value: '__cash__', label: 'Cash' },
                        ...bankAccounts.accounts.map((a) => ({ value: a.id, label: optionLabel(a.name, available?.byId[a.id]) })),
                      ]}
                      onChange={(v) => setBankAccountId(v === '__cash__' ? null : v)}
                      selectRef={(el) => {
                        methodRef.current = el;
                      }}
                      onEnter={focusFirstRow}
                      onRequestSave={handleSaveAll}
                      accent={accent}
                      label="Payment method"
                    />
                  </View>
                </View>
              </View>

              <PaymentEntryTable
                ref={tableRef}
                rows={rows}
                customers={customers ?? []}
                phoneContacts={phoneContacts.contacts}
                accent={accent}
                partyLabel={payTarget === 'vendor' ? 'Vendor' : 'Customer'}
                addLabel={`Add ${payTarget === 'vendor' ? 'vendor' : 'person'}`}
                totalLabel={isOut ? 'Total Paid' : 'Total Received'}
                totalColor={meta.color}
                onUpdateRow={updateRow}
                withCar={withCar}
                carOptionsFor={carOptionsFor}
                onCreateParty={async (name) => {
                  try {
                    return await createCustomer.mutateAsync({ owner_id: userId, name, phone: null });
                  } catch (err) {
                    showAlert('Could not add ' + (payTarget === 'vendor' ? 'vendor' : 'customer'), getErrorMessage(err));
                    return null;
                  }
                }}
                onAddRow={addRow}
                onRemoveRow={removeRow}
                onRequestSave={handleSaveAll}
                onExit={() => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.()}
                autoFocusFirst
              />

              <View className="mt-4 flex-row items-center justify-end" style={{ gap: 16 }}>
                <View className="flex-row" style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => router.back()}
                    className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5"
                  >
                    <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                  </Pressable>
                  <Pressable
                    ref={saveButtonRef}
                    onPress={handleSaveAll}
                    disabled={saving}
                    className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
                    style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${FINANCE_ENTRY_SHADOW}` }}
                  >
                    <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={{ width: 320 }}>
              <View className="rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="mb-2 text-[11px] font-bold capitalize tracking-wide text-gray-400">
                  Recent {isOut ? 'Paid' : 'Received'}
                </Text>
                {recentEntries.length === 0 ? (
                  <Text className="text-xs text-gray-400">No entries yet.</Text>
                ) : (
                  recentEntries.map((entry, i) => (
                    <View
                      key={entry.id}
                      className={`flex-row items-center justify-between py-2 ${i < recentEntries.length - 1 ? 'border-b border-gray-50' : ''}`}
                    >
                      <View className="flex-1 pr-2">
                        <Text numberOfLines={1} className="text-xs font-semibold text-gray-800">
                          {recentEntryPartyName(entry)}
                        </Text>
                        <Text className="text-[10px] text-gray-400">
                          {toBsHistoryLabel(entry.entry_date ?? entry.created_at)}
                        </Text>
                        {withCar && !!entry.note && (
                          <Text numberOfLines={1} className="text-[10px] text-gray-500">
                            {entry.note}
                          </Text>
                        )}
                      </View>
                      <Text className="text-xs font-bold" style={{ color: accent }}>
                        NPR {formatMoney(entry.amount)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>
        </View>

        {confirmDialog}

        <ContactPickerModal
          visible={activeRowKey != null}
          initialQuery={rowPickerQuery}
          customers={customers ?? []}
          phoneContacts={phoneContacts.contacts}
          onSelectCustomer={selectCustomerForRow}
          onSelectNew={handleSelectNewForRow}
          onClose={() => setActiveRowKey(null)}
        />
        <BankAccountPickerModal
          visible={showAccountPicker}
          accounts={bankAccounts.accounts}
          selectedId={bankAccountId}
          onSelect={setBankAccountId}
          onClose={() => setShowAccountPicker(false)}
          onRename={bankAccounts.rename}
          onDelete={bankAccounts.remove}
        />
      </ScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-gray-50 px-6 pt-4"
      contentContainerStyle={{ paddingBottom: 40 }}
      enableOnAndroid
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      <View className={`mb-3 flex-row items-center gap-2 rounded-2xl p-4 ${meta.bg}`}>
        <Ionicons name={meta.icon} size={20} color={meta.color} />
        <Text className="text-base font-bold" style={{ color: meta.color }}>
          {meta.label}
        </Text>
      </View>

      <View className="mb-3">{scanBillButton}</View>

      <View className="rounded-2xl border border-gray-200 bg-white p-4">
        {customerSection}

        <FormSection icon="document-text-outline" title="Details">
          <View className="mb-3 flex-row gap-2">
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
              <DateField value={date} onChange={setDate} />
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-xs font-medium text-gray-500">{isOut ? 'Payment No.' : 'Receipt No.'}</Text>
              <TextInput
                value={receiptNo}
                onChangeText={(v) => {
                  setReceiptNo(v);
                  setReceiptNoTouched(true);
                }}
                placeholder="Optional"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                className="rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-900"
              />
            </View>
          </View>

          <Text className="mb-1 text-xs font-medium text-gray-500">
            Amount (NPR)
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 1000"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            className="mb-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
          />

          <Text className="mb-1 text-xs font-medium text-gray-500">Remarks (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Cash payment"
            placeholderTextColor="#9CA3AF"
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
          />
        </FormSection>

        {paymentMethodSection}

        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="items-center rounded-lg py-3 disabled:opacity-50"
          style={{ backgroundColor: meta.color }}
        >
          <Text className="text-base font-semibold text-white">
            {saving ? 'Saving…' : isOut ? 'Save Paid' : 'Save Received'}
          </Text>
        </Pressable>
      </View>

      {pickerModals}
    </KeyboardAwareScrollView>
  );
}
