// lib/components/finance/CustomersListScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, TextInput, Pressable, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseInsert, useSupabaseQuery } from '../../hooks/useSupabase';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { usePartyDestination } from '../../hooks/usePartyDestination';
import { useFreshLedgerArea } from '../../hooks/useFreshLedgerArea';
import { supabase } from '../../supabase';
import { BookPage, BookStats, BookTable, Pill, ToolbarButton, ToolbarSearch, money as bookMoney, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { PartyBalance } from './PartyBalance';
import { PartyTypeField } from './PartyTypeField';
import { LedgerTypeMenuModal } from './LedgerTypeMenuModal';
import { Field, FieldRow, FormActions, INPUT, PopupCard } from './FormKit';
import { CapsProvider, Text } from './CapsText';
import { ExcelButton, PrintButton, exportReportDocument, printReportDocument } from './PrintButton';
import { reportHtml, type PrintReport, type PrintSection } from '../../utils/printReport';
import { Checkbox, LEDGER_TONE, StatusBadges, SummaryCard } from './ledger/LedgerUi';
import { partyPosition, type PartyPosition } from '../../utils/partyBalance';
import { round2 } from '../../utils/money';
import {
  compareItems,
  drCr,
  entryDay,
  overdueAmount,
  receivableAging,
  relativeDay,
  sideTotals,
  statusOf,
  summarize,
  withRunningBalance,
  type LedgerItem,
  type PartyStatus,
  type PartyTotals,
} from '../../utils/ledgerStatement';
import { exportPartiesXlsx, type PartyListRow } from '../../utils/exportLedger';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { nameCaps, capWords } from '../../utils/nameCaps';
import { isValidPhone10 } from '../../utils/phone';
import { localTodayIso } from '../../utils/localDate';
import { journalOf } from '../../utils/journalVoucher';
import { highlightText as highlight } from './Highlight';
import { itemNamesOf, sellsVehicles } from '../../utils/accountFeatures';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { pickPhoneContact } from '../../utils/pickPhoneContact';
import type { BusinessTransactionType, Customer, CustomerLedgerEntry, Profile } from '../../../types/database.types';

/** A reference number and what it is the number of ("Sales no.", "Payment no.", ...). */
interface LedgerReference {
  no: string;
  kind: string;
}

const BILL_KIND: Record<BusinessTransactionType, string> = { sale: 'Sales no.', purchase: 'Purchase no.', expense: 'Expenses no.' };

/** Every ledger entry of every party, grouped by party. A party's two ledgers
 * (customer_ledger_entries, vendor_ledger_entries - opposite polarity, see
 * 0059_vendor_ledger.sql) are shown as the one account they add up to; the
 * arithmetic is in ledgerStatement.ts.
 *
 * `referenceById` is each entry's reference number (by entry id, only for entries that have
 * one): the number of the bill it was posted from, else its own receipt / payment number -
 * as a party's statement shows it - with what kind of number it is. */
function useLedgerItems(userId: string | undefined): {
  byParty: Map<string, LedgerItem[]>;
  referenceById: Map<string, LedgerReference>;
  /** Money that actually moved with each party: all received from them, all paid to them (journal vouchers are not cash). */
  cashByParty: Map<string, { paid: number; received: number }>;
} {
  // `all`: balances are sums over every entry, and the API cuts a plain read
  // off at 1000 rows - past that, each party's balance is silently wrong.
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  // A bill's number is on the bill, not on the ledger entry it posts: read just what is needed of it
  // (its items too, for an account that shows the item in place of the remark).
  const { data: bills } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    columns: 'id,bill_no,type,items',
    all: true,
    enabled: !!userId,
  });
  const profile = useAuthStore((state) => state.profile);
  const showItems = sellsVehicles(profile?.business_name?.trim() || profile?.full_name);

  return useMemo(() => {
    const byParty = new Map<string, LedgerItem[]>();
    const referenceById = new Map<string, LedgerReference>();
    const cashByParty = new Map<string, { paid: number; received: number }>();
    const cash = (partyId: string) => {
      let c = cashByParty.get(partyId);
      if (!c) {
        c = { paid: 0, received: 0 };
        cashByParty.set(partyId, c);
      }
      return c;
    };
    const add = (partyId: string, item: LedgerItem) => {
      const list = byParty.get(partyId);
      if (list) list.push(item);
      else byParty.set(partyId, [item]);
    };
    const billById = new Map((bills ?? []).map((b) => [b.id, b]));
    const note = (side: 'customer' | 'vendor', e: Pick<CustomerLedgerEntry, 'id' | 'entry_type' | 'source' | 'source_type' | 'source_id' | 'receipt_no'>) => {
      const fromBill = e.source === 'booking' && e.source_type === 'business_transaction' && !!e.source_id;
      const bill = fromBill ? billById.get(e.source_id!) : undefined;
      const no = bill?.bill_no || e.receipt_no;
      if (!no) return;
      const debit = e.entry_type === 'debit';
      // A bill is a sales / purchase / expense no.; money paid out is a payment no.; money received is a receipt no.
      const kind = bill
        ? BILL_KIND[bill.type]
        : side === 'vendor'
          ? debit
            ? 'Purchase no.'
            : 'Payment no.'
          : debit
            ? fromBill
              ? 'Sales no.'
              : e.source === 'manual'
                ? 'Payment no.'
                : 'Receipt no.'
            : 'Receipt no.';
      referenceById.set(e.id, { no, kind });
    };
    // What a line says about itself: the remark - or, for an entry a bill posted on an account that shows
    // items, the item (car) on that bill, falling back to the remark when the bill has none.
    const noteOf = (e: Pick<CustomerLedgerEntry, 'source' | 'source_type' | 'source_id' | 'note'>) => {
      const fromBill = e.source === 'booking' && e.source_type === 'business_transaction' && !!e.source_id;
      if (!showItems || !fromBill) return e.note;
      return itemNamesOf(billById.get(e.source_id!)?.items) || e.note;
    };
    for (const e of customerEntries ?? []) {
      note('customer', e);
      // Received: what they paid in. Paid: money given out to them by hand (a debit a bill posts is not cash).
      if (!journalOf(e.note)) {
        if (e.entry_type === 'credit') cash(e.customer_id).received += Number(e.amount);
        else if (e.source === 'manual') cash(e.customer_id).paid += Number(e.amount);
      }
      add(e.customer_id, {
        id: e.id,
        side: 'customer',
        entryType: e.entry_type,
        amount: Number(e.amount),
        day: entryDay(e.entry_date, e.created_at),
        createdAt: e.created_at,
        note: noteOf(e),
        manual: e.source === 'manual',
      });
    }
    for (const e of vendorEntries ?? []) {
      note('vendor', e);
      // Paid: what was paid to the vendor (the debits are the bills they sent).
      if (!journalOf(e.note) && e.entry_type === 'credit') cash(e.vendor_id).paid += Number(e.amount);
      add(e.vendor_id, {
        id: e.id,
        side: 'vendor',
        entryType: e.entry_type,
        amount: Number(e.amount),
        day: entryDay(e.entry_date, e.created_at),
        createdAt: e.created_at,
        note: noteOf(e),
      });
    }
    return { byParty, referenceById, cashByParty };
  }, [customerEntries, vendorEntries, bills, showItems]);
}

/** Id of the existing customer already using `phone` for this owner, if any. */
async function findExistingCustomerByPhone(ownerId: string, phone: string, excludeCustomerId?: string) {
  let query = supabase.from('customers').select('id').eq('owner_id', ownerId).eq('phone', phone);
  if (excludeCustomerId) query = query.neq('id', excludeCustomerId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

function AddCustomerForm({ userId, basePath, initialName, onDone }: { userId: string; basePath: string; initialName?: string; onDone: () => void }) {
  const createCustomer = useSupabaseInsert('customers');
  const hrefFor = usePartyDestination(userId, basePath);
  // A ledger type is required - unless there are none to choose from (the types table
  // is not set up yet), where the field is not shown at all.
  const { available: typesAvailable } = usePartyTypes(userId);
  const [name, setName] = useState(initialName ? nameCaps(initialName) : '');
  const nameInput = useRef<TextInput>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [partyTypeId, setPartyTypeId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleUseMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Location permission needed', 'Allow location access to attach a position.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch (err) {
      showAlert('Could not get location', getErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }

  async function handlePickContact() {
    const picked = await pickPhoneContact();
    if (!picked) return;
    if (picked.name) setName(nameCaps(picked.name));
    if (picked.phone) setPhone(picked.phone);
  }

  async function handleSave() {
    // The name and the ledger type are required; the phone number and address are not
    // (a phone number, when given, has to be a real one).
    const trimmedPhone = phone.trim();
    const missing = [!name.trim() && 'Name', typesAvailable && !partyTypeId && 'Ledger type'].filter(Boolean);
    if (missing.length > 0) {
      showAlert('Fill in the required details', `Still needed: ${missing.join(', ')}.`);
      return;
    }
    if (trimmedPhone && !isValidPhone10(trimmedPhone)) {
      showAlert('Check the phone number', 'Enter a valid 10-digit phone number.');
      return;
    }
    setSaving(true);
    try {
      const existingId = trimmedPhone ? await findExistingCustomerByPhone(userId, trimmedPhone) : null;
      if (existingId) {
        // Almost always means this contact was already pulled in by the
        // background phone-contacts sync (see contactsSync.ts) before the
        // user got to it manually - a flat "already exists" refusal with no
        // way forward reads as the app just blocking them, so take them
        // straight to the record that's already there instead.
        showAlert('Already saved', 'Someone with this phone number is already in your list.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'View them', onPress: () => router.push(hrefFor(existingId) as any) },
        ]);
        onDone();
        return;
      }
      await createCustomer.mutateAsync({
        owner_id: userId,
        name: nameCaps(name.trim()),
        phone: trimmedPhone || null,
        address: address.trim() || null,
        // Only sent when chosen: without the types table there is nothing to send.
        ...(partyTypeId ? { party_type_id: partyTypeId } : {}),
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      });
      onDone();
    } catch (err) {
      showAlert('Could not save customer', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PopupCard title="New party" onClose={onDone}>
      <FieldRow>
        <Field label="Name *" basis={240}>
          <View className="flex-row items-center rounded-lg border border-gray-300 bg-white">
            <TextInput
              value={name}
              ref={nameInput}
              onChange={(e) => {
                // typing keeps the caret where it is: capitalising a letter must not send it to the end
                const el = (e.nativeEvent as unknown as { target?: HTMLInputElement }).target;
                const at = el?.selectionStart;
                if (Platform.OS === 'web' && el && at != null) requestAnimationFrame(() => el.setSelectionRange?.(at, at));
              }}
              onChangeText={(v) => setName(capWords(v))}
              autoCapitalize="words"
              autoFocus
              placeholder="Name"
              placeholderTextColor="#9CA3AF"
              className="flex-1 px-3 py-2.5 text-sm text-gray-900"
            />
            {Platform.OS !== 'web' && (
              <Pressable onPress={handlePickContact} hitSlop={8} className="px-2.5">
                <Ionicons name="person-add-outline" size={18} color="#1d4ed8" />
              </Pressable>
            )}
          </View>
        </Field>
        <Field label="Phone (10 digits)" basis={180}>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
            placeholder="98XXXXXXXX"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            maxLength={10}
            className={INPUT}
          />
        </Field>
        <Field label="Address" basis={320}>
          <TextInput
            value={address}
            onChangeText={setAddress}
            autoCapitalize="words"
            placeholder="Address"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
            style={{ textTransform: 'capitalize' }}
          />
        </Field>
      </FieldRow>

      <PartyTypeField ownerId={userId} value={partyTypeId} onChange={setPartyTypeId} required />

      <Pressable
        onPress={handleUseMyLocation}
        disabled={locating}
        className="items-center rounded-lg border border-blue-700 bg-blue-50 py-2 disabled:opacity-50"
      >
        <Text className="text-xs font-semibold text-blue-700">
          {locating ? 'Locating…' : coords ? '📍 Location captured' : '📍 Attach current location (optional)'}
        </Text>
      </Pressable>

      <Text className="text-[11px] text-gray-400">* Required</Text>

      <FormActions onCancel={onDone} onSave={handleSave} saving={saving} />
    </PopupCard>
  );
}

/** One party as the Ledger list works with it: the row itself plus its figures
 * for the period on screen. */
interface PartyRowData {
  row: MergedRow;
  totals: PartyTotals;
  /** What was billed to them (the customer ledger's sales and "customer owes" entries). */
  sales: number;
  /** What was bought from them on credit (the vendor ledger). */
  purchases: number;
  /** Money that actually moved: received from them plus paid out to them. */
  payments: number;
  /** Where the account stands at the end of the period; positive = they owe you. */
  balance: number;
  status: PartyStatus;
  /** The part of it that is overdue - 0 unless they owe you. */
  overdue: number;
  /** Their ledger type, when one is set. */
  typeName: string | undefined;
  /** The reference number (sales, purchase, payment or receipt no.) of their latest transaction - null when it has none. */
  lastReference: LedgerReference | null;
  /** All the money paid to them, and all received from them, as of today. */
  totalPaid: number;
  totalReceived: number;
}

/** The balance as the shared balance cell draws it. */
function positionOf(data: PartyRowData): PartyPosition {
  const base = partyPosition({ receivable: data.balance, payable: 0 });
  // Both of their ledgers are in this one figure - say so, as the list always has.
  return { ...base, bothLedgers: data.totals.hasCustomer && data.totals.hasVendor };
}

const dash = (n: number) => (round2(n) === 0 ? '—' : bookMoney(n));

/** One header of the Ledger: a Ledger type (Customer, Vendor, Employee, Expense ...) and the parties
 * under it, with what they add up to. */
interface LedgerGroup {
  key: string;
  label: string;
  rows: PartyRowData[];
  /** What the ones who owe you add up to. */
  receivable: number;
  /** What you owe the ones you owe. */
  payable: number;
  /** Both netted: positive = they owe you. */
  net: number;
}

/** The header an app user with no saved ledger sits under when there is no Ledger type called Customer. */
const CUSTOMER_GROUP = '__customer__';

/** A party on a phone: who, how to reach them, when they last traded, Sales /
 * Purchases / Payments / Balance, and where they stand. */
function PartyCard({
  data,
  onOpen,
  today,
  selecting,
  selected,
  onToggle,
}: {
  data: PartyRowData;
  /** Opens their ledger in a popup. */
  onOpen: () => void;
  today: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  if (data.row.kind !== 'customer') return <AppCustomerRow entry={data.row.entry} />;
  const { customer, isApp } = data.row;
  const { totals } = data;
  // The ledger type and how to reach them, side by side on one line.
  const typeAndContact = [data.typeName, customer.phone, customer.address].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => (selecting ? onToggle() : onOpen())}
      className="mb-2.5 rounded-2xl border bg-white p-3.5"
      style={{ borderColor: selected ? '#2563EB' : '#E5E7EB' }}
    >
      <View className="flex-row items-start" style={{ gap: 10 }}>
        {selecting && <Checkbox checked={selected} onPress={onToggle} label={`Select ${customer.name}`} />}
        <View className="flex-1" style={{ minWidth: 0 }}>
          {/* Wraps, so on a narrow phone the APP badge drops below the name instead of cutting it short. */}
          <View className="flex-row flex-wrap items-center" style={{ columnGap: 8, rowGap: 4 }}>
            <Text className="font-semibold text-gray-900" style={{ flexShrink: 1 }} numberOfLines={1}>
              {nameCaps(customer.name)}
            </Text>
            {isApp && (
              <View className="flex-row items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5">
                <Ionicons name="phone-portrait-outline" size={11} color="#2563eb" />
                <Text className="text-[10px] font-bold text-blue-700">APP</Text>
              </View>
            )}
          </View>
          {!!typeAndContact && (
            <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
              {typeAndContact}
            </Text>
          )}
          {totals.lastDay && (
            <Text className="mt-0.5 text-[11px] text-gray-400" numberOfLines={1}>
              Last transaction {toBsHistoryLabel(totals.lastDay)} · {relativeDay(totals.lastDay, today)}
            </Text>
          )}
        </View>
        <View className="items-end" style={{ gap: 4 }}>
          <PartyBalance position={positionOf(data)} compact />
          <StatusBadges status={data.status} overdue={data.overdue > 0} />
        </View>
      </View>
      <View className="mt-2.5 flex-row border-t border-gray-100 pt-2" style={{ gap: 16 }}>
        <Text className="text-[12px] text-gray-500">
          Sales <Text className="font-semibold text-gray-800">{dash(data.sales)}</Text>
        </Text>
        <Text className="text-[12px] text-gray-500">
          Purchases <Text className="font-semibold text-gray-800">{dash(data.purchases)}</Text>
        </Text>
        <Text className="text-[12px] text-gray-500">
          Payments <Text className="font-semibold text-gray-800">{dash(data.payments)}</Text>
        </Text>
        {data.overdue > 0 && (
          <Text className="text-[12px] text-gray-500">
            Overdue <Text className="font-semibold" style={{ color: LEDGER_TONE.overdue.text }}>{bookMoney(data.overdue)}</Text>
          </Text>
        )}
      </View>
    </Pressable>
  );
}

interface AppCustomer {
  profile: Profile;
  requestCount: number;
  lastRequestAt: string;
}

// Jageer's marketplace shows app users here; a department store has none,
// so this stays empty and the ledger lists only the store's own customers.
function useAppCustomers(_userId: string | undefined): AppCustomer[] {
  return useMemo(() => [], []);
}

function AppCustomerRow({ entry }: { entry: AppCustomer }) {
  const { profile, requestCount, lastRequestAt } = entry;
  return (
    <View className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4">
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="flex-1 font-semibold text-gray-900" numberOfLines={1}>
          {profile.full_name ?? 'Unnamed'}
        </Text>
        <View className="flex-row items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5">
          <Ionicons name="phone-portrait-outline" size={11} color="#2563eb" />
          <Text className="text-[10px] font-bold text-blue-700">APP</Text>
        </View>
      </View>
      {!!profile.phone && (
        <Text className="mt-0.5 text-xs text-gray-500">
          <Ionicons name="call-outline" size={11} color="#9CA3AF" /> {profile.phone}
        </Text>
      )}
      {!!profile.city && (
        <Text className="mt-0.5 text-xs text-gray-500">
          <Ionicons name="location-outline" size={11} color="#9CA3AF" /> {profile.city}
        </Text>
      )}
      <Text className="mt-1.5 text-xs text-gray-400">
        {requestCount} request{requestCount === 1 ? '' : 's'} · last on {new Date(lastRequestAt).toLocaleDateString()}
      </Text>
    </View>
  );
}

// One combined row: either a saved customer (tappable into the ledger) or,
// for a registered app user who's booked a request but was never saved to
// the customers directory, an app-only row (informational, same as the old
// "App Customers" tab - there's no customer_id to open a ledger for).
type MergedRow =
  | { kind: 'customer'; id: string; name: string; phone: string | null; customer: Customer; isApp: boolean }
  | { kind: 'app'; id: string; name: string; phone: string | null; entry: AppCustomer };

/** What the summary cards narrow the list to: 'open' is everyone with a balance either way (the Net balance card). */
type StatusFilter = 'all' | 'receivable' | 'payable' | 'open';

/** "No ledger type" in the bulk menu - the key can't clash with a real type's id. */
const NO_TYPE = '__none__';

/** Exports the list on screen to Excel - the page's Excel button, beside Print. */
function ExportButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityLabel="Export the list to Excel"
      className="h-9 flex-row items-center rounded-lg border border-gray-300 bg-white px-3"
      style={{ gap: 6, opacity: busy ? 0.5 : 1 }}
    >
      <Ionicons name="download-outline" size={14} color="#047857" />
      <Text className="text-[13px] font-semibold text-gray-700">{busy ? 'Exporting…' : 'Excel'}</Text>
    </Pressable>
  );
}

/** The strip that appears once something is ticked: what to do with those parties. */
function BulkBar({
  count,
  total,
  onSelectAll,
  onClear,
  onSetType,
  onExport,
}: {
  count: number;
  /** How many parties the current filters match - "select all N". */
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onSetType: () => void;
  onExport: () => void;
}) {
  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      className="h-8 flex-row items-center rounded-lg border border-blue-200 bg-white px-2.5"
      style={{ gap: 5 }}
    >
      <Ionicons name={icon} size={14} color="#1D4ED8" />
      <Text className="text-[12.5px] font-semibold text-blue-800">{label}</Text>
    </Pressable>
  );
  return (
    <View className="flex-row flex-wrap items-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2" style={{ gap: 8 }}>
      <Text className="text-[13px] font-bold text-blue-900">{count} selected</Text>
      {count < total && (
        <Pressable onPress={onSelectAll} hitSlop={6}>
          <Text className="text-[12.5px] font-semibold text-blue-700">Select all {total}</Text>
        </Pressable>
      )}
      <View className="flex-1" />
      {action('pricetag-outline', 'Set ledger type', onSetType)}
      {action('download-outline', 'Export selected', onExport)}
      <Pressable onPress={onClear} hitSlop={6}>
        <Text className="text-[12.5px] font-semibold text-gray-500">Clear</Text>
      </Pressable>
    </View>
  );
}

/** The Ledger page: every word on it - table, cards, popups, top-bar controls - is in capitals. */
export function CustomersListScreen(props: { basePath: string }) {
  // Keyed on the visit: once the Ledger has been left for another page, the list comes back with
  // nothing open, nothing typed in the search and the figures read again.
  const visit = useFreshLedgerArea();
  return (
    <CapsProvider>
      <LedgerList key={visit} {...props} />
    </CapsProvider>
  );
}

/** A party's ledger in a popup: every entry on it as a statement - Debit, Credit and the balance after
 * it - newest first, in the same scrollable table the other reports open. Print and Excel for it, and
 * the way on to their ledger page, are in the blue bar. */
function PartyLedgerPopup({
  data,
  items,
  referenceById,
  businessName,
  vehicles,
  onOpenLedger,
  onClose,
}: {
  data: PartyRowData;
  items: LedgerItem[];
  referenceById: Map<string, LedgerReference>;
  businessName: string;
  /** A vehicle account reads the popup like the Ledger table: price, paid, received and what is left. */
  vehicles?: boolean;
  onOpenLedger: () => void;
  onClose: () => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const { width } = useWindowDimensions();
  const roomy = width >= 760;
  const name = nameCaps(data.row.name);

  // Oldest first to work the balance out, then newest first to read.
  const lines = useMemo(() => {
    const oldestFirst = [...items].sort(compareItems).map((item) => ({ item, ...drCr(item.side, item.entryType, item.amount) }));
    return withRunningBalance(oldestFirst, 0).reverse();
  }, [items]);
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  const closing = debit - credit;

  // What each line is, in the Ledger table's own words: the price billed, the money paid, the money received.
  // (A journal voucher moves no money, so it is none of them; it still moves what is left to receive or pay.)
  const moneyOf = (item: LedgerItem): 'billed' | 'paid' | 'received' | 'none' =>
    journalOf(item.note)
      ? 'none'
      : item.side === 'customer'
        ? item.entryType === 'credit'
          ? 'received'
          : item.manual
            ? 'paid'
            : 'billed'
        : item.entryType === 'debit'
          ? 'billed'
          : 'paid';
  const amountOfKind = (kind: 'billed' | 'paid' | 'received') =>
    round2(lines.reduce((sum, l) => sum + (moneyOf(l.item) === kind ? l.item.amount : 0), 0));
  const priceTotal = amountOfKind('billed');
  const paidTotal = amountOfKind('paid');
  const receivedTotal = amountOfKind('received');
  const PRICE_COLOR = '#111827';

  const sideWord = (b: number) => (round2(b) > 0 ? ' Dr' : round2(b) < 0 ? ' Cr' : '');
  const balanceText = (b: number) => `${dash(Math.abs(b))}${sideWord(b)}`;
  const balanceColor = (b: number) => (round2(b) > 0 ? LEDGER_TONE.receivable.text : round2(b) < 0 ? LEDGER_TONE.payable.text : '#6B7280');
  const kindOf = (item: LedgerItem) =>
    journalOf(item.note)
      ? 'Journal voucher'
      : item.side === 'customer'
        ? item.entryType === 'debit'
          ? vehicles && item.manual
            ? 'Paid out'
            : 'Billed'
          : 'Received'
        : item.entryType === 'debit'
          ? 'Bought on credit'
          : 'Paid';
  const subOf = (item: LedgerItem) => {
    const ref = referenceById.get(item.id);
    const journal = journalOf(item.note);
    const note = journal ? [journal.code, journal.narration].filter(Boolean).join(' · ') : item.note;
    return [ref ? `${ref.kind} ${ref.no}` : null, note].filter(Boolean).join(' · ');
  };

  const buildVehicleReport = (): PrintReport => {
    const left = (b: number) => (round2(b) > 0 ? bookMoney(b) : '');
    const owe = (b: number) => (round2(b) < 0 ? bookMoney(-b) : '');
    return {
      title: `Ledger - ${name}`,
      businessName,
      subtitle: [data.typeName, data.row.phone].filter(Boolean).join(' · ') || undefined,
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary: [
        { label: 'Balance (original price)', value: `NPR ${bookMoney(priceTotal)}` },
        { label: 'Total paid', value: `NPR ${bookMoney(paidTotal)}` },
        { label: 'Total received', value: `NPR ${bookMoney(receivedTotal)}` },
        { label: round2(closing) < 0 ? 'Payable' : 'Receivable', value: `NPR ${bookMoney(Math.abs(closing))}` },
        { label: 'Entries', value: String(lines.length) },
      ],
      sections: [
        {
          columns: [
            { label: 'SN' },
            { label: 'Date' },
            { label: 'Details' },
            { label: 'Balance', align: 'right' },
            { label: 'Total paid', align: 'right' },
            { label: 'Total received', align: 'right' },
            { label: 'Receivable', align: 'right' },
            { label: 'Payable', align: 'right' },
          ],
          rows: lines.map((l, i) => [
            String(i + 1),
            toBsHistoryLabel(l.item.day),
            [kindOf(l.item), subOf(l.item)].filter(Boolean).join(' · '),
            moneyOf(l.item) === 'billed' ? bookMoney(l.item.amount) : '',
            moneyOf(l.item) === 'paid' ? bookMoney(l.item.amount) : '',
            moneyOf(l.item) === 'received' ? bookMoney(l.item.amount) : '',
            left(l.balance),
            owe(l.balance),
          ]),
          footer: ['', '', 'Total', bookMoney(priceTotal), bookMoney(paidTotal), bookMoney(receivedTotal), left(closing), owe(closing)],
          emptyText: 'No entries yet.',
        },
      ],
      note: 'Balance is the original price: what was billed. Receivable and Payable are what is left to receive or pay after each line.',
    };
  };

  const buildReport = (): PrintReport => ({
    title: `Ledger - ${name}`,
    businessName,
    subtitle: [data.typeName, data.row.phone].filter(Boolean).join(' · ') || undefined,
    printedOn: toBsHistoryLabel(localTodayIso()),
    summary: [
      { label: 'Balance', value: `NPR ${balanceText(closing)}` },
      { label: 'Total debit', value: `NPR ${bookMoney(debit)}` },
      { label: 'Total credit', value: `NPR ${bookMoney(credit)}` },
      { label: 'Entries', value: String(lines.length) },
    ],
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Date' },
          { label: 'Details' },
          { label: 'Debit', align: 'right' },
          { label: 'Credit', align: 'right' },
          { label: 'Balance (NPR)', align: 'right' },
        ],
        rows: lines.map((l, i) => [
          String(i + 1),
          toBsHistoryLabel(l.item.day),
          [kindOf(l.item), subOf(l.item)].filter(Boolean).join(' · '),
          l.debit ? bookMoney(l.debit) : '',
          l.credit ? bookMoney(l.credit) : '',
          balanceText(l.balance),
        ]),
        footer: ['', '', 'Total', bookMoney(debit), bookMoney(credit), balanceText(closing)],
        emptyText: 'No entries yet.',
      },
    ],
    note: 'Debit = they owe you more, Credit = they owe you less. Dr = they owe you, Cr = you owe them.',
  });

  type Line = (typeof lines)[number];
  const detailsCell = (l: Line, withDate: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {kindOf(l.item)}
      </Text>
      {(!!subOf(l.item) || withDate) && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {[withDate ? toBsHistoryLabel(l.item.day) : null, subOf(l.item)].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );
  const figure = (value: number, color: string) =>
    value ? (
      <Text className="text-[12.5px] font-bold" style={{ color }} numberOfLines={1}>
        {bookMoney(value)}
      </Text>
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const balanceCell = (l: Line) => (
    <Text className="text-[12.5px] font-bold" style={{ color: balanceColor(l.balance) }} numberOfLines={1}>
      {balanceText(l.balance)}
    </Text>
  );

  // A vehicle account's popup, in the Ledger table's own columns and colours: Balance (the price billed, black),
  // Total paid (red), Total received (green), and what is left to receive (green) or pay (red) after the line.
  const kindFigure = (l: Line, kind: 'billed' | 'paid' | 'received', color: string) => figure(moneyOf(l.item) === kind ? l.item.amount : 0, color);
  const leftToReceive = (l: Line) => figure(round2(l.balance) > 0 ? l.balance : 0, LEDGER_TONE.receivable.text);
  const leftToPay = (l: Line) => figure(round2(l.balance) < 0 ? -l.balance : 0, LEDGER_TONE.payable.text);
  const vehicleColumns: BookColumn<Line>[] = roomy
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_l, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'date', label: 'Date', width: 120, render: (l) => <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(l.item.day)}</Text> },
        { key: 'details', label: 'Details', render: (l) => detailsCell(l, false) },
        { key: 'price', label: 'Balance', width: 118, align: 'right', render: (l) => kindFigure(l, 'billed', PRICE_COLOR) },
        { key: 'paid', label: 'Total paid', width: 112, align: 'right', render: (l) => kindFigure(l, 'paid', LEDGER_TONE.payable.text) },
        { key: 'received', label: 'Total received', width: 124, align: 'right', render: (l) => kindFigure(l, 'received', LEDGER_TONE.receivable.text) },
        { key: 'receivable', label: 'Receivable', width: 108, align: 'right', render: leftToReceive },
        { key: 'payable', label: 'Payable', width: 104, align: 'right', render: leftToPay },
      ]
    : [
        { key: 'details', label: 'Details', render: (l) => detailsCell(l, true) },
        {
          key: 'amount',
          label: 'Amount',
          width: 100,
          align: 'right',
          render: (l) =>
            moneyOf(l.item) === 'paid'
              ? figure(l.item.amount, LEDGER_TONE.payable.text)
              : moneyOf(l.item) === 'received'
                ? figure(l.item.amount, LEDGER_TONE.receivable.text)
                : figure(moneyOf(l.item) === 'billed' ? l.item.amount : 0, PRICE_COLOR),
        },
        {
          key: 'left',
          label: 'Left',
          width: 100,
          align: 'right',
          render: (l) => (round2(l.balance) < 0 ? leftToPay(l) : leftToReceive(l)),
        },
      ];
  const vehicleFooter = roomy
    ? {
        price: <Text className="text-[13px] font-extrabold" style={{ color: PRICE_COLOR }}>{bookMoney(priceTotal)}</Text>,
        paid: <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.payable.text }}>{bookMoney(paidTotal)}</Text>,
        received: <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.receivable.text }}>{bookMoney(receivedTotal)}</Text>,
        receivable: (
          <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.receivable.text }}>
            {round2(closing) > 0 ? bookMoney(closing) : '—'}
          </Text>
        ),
        payable: (
          <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.payable.text }}>
            {round2(closing) < 0 ? bookMoney(-closing) : '—'}
          </Text>
        ),
      }
    : {
        left: (
          <Text className="text-[13px] font-extrabold" style={{ color: round2(closing) < 0 ? LEDGER_TONE.payable.text : LEDGER_TONE.receivable.text }}>
            {bookMoney(Math.abs(closing))}
          </Text>
        ),
      };

  const columns: BookColumn<Line>[] = roomy
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_l, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'date', label: 'Date', width: 130, render: (l) => <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(l.item.day)}</Text> },
        { key: 'details', label: 'Details', render: (l) => detailsCell(l, false) },
        { key: 'debit', label: 'Debit', width: 110, align: 'right', render: (l) => figure(l.debit, LEDGER_TONE.receivable.text) },
        { key: 'credit', label: 'Credit', width: 110, align: 'right', render: (l) => figure(l.credit, LEDGER_TONE.payable.text) },
        { key: 'balance', label: 'Balance', width: 130, align: 'right', render: balanceCell },
      ]
    : [
        { key: 'details', label: 'Details', render: (l) => detailsCell(l, true) },
        {
          key: 'debit',
          label: 'Debit / Credit',
          width: 104,
          align: 'right',
          render: (l) => (l.debit ? figure(l.debit, LEDGER_TONE.receivable.text) : figure(l.credit, LEDGER_TONE.payable.text)),
        },
        { key: 'balance', label: 'Balance', width: 104, align: 'right', render: balanceCell },
      ];
  const footerCells = roomy
    ? {
        debit: <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.receivable.text }}>{bookMoney(debit)}</Text>,
        credit: <Text className="text-[13px] font-extrabold" style={{ color: LEDGER_TONE.payable.text }}>{bookMoney(credit)}</Text>,
        balance: <Text className="text-[13px] font-extrabold" style={{ color: balanceColor(closing) }}>{balanceText(closing)}</Text>,
      }
    : { balance: <Text className="text-[13px] font-extrabold" style={{ color: balanceColor(closing) }}>{balanceText(closing)}</Text> };

  return (
    <PopupCard
      title={name}
      onClose={onClose}
      maxWidth={vehicles ? 1120 : 920}
      closeOnOutside
      headerRight={
        <>
          <PrintButton onPress={() => void printReportDocument(reportHtml(vehicles ? buildVehicleReport() : buildReport()))} />
          <ExcelButton onPress={() => void exportReportDocument(vehicles ? buildVehicleReport() : buildReport())} />
          <Pressable
            onPress={onOpenLedger}
            accessibilityRole="button"
            accessibilityLabel="Open ledger"
            className="h-9 flex-row items-center justify-center rounded-lg border border-gray-300 bg-white px-3"
            style={{ gap: 6 }}
          >
            <Ionicons name="open-outline" size={16} color="#1D4ED8" />
            {roomy && <Text className="text-[13px] font-semibold text-gray-700">Open ledger</Text>}
          </Pressable>
        </>
      }
    >
      {lines.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-8">
          <Text className="text-gray-500">No entries yet.</Text>
        </View>
      ) : (
        <BookTable
          stickyHeader
          columns={vehicles ? vehicleColumns : columns}
          rows={lines}
          rowKey={(l) => l.item.id}
          footer={{ label: `${lines.length} ${lines.length === 1 ? 'entry' : 'entries'} · Total`, cells: vehicles ? vehicleFooter : footerCells }}
        />
      )}
    </PopupCard>
  );
}

function LedgerList({ basePath }: { basePath: string }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const { add } = useLocalSearchParams<{ add?: string }>();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const queryClient = useQueryClient();
  // The search box filters the table as you type: every party whose name or phone contains what is
  // typed, those whose name starts with it first.
  const [search, setSearch] = useState('');
  // A name typed in the search that is not saved yet starts the New party form with it filled in.
  const [newPartyName, setNewPartyName] = useState('');
  const [showAddForm, setShowAddForm] = useState(add === '1');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A phone shows tick boxes only while selecting; the wide table always has them.
  const [selecting, setSelecting] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The party whose ledger is open in a popup - a tap on a party is the popup, not their page.
  const [viewing, setViewing] = useState<PartyRowData | null>(null);
  // Which headers (Ledger types) are open to show their parties. They all start closed - the headers
  // are the overview, and a type's parties are a tap away instead of a scroll.
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  // Every header starts open, so each ledger type shows its parties straight away; later ones open too.
  const [allStartOpen, setAllStartOpen] = useState(true);

  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'name' },
    enabled: !!userId,
  });
  const appCustomers = useAppCustomers(userId);
  const { byParty: itemsByParty, referenceById, cashByParty } = useLedgerItems(userId);
  const { nameById: partyTypeName, types: partyTypes } = usePartyTypes(userId);
  // A person typed Expense / Sales / Purchase opens on that report (see usePartyDestination).
  const hrefFor = usePartyDestination(userId, basePath);

  const layout = useBookLayout();
  // The table has eight columns and needs the room (the sidebar takes 240px): below
  // 1200px a phone-style card list reads better.
  const { width: windowWidth } = useWindowDimensions();
  const tableMode = layout.wide && windowWidth >= 1200;
  const today = localTodayIso();

  // A saved customer whose phone matches a registered app user is marked
  // "APP" on their existing row instead of being listed twice; an app user
  // with no matching saved customer still shows up, just without a ledger
  // to open.
  const merged = useMemo((): MergedRow[] => {
    const customerPhones = new Set((customers ?? []).map((c) => c.phone).filter((p): p is string => !!p));
    const appPhones = new Set(appCustomers.map((a) => a.profile.phone).filter((p): p is string => !!p));

    const customerRows: MergedRow[] = (customers ?? []).map((c) => ({
      kind: 'customer',
      id: c.id,
      name: c.name,
      phone: c.phone,
      customer: c,
      isApp: !!c.phone && appPhones.has(c.phone),
    }));
    const appOnlyRows: MergedRow[] = appCustomers
      .filter((a) => !a.profile.phone || !customerPhones.has(a.profile.phone))
      .map((a) => ({
        kind: 'app',
        id: a.profile.id,
        name: a.profile.full_name ?? 'Unnamed',
        phone: a.profile.phone,
        entry: a,
      }));

    return [...customerRows, ...appOnlyRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, appCustomers]);

  // Every party's figures: all they have ever traded, as of today.
  const analysed = useMemo(
    (): PartyRowData[] =>
      merged.map((row) => {
        const all = row.kind === 'customer' ? itemsByParty.get(row.id) ?? [] : [];
        const totals = summarize(all);
        const sides = sideTotals(all);
        const balance = totals.closing;
        const latest = all.reduce<LedgerItem | null>((a, b) => (!a || compareItems(a, b) < 0 ? b : a), null);
        return {
          row,
          totals,
          sales: sides.billed,
          purchases: sides.purchased,
          payments: sides.received + sides.paid,
          balance,
          status: statusOf(balance),
          overdue: overdueAmount(balance, receivableAging(all, today)),
          typeName: row.kind === 'customer' && row.customer.party_type_id ? partyTypeName.get(row.customer.party_type_id) : undefined,
          lastReference: (latest && referenceById.get(latest.id)) || null,
          totalPaid: round2(row.kind === 'customer' ? cashByParty.get(row.id)?.paid ?? 0 : 0),
          totalReceived: round2(row.kind === 'customer' ? cashByParty.get(row.id)?.received ?? 0 : 0),
        };
      }),
    [merged, itemsByParty, referenceById, cashByParty, today, partyTypeName]
  );

  // The headline cards count the way the Finance dashboard does, so the two always
  // agree: each ledger on its own - a customer who owes you counts as receivable, a
  // vendor you owe counts as payable - and one running the other way (a customer who
  // paid ahead, a vendor you overpaid) is left out rather than netted against the
  // other ledger. The rows below net a person's two ledgers into one figure, so their
  // total can differ. All parties, whatever the search and status filter say.
  const cards = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    for (const items of itemsByParty.values()) {
      let customerBalance = 0;
      let vendorBalance = 0;
      for (const item of items) {
        const signed = item.entryType === 'debit' ? item.amount : -item.amount;
        if (item.side === 'customer') customerBalance += signed;
        else vendorBalance += signed;
      }
      if (customerBalance > 0) receivable += customerBalance;
      if (vendorBalance > 0) payable += vendorBalance;
    }
    return { receivable, payable, net: receivable - payable };
  }, [itemsByParty]);

  // A vehicle account reads Balance as the original price: everything billed with the party, before any
  // payment - what is still to be received or paid after that is the Receivable and Payable.
  const vehicles = sellsVehicles(profile?.business_name?.trim() || profile?.full_name);
  const priceOf = (d: PartyRowData) => round2(d.sales + d.purchases);
  const totalPrice = useMemo(() => round2(analysed.reduce((sum, d) => sum + round2(d.sales + d.purchases), 0)), [analysed]);

  // An app user with no saved ledger is a customer: they sit under the Ledger type called Customer.
  const appUserType = useMemo(() => partyTypes.find((t) => /^customers?$/i.test(t.name.trim())), [partyTypes]);
  // The Ledger type a row is listed under, as a word to search by (nothing for a party with none).
  const typeOf = (d: PartyRowData) => (d.row.kind === 'customer' ? d.typeName ?? '' : appUserType?.name ?? 'Customer');

  // In name order (A-Z): `merged` is already sorted that way and filtering keeps the order. With
  // something typed in the search, a party shows when its name, phone or Ledger type contains it -
  // typing "vendor" lists everyone filed under Vendor. The ones whose name (or any word of it) starts
  // with it come first, then the rest, each still A-Z.
  const filtered = useMemo(() => {
    const byStatus =
      filter === 'all'
        ? analysed
        : filter === 'open'
          ? analysed.filter((d) => d.status !== 'settled')
          : analysed.filter((d) => d.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    const rank = (d: PartyRowData) => {
      const name = d.row.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
      return name.includes(q) || (d.row.phone ?? '').includes(q) ? 2 : 3;
    };
    return byStatus
      .filter(
        (d) =>
          d.row.name.toLowerCase().includes(q) || (d.row.phone ?? '').includes(q)
      )
      .sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysed, filter, search, appUserType]);

  // The Ledger is laid out by Ledger type - Customer, Vendor, Employee, Expense ... - each header with
  // how many parties it holds and what they add up to, and the parties inside it. Only a type with
  // someone in it is a header: one nobody is filed under is left out. A search or a status filter
  // lists (and opens) only the headers with a match.
  const narrowed = !!search.trim() || filter !== 'all';
  const groups = useMemo((): LedgerGroup[] => {
    const byKey = new Map<string, LedgerGroup>();
    const slot = (key: string, label: string) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, label, rows: [], receivable: 0, payable: 0, net: 0 };
        byKey.set(key, g);
      }
      return g;
    };
    // Every Ledger type is a header, one with nobody in it too (until a search narrows the list).
    if (!narrowed) for (const t of partyTypes) slot(t.id, t.name);
    // An app user with no saved ledger is a customer: they go under Customer, with their APP badge.
    for (const d of filtered) {
      const typeId = d.row.kind === 'customer' ? d.row.customer.party_type_id ?? null : null;
      const g =
        d.row.kind !== 'customer'
          ? appUserType
            ? slot(appUserType.id, appUserType.name)
            : slot(CUSTOMER_GROUP, 'Customer')
          : typeId
            ? slot(typeId, partyTypeName.get(typeId) ?? 'No ledger type')
            : slot(NO_TYPE, 'No ledger type');
      g.rows.push(d);
      g.net += d.balance;
      if (d.status === 'receivable') g.receivable += d.balance;
      else if (d.status === 'payable') g.payable += -d.balance;
    }
    const last = (k: string) => (k === NO_TYPE ? 1 : 0);
    return [...byKey.values()].sort((a, b) => last(a.key) - last(b.key) || a.label.localeCompare(b.label));
  }, [filtered, appUserType, partyTypeName, partyTypes, narrowed]);
  const groupKeys = groups.map((g) => g.key);
  useEffect(() => {
    if (allStartOpen && groupKeys.length > 0) {
      setOpenKeys(new Set(groupKeys));
      setAllStartOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKeys.join('|')]);
  const allOpen = groupKeys.length > 0 && groupKeys.every((k) => openKeys.has(k));
  const toggleGroup = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // The listed rows' own figures added up, so the line under the headers agrees with them.
  const footerNet = filtered.reduce((sum, d) => sum + d.balance, 0);
  const footerPosition = partyPosition({ receivable: footerNet, payable: 0 });

  // --- selection (phone: the Select button): only saved parties - an app-only row has no ledger to act on ---
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllFiltered = () => setSelected(new Set(filtered.filter((d) => d.row.kind === 'customer').map((d) => d.row.id)));
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };
  const selectedCount = selected.size;

  // --- bulk actions ---
  async function exportRows(onlySelected: boolean) {
    const source = onlySelected ? filtered.filter((d) => selected.has(d.row.id)) : filtered;
    if (source.length === 0) {
      showAlert('Nothing to export', 'No parties match what is on screen.');
      return;
    }
    setExporting(true);
    try {
      const rows: PartyListRow[] = source.map((d) => ({
        Party: nameCaps(d.row.name),
        'Ledger type': d.typeName ?? '',
        Phone: d.row.phone ?? '',
        Address: d.row.kind === 'customer' ? d.row.customer.address ?? '' : '',
        'Last transaction': d.totals.lastDay ? toBsHistoryLabel(d.totals.lastDay) : '',
        Sales: round2(d.sales),
        Purchases: round2(d.purchases),
        Payments: round2(d.payments),
        Balance: Math.abs(round2(d.balance)),
        'Dr / Cr': d.status === 'receivable' ? 'Dr' : d.status === 'payable' ? 'Cr' : '',
        Status: d.status === 'receivable' ? 'Receivable' : d.status === 'payable' ? 'Payable' : 'Settled',
        Overdue: round2(d.overdue),
      }));
      await exportPartiesXlsx(rows);
    } catch (err) {
      showAlert('Could not export', getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  async function applyLedgerType(key: string) {
    setTypeMenuOpen(false);
    const ids = [...selected];
    if (ids.length === 0) return;
    const { error } = await (supabase.from('customers') as any)
      .update({ party_type_id: key === NO_TYPE ? null : key })
      .in('id', ids);
    if (error) {
      showAlert('Could not set the ledger type', getErrorMessage(error));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    showAlert('Ledger type updated', `${ids.length} ${ids.length === 1 ? 'party' : 'parties'} updated.`);
    clearSelection();
  }

  // Search, Export and New party live in the top bar on a wide screen (a plain row
  // above the tiles on a narrow one) - web only; the phone app keeps its own list
  // below. The bar keeps the callbacks it was last given, so Export reaches the
  // list as it is now through a ref.
  const exportNow = useRef(exportRows);
  exportNow.current = exportRows;

  // Print: the list as it is on screen - one table for each Ledger type header, with what it adds up
  // to. (Export, beside it, is the same list as a spreadsheet.) The figures at the top are for every
  // party, so they print only when nothing narrows the list.
  const buildReport = (): PrintReport => {
    const balanceText = (value: number) => {
      const side = round2(value) > 0 ? ' Dr' : round2(value) < 0 ? ' Cr' : '';
      return `${dash(Math.abs(value))}${side}`;
    };
    const sections: PrintSection[] = groups.map((g) => ({
      heading: `${g.label} - ${g.rows.length} ${g.rows.length === 1 ? 'party' : 'parties'}`,
      columns: [
        { label: 'SN' },
        { label: 'Party' },
        { label: 'Phone' },
        { label: 'Last transaction' },
        { label: 'Sales', align: 'right' },
        { label: 'Purchases', align: 'right' },
        { label: 'Payments', align: 'right' },
        { label: 'Balance (NPR)', align: 'right' },
      ],
      rows: g.rows.map((d, i) => [
        String(i + 1),
        nameCaps(d.row.name),
        d.row.phone ?? '',
        d.totals.lastDay ? toBsHistoryLabel(d.totals.lastDay) : '',
        dash(d.sales),
        dash(d.purchases),
        dash(d.payments),
        balanceText(d.balance),
      ]),
      footer: ['', 'Total', '', '', '', '', '', balanceText(g.net)],
    }));
    return {
      title: 'Ledger',
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: search.trim() ? `Matching "${search.trim()}"` : filter !== 'all' ? 'Filtered list' : 'All parties',
      printedOn: toBsHistoryLabel(today),
      summary: narrowed
        ? undefined
        : [
            { label: 'Net balance', value: `${cards.net < 0 ? '-' : ''}NPR ${bookMoney(Math.abs(cards.net))}` },
            { label: 'Total receivable', value: `NPR ${bookMoney(cards.receivable)}` },
            { label: 'Total payable', value: `NPR ${bookMoney(cards.payable)}` },
            { label: 'Parties', value: String(merged.length) },
          ],
      sections:
        sections.length > 0
          ? sections
          : [{ columns: [{ label: 'Party' }], rows: [], emptyText: 'No parties match what is on screen.' }],
      note: 'Dr = they owe you, Cr = you owe them.',
    };
  };
  const printNow = useRef<() => void>(() => {});
  printNow.current = () => void printReportDocument(reportHtml(buildReport()));
  const openNewParty = () => {
    setNewPartyName('');
    setShowAddForm(true);
  };
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      // Drawn in the app's top bar, outside this page's own tree - so it carries the capitals with it.
      right: (inBar) => (
        <CapsProvider>
          <PrintButton onPress={() => printNow.current()} />
          <ExportButton onPress={() => exportNow.current(false)} busy={exporting} />
          <ToolbarButton icon="add" label="New party" onPress={openNewParty} />
        </CapsProvider>
      ),
    },
    [exporting]
  );

  // The search sits right under the figures: a wide, rounded box with the match count and a clear button.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchBar = (
    <View
      className="flex-row items-center rounded-2xl bg-white px-4"
      style={{
        height: 50,
        gap: 10,
        borderWidth: 1.5,
        borderColor: searchFocused ? '#2563EB' : '#E2E8F0',
        boxShadow: searchFocused ? '0 0 0 4px rgba(37,99,235,0.12)' : '0 1px 2px rgba(16,24,40,0.05)',
      }}
    >
      <Ionicons name="search" size={19} color={searchFocused || search ? '#2563EB' : '#94A3B8'} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        placeholder="Search ledgers by name or phone"
        placeholderTextColor="#94A3B8"
        className="flex-1 text-[15px] text-gray-900"
        style={{ outlineStyle: 'none' } as object}
      />
      {!!search.trim() && (
        <Text className="text-[12.5px] font-semibold" style={{ color: '#1E3A8A' }}>
          {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}
        </Text>
      )}
      {!!search && (
        <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={19} color="#94A3B8" />
        </Pressable>
      )}
    </View>
  );

  // --- pieces both layouts share ---
  const summaryCards = (
    <BookStats>
      {vehicles ? (
        <SummaryCard
          label="Balance"
          caption="Original price"
          value={`NPR ${bookMoney(totalPrice)}`}
          color={LEDGER_TONE.settled.text}
          accent={LEDGER_TONE.settled.base}
        />
      ) : (
        <SummaryCard
          label="Net balance"
          value={`${cards.net < 0 ? '−' : ''}NPR ${bookMoney(Math.abs(cards.net))}`}
          color={cards.net > 0 ? LEDGER_TONE.receivable.text : cards.net < 0 ? LEDGER_TONE.payable.text : LEDGER_TONE.settled.text}
          accent={cards.net > 0 ? LEDGER_TONE.receivable.base : cards.net < 0 ? LEDGER_TONE.payable.base : LEDGER_TONE.settled.base}
          active={filter === 'open'}
          onPress={() => setFilter(filter === 'open' ? 'all' : 'open')}
        />
      )}
      <SummaryCard
        label="Total receivable"
        value={`NPR ${bookMoney(cards.receivable)}`}
        color={LEDGER_TONE.receivable.text}
        accent={LEDGER_TONE.receivable.base}
        active={filter === 'receivable'}
        onPress={() => setFilter(filter === 'receivable' ? 'all' : 'receivable')}
      />
      <SummaryCard
        label="Total payable"
        value={`NPR ${bookMoney(cards.payable)}`}
        color={LEDGER_TONE.payable.text}
        accent={LEDGER_TONE.payable.base}
        active={filter === 'payable'}
        onPress={() => setFilter(filter === 'payable' ? 'all' : 'payable')}
      />
      <SummaryCard
        label="Parties"
        value={String(merged.length)}
        color={LEDGER_TONE.settled.text}
        accent={LEDGER_TONE.settled.base}
        active={filter === 'all'}
        onPress={() => setFilter('all')}
      />
    </BookStats>
  );

  const addForm = (
    <>
      {showAddForm && userId ? (
        <AddCustomerForm userId={userId} basePath={basePath} initialName={newPartyName} onDone={() => setShowAddForm(false)} />
      ) : null}
    </>
  );

  const bulkBar =
    selectedCount > 0 ? (
      <BulkBar
        count={selectedCount}
        total={filtered.filter((d) => d.row.kind === 'customer').length}
        onSelectAll={selectAllFiltered}
        onClear={clearSelection}
        onSetType={() => setTypeMenuOpen(true)}
        onExport={() => exportRows(true)}
      />
    ) : null;

  const typeMenu = (
    <LedgerTypeMenuModal
      visible={typeMenuOpen}
      title={`Set ledger type · ${selectedCount} selected`}
      ownerId={userId}
      onPick={(id) => applyLedgerType(id ?? NO_TYPE)}
      onClose={() => setTypeMenuOpen(false)}
    />
  );

  const partyPopup =
    viewing && viewing.row.kind === 'customer' ? (
      <PartyLedgerPopup
        key={viewing.row.id}
        data={viewing}
        items={itemsByParty.get(viewing.row.id) ?? []}
        referenceById={referenceById}
        businessName={profile?.business_name ?? profile?.full_name ?? ''}
        vehicles={vehicles}
        onOpenLedger={() => {
          const id = viewing.row.id;
          setViewing(null);
          router.push(hrefFor(id) as any);
        }}
        onClose={() => setViewing(null)}
      />
    ) : null;

  const typedName = search.trim();
  const emptyState = (
    <View className="items-center rounded-xl border border-dashed border-gray-300 bg-white py-10">
      <Ionicons name="people-outline" size={28} color="#D1D5DB" />
      <Text className="mt-2 text-gray-500">{merged.length > 0 ? 'No matches.' : 'No customers yet.'}</Text>
      <Text className="text-xs text-gray-400">
        {merged.length > 0 ? 'Try another search or filter.' : "Add one with New party, or they'll be saved when you record a bill for them."}
      </Text>
      {!!typedName && (
        // Not in the Ledger yet: the typed name can start the New party form as it is.
        <Pressable
          onPress={() => {
            setNewPartyName(typedName);
            setShowAddForm(true);
          }}
          accessibilityRole="button"
          className="mt-3 flex-row items-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2"
          style={{ gap: 6 }}
        >
          <Ionicons name="add-circle-outline" size={15} color="#EA580C" />
          <Text className="text-sm font-semibold text-orange-600">Add "{typedName}" as a new party</Text>
        </Pressable>
      )}
    </View>
  );

  // One flat list, A to Z by name. A search narrows it to every ledger with the typed letters in it.
  const sortedRows = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => a.row.name.localeCompare(b.row.name, undefined, { sensitivity: 'base' })),
    [filtered]
  );
  const flatFooter = (
    <View className="flex-row items-center justify-end px-1 pt-3" style={{ gap: 10 }}>
      <Text className="text-[12.5px] font-bold text-gray-600">
        {`${filtered.length} ${filtered.length === 1 ? 'party' : 'parties'} · Total`}
      </Text>
      <View style={{ width: 120, alignItems: 'flex-end' }}>
        <PartyBalance position={footerPosition} compact />
      </View>
    </View>
  );

  // The headers, each a card: its Ledger type, how many parties and what they add up to. Tap one to
  // open the parties inside it (`body`); a search or a status filter opens the ones with a match.
  const groupsView = (body: (g: LedgerGroup) => ReactNode) => (
    <View style={{ gap: 10 }}>
      {!narrowed && groupKeys.length > 1 && (
        <View className="flex-row items-center justify-end px-1">
          <Pressable onPress={() => setOpenKeys(allOpen ? new Set() : new Set(groupKeys))} accessibilityRole="button" hitSlop={6}>
            <Text className="text-[12.5px] font-semibold text-blue-700">{allOpen ? 'Close all' : 'Open all'}</Text>
          </Pressable>
        </View>
      )}
      {groups.map((g) => {
        const isOpen = narrowed || openKeys.has(g.key);
        return (
          <View key={g.key} className="overflow-hidden rounded-xl border border-gray-300 bg-white">
            <Pressable
              onPress={() => toggleGroup(g.key)}
              disabled={narrowed}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              className="flex-row items-center px-3.5 py-3"
              style={{ gap: 10, backgroundColor: isOpen ? '#F9FAFB' : '#FFFFFF' }}
            >
              <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={16} color="#6B7280" />
              <Text className="flex-1 text-[14px] font-bold text-gray-900" numberOfLines={1}>
                {g.label}
              </Text>
              <Text className="text-[12px] text-gray-400">
                {`${g.rows.length} ${g.rows.length === 1 ? 'party' : 'parties'}`}
              </Text>
              {tableMode && (
                <>
                  {/* The column titles sit in this line, over the same columns the parties below use. */}
                  <View style={{ width: 140 }}>
                    <Text className="text-[10.5px] font-bold uppercase text-gray-500">Ledger type</Text>
                  </View>
                  <View style={{ width: 125 }}>
                    <Text className="text-[10.5px] font-bold uppercase text-gray-500">Last transaction</Text>
                  </View>
                  <View style={{ width: 120 }}>
                    <Text className="text-[10.5px] font-bold uppercase text-gray-500">Ref No.</Text>
                  </View>
                  <View style={{ width: 105, alignItems: 'flex-end' }}>
                    <Text className="text-[10.5px] font-bold uppercase text-gray-500">Receivable</Text>
                    <Text className="text-[12.5px] font-bold" style={{ color: g.receivable > 0 ? LEDGER_TONE.receivable.text : '#D1D5DB' }}>
                      {g.receivable > 0 ? bookMoney(g.receivable) : '—'}
                    </Text>
                  </View>
                  <View style={{ width: 105, alignItems: 'flex-end' }}>
                    <Text className="text-[10.5px] font-bold uppercase text-gray-500">Payable</Text>
                    <Text className="text-[12.5px] font-bold" style={{ color: g.payable > 0 ? LEDGER_TONE.payable.text : '#D1D5DB' }}>
                      {g.payable > 0 ? bookMoney(g.payable) : '—'}
                    </Text>
                  </View>
                </>
              )}
              <View style={{ width: tableMode ? 120 : 150, alignItems: 'flex-end' }}>
                {tableMode && <Text className="text-[10.5px] font-bold uppercase text-gray-500">Balance</Text>}
                <PartyBalance position={partyPosition({ receivable: g.net, payable: 0 })} compact />
              </View>
            </Pressable>
            {isOpen && <View className="border-t border-gray-200">{body(g)}</View>}
          </View>
        );
      })}
      <View className="flex-row items-center justify-end px-1" style={{ gap: 10 }}>
        <Text className="text-[12.5px] font-bold text-gray-600">
          {`${filtered.length} ${filtered.length === 1 ? 'party' : 'parties'} · Total`}
        </Text>
        <View style={{ width: 120, alignItems: 'flex-end' }}>
          <PartyBalance position={footerPosition} compact />
        </View>
      </View>
    </View>
  );

  // ---------------- wide screen: the ledger table ----------------
  if (tableMode) {
    // Under the name: the ledger type, the phone number and the address, on one line.
    const partyCell = (d: PartyRowData) => {
      const typeAndContact = [d.row.phone, d.row.kind === 'customer' ? d.row.customer.address : null].filter(Boolean).join(' · ');
      return (
        <View style={{ minWidth: 0 }}>
          {/* Wraps, so on a narrow screen the APP badge drops below the name instead of cutting it short. */}
          <View className="flex-row flex-wrap items-center" style={{ columnGap: 6, rowGap: 2 }}>
            <Text className="text-[13px] font-semibold text-gray-900">
              {highlight(nameCaps(d.row.name), search)}
            </Text>
            {(d.row.kind === 'app' || (d.row.kind === 'customer' && d.row.isApp)) && <Pill text="APP" color="#1D4ED8" bg="#EFF6FF" />}
          </View>
          {!!typeAndContact && (
            <Text className="text-[11px] text-gray-400" numberOfLines={1}>
              {highlight(typeAndContact, search)}
            </Text>
          )}
        </View>
      );
    };

    const lastCell = (d: PartyRowData) =>
      d.totals.lastDay ? (
        <View>
          <Text className="text-[12.5px] text-gray-700">{toBsHistoryLabel(d.totals.lastDay)}</Text>
          <Text className="text-[11px] text-gray-400">{relativeDay(d.totals.lastDay, today)}</Text>
        </View>
      ) : (
        <Text className="text-[12.5px] text-gray-300">—</Text>
      );

    const open = (d: PartyRowData) => {
      if (d.row.kind === 'customer') setViewing(d);
    };

    // A price: a plain dark figure - it is neither money to come nor money gone.
    const priceText = (value: number, strong = false) =>
      value === 0 ? (
        <Text className="text-[12.5px] text-gray-300">—</Text>
      ) : (
        <Text className={`text-[12.5px] text-gray-900 ${strong ? 'font-extrabold' : 'font-bold'}`}>{bookMoney(value)}</Text>
      );

    const columns: BookColumn<PartyRowData>[] = [
      {
        key: 'sn',
        label: 'SN',
        width: 52,
        render: (_d, index) => <Text className="text-[12.5px] text-gray-500">{index + 1}</Text>,
      },
      { key: 'party', label: 'Party', render: partyCell },
      {
        // Which ledger type the party is filed under, between the name and its last transaction.
        key: 'ledgerType',
        label: 'Ledger type',
        width: 140,
        render: (d) => (
          <Text className="text-[12.5px] font-semibold text-gray-700" numberOfLines={1}>
            {d.typeName ? highlight(d.typeName, search) : d.row.kind === 'customer' ? '—' : 'Customer'}
          </Text>
        ),
      },
      { key: 'last', label: 'Last transaction', width: 125, render: lastCell },
      {
        // The number on that last transaction, with what it is the number of underneath.
        key: 'reference',
        label: 'Ref No.',
        width: 120,
        render: (d) =>
          d.lastReference ? (
            <View style={{ minWidth: 0 }}>
              <Text className="text-[12.5px] font-semibold text-gray-700" numberOfLines={1}>
                {d.lastReference.no}
              </Text>
              <Text className="text-[10.5px] text-gray-400" numberOfLines={1}>
                {d.lastReference.kind}
              </Text>
            </View>
          ) : (
            <Text className="text-[12.5px] text-gray-300">—</Text>
          ),
      },
      {
        // All the money paid to them - to a vendor, or given out to a customer - whatever it settled.
        key: 'totalPaid',
        label: 'Total paid',
        width: 110,
        align: 'right',
        render: (d) =>
          d.totalPaid ? (
            <Text className="text-[12.5px] font-bold" style={{ color: LEDGER_TONE.payable.text }}>
              {bookMoney(d.totalPaid)}
            </Text>
          ) : (
            <Text className="text-[12.5px] text-gray-300">—</Text>
          ),
      },
      {
        // All the money received from them.
        key: 'totalReceived',
        label: 'Total received',
        width: 120,
        align: 'right',
        render: (d) =>
          d.totalReceived ? (
            <Text className="text-[12.5px] font-bold" style={{ color: LEDGER_TONE.receivable.text }}>
              {bookMoney(d.totalReceived)}
            </Text>
          ) : (
            <Text className="text-[12.5px] text-gray-300">—</Text>
          ),
      },
      {
        // The part of the balance that is money coming in (green), blank when it runs the other way.
        key: 'receivable',
        label: 'Receivable',
        width: 105,
        align: 'right',
        render: (d) =>
          d.status === 'receivable' ? (
            <Text className="text-[12.5px] font-bold" style={{ color: LEDGER_TONE.receivable.text }}>
              {bookMoney(d.balance)}
            </Text>
          ) : (
            <Text className="text-[12.5px] text-gray-300">—</Text>
          ),
      },
      {
        // The part of the balance that is money going out (red), blank when it runs the other way.
        key: 'payable',
        label: 'Payable',
        width: 105,
        align: 'right',
        render: (d) =>
          d.status === 'payable' ? (
            <Text className="text-[12.5px] font-bold" style={{ color: LEDGER_TONE.payable.text }}>
              {bookMoney(-d.balance)}
            </Text>
          ) : (
            <Text className="text-[12.5px] text-gray-300">—</Text>
          ),
      },
      vehicles
        ? {
            // The original price: all that was billed with them, before any payment - what is still to be
            // received or paid is in Receivable and Payable.
            key: 'balance',
            label: 'Balance',
            width: 120,
            align: 'right',
            render: (d) => priceText(priceOf(d)),
          }
        : { key: 'balance', label: 'Balance', width: 120, align: 'right', render: (d) => <PartyBalance position={positionOf(d)} compact /> },
    ];

    // The listed parties added up, column by column, in the line under the table - which stays in view while
    // the table scrolls (see `maxRows` below).
    const sum = (pick: (d: PartyRowData) => number) => round2(sortedRows.reduce((total, d) => total + pick(d), 0));
    const total = (value: number, color: string) =>
      value ? (
        <Text className="text-[12.5px] font-extrabold" style={{ color }}>
          {bookMoney(value)}
        </Text>
      ) : (
        <Text className="text-[12.5px] text-gray-300">—</Text>
      );
    const tableFooter = {
      label: `${sortedRows.length} ${sortedRows.length === 1 ? 'party' : 'parties'} · Total`,
      cells: {
        totalPaid: total(sum((d) => d.totalPaid), LEDGER_TONE.payable.text),
        totalReceived: total(sum((d) => d.totalReceived), LEDGER_TONE.receivable.text),
        receivable: total(sum((d) => (d.status === 'receivable' ? d.balance : 0)), LEDGER_TONE.receivable.text),
        payable: total(sum((d) => (d.status === 'payable' ? -d.balance : 0)), LEDGER_TONE.payable.text),
        balance: vehicles ? priceText(sum(priceOf), true) : <PartyBalance position={footerPosition} compact />,
      },
    };

    return (
      <BookPage wide={layout.wide}>
        {toolbar}
        {summaryCards}
        {searchBar}
        {addForm}
        {bulkBar}

        {filtered.length === 0 && (narrowed || merged.length === 0) ? (
          emptyState
        ) : (
          <View style={{ gap: 10 }}>
            {/* Twenty parties show, then the table scrolls inside itself, its header and totals kept in view. */}
            <BookTable
              columns={columns}
              rows={sortedRows}
              rowKey={(d) => `${d.row.kind}-${d.row.id}`}
              onRowPress={open}
              stickyHeader
              maxRows={20}
              footer={tableFooter}
            />
            {vehicles && (
              <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
                Balance is the original price: everything billed with them, before any payment. Receivable is what is still to be received and
                Payable what is still to be paid, after what has been received or paid.
              </Text>
            )}
          </View>
        )}

        {typeMenu}
        {partyPopup}
      </BookPage>
    );
  }

  // ---------------- phone / narrow window: cards ----------------
  return (
    <View className="flex-1 bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-2">
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search by name, phone or type" wide={false} />
          <Pressable onPress={openNewParty} className="h-11 w-11 items-center justify-center rounded-2xl bg-orange-500">
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
        </View>

        {summaryCards}


        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <Pressable
            onPress={() => (selecting ? clearSelection() : setSelecting(true))}
            className="h-9 flex-row items-center rounded-lg border px-3"
            style={{ gap: 6, borderColor: selecting ? '#2563EB' : '#D1D5DB', backgroundColor: selecting ? '#EFF6FF' : '#FFFFFF' }}
          >
            <Ionicons name="checkbox-outline" size={14} color={selecting ? '#1D4ED8' : '#4B5563'} />
            <Text className={`text-[13px] font-semibold ${selecting ? 'text-blue-700' : 'text-gray-700'}`}>{selecting ? 'Done' : 'Select'}</Text>
          </Pressable>
          <PrintButton onPress={() => printNow.current()} />
          <ExportButton onPress={() => exportRows(false)} busy={exporting} />
        </View>

        {addForm}
        {bulkBar}

        {filtered.length === 0 && (narrowed || merged.length === 0) ? (
          emptyState
        ) : (
          <View style={{ gap: 0 }}>
            {sortedRows.map((d) => (
              <PartyCard
                key={`${d.row.kind}-${d.row.id}`}
                data={d}
                onOpen={() => setViewing(d)}
                today={today}
                selecting={selecting}
                selected={selected.has(d.row.id)}
                onToggle={() => toggle(d.row.id)}
              />
            ))}
            {flatFooter}
          </View>
        )}

        {typeMenu}
        {partyPopup}
      </ScrollView>
    </View>
  );
}
