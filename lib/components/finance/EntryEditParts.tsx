// lib/components/finance/EntryEditParts.tsx
//
// The pieces the "Edit entry" popups share - a ledger entry's (CustomerDetailScreen) and a bill's
// (TransactionsScreen): who it is on, and when it is dated.
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSupabaseInsert, useSupabaseQuery, useSupabaseRow } from '../../hooks/useSupabase';
import { usePhoneContacts } from '../../hooks/usePhoneContacts';
import { ContactPickerModal } from '../ContactPickerModal';
import { DateField, TimeField } from '../DateTimeFields';
import { Field, FieldRow } from './FormKit';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { nameCaps } from '../../utils/nameCaps';
import { entryDay } from '../../utils/ledgerStatement';

/** Who an entry being edited is on: the person whose page it is, until another is
 * picked. Picking only changes the choice - nothing moves until the form is saved. */
export function useEntryParty(pageId: string) {
  const [moved, setMoved] = useState<{ id: string; name: string } | null>(null);
  return {
    partyId: moved?.id ?? pageId,
    /** Set only when the entry is going to a different person than this page's. */
    movedTo: moved && moved.id !== pageId ? moved : null,
    setParty: setMoved,
  };
}

/** 'HH:MM' of an ISO timestamp, in the device's own time zone (the zone entryDay uses). */
export function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The ISO timestamp of a local 'YYYY-MM-DD' day at 'HH:MM'. */
export function stampOf(day: string, time: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

/** The date and time of an entry being edited, starting from what it has now.
 * `changed` is false until one of them is touched, so a plain edit leaves the
 * entry's stored date and timestamp exactly as they were.
 *
 * The date is the entry's own date (`entry_date`; a bill's `bill_date`); the time is the time of
 * day of its `created_at` - the only time an entry carries, and what orders the entries of one day
 * (and so a running balance). */
export function useEntryWhen(initial?: { entry_date: string | null; created_at: string } | null) {
  const startDate = initial ? entryDay(initial.entry_date, initial.created_at) : '';
  const startTime = initial ? timeOf(initial.created_at) : '';
  const [date, setDate] = useState(startDate);
  const [time, setTime] = useState(startTime);
  return { date, time, setDate, setTime, changed: !!initial && (date !== startDate || time !== startTime) };
}

/** The "Date" and "Time" fields of the edit popup. */
export function EntryWhenFields({
  date,
  time,
  onDate,
  onTime,
}: {
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
}) {
  return (
    <FieldRow>
      <Field label="Date" basis={220}>
        <DateField value={date} onChange={onDate} />
      </Field>
      <Field label="Time" basis={140}>
        <TimeField value={time} onChange={onTime} />
      </Field>
    </FieldRow>
  );
}

/** The "Person" field of the edit popup: shows who the entry is on and lets you
 * pick someone else (or add a new person) - for an entry logged on the wrong
 * person. The entry moves to them when the form is saved. */
export function PartyMoveField({
  ownerId,
  partyId,
  pickedName,
  onPick,
  hint = 'Entered on the wrong person? Pick the right one and save - this entry moves to their ledger.',
  pickerTitle = 'Move this entry to',
  label = 'Person',
}: {
  ownerId: string;
  /** Who it is on now; may be '' for something with nobody saved against it. */
  partyId: string;
  /** The name to show in place of a loaded person's: one just picked (before their row has
   * loaded), or the name written on something with nobody saved against it. */
  pickedName?: string;
  onPick: (party: { id: string; name: string }) => void;
  hint?: string;
  pickerTitle?: string;
  /** The field's name above the box. */
  label?: string;
}) {
  const { data: party } = useSupabaseRow('customers', partyId || undefined);
  const { data: customers } = useSupabaseQuery('customers', { filters: { owner_id: ownerId } });
  const createCustomer = useSupabaseInsert('customers');
  const phoneContacts = usePhoneContacts();
  const [picking, setPicking] = useState(false);

  function pick(id: string, name: string) {
    setPicking(false);
    onPick({ id, name });
  }

  // A phone contact or typed name that is not saved yet is saved as a real person now,
  // the way the Sale / Payment forms do - unless someone with that phone already exists.
  async function handleSelectNew(name: string, phone: string | null) {
    const existing = phone ? (customers ?? []).find((c) => c.phone === phone) : undefined;
    if (existing) {
      pick(existing.id, existing.name);
      return;
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: ownerId, name: nameCaps(name.trim()), phone });
      pick(created.id, created.name);
    } catch (err) {
      setPicking(false);
      showAlert('Could not add this person', getErrorMessage(err));
    }
  }

  const shownName = nameCaps(pickedName ?? party?.name ?? '');

  return (
    <View style={{ gap: 6 }}>
      {/* Field's flexBasis is a width inside a row - in this column it would be a 300px-tall box. */}
      <FieldRow>
        <Field label={label} basis={300}>
          <Pressable
            onPress={() => {
              phoneContacts.request();
              setPicking(true);
            }}
            accessibilityLabel="Change person"
            className="flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
          >
            <View className="flex-1 flex-row items-center gap-2">
              <Ionicons name="person-outline" size={16} color="#6B7280" />
              <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
                {shownName || '...'}
              </Text>
            </View>
            <Text className="mr-1.5 text-xs font-semibold text-blue-700">Change</Text>
            <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
          </Pressable>
        </Field>
      </FieldRow>
      <Text className="text-[11px] text-gray-400">{hint}</Text>
      <ContactPickerModal
        visible={picking}
        initialQuery=""
        customers={customers ?? []}
        phoneContacts={phoneContacts.contacts}
        title={pickerTitle}
        matchPhone
        onSelectCustomer={(c) => pick(c.id, c.name)}
        onSelectNew={handleSelectNew}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

/** The payment-method button the entry popups share: Cash or a bank account. */
export function PaymentMethodButton({ name, isBank, onPress }: { name: string; isBank: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={isBank ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
        <Text className="text-sm text-gray-900">{name}</Text>
      </View>
      <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
    </Pressable>
  );
}
