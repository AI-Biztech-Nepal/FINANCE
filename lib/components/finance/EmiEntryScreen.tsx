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
import { EMI_STOCK_RATE, addMonths, billedVehicle, emiDirection, emiInstallment } from '../../utils/emi';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { journalOf } from '../../utils/journalVoucher';
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

/** One EMI sale - the vehicle, the customer and the installment plan. The same page adds and edits (`?id=`). */
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
  const { data: received } = useSupabaseQuery('customer_ledger_entries', { filters: owner, all: true, enabled: !!userId && !plan });
  const { data: paidOut } = useSupabaseQuery('vendor_ledger_entries', { filters: owner, all: true, enabled: !!userId && !plan });
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
  // Enter walks the form box by box: Date > customer / vendor > Vehicle > Amount > Interest > Tenure > Remarks, and Enter
  // on the last box (or Ctrl+Enter anywhere) saves.
  const box = {
    date: useRef<TextInput | null>(null),
    customer: useRef<TextInput | null>(null),
    car: useRef<TextInput | null>(null),
    amount: useRef<TextInput | null>(null),
    rate: useRef<TextInput | null>(null),
    months: useRef<TextInput | null>(null),
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
  const [months, setMonths] = useState(plan ? String(plan.months) : '12');
  // The EMI's date - the day it was agreed; the first installment falls a month after it.
  const [date, setDate] = useState(plan ? addMonths(plan.first_due, -1) : today);
  const firstDue = date ? addMonths(date, 1) : '';
  const [note, setNote] = useState(plan?.note ?? '');
  const [focused, setFocused] = useState<'car' | 'customer' | null>(null);
  const [saving, setSaving] = useState(false);

  // The model is the vehicle's Purchase bill's, as "Add all" reads it. The down payment and Completed on are not asked: a
  // plan keeps what it was saved with (a new one has none).
  const model = useMemo(() => billedVehicle(bills ?? [], 'purchase', car)?.model || plan?.model || '', [bills, car, plan]);
  // A new plan runs on the balance: what was already paid naming the vehicle (by this customer; to any vendor) comes off.
  const paidOn = (name: string) => {
    const first = (note: string | null) => (note ?? '').split(' · ')[0].trim().replace(/\s+/g, ' ').toLowerCase();
    const car = name.trim().replace(/\s+/g, ' ').toLowerCase();
    const paid = (entries: { entry_type: string; note: string | null; amount: number }[]) =>
      entries.filter((e) => e.entry_type === 'credit' && !journalOf(e.note) && first(e.note) === car).reduce((s, e) => s + Number(e.amount), 0);
    return round2(buying ? paid(paidOut ?? []) : paid((received ?? []).filter((e) => e.customer_id === customerId)));
  };
  const down = plan ? Number(plan.down_payment) || 0 : paidOn(car);
  const closedOn = plan?.closed_on ?? '';
  // The EMI calculator: the amount on installments, the interest a year and the tenure in months. Picking the vehicle fills
  // the amount from its own bill - its Sale bill, or its Purchase bill when we pay the vendor - less any down payment;
  // it can be changed. The installment is worked out the way banks do: the yearly rate charged each month on what is
  // still unpaid (reducing balance), every month the same.
  const [amount, setAmount] = useState(plan ? String(round2(Math.max(0, Number(plan.sale_price) - down))) : '');
  const billedOf = (name: string) => billedVehicle(bills ?? [], buying ? 'purchase' : 'sale', name);
  const fillAmount = (name: string) => {
    const b = billedOf(name);
    if (b) setAmount(String(round2(Math.max(0, b.price - (plan ? down : paidOn(name))))));
  };
  const installment = emiInstallment(Number(amount) || 0, Number(months) || 0, Number(rate) || 0);
  const totalPayable = round2(installment * (Number(months) || 0));
  const totalInterest = round2(Math.max(0, totalPayable - (Number(amount) || 0)));

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
    if (!date) return showAlert('Add the date', 'The day the EMI was agreed - the first installment falls a month after it.');
    if (!customerId) return showAlert(`Pick the ${partyWord.toLowerCase()}`, `Choose the ${partyWord.toLowerCase()} from the list (or add them), so their payments are matched.`);
    if (!car.trim()) return showAlert('Add the vehicle', 'Type the vehicle, or pick one from your stock.');
    if (!(Number(amount) > 0)) return showAlert('Add the amount', 'The amount on installments.');
    if (!(Number(months) > 0)) return showAlert('Add the tenure', 'How many monthly installments?');
    const ok = await confirmSave({
      title: `Save ${plan ? 'changes to this' : 'this'} EMI?`,
      rows: [
        { label: 'Date', value: toBsHistoryLabel(date) },
        { label: partyWord, value: customerName.trim() },
        { label: 'Vehicle', value: [car.trim(), model].filter(Boolean).join(' · ') },
        { label: 'Amount', value: `NPR ${formatMoney(Number(amount) || 0)}` },
        { label: 'Interest', value: Number(rate) > 0 ? `${Number(rate)}% a year, reducing balance` : 'None' },
        { label: 'Tenure', value: `${months} months` },
        { label: 'EMI', value: `NPR ${formatMoney(installment)} a month` },
        { label: 'First due', value: toBsHistoryLabel(firstDue) },
      ],
      total: { label: buying ? 'To pay' : 'To collect', value: `NPR ${formatMoney(totalPayable)}`, color: buying ? '#B91C1C' : '#047857' },
    });
    if (!ok) return;
    const values = {
      car: car.trim(),
      model: model || null,
      customer_id: customerId,
      customer_name: customerName.trim() || null,
      sale_price: round2((Number(amount) || 0) + down),
      down_payment: round2(down),
      installment: round2(installment),
      months: Math.round(Number(months)),
      first_due: firstDue,
      closed_on: closedOn || null,
      note: note.trim() || null,
      // Only what differs from a plain sale is sent, so a sale without interest saves as it always did.
      ...(buying ? { direction } : {}),
      ...(!plan && down > 0 ? { ledger_paid: down } : {}),
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
    showAlert('Remove this EMI?', 'The sale bill and the payments stay; only the installment plan goes.', [
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
          <Box label="Date" basis={170}>
            <KeyboardDateInput
              value={date}
              onChange={setDate}
              inputRef={box.date}
              onEnter={() => focusBox('customer')}
              onRequestSave={handleSave}
              accent={accent}
              autoFocus={!plan}
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
                  if (picked && via !== 'tab') focusBox('car');
                });
              }}
              onKeyPress={enterMovesTo('car')}
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
          <Box label="Vehicle" basis={260} raised={focused === 'car'}>
            <SuggestInput
              value={car}
              onChangeText={setCar}
              options={focused === 'car' ? carOptions : []}
              onSelectOption={(opt, via) => {
                setCar(opt.label);
                fillAmount(opt.label);
                if (via !== 'tab') focusBox('amount');
              }}
              onKeyPress={(e) => {
                const k = readKey(e);
                if (k.key === 'Enter' && !k.ctrl && !Number(amount)) fillAmount(car);
                enterMovesTo('amount')(e);
              }}
              inputRef={(el) => {
                box.car.current = el;
              }}
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
        </View>
      </View>

      {/* The EMI calculator: amount, interest a year and tenure give the monthly installment. */}
      <View className="rounded-2xl border border-gray-200 bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
        <View className="mb-4 flex-row items-center gap-2">
          <Ionicons name="calculator-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold tracking-wider text-gray-500">EMI CALCULATOR</Text>
        </View>
        <View className="flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14 }}>
          {field('Amount (NPR)', amount, setAmount, { numeric: true, basis: 200, at: 'amount', next: 'rate' })}
          {field('Interest (% / year)', rate, setRate, { numeric: true, basis: 150, at: 'rate', next: 'months' })}
          {field('Tenure (months)', months, setMonths, { numeric: true, basis: 150, at: 'months', next: 'note' })}
        </View>
        {car.trim() && !Number(amount) && !billedOf(car) ? (
          <Text className="mt-2 text-[11.5px] text-amber-700">{`No ${buying ? 'Purchase' : 'Sale'} bill for this vehicle yet - type the amount.`}</Text>
        ) : null}
        <View className="mt-4 flex-row flex-wrap overflow-hidden rounded-xl border border-gray-200">
          {[
            { label: 'EMI / month', value: installment, big: true },
            { label: 'Total interest', value: totalInterest, big: false },
            { label: 'Total payable', value: totalPayable, big: false },
          ].map((k, i) => (
            <View
              key={k.label}
              className="px-4 py-3"
              style={{ flexGrow: 1, flexBasis: 160, backgroundColor: k.big ? '#EFF6FF' : '#FFFFFF', borderLeftWidth: i === 0 ? 0 : 1, borderColor: '#E5E7EB' }}
            >
              <Text className="text-[11.5px] font-semibold text-gray-500">{k.label}</Text>
              <Text className={k.big ? 'mt-0.5 text-[20px] font-extrabold' : 'mt-0.5 text-[15px] font-bold text-gray-900'} style={k.big ? { color: accent } : undefined}>
                {`NPR ${money(k.value)}`}
              </Text>
            </View>
          ))}
        </View>
        <Text className="mt-2 text-[11px] text-gray-400">
          {firstDue ? `First installment ${toBsHistoryLabel(firstDue)}, a month after the date. ` : ''}
          Worked out the way banks do: the yearly interest, charged each month on what is still unpaid (reducing balance), so every month pays the same.
        </Text>
        <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14 }}>
          {field('Remarks', note, setNote, { placeholder: 'Optional', basis: 300, at: 'note', next: 'save' })}
        </View>
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
