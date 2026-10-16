// lib/components/finance/JournalVoucherForm.tsx
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { readKey } from '../../utils/webKeys';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../supabase';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { DateField } from '../DateTimeFields';
import { Field, FieldRow, FormActions, INPUT } from './FormKit';
import { SuggestInput } from './SuggestInput';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { localTodayIso } from '../../utils/localDate';
import { journalNote, newJournalCode } from '../../utils/journalVoucher';
import { tidyName } from '../../utils/nameCaps';

type Person = { id: string; name: string };
type Side = 'debit' | 'credit';
type Line = { key: number; side: Side; kind: 'party' | 'expense'; person: Person | null; head: string; amount: string; confirmed?: boolean };

/** A Save / Cancel question. */
function ask(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Save', onPress: () => resolve(true) },
    ]);
  });
}

let lineSeq = 0;
const newLine = (side: Side): Line => ({ key: (lineSeq += 1), side, kind: 'party', person: null, head: '', amount: '' });

/** Whether a person has any entry on one of the two ledgers. */
async function hasEntries(table: 'customer_ledger_entries' | 'vendor_ledger_entries', column: 'customer_id' | 'vendor_id', id: string) {
  const { count, error } = await (supabase.from(table) as any).select('id', { count: 'exact', head: true }).eq(column, id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

const money = (n: number) => `NPR ${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString() : (Math.round(n * 100) / 100).toLocaleString()}`;

/** The Journal voucher form: any number of Debit lines and Credit lines that add up to the same total.
 * A line is a person's ledger (either side) or an expense head (debit only, e.g. Salary Expenses
 * debited, Roshan and Manish credited). No cash or bank account is touched - see journalVoucher.ts:
 * every line carries the voucher's code in its remark, which is how the lines are found again. */
export function JournalVoucherForm({ ownerId, onDone }: { ownerId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Line[]>(() => [newLine('debit'), newLine('credit')]);
  const [date, setDate] = useState(localTodayIso());
  const [narration, setNarration] = useState('');
  const [saving, setSaving] = useState(false);
  // Enter walks account -> amount -> the next line's account; these let it focus a box by line.
  const nameRefs = useRef(new Map<number, TextInput | null>());
  const amountRefs = useRef(new Map<number, TextInput | null>());
  const [focusNew, setFocusNew] = useState<number | null>(null);
  useEffect(() => {
    if (focusNew == null) return;
    const t = setTimeout(() => nameRefs.current.get(focusNew)?.focus(), 30);
    setFocusNew(null);
    return () => clearTimeout(t);
  }, [focusNew, lines.length]);
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: { owner_id: ownerId },
    orderBy: { column: 'name' },
  });

  const patch = (key: number, values: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...values } : l)));
  const remove = (key: number) => setLines((ls) => (ls.length > 2 ? ls.filter((l) => l.key !== key) : ls));
  const total = (side: Side) => lines.filter((l) => l.side === side).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const debit = total('debit');
  const credit = total('credit');
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005;

  const { data: people } = useSupabaseQuery('customers', {
    filters: { owner_id: ownerId },
    orderBy: { column: 'name' },
    all: true,
  });

  // One search over both: people (either side) and expense heads (debit only).
  const accountOptions = (text: string, side: Side) => {
    const q = text.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);
    const persons = (people ?? []).filter((c) => match(c.name)).map((c) => ({ key: `p:${c.id}`, label: c.name, hint: 'Person' }));
    const heads =
      side === 'debit' ? (categories ?? []).filter((c) => match(c.name)).map((c) => ({ key: `h:${c.id}`, label: c.name, hint: 'Expense head' })) : [];
    const typed = text.trim();
    const exact = [...(categories ?? []), ...(people ?? [])].some((c) => c.name.toLowerCase() === typed.toLowerCase());
    // not in the books yet: offer to add it right here
    const adds =
      typed && !exact
        ? [
            ...(side === 'debit' ? [{ key: 'new-h', label: typed, hint: '+ New expense head' }] : []),
            { key: 'new-p', label: typed, hint: '+ New ledger (person)' },
          ]
        : [];
    return [...heads, ...persons].slice(0, 14).concat(adds);
  };
  const pick = async (key: number, optionKey: string, label: string) => {
    if (optionKey === 'new-p' || optionKey === 'new-h') {
      const isPerson = optionKey === 'new-p';
      const ok = await ask(
        isPerson ? 'Add new ledger?' : 'Add new expense head?',
        `"${label.trim()}" is not in your books yet. ${isPerson ? 'Save it as a new ledger?' : 'Save it as a new expense head?'}`
      );
      if (!ok) {
        patch(key, { head: '', person: null, kind: 'expense', confirmed: false });
        return;
      }
      if (!isPerson) {
        patch(key, { kind: 'expense', person: null, head: label.trim(), confirmed: true });
        setTimeout(() => amountRefs.current.get(key)?.focus(), 30);
        return;
      }
    }
    if (optionKey === 'new-p') {
      const created = await (supabase.from('customers') as any).insert({ owner_id: ownerId, name: label.trim(), phone: null }).select('id').single();
      if (created.error) {
        showAlert('Could not add the ledger', getErrorMessage(created.error));
        return;
      }
      optionKey = `p:${created.data.id}`;
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
    if (optionKey.startsWith('p:')) patch(key, { kind: 'party', person: { id: optionKey.slice(2), name: label }, head: label });
    else patch(key, { kind: 'expense', person: null, head: label });
    setTimeout(() => amountRefs.current.get(key)?.focus(), 30);
  };
  /** Enter on an amount: on to the next line; after the last one, a new line for whichever side is short. */
  const nextLine = (key: number) => {
    const i = lines.findIndex((l) => l.key === key);
    const next = lines[i + 1];
    if (next) {
      nameRefs.current.get(next.key)?.focus();
      return;
    }
    if (balanced) return;
    const add = newLine(credit > debit ? 'debit' : 'credit');
    setLines((ls) => [...ls, add]);
    setFocusNew(add.key);
  };

  async function handleSave() {
    if (!date) {
      showAlert('Pick a date', 'Choose the date of this voucher.');
      return;
    }
    for (const [i, l] of lines.entries()) {
      const where = `${l.side === 'debit' ? 'Debit' : 'Credit'} line ${i + 1}`;
      if (!l.head.trim()) {
        showAlert('Finish every line', `${where}: search and pick ${l.side === 'debit' ? 'a person or an expense head' : 'the person'}.`);
        return;
      }
      if (l.side === 'credit' && !l.person) {
        showAlert('Pick the person', `${where}: choose a person from the list - an expense head can only be debited.`);
        return;
      }
      const v = Number(l.amount);
      if (!l.amount.trim() || Number.isNaN(v) || v <= 0) {
        showAlert('Enter an amount', `${where}: add a valid amount in NPR.`);
        return;
      }
    }
    if (!lines.some((l) => l.side === 'debit') || !lines.some((l) => l.side === 'credit')) {
      showAlert('Add both sides', 'A voucher needs at least one Debit and one Credit line.');
      return;
    }
    if (!balanced) {
      showAlert('Debit and credit differ', `Debit ${money(debit)} and Credit ${money(credit)} must be equal - the difference is ${money(Math.abs(debit - credit))}.`);
      return;
    }
    for (const l of lines) {
      const name = l.head.trim();
      const known = (categories ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase());
      if (l.side === 'debit' && !l.person && !known && !l.confirmed) {
        if (!(await ask('Add new expense head?', `"${name}" is not in your books yet. Save it as a new expense head?`))) return;
        patch(l.key, { confirmed: true });
      }
    }
    setSaving(true);
    const made: { table: string; id: string }[] = [];
    try {
      const note = journalNote(newJournalCode(), narration);
      const common = { owner_id: ownerId, note, source: 'manual', entry_date: date, bank_account_id: null };
      const created = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));

      for (const l of lines) {
        const amount = Number(l.amount);
        let table: string;
        let row: Record<string, unknown>;
        if (l.kind === 'expense' || !l.person) {
          const name = l.head.trim();
          let categoryId = created.get(name.toLowerCase()) ?? null;
          if (!categoryId) {
            const c = await (supabase.from('expense_categories') as any).insert({ owner_id: ownerId, name }).select('id').single();
            if (c.error) throw c.error;
            categoryId = c.data.id as string;
            created.set(name.toLowerCase(), categoryId);
          }
          table = 'business_transactions';
          row = {
            owner_id: ownerId,
            type: 'expense',
            amount,
            party_name: tidyName(name),
            note,
            bill_date: date,
            expense_category_id: categoryId,
            payment_mode: 'credit',
            bank_account_id: null,
          };
        } else {
          const person = l.person as Person;
          // A debited person who only has a vendor ledger is debited there (a payment on it); everyone else on
          // their customer ledger.
          let vendorOnly = false;
          if (l.side === 'debit') {
            const [v, c] = await Promise.all([
              hasEntries('vendor_ledger_entries', 'vendor_id', person.id),
              hasEntries('customer_ledger_entries', 'customer_id', person.id),
            ]);
            vendorOnly = v && !c;
          }
          if (vendorOnly) {
            table = 'vendor_ledger_entries';
            row = { ...common, amount, vendor_id: person.id, entry_type: 'credit' };
          } else {
            table = 'customer_ledger_entries';
            row = { ...common, amount, customer_id: person.id, entry_type: l.side };
          }
        }
        const res = await (supabase.from(table) as any).insert(row).select('id').single();
        if (res.error) throw res.error;
        made.push({ table, id: res.data.id as string });
      }
      await Promise.all(
        ['customer_ledger_entries', 'vendor_ledger_entries', 'business_transactions', 'expense_categories'].map((t) =>
          queryClient.invalidateQueries({ queryKey: [t] })
        )
      );
      onDone();
    } catch (err) {
      // Take back what was already posted, so a voucher is never part of one.
      for (const m of made) await (supabase.from(m.table) as any).delete().eq('id', m.id);
      showAlert('Could not save the voucher', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const sideLines = (side: Side) => lines.filter((l) => l.side === side);

  const renderLine = (l: Line, n: number, count: number) => (
    // earlier lines sit above later ones so an open account list is never painted over
    <View key={l.key} style={{ zIndex: 100 - n, gap: 4 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text className="w-14 text-[12px] font-bold text-gray-500">{l.side === 'debit' ? 'Dr' : 'Cr'} {n}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SuggestInput
            value={l.head}
            // typing again drops the earlier pick, so a stale person is never posted under a new name
            onChangeText={(v) => patch(l.key, { head: v, person: null, kind: 'expense', confirmed: false })}
            options={accountOptions(l.head, l.side)}
            onSelectOption={(o) => pick(l.key, o.key, o.label)}
            inputRef={(el) => nameRefs.current.set(l.key, el)}
            onKeyPress={(e) => {
              const k = readKey(e);
              if (k.key !== 'Enter') return;
              k.prevent();
              if (!l.head.trim()) return;
              // Enter with nothing highlighted: an exact match is taken; a new name on the debit side stays
              // as a new expense head, and on the credit side becomes a new ledger.
              if (!l.person) {
                const exact = accountOptions(l.head, l.side).find((o) => o.label.toLowerCase() === l.head.trim().toLowerCase() && !o.key.startsWith('new'));
                if (exact) {
                  pick(l.key, exact.key, exact.label);
                  return;
                }
                pick(l.key, l.side === 'credit' ? 'new-p' : 'new-h', l.head.trim());
                return;
              }
              amountRefs.current.get(l.key)?.focus();
            }}
            placeholder={l.side === 'debit' ? 'Person or expense head' : 'Person'}
            accent={l.side === 'debit' ? '#DC2626' : '#047857'}
            inputClassName={INPUT}
            showWhenEmpty
            adornment={
              l.head.trim() !== '' ? (
                <Text className="text-[10.5px] font-bold" style={{ color: l.person ? '#1D4ED8' : '#B45309' }}>
                  {l.person ? 'PERSON' : l.side === 'debit' ? 'EXPENSE' : '?'}
                </Text>
              ) : undefined
            }
            adornmentWidth={l.head.trim() !== '' ? 70 : 0}
          />
        </View>
        <TextInput
          ref={(el) => {
            amountRefs.current.set(l.key, el);
          }}
          value={l.amount}
          onChangeText={(v) => patch(l.key, { amount: v })}
          onKeyPress={(e) => {
            if (readKey(e).key === 'Enter') {
              readKey(e).prevent();
              nextLine(l.key);
            }
          }}
          placeholder="Amount"
          placeholderTextColor="#9CA3AF"
          keyboardType="numeric"
          className={INPUT}
          style={{ width: 130 }}
        />
        {lines.length > 2 && count > 0 ? (
          <Pressable onPress={() => remove(l.key)} hitSlop={8} accessibilityLabel="Remove this line">
            <Ionicons name="trash-outline" size={17} color="#DC2626" />
          </Pressable>
        ) : (
          <View style={{ width: 17 }} />
        )}
      </View>
    </View>
  );

  return (
    <>
      <FieldRow>
        <Field label="Date" basis={220}>
          <DateField value={date} onChange={setDate} />
        </Field>
      </FieldRow>
      <Text className="text-[12px] text-gray-500">
        Add as many Debit and Credit lines as you need - they must add up to the same total. No cash or bank account is touched.
      </Text>

      {(['debit', 'credit'] as const).map((side) => (
        <View key={side} style={{ gap: 8, zIndex: side === 'debit' ? 300 : 200 }}>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Text className="text-[13px] font-extrabold" style={{ color: side === 'debit' ? '#B91C1C' : '#047857' }}>
              {side === 'debit' ? 'DEBIT' : 'CREDIT'}
            </Text>
            <Text className="flex-1 text-[12px] text-gray-500">{money(total(side))}</Text>
            <Pressable
              onPress={() => setLines((ls) => [...ls, newLine(side)])}
              className="flex-row items-center rounded-lg border border-gray-300 px-2.5 py-1.5"
              style={{ gap: 4 }}
            >
              <Ionicons name="add" size={15} color="#1D4ED8" />
              <Text className="text-[12.5px] font-semibold text-blue-700">Add {side}</Text>
            </Pressable>
          </View>
          {sideLines(side).map((l, i) => renderLine(l, i + 1, sideLines(side).length))}
        </View>
      ))}

      <View className="flex-row items-center rounded-xl px-3 py-2.5" style={{ gap: 12, backgroundColor: balanced ? '#ECFDF5' : '#FEF2F2' }}>
        <Text className="flex-1 text-[13px] font-semibold text-gray-800">Debit {money(debit)}  ·  Credit {money(credit)}</Text>
        <Text className="text-[13px] font-bold" style={{ color: balanced ? '#047857' : '#B91C1C' }}>
          {balanced ? 'Balanced' : `Difference ${money(Math.abs(debit - credit))}`}
        </Text>
      </View>

      <FieldRow>
        <Field label="Remarks" basis={260}>
          <TextInput
            value={narration}
            onChangeText={setNarration}
            placeholder="Optional"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
          />
        </Field>
      </FieldRow>
      <FormActions onCancel={onDone} onSave={handleSave} saving={saving} saveLabel="Post voucher" />
    </>
  );
}
