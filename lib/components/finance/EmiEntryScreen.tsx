// lib/components/finance/EmiEntryScreen.tsx
import { useMemo, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseRow, useSupabaseUpdate } from '../../hooks/useSupabase';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { KeyInput } from './KeyInput';
import { KeyboardDateInput } from './KeyboardDateInput';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { useConfirmSave } from './ConfirmSave';
import { useConfirmNewParty, withType } from './NewPartyConfirm';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { money } from './BookKit';
import { EMI_STOCK_RATE, addMonths, emiDirection, emiFigures, flatInstallment } from '../../utils/emi';
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
  const [car, setCar] = useState(plan?.car ?? '');
  const [model, setModel] = useState(plan?.model ?? '');
  const [customerId, setCustomerId] = useState<string | null>(plan?.customer_id ?? null);
  const [customerName, setCustomerName] = useState(plan?.customer_name ?? '');
  const [price, setPrice] = useState(plan ? String(plan.sale_price) : '');
  const [down, setDown] = useState(plan ? String(plan.down_payment) : '');
  const [installment, setInstallment] = useState(plan ? String(plan.installment) : '');
  const [months, setMonths] = useState(plan ? String(plan.months) : '12');
  const [firstDue, setFirstDue] = useState(plan?.first_due ?? addMonths(today, 1));
  const [closedOn, setClosedOn] = useState(plan?.closed_on ?? '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [focused, setFocused] = useState<'car' | 'customer' | null>(null);
  const [saving, setSaving] = useState(false);

  // Financed: the price less the down payment. The instalment it comes to: the financed amount over the months, plus the
  // interest - the rate % of the financed amount every month (flat).
  const financed = Math.max(0, (Number(price) || 0) - (Number(down) || 0));
  const suggestedInstallment = flatInstallment(financed, Number(months), Number(rate) || 0);

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
    { down_payment: Number(down) || 0, installment: Number(installment) || 0, months: Number(months) || 1, first_due: firstDue, closed_on: closedOn || null },
    paid,
    today
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/rent?tab=emi` as never);
  };

  async function pickCustomer(opt: SuggestOption) {
    if (opt.key === ADD_PARTY_KEY) {
      if (!userId) return;
      const asked = await askNewParty({ name: customerName.trim(), kind: buying ? 'vendor' : 'customer' });
      if (!asked) return;
      try {
        const created = await createCustomer.mutateAsync({ owner_id: userId, name: asked.name, phone: null, ...withType(asked) });
        setCustomerId(created.id);
        setCustomerName(created.name);
      } catch (err) {
        showAlert('Could not add customer', getErrorMessage(err));
      }
      return;
    }
    setCustomerId(opt.key);
    setCustomerName(opt.label);
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
        { label: 'Vehicle', value: [car.trim(), model.trim()].filter(Boolean).join(' · ') },
        { label: partyWord, value: customerName.trim() },
        { label: buying ? 'Purchase price' : 'Sale price', value: `NPR ${formatMoney(Number(price) || 0)}` },
        { label: 'Down payment', value: `NPR ${formatMoney(Number(down) || 0)}` },
        { label: 'Instalment', value: `NPR ${formatMoney(Number(installment) || 0)} × ${months} months` },
        ...(Number(rate) > 0 ? [{ label: 'Interest', value: `${Number(rate)}% a month, flat` }] : []),
        { label: 'First due', value: toBsHistoryLabel(firstDue) },
      ],
      total: { label: buying ? 'To pay' : 'To collect', value: `NPR ${formatMoney(figures.total)}`, color: buying ? '#B91C1C' : '#047857' },
    });
    if (!ok) return;
    const values = {
      car: car.trim(),
      model: model.trim() || null,
      customer_id: customerId,
      customer_name: customerName.trim() || null,
      sale_price: round2(Number(price) || 0),
      down_payment: round2(Number(down) || 0),
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
  const field = (label: string, value: string, set: (v: string) => void, opts: { numeric?: boolean; placeholder?: string; basis?: number } = {}) => (
    <Box label={label} basis={opts.basis ?? 170}>
      <KeyInput value={value} onChangeText={set} onRequestSave={handleSave} accent={accent} placeholder={opts.placeholder ?? '0'} numeric={opts.numeric} align={opts.numeric ? 'right' : undefined} accessibilityLabel={label} />
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
              onSelectOption={(opt) => setCar(opt.label)}
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
          {field('Model', model, setModel, { placeholder: 'Model' })}
          <Box label={partyWord} basis={260} raised={focused === 'customer'}>
            <SuggestInput
              value={customerName}
              onChangeText={(v) => {
                setCustomerName(v);
                setCustomerId(null);
              }}
              options={focused === 'customer' ? customerOptions : []}
              onSelectOption={(opt) => void pickCustomer(opt)}
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
          {field(buying ? 'Purchase price (NPR)' : 'Sale price (NPR)', price, setPrice, { numeric: true })}
          {field('Down payment (NPR)', down, setDown, { numeric: true })}
          {field('Months', months, setMonths, { numeric: true, basis: 110 })}
          {field('Interest (% / month)', rate, setRate, { numeric: true, basis: 130 })}
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
            <KeyInput value={installment} onChangeText={setInstallment} onRequestSave={handleSave} accent={accent} placeholder="0" numeric align="right" accessibilityLabel="Instalment" />
          </Box>
          <Box label="First instalment due" basis={180}>
            <KeyboardDateInput value={firstDue} onChange={setFirstDue} onRequestSave={handleSave} accent={accent} />
          </Box>
        </View>
        <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 14 }}>
          {field('Remarks', note, setNote, { placeholder: 'Optional', basis: 300 })}
          <Box
            label="Completed on"
            basis={180}
            action={
              <Pressable onPress={() => setClosedOn(closedOn ? '' : today)} hitSlop={6}>
                <Text className="text-[11px] font-semibold" style={{ color: accent }}>
                  {closedOn ? 'Clear' : 'Today'}
                </Text>
              </Pressable>
            }
          >
            <KeyboardDateInput value={closedOn} onChange={setClosedOn} onRequestSave={handleSave} accent={accent} />
          </Box>
        </View>
      </View>

      <View className="rounded-2xl border border-gray-200 bg-white p-4" style={{ boxShadow: CARD_SHADOW }}>
        {[
          { label: buying ? 'To pay (down + instalments)' : 'To collect (down + instalments)', value: figures.total, color: '#111827' },
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
          {buying ? "Payments are the Paid entries on the vendor's ledger naming this item." : "Payments are the customer's Received entries naming this vehicle."}
          {' '}The instalment is the financed amount ÷ months, plus the interest rate % of it every month (flat).
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
