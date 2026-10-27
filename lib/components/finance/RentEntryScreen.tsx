// lib/components/finance/RentEntryScreen.tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIsWideWeb } from '../../hooks/useWideGrid';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseRow, useSupabaseUpdate } from '../../hooks/useSupabase';
import { usePhoneContacts } from '../../hooks/usePhoneContacts';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { KeyInput } from './KeyInput';
import { KeyboardDateInput } from './KeyboardDateInput';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { useConfirmSave } from './ConfirmSave';
import { useConfirmNewParty } from './NewPartyConfirm';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { MONEY } from './moneyColors';
import { money } from './BookKit';
import { buildCustomerSuggestions } from '../../utils/customerSuggestions';
import { readKey } from '../../utils/webKeys';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { formatMoney, round2 } from '../../utils/money';
import { rentalFigures, rentalStatus } from '../../utils/rental';
import type { Rental } from '../../../types/database.types';

const CARD_SHADOW = '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)';
// The same list length the Purchase item box and the Paid page's name box show.
const MAX_SUGGESTIONS = 6;
const ADD_PARTY_KEY = '__add-party__';

// The order Enter walks through the boxes; the last one moves on to Save.
const FIELDS = ['start', 'item', 'model', 'rate', 'renter', 'note'] as const;
type FieldName = (typeof FIELDS)[number];

/** A titled white card, as on the Paid page: a small icon and heading, then what the card holds. */
function EntryCard({ icon, title, children, z }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: ReactNode; z?: number }) {
  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white" style={{ boxShadow: CARD_SHADOW, zIndex: z ?? 0 }}>
      <View className="flex-row items-center gap-2 px-5 pb-3 pt-4">
        <Ionicons name={icon} size={14} color="#6B7280" />
        <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">{title}</Text>
      </View>
      <View className="px-5 pb-5">{children}</View>
    </View>
  );
}

/** A label over its box; boxes sit side by side and wrap when the window is narrow. `action` is a small
 * link at the right of the label (Clear, ...). */
function Box({ label, basis = 200, grow = 1, action, raised, children }: { label: string; basis?: number; grow?: number; action?: ReactNode; raised?: boolean; children: ReactNode }) {
  return (
    // react-native-web gives every View its own stacking layer, so the box whose list is open (and the row it
    // sits in) is raised above what follows it - otherwise the list would paint under the next row.
    <View style={{ flexGrow: grow, flexBasis: basis, minWidth: 0, zIndex: raised ? 30 : 0 }}>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-gray-600">{label}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Rent entry: one rental - the item, who has it, the dates and the rate. The same page for adding and for
 * editing (`?id=`), laid out like the Paid and Purchase pages. */
export function RentEntryScreen({ basePath }: { basePath: string }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: rental, isLoading } = useSupabaseRow('rentals', id);
  // The form starts from the rental being edited, so it waits for it - and a rental that is gone goes back to the list.
  if (id && isLoading) return null;
  if (id && !rental) return <Redirect href={`${basePath}/rent` as never} />;
  return <RentForm key={id ?? 'new'} basePath={basePath} rental={id ? rental ?? null : null} />;
}

function RentForm({ basePath, rental }: { basePath: string; rental: Rental | null }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const desktopWeb = useIsWideWeb();
  const accent = FINANCE_ENTRY_ACCENT;
  const userId = useAuthStore((state) => state.session?.user.id);
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: products } = useSupabaseQuery('products', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: financeItems } = useSupabaseQuery('finance_items', { filters: owner, enabled: !!userId });
  const { data: customers } = useSupabaseQuery('customers', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  // The model number entered on each item's purchase bill (the latest bill that has one), so picking an item brings it in.
  const { data: purchaseBills } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId, type: 'purchase' } : {},
    orderBy: { column: 'created_at', ascending: false },
    all: true,
    enabled: !!userId,
  });
  const { data: allRentals } = useSupabaseQuery('rentals', { filters: owner, orderBy: { column: 'created_at', ascending: false }, enabled: !!userId });
  const phoneContacts = usePhoneContacts();
  const createRental = useSupabaseInsert('rentals');
  const updateRental = useSupabaseUpdate('rentals');
  const deleteRental = useSupabaseDelete('rentals');
  const createCustomer = useSupabaseInsert('customers');
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();
  // A new customer made from a typed name is checked first, with its name editable.
  const { askNewParty, dialog: newPartyDialog } = useConfirmNewParty();

  const [item, setItem] = useState(rental?.car ?? '');
  const [model, setModel] = useState(rental?.model ?? '');
  const [customerId, setCustomerId] = useState<string | null>(rental?.customer_id ?? null);
  const [customerName, setCustomerName] = useState(rental?.customer_name ?? '');
  const [rate, setRate] = useState(rental ? String(rental.rate_per_day) : '');
  const [start, setStart] = useState(rental?.start_date ?? today);
  // The due-back and returned days are not on this form; a rental that already has them keeps them (and
  // they still decide its days and status).
  const end = rental?.end_date ?? '';
  const returnedOn = rental?.returned_on ?? '';
  const [note, setNote] = useState(rental?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);

  // The boxes' inputs, by name, so Enter can walk from one to the next.
  const inputs = useRef<Record<string, TextInput | null>>({});
  const saveButtonRef = useRef<View>(null);
  const setRef = (name: FieldName) => (el: TextInput | null) => {
    inputs.current[name] = el;
  };
  const focus = (name: FieldName) => inputs.current[name]?.focus();
  const focusSave = () => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  const afterField = (name: FieldName) => {
    const at = FIELDS.indexOf(name);
    if (at < FIELDS.length - 1) focus(FIELDS[at + 1]);
    else focusSave();
  };
  /** Enter / Ctrl+Enter in a suggestion box, when the list did not take the key. */
  const enterKey = (name: FieldName) => (e: unknown) => {
    const k = readKey(e);
    if (k.key !== 'Enter') return;
    k.prevent();
    if (k.ctrl) void handleSave();
    else afterField(name);
  };

  const figures = rentalFigures(
    { start_date: start, end_date: end || null, returned_on: returnedOn || null, rate_per_day: Number(rate) || 0, payments: [] },
    today
  );
  const status = rentalStatus({ end_date: end || null, returned_on: returnedOn || null }, today);

  // The Item box lists your stock the way the Purchase bill's item box does: matches for what is typed,
  // those that start with it first, with the price and stock beside each.
  const itemOptions = useMemo<SuggestOption[]>(() => {
    const q = item.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set<string>();
    const catalog: SuggestOption[] = [];
    for (const p of products ?? []) {
      const k = p.name.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      catalog.push({
        key: `p-${p.id}`,
        label: p.name,
        hint: Number(p.price) > 0 ? `NPR ${formatMoney(Number(p.price))}` : null,
      });
    }
    for (const f of financeItems ?? []) {
      const k = f.name.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      catalog.push({ key: `f-${f.id}`, label: f.name, hint: f.rate != null ? `NPR ${formatMoney(Number(f.rate))}` : null });
    }
    return catalog
      .filter((c) => c.label.toLowerCase().includes(q))
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
      .slice(0, MAX_SUGGESTIONS);
  }, [products, financeItems, item]);

  // The Rented to box is the Paid page's name box: saved customers (and phone contacts) matching what is
  // typed, and an "Add ... as new customer" row for a name nobody has.
  const renterSuggestions = useMemo(
    () => (customerName.trim() ? buildCustomerSuggestions(customers ?? [], phoneContacts.contacts, customerName.trim(), MAX_SUGGESTIONS) : []),
    [customers, phoneContacts.contacts, customerName]
  );
  const renterOptions = useMemo<SuggestOption[]>(() => {
    const typed = customerName.trim();
    if (!typed) return [];
    const options: SuggestOption[] = renterSuggestions.map((s) => ({
      key: s.key,
      label: s.name,
      hint: s.customer ? s.phone : 'From contacts',
    }));
    const linkedExact = !!customerId && customers?.find((c) => c.id === customerId)?.name === customerName;
    if (!linkedExact && !(customers ?? []).some((c) => c.name.trim().toLowerCase() === typed.toLowerCase())) {
      options.push({ key: ADD_PARTY_KEY, label: `Add "${typed}" as new customer`, kind: 'add' });
    }
    return options;
  }, [renterSuggestions, customerName, customerId, customers]);

  const modelByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const bill of purchaseBills ?? []) {
      for (const line of bill.items ?? []) {
        const name = line.description?.trim().toLowerCase();
        const m = line.model?.trim();
        if (name && m && !map.has(name)) map.set(name, m);
      }
    }
    return map;
  }, [purchaseBills]);
  /** Brings in the item's model; `onlyIfEmpty` leaves one that is already typed. */
  const fillModel = (name: string, onlyIfEmpty = false) => {
    const found = modelByItem.get(name.trim().toLowerCase());
    if (found && !(onlyIfEmpty && model.trim())) setModel(found);
  };

  const recent = useMemo(() => (allRentals ?? []).filter((r) => r.id !== rental?.id).slice(0, 5), [allRentals, rental?.id]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/rent` as never);
  };

  async function pickRenter(opt: SuggestOption, via: 'enter' | 'tab' | 'click') {
    if (opt.key === ADD_PARTY_KEY) {
      if (!userId) return;
      const finalName = await askNewParty({ name: customerName.trim(), kind: 'customer' });
      if (!finalName) return;
      try {
        const created = await createCustomer.mutateAsync({ owner_id: userId, name: finalName, phone: null });
        setCustomerName(created.name);
        setCustomerId(created.id);
      } catch (err) {
        showAlert('Could not add customer', getErrorMessage(err));
        return;
      }
    } else {
      const s = renterSuggestions.find((x) => x.key === opt.key);
      if (!s) return;
      setCustomerName(s.name);
      if (s.customer) setCustomerId(s.customer.id);
      else {
        // A phone contact that is not saved yet is saved now, so the rental links to a real customer.
        const finalName = await askNewParty({ name: s.name, kind: 'customer' });
        if (!finalName) return;
        try {
          const created = await createCustomer.mutateAsync({ owner_id: userId, name: finalName, phone: s.phone });
          setCustomerId(created.id);
        } catch {
          setCustomerId(null);
        }
      }
    }
    if (via !== 'tab') focus('note');
  }

  async function handleSave() {
    if (!userId || saving) return;
    if (!item.trim()) {
      showAlert('Add the item', 'Type the item, or pick one from your stock.');
      return;
    }
    if (!start) {
      showAlert('Add the date', 'Pick the day it was rented.');
      return;
    }
    const ok = await confirmSave({
      title: `Save ${rental ? 'changes to this' : 'this'} rental?`,
      rows: [
        { label: 'Item', value: [item.trim(), model.trim()].filter(Boolean).join(' · ') },
        ...(customerName.trim() ? [{ label: 'Rented to', value: customerName.trim() }] : []),
        { label: 'Rented on', value: toBsHistoryLabel(start) },
        { label: 'Rate per day', value: `NPR ${formatMoney(Number(rate) || 0)}` },
        { label: 'Days', value: String(figures.days) },
      ],
      total: { label: 'Rent', value: `NPR ${formatMoney(figures.total)}`, color: MONEY.in.base },
    });
    if (!ok) return;
    // `payments`, `end_date` and `returned_on` are left out on purpose: a rental that already has them keeps them.
    const values = {
      car: item.trim(),
      model: model.trim() || null,
      customer_id: customerId,
      customer_name: customerName.trim() || null,
      start_date: start,
      rate_per_day: round2(Number(rate) || 0),
      note: note.trim() || null,
    };
    setSaving(true);
    try {
      if (rental) await updateRental.mutateAsync({ id: rental.id, values });
      else await createRental.mutateAsync({ owner_id: userId, ...values });
      goBack();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    if (!rental) return;
    showAlert('Remove this rental?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRental.mutateAsync(rental.id);
            goBack();
          } catch (err) {
            showAlert('Could not remove', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  useScreenHeader({ title: rental ? 'Rental' : 'New rental', resetTitle: 'Rent' }, [!!rental]);

  // A suggestion box styled as the Purchase and Paid pages' own: a plain bordered box that takes the accent ring.
  const suggestStyle = (name: FieldName) =>
    ({
      borderWidth: 1,
      borderColor: focusedField === name ? accent : '#D1D5DB',
      backgroundColor: '#FFFFFF',
      ...(focusedField === name ? { boxShadow: `0 0 0 3px ${accent}29` } : null),
      outlineStyle: 'none',
    }) as object;
  const suggestClass = 'rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900';

  const detailsCard = (
    <EntryCard icon="car-outline" title="Rental details" z={20}>
      <View className="flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14, zIndex: focusedField === 'item' ? 30 : 0 }}>
        <Box label="Item" basis={260} grow={2} raised={focusedField === 'item'}>
          <SuggestInput
            value={item}
            onChangeText={setItem}
            options={focusedField === 'item' ? itemOptions : []}
            onSelectOption={(opt, via) => {
              setItem(opt.label);
              fillModel(opt.label);
              if (via !== 'tab') focus('model');
            }}
            inputRef={setRef('item')}
            onFocus={() => setFocusedField('item')}
            onBlur={() => {
              setFocusedField((f) => (f === 'item' ? null : f));
              // An item typed out in full (not picked) brings its model in too, when none is typed.
              fillModel(item, true);
            }}
            onKeyPress={enterKey('item')}
            placeholder="Item name…"
            accessibilityLabel="Item"
            accent={accent}
            inputClassName={suggestClass}
            inputStyle={suggestStyle('item')}
            compact
          />
        </Box>
        <Box label="Model" basis={200}>
          <KeyInput
            value={model}
            onChangeText={setModel}
            inputRef={setRef('model')}
            onEnter={() => afterField('model')}
            onRequestSave={handleSave}
            accent={accent}
            placeholder="Model"
            accessibilityLabel="Model"
          />
        </Box>
        <Box label="Rate per day (NPR)" basis={170}>
          <KeyInput
            value={rate}
            onChangeText={setRate}
            inputRef={setRef('rate')}
            onEnter={() => afterField('rate')}
            onRequestSave={handleSave}
            accent={accent}
            placeholder="0"
            numeric
            align="right"
            accessibilityLabel="Rate per day"
          />
        </Box>
      </View>

      <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14, zIndex: focusedField === 'renter' ? 30 : 0 }}>
        <Box label="Rented to" basis={260} grow={2} raised={focusedField === 'renter'}>
          <SuggestInput
            value={customerName}
            onChangeText={(v) => {
              setCustomerName(v);
              setCustomerId(null);
            }}
            options={focusedField === 'renter' ? renterOptions : []}
            onSelectOption={(opt, via) => void pickRenter(opt, via)}
            inputRef={setRef('renter')}
            onFocus={() => setFocusedField('renter')}
            onBlur={() => setFocusedField((f) => (f === 'renter' ? null : f))}
            onKeyPress={enterKey('renter')}
            placeholder="Who has it?"
            accessibilityLabel="Rented to"
            accent={accent}
            inputClassName={suggestClass}
            inputStyle={suggestStyle('renter')}
            adornmentWidth={54}
            adornment={
              customerId ? (
                <Ionicons name="checkmark-circle" size={15} color={accent} />
              ) : customerName.trim() ? (
                <Text className="text-[10px] font-bold capitalize text-gray-400">New</Text>
              ) : null
            }
            compact
          />
        </Box>
        <Box label="Rented on" basis={170}>
          <KeyboardDateInput value={start} onChange={setStart} inputRef={setRef('start')} autoFocus={!rental} onEnter={() => afterField('start')} onRequestSave={handleSave} accent={accent} />
        </Box>
      </View>

      <View className="mt-4">
        <Box label="Remarks" basis={300}>
          <KeyInput
            value={note}
            onChangeText={setNote}
            inputRef={setRef('note')}
            onEnter={() => afterField('note')}
            onRequestSave={handleSave}
            accent={accent}
            placeholder="Optional"
            accessibilityLabel="Remarks"
          />
        </Box>
      </View>
    </EntryCard>
  );

  const actions = (
    <View className="flex-row items-center justify-end" style={{ gap: 16 }}>
      {rental && (
        <Pressable
          onPress={handleRemove}
          className="mr-auto flex-row items-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5"
          style={{ gap: 6 }}
        >
          <Ionicons name="trash-outline" size={15} color="#DC2626" />
          <Text className="text-sm font-semibold text-red-600">Remove</Text>
        </Pressable>
      )}
      <View className="flex-row" style={{ gap: 10 }}>
        <Pressable onPress={goBack} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          ref={saveButtonRef}
          onPress={handleSave}
          disabled={saving}
          className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
          style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${FINANCE_ENTRY_SHADOW}` }}
        >
          <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );

  // What it comes to, from the dates and the rate - the side panel's first card (above the buttons on a narrow screen).
  const summaryCard = (
    <View className="rounded-2xl border border-gray-200 bg-white p-4" style={{ boxShadow: CARD_SHADOW }}>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-[11px] font-bold capitalize tracking-wide text-gray-400">This rental</Text>
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: status.bg }}>
          <Text className="text-[10.5px] font-bold" style={{ color: status.color }}>
            {status.label}
          </Text>
        </View>
      </View>
      {[
        { label: 'Days', value: String(figures.days), color: '#111827' },
        { label: 'Rate per day', value: `NPR ${money(Number(rate) || 0)}`, color: '#111827' },
        { label: 'Rent', value: `NPR ${money(figures.total)}`, color: MONEY.in.base },
      ].map((f, i, all) => (
        <View key={f.label} className={`flex-row items-center justify-between py-2 ${i < all.length - 1 ? 'border-b border-gray-50' : ''}`}>
          <Text className="text-xs text-gray-500">{f.label}</Text>
          <Text className="text-[13px] font-bold" style={{ color: f.color }}>
            {f.value}
          </Text>
        </View>
      ))}
    </View>
  );

  const recentCard = (
    <View className="rounded-2xl border border-gray-200 bg-white p-4">
      <Text className="mb-2 text-[11px] font-bold capitalize tracking-wide text-gray-400">Recent rentals</Text>
      {recent.length === 0 ? (
        <Text className="text-xs text-gray-400">No entries yet.</Text>
      ) : (
        recent.map((r, i) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`${basePath}/rent-entry?id=${r.id}` as never)}
            className={`flex-row items-center justify-between py-2 ${i < recent.length - 1 ? 'border-b border-gray-50' : ''}`}
          >
            <View className="flex-1 pr-2">
              <Text numberOfLines={1} className="text-xs font-semibold text-gray-800">
                {r.car}
              </Text>
              <Text numberOfLines={1} className="text-[10px] text-gray-400">
                {[r.customer_name, toBsHistoryLabel(r.start_date)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text className="text-xs font-bold" style={{ color: accent }}>
              NPR {money(rentalFigures(r, today).total)}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );

  if (desktopWeb) {
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View className="px-8 pt-6">
          <View className="flex-row" style={{ gap: 24 }}>
            <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
              {detailsCard}
              {actions}
            </View>
            <View style={{ width: 320, gap: 16 }}>
              {summaryCard}
              {recentCard}
            </View>
          </View>
        </View>
        {confirmDialog}
        {newPartyDialog}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {detailsCard}
      <View className="mb-4">{summaryCard}</View>
      {actions}
      {confirmDialog}
      {newPartyDialog}
    </ScrollView>
  );
}
