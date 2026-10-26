// lib/components/finance/RentEntryScreen.tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIsWideWeb } from '../../hooks/useWideGrid';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseRow, useSupabaseUpdate } from '../../hooks/useSupabase';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { KeyInput } from './KeyInput';
import { KeyboardDateInput } from './KeyboardDateInput';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { useConfirmSave } from './ConfirmSave';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { MONEY } from './moneyColors';
import { money } from './BookKit';
import { readKey, type WebKeyInfo } from '../../utils/webKeys';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { formatMoney, round2 } from '../../utils/money';
import { rentalFigures, rentalStatus } from '../../utils/rental';
import type { Rental } from '../../../types/database.types';

const CARD_SHADOW = '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)';
const MAX_SUGGESTIONS = 8;

let payKeySeq = 0;
interface PayRow {
  key: string;
  date: string;
  amount: string;
  note: string;
}
function newPayRow(date: string, amount = '', note = ''): PayRow {
  payKeySeq += 1;
  return { key: `pay-${payKeySeq}`, date, amount, note };
}
const payHasContent = (r: PayRow) => !!(r.amount.trim() || r.note.trim());

// The order Enter walks through the details, before it moves on to the payments.
const FIELDS = ['car', 'model', 'renter', 'rate', 'start', 'end', 'returned', 'note'] as const;
type FieldName = (typeof FIELDS)[number];

/** A titled white card, as on the Paid page: a small icon and heading, then what the card holds. */
function EntryCard({ icon, title, right, children, z }: { icon: keyof typeof Ionicons.glyphMap; title: string; right?: ReactNode; children: ReactNode; z?: number }) {
  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white" style={{ boxShadow: CARD_SHADOW, zIndex: z ?? 0 }}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name={icon} size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">{title}</Text>
        </View>
        {right}
      </View>
      <View className="px-5 pb-4">{children}</View>
    </View>
  );
}

/** A label over its box; fields sit side by side and wrap when the window is narrow. `action` is a small
 * link at the right of the label (Clear, ...). */
function Box({ label, basis = 200, action, children }: { label: string; basis?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: basis, minWidth: 0 }}>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-gray-600">{label}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Rent entry: one rental - the car, who has it, the dates and rate - and the payments received on it.
 * The same page for adding and for editing (`?id=`), laid out like the Paid page. */
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
  const { data: customers } = useSupabaseQuery('customers', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: allRentals } = useSupabaseQuery('rentals', { filters: owner, orderBy: { column: 'created_at', ascending: false }, enabled: !!userId });
  const createRental = useSupabaseInsert('rentals');
  const updateRental = useSupabaseUpdate('rentals');
  const deleteRental = useSupabaseDelete('rentals');
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();

  const [car, setCar] = useState(rental?.car ?? '');
  const [model, setModel] = useState(rental?.model ?? '');
  const [customerId, setCustomerId] = useState<string | null>(rental?.customer_id ?? null);
  const [customerName, setCustomerName] = useState(rental?.customer_name ?? '');
  const [rate, setRate] = useState(rental ? String(rental.rate_per_day) : '');
  const [start, setStart] = useState(rental?.start_date ?? today);
  const [end, setEnd] = useState(rental?.end_date ?? '');
  const [returnedOn, setReturnedOn] = useState(rental?.returned_on ?? '');
  const [note, setNote] = useState(rental?.note ?? '');
  // The payments received, one row each, with a blank one at the end to type the next into.
  const [pays, setPays] = useState<PayRow[]>(() => [
    ...(rental?.payments ?? []).map((p) => newPayRow(p.date, String(p.amount), p.note ?? '')),
    newPayRow(today),
  ]);
  const [saving, setSaving] = useState(false);
  const [carFocused, setCarFocused] = useState(false);
  const [renterFocused, setRenterFocused] = useState(false);

  // The cells' inputs, by name, so Enter can walk from one to the next.
  const inputs = useRef<Record<string, TextInput | null>>({});
  const saveButtonRef = useRef<View>(null);
  const setRef = (name: string) => (el: TextInput | null) => {
    inputs.current[name] = el;
  };
  const focus = (name: string) => inputs.current[name]?.focus();
  const focusSave = () => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  const afterField = (name: FieldName) => {
    const at = FIELDS.indexOf(name);
    if (at < FIELDS.length - 1) focus(FIELDS[at + 1]);
    else focus(`${pays[0].key}:amount`);
  };
  /** Enter / Ctrl+Enter on a cell the suggestion list does not take. */
  const enterKey = (name: FieldName) => (e: unknown) => {
    const k = readKey(e);
    if (k.key !== 'Enter') return;
    k.prevent();
    if (k.ctrl) void handleSave();
    else afterField(name);
  };

  const figures = rentalFigures(
    {
      start_date: start,
      end_date: end || null,
      returned_on: returnedOn || null,
      rate_per_day: Number(rate) || 0,
      payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ date: p.date, amount: Number(p.amount) })),
    },
    today
  );
  const status = rentalStatus({ end_date: end || null, returned_on: returnedOn || null }, today);

  const carOptions = useMemo<SuggestOption[]>(() => {
    const q = car.trim().toLowerCase();
    return (products ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((p) => ({ key: p.id, label: p.name, hint: `stock ${p.stock_level}` }));
  }, [products, car]);
  const renterOptions = useMemo<SuggestOption[]>(() => {
    const q = customerName.trim().toLowerCase();
    return (customers ?? [])
      .filter((c) => !!q && c.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((c) => ({ key: c.id, label: c.name, hint: c.phone }));
  }, [customers, customerName]);

  const recent = useMemo(() => (allRentals ?? []).filter((r) => r.id !== rental?.id).slice(0, 5), [allRentals, rental?.id]);

  function updatePay(key: string, patch: Partial<PayRow>) {
    setPays((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addPayRow(): string {
    const row = newPayRow(today);
    setPays((prev) => [...prev, row]);
    return row.key;
  }
  // The new row's inputs exist only after the next render: try on the next tick.
  const focusLater = (name: string) => setTimeout(() => focus(name), 60);
  function removePay(key: string) {
    setPays((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }
  /** Enter in a payment cell: along the row, then down to the next - a last row with something in it starts another. */
  function payEnter(index: number, col: 'amount' | 'note') {
    const row = pays[index];
    if (col === 'amount') return focus(`${row.key}:note`);
    if (index < pays.length - 1) return focus(`${pays[index + 1].key}:amount`);
    if (payHasContent(row)) {
      const key = addPayRow();
      focusLater(`${key}:amount`);
    } else focusSave();
  }
  const payKey = (index: number, col: 'amount' | 'note') => (k: WebKeyInfo) => {
    if (k.key === 'Enter' && k.ctrl) {
      k.prevent();
      void handleSave();
    } else if (k.key === 'ArrowDown' && index < pays.length - 1) {
      k.prevent();
      focus(`${pays[index + 1].key}:${col}`);
    } else if (k.key === 'ArrowUp' && index > 0) {
      k.prevent();
      focus(`${pays[index - 1].key}:${col}`);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/rent` as never);
  };

  async function handleSave() {
    if (!userId || saving) return;
    if (!car.trim()) {
      showAlert('Add the car', 'Type the car number, or pick one from your stock.');
      return;
    }
    if (!start) {
      showAlert('Add the start date', 'Pick the day the car went out.');
      return;
    }
    if (end && end < start) {
      showAlert('Check the dates', 'The car cannot be due back before the day it went out.');
      return;
    }
    if (returnedOn && returnedOn < start) {
      showAlert('Check the dates', 'The car cannot come back before the day it went out.');
      return;
    }
    // A row with a note but no amount used to be dropped silently - point it out instead.
    if (pays.some((p) => p.note.trim() && !(Number(p.amount) > 0))) {
      showAlert('Finish every payment', 'A payment needs an amount above 0 - fill it in or clear the row.');
      return;
    }
    const payments = pays
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({ date: p.date || today, amount: round2(Number(p.amount)), note: p.note.trim() || null }));
    const ok = await confirmSave({
      title: `Save ${rental ? 'changes to this' : 'this'} rental?`,
      rows: [
        { label: 'Car', value: [car.trim(), model.trim()].filter(Boolean).join(' · ') },
        ...(customerName.trim() ? [{ label: 'Rented to', value: customerName.trim() }] : []),
        { label: 'Went out', value: toBsHistoryLabel(start) },
        { label: 'Rate per day', value: `NPR ${formatMoney(Number(rate) || 0)}` },
        { label: 'Days · Rent', value: `${figures.days} · NPR ${formatMoney(figures.total)}` },
        { label: 'Received', value: `NPR ${formatMoney(figures.received)}` },
      ],
      total: { label: figures.due < 0 ? 'Paid ahead' : 'Due', value: `NPR ${formatMoney(Math.abs(figures.due))}`, color: figures.due > 0 ? MONEY.out.base : MONEY.in.base },
    });
    if (!ok) return;
    const values = {
      car: car.trim(),
      model: model.trim() || null,
      customer_id: customerId,
      customer_name: customerName.trim() || null,
      start_date: start,
      end_date: end || null,
      returned_on: returnedOn || null,
      rate_per_day: round2(Number(rate) || 0),
      payments,
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
    showAlert('Remove this rental?', 'Its payments are removed with it.', [
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

  const clearLink = (set: (v: string) => void, value: string) =>
    value ? (
      <Pressable onPress={() => set('')} hitSlop={6} tabIndex={-1}>
        <Text className="text-[11px] font-semibold" style={{ color: accent }}>
          Clear
        </Text>
      </Pressable>
    ) : null;

  const detailsCard = (
    <EntryCard icon="car-outline" title="Rental" z={20}>
      <View className="flex-row flex-wrap" style={{ columnGap: 14, rowGap: 12 }}>
        <Box label="Car" basis={240}>
          <SuggestInput
            value={car}
            onChangeText={setCar}
            options={carFocused ? carOptions : []}
            onSelectOption={(opt, via) => {
              setCar(opt.label);
              if (via !== 'tab') focus('model');
            }}
            showWhenEmpty
            inputRef={setRef('car')}
            onFocus={() => setCarFocused(true)}
            onBlur={() => setCarFocused(false)}
            onKeyPress={enterKey('car')}
            placeholder="Car number"
            accessibilityLabel="Car"
            autoFocus={!rental}
            accent={accent}
            inputClassName="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900"
            inputStyle={{ borderWidth: 1, borderColor: carFocused ? accent : '#D1D5DB', backgroundColor: '#FFFFFF', outlineStyle: 'none' } as object}
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
        <Box label="Rented to" basis={240}>
          <SuggestInput
            value={customerName}
            onChangeText={(v) => {
              setCustomerName(v);
              setCustomerId(null);
            }}
            options={renterFocused ? renterOptions : []}
            onSelectOption={(opt, via) => {
              setCustomerName(opt.label);
              setCustomerId(opt.key);
              if (via !== 'tab') focus('rate');
            }}
            inputRef={setRef('renter')}
            onFocus={() => setRenterFocused(true)}
            onBlur={() => setRenterFocused(false)}
            onKeyPress={enterKey('renter')}
            placeholder="Who has the car"
            accessibilityLabel="Rented to"
            accent={accent}
            inputClassName="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900"
            inputStyle={{ borderWidth: 1, borderColor: renterFocused ? accent : '#D1D5DB', backgroundColor: '#FFFFFF', outlineStyle: 'none' } as object}
            compact
          />
        </Box>
        <Box label="Rate per day (NPR)" basis={160}>
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

      <View className="mt-3 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 12 }}>
        <Box label="Went out on" basis={190}>
          <KeyboardDateInput value={start} onChange={setStart} inputRef={setRef('start')} onEnter={() => afterField('start')} onRequestSave={handleSave} accent={accent} />
        </Box>
        <Box label="Due back on" basis={190} action={clearLink(setEnd, end)}>
          <KeyboardDateInput value={end} onChange={setEnd} inputRef={setRef('end')} onEnter={() => afterField('end')} onRequestSave={handleSave} accent={accent} />
        </Box>
        <Box
          label="Came back on"
          basis={190}
          action={
            returnedOn ? (
              clearLink(setReturnedOn, returnedOn)
            ) : (
              <Pressable onPress={() => setReturnedOn(today)} hitSlop={6} tabIndex={-1}>
                <Text className="text-[11px] font-semibold" style={{ color: accent }}>
                  Mark returned today
                </Text>
              </Pressable>
            )
          }
        >
          <KeyboardDateInput value={returnedOn} onChange={setReturnedOn} inputRef={setRef('returned')} onEnter={() => afterField('returned')} onRequestSave={handleSave} accent={accent} />
        </Box>
      </View>

      <View className="mt-3">
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

  const cellClass = 'rounded-lg px-2.5 py-2.5 text-sm text-gray-900';
  const headClass = 'px-2.5 text-[11px] font-bold capitalize tracking-wider text-gray-500';
  const paymentsCard = (
    <View
      className="mb-4 rounded-2xl border border-gray-200 bg-white"
      style={{ boxShadow: CARD_SHADOW, zIndex: 10 }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="cash-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">Payments received</Text>
        </View>
        <Text className="text-xs text-gray-400">
          {pays.filter(payHasContent).length} {pays.filter(payHasContent).length === 1 ? 'entry' : 'entries'}
        </Text>
      </View>

      <View className="flex-row items-center border-y border-gray-200 bg-gray-50 px-2 py-2">
        <Text className="text-center text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ width: 36 }}>
          #
        </Text>
        <Text className={headClass} style={{ width: 190 }}>
          Date
        </Text>
        <Text className={`${headClass} text-right`} style={{ width: 160 }}>
          Amount (NPR)
        </Text>
        <Text className={headClass} style={{ flex: 1 }}>
          Remarks
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {pays.map((row, index) => (
        <View key={row.key} className="flex-row items-start border-b border-gray-100 px-2 py-1">
          <Text className="pt-3 text-center text-[13px] font-semibold text-gray-400" style={{ width: 36 }}>
            {index + 1}
          </Text>
          <View style={{ width: 190 }} className="px-1">
            <KeyboardDateInput
              value={row.date}
              onChange={(v) => updatePay(row.key, { date: v })}
              inputRef={setRef(`${row.key}:date`)}
              onEnter={() => focus(`${row.key}:amount`)}
              onRequestSave={handleSave}
              accent={accent}
              compact
            />
          </View>
          <View style={{ width: 160 }} className="px-1">
            <KeyInput
              value={row.amount}
              onChangeText={(v) => updatePay(row.key, { amount: v })}
              inputRef={setRef(`${row.key}:amount`)}
              onEnter={() => payEnter(index, 'amount')}
              onRequestSave={handleSave}
              onKey={payKey(index, 'amount')}
              accent={accent}
              placeholder="0"
              numeric
              align="right"
              className={`${cellClass} font-semibold`}
              accessibilityLabel={`Amount in NPR, payment ${index + 1}`}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }} className="px-1">
            <KeyInput
              value={row.note}
              onChangeText={(v) => updatePay(row.key, { note: v })}
              inputRef={setRef(`${row.key}:note`)}
              onEnter={() => payEnter(index, 'note')}
              onRequestSave={handleSave}
              onKey={payKey(index, 'note')}
              accent={accent}
              placeholder="Optional"
              className={cellClass}
              accessibilityLabel={`Remarks, payment ${index + 1}`}
            />
          </View>
          <View style={{ width: 36, alignItems: 'center', paddingTop: 12 }}>
            <Pressable
              onPress={() => removePay(row.key)}
              disabled={pays.length === 1}
              tabIndex={-1}
              hitSlop={6}
              accessibilityLabel={`Remove payment ${index + 1}`}
              style={{ opacity: pays.length === 1 ? 0 : 0.6 }}
            >
              <Ionicons name="close-circle" size={18} color="#DC2626" />
            </Pressable>
          </View>
        </View>
      ))}

      <View
        className="flex-row flex-wrap items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2.5"
        style={{ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
      >
        <Pressable
          onPress={() => {
            const key = addPayRow();
            focusLater(`${key}:amount`);
          }}
          tabIndex={-1}
          className="flex-row items-center gap-1.5 rounded-lg px-2 py-2"
          accessibilityLabel="Add payment"
        >
          <Ionicons name="add-circle-outline" size={17} color={accent} />
          <Text className="text-sm font-bold" style={{ color: accent }}>
            Add payment
          </Text>
        </Pressable>
        <View className="flex-row items-baseline gap-3 pr-2">
          <Text className="text-[13px] font-semibold text-gray-500">Total Received</Text>
          <Text className="text-xl font-extrabold" style={{ color: MONEY.in.base }}>
            NPR {formatMoney(figures.received)}
          </Text>
        </View>
      </View>
    </View>
  );

  const actions = (
    <View className="mt-1 flex-row items-center justify-end" style={{ gap: 16 }}>
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

  // What it comes to, as the side panel's first card (below the cards on a narrow screen).
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
        { label: 'Rent', value: `NPR ${money(figures.total)}`, color: '#111827' },
        { label: 'Received', value: `NPR ${money(figures.received)}`, color: MONEY.in.base },
        { label: figures.due < 0 ? 'Paid ahead' : 'Due', value: `NPR ${money(Math.abs(figures.due))}`, color: figures.due > 0 ? MONEY.out.base : MONEY.in.base },
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
        recent.map((r, i) => {
          const f = rentalFigures(r, today);
          return (
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
              <Text className="text-xs font-bold" style={{ color: f.due > 0 ? MONEY.out.base : MONEY.in.base }}>
                {f.due === 0 ? 'Cleared' : `NPR ${money(Math.abs(f.due))}`}
              </Text>
            </Pressable>
          );
        })
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
              {paymentsCard}
              {actions}
            </View>
            <View style={{ width: 320, gap: 16 }}>
              {summaryCard}
              {recentCard}
            </View>
          </View>
        </View>
        {confirmDialog}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {detailsCard}
      {paymentsCard}
      <View className="mb-4">{summaryCard}</View>
      {actions}
      {confirmDialog}
    </ScrollView>
  );
}
