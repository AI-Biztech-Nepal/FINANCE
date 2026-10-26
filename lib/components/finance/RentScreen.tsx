// lib/components/finance/RentScreen.tsx
import { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { DateField } from '../DateTimeFields';
import { BackButton, BookPage, BookStat, BookStats, BookTable, Pill, ToolbarButton, money, useBookLayout, useBookToolbar, type BookColumn } from './BookKit';
import { Field, FieldRow, FormActions, INPUT, PopupCard } from './FormKit';
import { useReportActions } from './PrintButton';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { decimalInput } from '../../utils/number';
import { round2 } from '../../utils/money';
import type { PrintReport } from '../../utils/printReport';
import type { Rental, RentalPayment } from '../../../types/database.types';

const ACCENT = '#2563EB';
const RED = '#B91C1C';
const GREEN = '#047857';

/** Whole days from one 'YYYY-MM-DD' to another (a day number, so differences are exact across months). */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** What a rental comes to. It is billed by the day, counting the day it went out and the day it came
 * back: to the day it returned; else to the day it is due back, if that is still ahead; else up to today
 * (it is overdue, and every day it stays out is a day more). At least one day. */
function figuresOf(r: Pick<Rental, 'start_date' | 'end_date' | 'returned_on' | 'rate_per_day' | 'payments'>, today: string) {
  const until = r.returned_on ?? (r.end_date && r.end_date > today ? r.end_date : today);
  const days = Math.max(1, dayNumber(until) - dayNumber(r.start_date) + 1);
  const total = round2(days * Number(r.rate_per_day || 0));
  const received = round2((r.payments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  return { days, total, received, due: round2(total - received) };
}

function statusOf(r: Pick<Rental, 'end_date' | 'returned_on'>, today: string) {
  if (r.returned_on) return { label: 'Returned', color: '#374151', bg: '#F3F4F6' };
  if (r.end_date && r.end_date < today) return { label: 'Overdue', color: RED, bg: '#FEF2F2' };
  return { label: 'Out', color: '#1D4ED8', bg: '#EFF6FF' };
}

interface FormState {
  car: string;
  model: string;
  customerId: string | null;
  customerName: string;
  start: string;
  end: string;
  returnedOn: string;
  rate: string;
  note: string;
  payments: RentalPayment[];
}

function formOf(r: Rental | null, today: string): FormState {
  return {
    car: r?.car ?? '',
    model: r?.model ?? '',
    customerId: r?.customer_id ?? null,
    customerName: r?.customer_name ?? '',
    start: r?.start_date ?? today,
    end: r?.end_date ?? '',
    returnedOn: r?.returned_on ?? '',
    rate: r ? String(r.rate_per_day) : '',
    note: r?.note ?? '',
    payments: r?.payments ?? [],
  };
}

interface PickOption {
  key: string;
  label: string;
  hint?: string | null;
}

/** A text box that lists matching names under it as you type - tap one to take it. A name that matches
 * nothing is kept as typed. (Listed in the page's own flow rather than floated over it, so it is never
 * cut off by the popup it sits in.) */
function PickInput({
  value,
  onChange,
  onPick,
  options,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (option: PickOption) => void;
  options: PickOption[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = focused && q ? options.filter((o) => o.label.toLowerCase().includes(q) && o.label.toLowerCase() !== q).slice(0, 5) : [];
  return (
    <View style={{ gap: 4 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        autoFocus={autoFocus}
        className={INPUT}
      />
      {matches.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => {
            setFocused(false);
            onPick(o);
          }}
          className="flex-row items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
        >
          <Text className="flex-1 text-[13px] text-gray-900" numberOfLines={1}>
            {o.label}
          </Text>
          {!!o.hint && <Text className="ml-2 text-[11px] text-gray-400">{o.hint}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

/** A date box that opens the calendar; an optional one can be cleared. */
function DateBox({ value, onChange, optional }: { value: string; onChange: (v: string) => void; optional?: boolean }) {
  useCalendarMode(); // draws the label again when the AD / BS toggle changes
  return (
    <View className="flex-row items-center" style={{ gap: 8 }}>
      <View style={{ flex: 1 }}>
        <DateField
          value={value}
          onChange={onChange}
          renderTrigger={(open) => (
            <Pressable onPress={open} className={`${INPUT} flex-row items-center justify-between`}>
              <Text className={`text-sm ${value ? 'text-gray-900' : 'text-gray-400'}`}>{value ? toBsHistoryLabel(value) : 'Not set'}</Text>
              <Ionicons name="calendar-outline" size={16} color="#6B7280" />
            </Pressable>
          )}
        />
      </View>
      {optional && !!value && (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear the date">
          <Ionicons name="close-circle" size={20} color="#9CA3AF" />
        </Pressable>
      )}
    </View>
  );
}

function RentalForm({
  rental,
  cars,
  renters,
  onClose,
}: {
  rental: Rental | null;
  cars: PickOption[];
  renters: (PickOption & { id: string })[];
  onClose: () => void;
}) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const today = localTodayIso();
  const createRental = useSupabaseInsert('rentals');
  const updateRental = useSupabaseUpdate('rentals');
  const deleteRental = useSupabaseDelete('rentals');
  const [form, setForm] = useState<FormState>(() => formOf(rental, today));
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payDate, setPayDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const now = figuresOf(
    { start_date: form.start, end_date: form.end || null, returned_on: form.returnedOn || null, rate_per_day: Number(form.rate) || 0, payments: form.payments },
    today
  );

  function addPayment() {
    const amount = round2(Number(payAmount));
    if (!payAmount.trim() || Number.isNaN(amount) || amount <= 0) {
      showAlert('Enter an amount', 'Add the amount received, in NPR.');
      return;
    }
    set('payments', [...form.payments, { date: payDate || today, amount, note: payNote.trim() || null }]);
    setPayAmount('');
    setPayNote('');
  }

  async function save() {
    if (!userId || saving) return;
    if (!form.car.trim()) {
      showAlert('Add the car', 'Type the car number (or pick one from your stock).');
      return;
    }
    if (!form.start) {
      showAlert('Add the start date', 'Pick the day the car went out.');
      return;
    }
    if (form.end && form.end < form.start) {
      showAlert('Check the dates', 'The car cannot be due back before the day it went out.');
      return;
    }
    if (form.returnedOn && form.returnedOn < form.start) {
      showAlert('Check the dates', 'The car cannot come back before the day it went out.');
      return;
    }
    const values = {
      car: form.car.trim(),
      model: form.model.trim() || null,
      customer_id: form.customerId,
      customer_name: form.customerName.trim() || null,
      start_date: form.start,
      end_date: form.end || null,
      returned_on: form.returnedOn || null,
      rate_per_day: round2(Number(form.rate) || 0),
      payments: form.payments,
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      if (rental) await updateRental.mutateAsync({ id: rental.id, values });
      else await createRental.mutateAsync({ owner_id: userId, ...values });
      onClose();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PopupCard title={rental ? `Rental · ${rental.car}` : 'New rental'} onClose={onClose} maxWidth={760}>
      <FieldRow>
        <Field label="Car">
          <PickInput
            value={form.car}
            onChange={(v) => set('car', v)}
            onPick={(o) => set('car', o.label)}
            options={cars}
            placeholder="Car number"
            autoFocus={!rental}
          />
        </Field>
        <Field label="Model">
          <TextInput value={form.model} onChangeText={(v) => set('model', v)} placeholder="Model" placeholderTextColor="#9CA3AF" className={INPUT} />
        </Field>
        <Field label="Rented to">
          <PickInput
            value={form.customerName}
            onChange={(v) => setForm((f) => ({ ...f, customerName: v, customerId: null }))}
            onPick={(o) => setForm((f) => ({ ...f, customerName: o.label, customerId: o.key }))}
            options={renters}
            placeholder="Who has the car"
          />
        </Field>
        <Field label="Rate per day (NPR)">
          <TextInput
            value={form.rate}
            onChangeText={(v) => set('rate', decimalInput(v))}
            placeholder="0"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            className={INPUT}
          />
        </Field>
        <Field label="Went out on" basis={180}>
          <DateBox value={form.start} onChange={(v) => set('start', v)} />
        </Field>
        <Field label="Due back on" basis={180}>
          <DateBox value={form.end} onChange={(v) => set('end', v)} optional />
        </Field>
        <Field label="Came back on" basis={180}>
          <DateBox value={form.returnedOn} onChange={(v) => set('returnedOn', v)} optional />
          {!form.returnedOn && (
            <Pressable onPress={() => set('returnedOn', today)} hitSlop={6} className="mt-1.5 self-start">
              <Text className="text-[12px] font-semibold" style={{ color: ACCENT }}>
                Mark returned today
              </Text>
            </Pressable>
          )}
        </Field>
        <Field label="Remarks" basis={300}>
          <TextInput value={form.note} onChangeText={(v) => set('note', v)} placeholder="Optional" placeholderTextColor="#9CA3AF" className={INPUT} />
        </Field>
      </FieldRow>

      {/* What it comes to, from the dates and the rate - it follows as the days pass while the car is out. */}
      <View className="flex-row flex-wrap rounded-xl border border-gray-200 bg-gray-50" style={{ rowGap: 0 }}>
        {[
          { label: 'Days', value: String(now.days), color: '#111827' },
          { label: 'Rent', value: money(now.total), color: '#111827' },
          { label: 'Received', value: money(now.received), color: GREEN },
          { label: now.due < 0 ? 'Paid ahead' : 'Due', value: money(Math.abs(now.due)), color: now.due > 0 ? RED : GREEN },
        ].map((f) => (
          <View key={f.label} className="px-3.5 py-2.5" style={{ flexGrow: 1, flexBasis: 120 }}>
            <Text className="text-[11px] font-semibold text-gray-400">{f.label}</Text>
            <Text className="text-[15px] font-extrabold" style={{ color: f.color }}>
              {f.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <Text className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Payments received</Text>
        {form.payments.length === 0 ? (
          <Text className="text-[12.5px] text-gray-400">Nothing received yet.</Text>
        ) : (
          form.payments.map((p, i) => (
            <View key={i} className="flex-row items-center rounded-lg border border-gray-200 px-3 py-2" style={{ gap: 10 }}>
              <Text className="text-[12.5px] text-gray-500">{toBsHistoryLabel(p.date)}</Text>
              <Text className="flex-1 text-[12.5px] text-gray-500" numberOfLines={1}>
                {p.note ?? ''}
              </Text>
              <Text className="text-[13px] font-bold" style={{ color: GREEN }}>
                {money(p.amount)}
              </Text>
              <Pressable onPress={() => set('payments', form.payments.filter((_, j) => j !== i))} hitSlop={6} accessibilityLabel="Remove this payment">
                <Ionicons name="close-circle" size={18} color="#DC2626" />
              </Pressable>
            </View>
          ))
        )}
        <View className="flex-row flex-wrap items-end" style={{ gap: 10 }}>
          <View style={{ width: 150 }}>
            <DateBox value={payDate} onChange={setPayDate} />
          </View>
          <View style={{ width: 130 }}>
            <TextInput
              value={payAmount}
              onChangeText={(v) => setPayAmount(decimalInput(v))}
              placeholder="Amount"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              className={INPUT}
            />
          </View>
          <View style={{ flexGrow: 1, flexBasis: 160 }}>
            <TextInput value={payNote} onChangeText={setPayNote} placeholder="Note (optional)" placeholderTextColor="#9CA3AF" className={INPUT} />
          </View>
          <Pressable onPress={addPayment} className="items-center rounded-lg border px-4 py-2.5" style={{ borderColor: ACCENT }}>
            <Text className="text-[13px] font-bold" style={{ color: ACCENT }}>
              Add payment
            </Text>
          </Pressable>
        </View>
      </View>

      <FormActions
        onCancel={onClose}
        onSave={save}
        saving={saving}
        onRemove={
          rental
            ? () =>
                showAlert('Remove this rental?', 'Its payments are removed with it.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await deleteRental.mutateAsync(rental.id);
                        onClose();
                      } catch (err) {
                        showAlert('Could not remove', getErrorMessage(err));
                      }
                    },
                  },
                ])
            : undefined
        }
      />
    </PopupCard>
  );
}

/** Rent: the cars given out on rent - who has each, from when, at what rate, what it comes to and what is
 * still due. Kept apart from Sale and Purchase bills: a car on rent comes back, so it is not a sale and does
 * not leave the stock. */
export function RentScreen() {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const today = localTodayIso();
  const owner: Record<string, string> = userId ? { owner_id: userId } : {};
  const { data: rentals, isLoading, error } = useSupabaseQuery('rentals', {
    filters: owner,
    orderBy: { column: 'start_date', ascending: false },
    all: true,
    enabled: !!userId,
  });
  const { data: products } = useSupabaseQuery('products', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  const { data: customers } = useSupabaseQuery('customers', { filters: owner, orderBy: { column: 'name' }, enabled: !!userId });
  // The rental open in the popup: a new one (`rental: null`) or one being edited.
  const [open, setOpen] = useState<{ rental: Rental | null } | null>(null);

  const cars = useMemo<PickOption[]>(() => (products ?? []).map((p) => ({ key: p.id, label: p.name })), [products]);
  const renters = useMemo(() => (customers ?? []).map((c) => ({ id: c.id, key: c.id, label: c.name, hint: c.phone })), [customers]);

  // Cars still out first, then the rest - newest first in each.
  const rows = useMemo(
    () =>
      [...(rentals ?? [])]
        .map((r) => ({ r, ...figuresOf(r, today), status: statusOf(r, today) }))
        .sort((a, b) => Number(!!a.r.returned_on) - Number(!!b.r.returned_on) || b.r.start_date.localeCompare(a.r.start_date)),
    [rentals, today]
  );
  type Row = (typeof rows)[number];
  const stats = useMemo(
    () => ({
      out: rows.filter((x) => !x.r.returned_on).length,
      total: round2(rows.reduce((s, x) => s + x.total, 0)),
      received: round2(rows.reduce((s, x) => s + x.received, 0)),
      due: round2(rows.reduce((s, x) => s + x.due, 0)),
    }),
    [rows]
  );

  const buildReport = (): PrintReport => ({
    title: 'Rent',
    businessName: profile?.business_name ?? profile?.full_name ?? '',
    printedOn: toBsHistoryLabel(today),
    summary: [
      { label: 'Cars out now', value: String(stats.out) },
      { label: 'Rent', value: `NPR ${money(stats.total)}` },
      { label: 'Received', value: `NPR ${money(stats.received)}` },
      { label: 'Due', value: `NPR ${money(stats.due)}` },
    ],
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Car' },
          { label: 'Model' },
          { label: 'Rented to' },
          { label: 'From' },
          { label: 'To' },
          { label: 'Days', align: 'right' },
          { label: 'Rate/day', align: 'right' },
          { label: 'Rent', align: 'right' },
          { label: 'Received', align: 'right' },
          { label: 'Due', align: 'right' },
          { label: 'Status' },
        ],
        rows: rows.map((x, i) => [
          String(i + 1),
          x.r.car,
          x.r.model ?? '',
          x.r.customer_name ?? '',
          toBsHistoryLabel(x.r.start_date),
          x.r.returned_on ?? x.r.end_date ? toBsHistoryLabel((x.r.returned_on ?? x.r.end_date)!) : '',
          String(x.days),
          money(x.r.rate_per_day),
          money(x.total),
          money(x.received),
          money(x.due),
          x.status.label,
        ]),
        footer: ['', '', '', '', '', '', '', 'Total', money(stats.total), money(stats.received), money(stats.due), ''],
        emptyText: 'No rentals yet.',
      },
    ],
  });
  const reportButtons = useReportActions(buildReport);

  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: () => (
        <>
          {reportButtons}
          <ToolbarButton icon="add" label="New rental" onPress={() => setOpen({ rental: null })} />
        </>
      ),
    },
    [reportButtons]
  );

  const dateCell = (iso: string | null | undefined) =>
    iso ? <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(iso)}</Text> : <Text className="text-[12.5px] text-gray-300">—</Text>;
  const num = (text: string, color = '#374151', bold = false) => (
    <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
      {text}
    </Text>
  );
  const dueCell = (x: Row) =>
    x.due === 0 ? num('Cleared', GREEN, true) : num(money(Math.abs(x.due)), x.due > 0 ? RED : GREEN, true);
  const carCell = (x: Row, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
        {x.r.car}
      </Text>
      {!!x.r.model && !compact && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {x.r.model}
        </Text>
      )}
      {compact && (
        <>
          <Text className="text-[11px] text-gray-500" numberOfLines={1}>
            {[x.r.customer_name, x.r.model].filter(Boolean).join(' · ') || '—'}
          </Text>
          <Pill text={x.status.label} color={x.status.color} bg={x.status.bg} />
          <Text className="text-[11px] text-gray-400" numberOfLines={1}>
            {`${toBsHistoryLabel(x.r.start_date)} · ${x.days} ${x.days === 1 ? 'day' : 'days'}`}
          </Text>
        </>
      )}
    </View>
  );

  const columns: BookColumn<Row>[] = layout.full
    ? [
        { key: 'car', label: 'Car', render: (x) => carCell(x, false) },
        { key: 'renter', label: 'Rented to', width: 170, render: (x) => (x.r.customer_name ? num(x.r.customer_name, '#111827') : num('—', '#D1D5DB')) },
        { key: 'from', label: 'From', width: 112, render: (x) => dateCell(x.r.start_date) },
        { key: 'to', label: 'To', width: 112, render: (x) => dateCell(x.r.returned_on ?? x.r.end_date) },
        { key: 'days', label: 'Days', width: 58, align: 'right', render: (x) => num(String(x.days)) },
        { key: 'rate', label: 'Rate / day', width: 96, align: 'right', render: (x) => num(money(x.r.rate_per_day)) },
        { key: 'total', label: 'Rent', width: 104, align: 'right', render: (x) => num(money(x.total), '#111827', true) },
        { key: 'received', label: 'Received', width: 104, align: 'right', render: (x) => num(x.received ? money(x.received) : '—', GREEN, true) },
        { key: 'due', label: 'Due', width: 104, align: 'right', render: dueCell },
        { key: 'status', label: 'Status', width: 96, render: (x) => <Pill text={x.status.label} color={x.status.color} bg={x.status.bg} /> },
      ]
    : [
        { key: 'car', label: 'Car', render: (x) => carCell(x, true) },
        { key: 'due', label: 'Due', width: 100, align: 'right', render: dueCell },
      ];

  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label="Cars out now" value={String(stats.out)} color="#1D4ED8" />
        <BookStat label="Rent" value={`NPR ${money(stats.total)}`} color="#374151" />
        <BookStat label="Received" value={`NPR ${money(stats.received)}`} color={GREEN} />
        <BookStat label="Due" value={`NPR ${money(stats.due)}`} color={RED} />
      </BookStats>

      {error ? (
        <View className="rounded-xl border border-red-200 bg-red-50 p-4">
          <Text className="text-[13px] font-semibold text-red-700">Rentals could not be loaded.</Text>
          <Text className="mt-1 text-[12px] text-red-600">
            If this is the first time, the rentals table has not been created yet - run supabase/migrations/0009_rentals.sql in Supabase.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="car-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{isLoading ? 'Loading…' : 'No rentals yet. Tap New rental.'}</Text>
        </View>
      ) : (
        <BookTable columns={columns} rows={rows} rowKey={(x) => x.r.id} onRowPress={(x) => setOpen({ rental: x.r })} />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap a rental to edit it, add the payments received, or mark the car returned. A rental is billed by the day, counting the day it went out
        and the day it came back; while a car is out past its due date, every day more is added. Rent is kept apart from Sales, so a car on rent
        stays in your stock.
      </Text>

      {open && <RentalForm key={open.rental?.id ?? 'new'} rental={open.rental} cars={cars} renters={renters} onClose={() => setOpen(null)} />}
    </BookPage>
  );
}
