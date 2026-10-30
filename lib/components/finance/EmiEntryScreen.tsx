// lib/components/finance/EmiEntryScreen.tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, type TextInput } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseRow, useSupabaseUpdate } from '../../hooks/useSupabase';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { KeyInput } from './KeyInput';
import { KeyboardDateInput } from './KeyboardDateInput';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { readKey } from '../../utils/webKeys';
import { useConfirmSave } from './ConfirmSave';
import { useConfirmNewParty, withType } from './NewPartyConfirm';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { money } from './BookKit';
import { EMI_STOCK_RATE, addMonths, billedVehicle, emiDirection, emiFigures, emiInstallment } from '../../utils/emi';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { formatMoney, round2 } from '../../utils/money';
import type { EmiPlan } from '../../../types/database.types';

const CARD_SHADOW = '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)';
const MAX_SUGGESTIONS = 6;
const ADD_PARTY_KEY = '__add-party__';

function Box({ label, basis = 200, raised, action, children }: { label: string; basis?: number; raised?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: basis, minWidth: 0, zIndex: raised ? 30 : 0 }}>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-xs font-semibold text-gray-600">{label}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** One EMI sale - the vehicle, the customer and the instalment plan. The same page adds and edits (`?id=`). */
export function EmiEntryScreen({ basePath }: { basePath: string }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: plan, isLoading } = useSupabaseRow('emi_plans', id);
  if (id && isLoading) return null;
  if (id && !plan) return <Redirect href={`${basePath}/rent?tab=emi` as never} />;
  return <EmiForm key={id ?? 'new'} basePath={basePath} plan={id ? plan ?? null : null} />;
}

function EmiForm({ basePath, plan }: { basePath: string; plan: EmiPlan | null }) {
  useCalendarMode();
  const accent = FINANCE_ENTRY_ACCENT;
  const userId = useAuthStore((state) => state.session?.user.id);
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: products } = useSupabaseQuery('products', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: customers } = useSupabaseQuery('customers', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: bills } = useSupabaseQuery('business_transactions', { filters: owner, all: true, enabled: !!userId });
  const { data: received } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId && !!plan });
  const { data: paidOut } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, all: true, enabled: !!userId && !!plan });
  const createPlan = useSupabaseInsert('emi_plans');
  const updatePlan = useSupabaseUpdate('emi_plans');
  const deletePlan = useSupabaseDelete('emi_plans');
  const createCustomer = useSupabaseInsert('customers');
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();
  const { askNewParty, dialog: newPartyDialog } = useConfirmNewParty();

  // Sold to a customer (they pay us) or bought from a vendor (we pay them). The vendor is kept where the customer is.
  const [direction, setDirection] = useState<'sale' | 'purchase'>(plan ? emiDirection(plan) : 'sale');
  const [rate, setRate] = useState(plan ? String(plan.interest_rate ?? 0) : String(EMI_STOCK_RATE));
  const buying = direction === 'purchase';
  const partyWord = buying ? 'Vendor' : 'Customer';
  // Enter walks the form box by box: Vehicle > customer / vendor > months > interest > instalment > first due > remarks,
  // and Enter on the last box (or Ctrl+Enter anywhere) saves.
  const box = {
    car: useRef<TextInput | null>(null),
    customer: useRef<TextInput | null>(null),
    months: useRef<TextInput | null>(null),
    rate: useRef<TextInput | null>(null),
    inst: useRef<TextInput | null>(null),
    firstDue: useRef<TextInput | null>(null),
    note: useRef<TextInput | null>(null),
  };
  // A moment later, so a list or popup that was just closed has let go of the keyboard first.
  const focusBox = (k: keyof typeof box) => setTimeout(() => box[k].current?.focus(), 30);
  // Enter in a name box with nothing to pick from moves on; Ctrl+Enter saves.
  const enterMovesTo = (next: keyof typeof box) => (e: unknown) => {
    const k = readKey(e);
    if (k.key !== 'Enter') return;
    k.prevent();
    if (k.ctrl) void handleSave();
    else focusBox(next);
  };
  const [car, setCar] = useState(plan?.car ?? '');
  const [customerId, setCustomerId] = useState<string | null>(plan?.customer_id ?? null);
  const [customerName, setCustomerName] = useState(plan?.customer_name ?? '');
  const [installment, setInstallment] = useState(plan ? String(plan.installment) : '');
  const [months, setMonths] = useState(plan ? String(plan.months) : '12');
  const [firstDue, setFirstDue] = useState(plan?.first_due ?? addMonths(today, 1));
  const [note, setNote] = useState(plan?.note ?? '');
  const [focused, setFocused] = useState<'car' | 'customer' | null>(null);
  const [saving, setSaving] = useState(false);

  // The price is the vehicle's own bill - its Sale bill, or its Purchase bill when we pay the vendor - and the model its
  // Purchase bill's, as "Add all" reads them; with no such bill, what the plan was saved with. The down payment and
  // Completed on are not asked: a plan keeps what it was saved with (a new one has none).
  const billed = useMemo(() => billedVehicle(bills ?? [], buying ? 'purchase' : 'sale', car), [bills, buying, car]);
  const price = billed?.price ?? (plan ? Number(plan.sale_price) || 0 : 0);
  const model = useMemo(() => billedVehicle(bills ?? [], 'purchase', car)?.model || plan?.model || '', [bills, car, plan]);
  const down = plan ? Number(plan.down_payment) || 0 : 0;
  const closedOn = plan?.closed_on ?? '';
  // Financed: the price less the down payment. The instalment it comes to, the way banks work it out: the yearly rate,
  // charged each month on what is still unpaid (reducing balance), every month the same.
  const financed = Math.max(0, price - down);
  const suggestedInstallment = emiInstallment(financed, Number(months), Number(rate) || 0);

  const carOptions = useMemo<SuggestOption[]>(() => {
    const q = car.trim().toLowerCase();
    if (!q) return [];
    return (products ?? [])
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((p) => ({ key: p.id, label: p.name, hint: Number(p.price) > 0 ? `NPR ${formatMoney(Number(p.price))}` : null }));
  }, [products, car]);
  const customerOptions = useMemo<SuggestOption[]>(() => {
    const q = customerName.trim().toLowerCase();
    if (!q) return [];
    const list: SuggestOption[] = (customers ?? [])
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((c) => ({ key: c.id, label: c.name, hint: c.phone ?? null }));
    if (!(customers ?? []).some((c) => c.name.trim().toLowerCase() === q)) list.push({ key: ADD_PARTY_KEY, label: `Add "${customerName.trim()}" as new customer`, kind: 'add' });
    return list;
  }, [customers, customerName]);

  const paid = useMemo(() => {
    if (!plan || (!buying && !customerId)) return 0;
    const k = car.trim().replace(/\s+/g, ' ').toLowerCase();
    const names = (note: string | null) => (note ?? '').split(' · ')[0].trim().replace(/\s+/g, ' ').toLowerCase() === k;
    // What the customer paid (their Received entries), or what we paid on the car (every Paid entry naming it - the way
    // Stock and Inventory count it, whichever vendor it was recorded under).
    return buying
      ? (paidOut ?? []).filter((e) => e.entry_type === 'credit' && names(e.note)).reduce((s, e) => s + Number(e.amount), 0)
      : (received ?? []).filter((e) => e.customer_id === customerId && e.entry_type === 'credit' && names(e.note)).reduce((s, e) => s + Number(e.amount), 0);
  }, [received, paidOut, buying, plan, customerId, car]);
  const figures = emiFigures(
    { down_payment: down, installment: Number(installment) || 0, months: Number(months) || 1, first_due: firstDue, closed_on: closedOn || null },
    paid,
    today
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/rent?tab=emi` as never);
  };

  /** Resolves to whether someone is now picked (false when the new-name popup was cancelled or the save failed). */
  async function pickCustomer(opt: SuggestOption): Promise<boolean> {
    if (opt.key === ADD_PARTY_KEY) {
      if (!userId) return false;
      const asked = await askNewParty({ name: customerName.trim(), kind: buying ? 'vendor' : 'customer' });
      if (!asked) return false;
      try {
        const created = await createCustomer.mutateAsync({ owner_id: userId, name: asked.name, phone: null, ...withType(asked) });
        setCustomerId(created.id);
        setCustomerName(created.name);
        return true;
      } catch (err) {
        showAlert('Could not add customer', getErrorMessage(err));
        return false;
      }
    }
    setCustomerId(opt.key);
    setCustomerName(opt.label);
    return true;
  }

  async function handleSave() {
    if (!userId || saving) return;
    if (!car.trim()) return showAlert('Add the vehicle', 'Type the vehicle, or pick one from your stock.');
    if (!customerId) return showAlert(`Pick the ${partyWord.toLowerCase()}`, `Choose the ${partyWord.toLowerCase()} from the list (or add them), so their payments are matched.`);
    if (!(Number(months) > 0)) return showAlert('Add the months', 'How many monthly instalments?');
    if (!(Number(installment) > 0)) return showAlert('Add the instalment', 'The amount due each month.');
    const ok = await confirmSave({
      title: `Save ${plan ? 'changes to this' : 'this'} EMI?`,
      rows: [
        { label: 'Vehicle', value: [car.trim(), model].filter(Boolean).join(' · ') },
        { label: partyWord, value: customerName.trim() },
        { label: 'Instalment', value: `NPR ${formatMoney(Number(installment) || 0)} × ${months} months` },
        ...(Number(rate) > 0 ? [{ label: 'Interest', value: `${Number(rate)}% a year, reducing balance` }] : []),
        { label: 'First due', value: toBsHistoryLabel(firstDue) },
      ],
      total: { label: buying ? 'To pay' : 'To collect', value: `NPR ${formatMoney(figures.total)}`, color: buying ? '#B91C1C' : '#047857' },
    });
    if (!ok) return;
    const values = {
      car: car.trim(),
      model: model || null,
      customer_id: customerId,
      customer_name: customerName.trim() || null,
      sale_price: round2(price),
      down_payment: round2(down),
      installment: round2(Number(installment) || 0),
      months: Math.round(Number(months)),
      first_due: firstDue,
      closed_on: closedOn || null,
      note: note.trim() || null,
      // Only what differs from a plain sale is sent, so a sale without interest saves as it always did.
      ...(buying ? { direction } : {}),
      ...(Number(rate) > 0 || plan?.interest_rate ? { interest_rate: Number(rate) || 0 } : {}),
    };
    setSaving(true);
    try {
      if (plan) await updatePlan.mutateAsync({ id: plan.id, values });
      else await createPlan.mutateAsync({ owner_id: userId, ...values });
      goBack();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleRemove() {
    if (!plan) return;
    showAlert('Remove this EMI?', 'The sale bill and the payments stay; only the instalment plan goes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlan.mutateAsync(plan.id);
            goBack();
          } catch (err) {
            showAlert('Could not remove', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  useScreenHeader({ title: plan ? 'EMI' : 'New EMI', resetTitle: 'Rent & EMI' }, [!!plan]);

  const inputStyle = (on: boolean) =>
    ({ borderWidth: 1, borderColor: on ? accent : '#D1D5DB', backgroundColor: '#FFFFFF', outlineStyle: 'none', ...(on ? { boxShadow: `0 0 0 3px ${accent}29` } : null) }) as object;
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { numeric?: boolean; placeholder?: string; basis?: number; at?: keyof typeof box; next?: keyof typeof box | 'save' } = {}
  ) => (
    <Box label={label} basis={opts.basis ?? 170}>
      <KeyInput
        value={value}
        onChangeText={set}
        inputRef={opts.at ? box[opts.at] : undefined}
        onEnter={opts.next === 'save' ? () => void handleSave() : opts.next ? () => focusBox(opts.next as keyof typeof box) : undefined}
        onRequestSave={handleSave}
        accent={accent}
        placeholder={opts.placeholder ?? '0'}
        numeric={opts.numeric}
        align={opts.numeric ? 'right' : undefined}
        accessibilityLabel={label}
      />
    </Box>
  );

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ padding: 24, paddingBottom: 60, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View className="rounded-2xl border border-gray-200 bg-white p-5" style={{ boxShadow: CARD_SHADOW, zIndex: 20 }}>
        <View className="mb-4 flex-row items-center gap-2">
          <Ionicons name="card-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold tracking-wider text-gray-500">{buying ? 'EMI PURCHASE' : 'EMI SALE'}</Text>
        </View>
        {/* Which way: a vehicle sold to a customer (they pay us), or stock bought from a vendor (we pay them). */}
        <View className="mb-4 flex-row flex-wrap" style={{ gap: 8 }}>
          {([
            ['sale', 'Sold on EMI - customer pays us'],
            ['purchase', 'Bought on EMI - we pay the vendor'],
          ] as const).map(([d, label]) => {
            const on = direction === d;
            return (
              <Pressable
                key={d}
                onPress={() => setDirection(d)}
                disabled={!!plan}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                className="rounded-full border px-4 py-2"
                style={{ borderColor: on ? accent : '#D1D5DB', backgroundColor: on ? '#EFF6FF' : '#FFFFFF', opacity: plan && !on ? 0.4 : 1 }}
              >
                <Text className="text-[12.5px] font-semibold" style={{ color: on ? accent : '#4B5563' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14, zIndex: focused ? 30 : 0 }}>
          <Box label="Vehicle" basis={260} raised={focused === 'car'}>
            <SuggestInput
              value={car}
              onChangeText={setCar}
              options={focused === 'car' ? carOptions : []}
              onSelectOption={(opt, via) => {
                setCar(opt.label);
                if (via !== 'tab') focusBox('customer');
              }}
              onKeyPress={enterMovesTo('customer')}
              inputRef={(el) => {
                box.car.current = el;
              }}
              autoFocus={!plan}
              onFocus={() => setFocused('car')}
              onBlur={() => setFocused((f) => (f === 'car' ? null : f))}
              placeholder="Vehicle number…"
              accessibilityLabel="Vehicle"
              accent={accent}
              inputClassName="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900"
              inputStyle={inputStyle(focused === 'car')}
              compact
            />
          </Box>
          <Box label={partyWord} basis={260} raised={focused === 'customer'}>
            <SuggestInput
              value={customerName}
              onChangeText={(v) => {
                setCustomerName(v);
                setCustomerId(null);
              }}
              options={focused === 'customer' ? customerOptions : []}
              onSelectOption={(opt, via) => {
                void pickCustomer(opt).then((picked) => {
                  if (picked && via !== 'tab') focusBox('months');
                });
              }}
              onKeyPress={enterMovesTo('months')}
              inputRef={(el) => {
                box.customer.current = el;
              }}
              enterAddsNew
              onFocus={() => setFocused('customer')}
              onBlur={() => setFocused((f) => (f === 'customer' ? null : f))}
              placeholder={buying ? 'Who did you buy it from?' : 'Who bought it?'}
              accessibilityLabel={partyWord}
              accent={accent}
              inputClassName="rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900"
              inputStyle={inputStyle(focused === 'customer')}
              adornmentWidth={54}
              adornment={customerId ? <Ionicons name="checkmark-circle" size={15} color={accent} /> : null}
              compact
            />
          </Box>
        </View>
        <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14 }}>
          {field('Months', months, setMonths, { numeric: true, basis: 110, at: 'months', next: 'rate' })}
          {field('Interest (% / year)', rate, setRate, { numeric: true, basis: 130, at: 'rate', next: 'inst' })}
          <Box
            label="Instalment / month (NPR)"
            basis={190}
            action={
              suggestedInstallment > 0 ? (
                <Pressable onPress={() => setInstallment(String(suggestedInstallment))} hitSlop={6}>
                  <Text className="text-[11px] font-semibold" style={{ color: accent }}>
                    {`Use ${formatMoney(suggestedInstallment)}`}
                  </Text>
                </Pressable>
              ) : null
            }
          >
            <KeyInput
              value={installment}
              onChangeText={setInstallment}
              inputRef={box.inst}
              onEnter={() => {
                if (!installment.trim() && suggestedInstallment > 0) setInstallment(String(suggestedInstallment));
                focusBox('firstDue');
              }}
              onRequestSave={handleSave}
              accent={accent}
              placeholder="0"
              numeric
              align="right"
              accessibilityLabel="Instalment"
            />
          </Box>
          <Box label="First instalment due" basis={180}>
            <KeyboardDateInput value={firstDue} onChange={setFirstDue} inputRef={box.firstDue} onEnter={() => focusBox('note')} onRequestSave={handleSave} accent={accent} />
          </Box>
        </View>
        <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14 }}>
          {field('Remarks', note, setNote, { placeholder: 'Optional', basis: 300, at: 'note', next: 'save' })}
        </View>
      </View>

      <View className="rounded-2xl border border-gray-200 bg-white p-4" style={{ boxShadow: CARD_SHADOW }}>
        {[
          { label: buying ? 'Purchase price (its Purchase bill)' : 'Sale price (its Sale bill)', value: price, color: '#111827' },
          { label: `${buying ? 'To pay' : 'To collect'}${down > 0 ? ' (down + instalments)' : ''}`, value: figures.total, color: '#111827' },
          { label: buying ? 'Paid so far' : 'Received so far', value: figures.paid, color: '#047857' },
          { label: `Due by today (${figures.dueCount} of ${months || 0} instalments)`, value: figures.dueByNow, color: '#111827' },
          { label: 'Overdue', value: figures.overdue, color: '#B91C1C' },
          { label: 'Remaining', value: figures.remaining, color: '#111827' },
        ].map((f) => (
          <View key={f.label} className="flex-row items-center justify-between border-b border-gray-50 py-2">
            <Text className="text-xs text-gray-500">{f.label}</Text>
            <Text className="text-[13px] font-bold" style={{ color: f.color }}>{`NPR ${money(f.value)}`}</Text>
          </View>
        ))}
        <Text className="mt-2 text-[11px] text-gray-400">
          {figures.next ? `Next instalment: ${toBsHistoryLabel(figures.next)}. ` : ''}
          {car.trim() && !billed && !plan ? `No ${buying ? 'Purchase' : 'Sale'} bill for this vehicle yet, so the instalment is not worked out - type it in. ` : ''}
          {down > 0 ? `The down payment counts as ${buying ? 'paid' : 'received'}. ` : ''}
          {buying
            ? "Instalments paid are the Paid entries on the vendor's ledger naming this item."
            : "Instalments received are the customer's Received entries naming this vehicle."}
          {' '}The instalment is worked out the way banks do: the yearly interest, charged each month on what is still unpaid (reducing balance), so every month pays the same.
        </Text>
      </View>

      <View className="flex-row items-center justify-end" style={{ gap: 10 }}>
        {plan && (
          <Pressable onPress={handleRemove} className="mr-auto flex-row items-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5" style={{ gap: 6 }}>
            <Ionicons name="trash-outline" size={15} color="#DC2626" />
            <Text className="text-sm font-semibold text-red-600">Remove</Text>
          </Pressable>
        )}
        <Pressable onPress={goBack} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable onPress={handleSave} disabled={saving} className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50" style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${FINANCE_ENTRY_SHADOW}` }}>
          <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      {confirmDialog}
      {newPartyDialog}
    </ScrollView>
  );
}
