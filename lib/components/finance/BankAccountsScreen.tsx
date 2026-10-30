// lib/components/finance/BankAccountsScreen.tsx
import { useState } from 'react';
import { View, Text, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseUpdate } from '../../hooks/useSupabase';
import { useBankAccounts, type BankAccountDetails } from '../../hooks/useBankAccounts';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { BookPage, BookTable, ToolbarButton, useBarActions, useBookLayout, type BookColumn } from './BookKit';
import { Field, FieldRow, FormActions, FormCard, INPUT } from './FormKit';
import { useReportActions } from './PrintButton';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import type { BankAccount } from '../../../types/database.types';

const EMPTY_DETAILS: BankAccountDetails = { name: '', bank_name: null, account_number: null, account_holder_name: null, address: null };

function toDetails(acc: BankAccount): BankAccountDetails {
  return {
    name: acc.name,
    bank_name: acc.bank_name,
    account_number: acc.account_number,
    account_holder_name: acc.account_holder_name,
    address: acc.address,
  };
}

/** Full add/edit form for one bank account - a label alone used to be all
 * you could give it, which isn't enough to actually identify the account
 * for real bookkeeping (which bank, whose name it's under, the account
 * number). Shared between "add new" and editing an existing row. */
function AccountForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: BankAccountDetails;
  onSave: (details: BankAccountDetails) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [details, setDetails] = useState<BankAccountDetails>(initial ?? EMPTY_DETAILS);
  const [saving, setSaving] = useState(false);

  function setField(key: keyof BankAccountDetails, value: string) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    if (!details.name.trim()) {
      showAlert('Add a label', 'Give this account a short label, e.g. "Nabil Bank - Current".');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: details.name.trim(),
        bank_name: details.bank_name?.trim() || null,
        account_number: details.account_number?.trim() || null,
        account_holder_name: details.account_holder_name?.trim() || null,
        address: details.address?.trim() || null,
      });
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormCard icon="business-outline" title={initial ? 'Edit bank account' : 'New bank account'}>
      <FieldRow>
        <Field label="Label">
          <TextInput
            value={details.name}
            onChangeText={(v) => setField('name', v)}
            placeholder="e.g. Nabil Bank - Current"
            placeholderTextColor="#9CA3AF"
            autoFocus={!initial}
            className={INPUT}
          />
        </Field>
        <Field label="Bank name">
          <TextInput
            value={details.bank_name ?? ''}
            onChangeText={(v) => setField('bank_name', v)}
            placeholder="e.g. Nabil Bank"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
          />
        </Field>
        <Field label="Account number">
          <TextInput
            value={details.account_number ?? ''}
            onChangeText={(v) => setField('account_number', v)}
            placeholder="e.g. 01234567890123"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            className={INPUT}
          />
        </Field>
        <Field label="Account holder name">
          <TextInput
            value={details.account_holder_name ?? ''}
            onChangeText={(v) => setField('account_holder_name', v)}
            placeholder="e.g. Ram Bahadur"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
          />
        </Field>
        <Field label="Branch / Address" basis={300}>
          <TextInput
            value={details.address ?? ''}
            onChangeText={(v) => setField('address', v)}
            placeholder="e.g. New Road Branch, Kathmandu"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
          />
        </Field>
      </FieldRow>

      <FormActions
        onCancel={onCancel}
        onSave={handleSave}
        saving={saving}
        onRemove={
          onDelete
            ? () =>
                showAlert('Remove this bank account?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: onDelete },
                ])
            : undefined
        }
      />
    </FormCard>
  );
}

/** A table row: a bank account, or null for Cash, which is always there. */
type Row = { id: string; acc: BankAccount | null };


const dash = <Text className="text-[12.5px] text-gray-400">—</Text>;
const cellText = (value: string | null | undefined) =>
  value ? (
    <Text className="text-[12.5px] text-gray-700" numberOfLines={1}>
      {value}
    </Text>
  ) : (
    dash
  );

export function BankAccountsScreen() {
  const userId = useAuthStore((state) => state.ownerId ?? undefined);
  const { accounts, create, update, remove } = useBankAccounts(userId);
  const profileRow = useAuthStore((state) => state.profile);
  const setProfile = useAuthStore((state) => state.setProfile);
  const updateProfile = useSupabaseUpdate('profiles');
  // Cash is not a bank_accounts row (an entry with no account IS cash), so its label and details live on the
  // profile; it can be renamed and given details like any account, and "Remove" puts them back to the default.
  const cashSaved = (profileRow?.cash_account ?? null) as Record<string, string | null> | null;
  const cashDetails: BankAccountDetails = {
    name: cashSaved?.name || 'Cash',
    bank_name: cashSaved?.bank_name ?? null,
    account_number: cashSaved?.account_number ?? null,
    account_holder_name: cashSaved?.account_holder_name ?? null,
    address: cashSaved?.address ?? null,
  };
  const [editingCash, setEditingCash] = useState(false);
  const saveCash = async (details: BankAccountDetails | null) => {
    if (!profileRow) return;
    await updateProfile.mutateAsync({ id: profileRow.id, values: { cash_account: details } as never });
    setProfile({ ...profileRow, cash_account: details as never });
    setEditingCash(false);
  };
  const cashForm = (
    <AccountForm
      key="cash"
      initial={cashDetails}
      onSave={(d) => saveCash(d)}
      onCancel={() => setEditingCash(false)}
      onDelete={() => saveCash(null)}
    />
  );
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Print and Excel: the accounts and their details.
  const profile = useAuthStore((state) => state.profile);
  const reportButtons = useReportActions(() => ({
    title: 'Bank Accounts',
    businessName: profile?.business_name ?? profile?.full_name ?? '',
    printedOn: toBsHistoryLabel(localTodayIso()),
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Account' },
          { label: 'Bank' },
          { label: 'Account number' },
          { label: 'Account holder' },
          { label: 'Branch / Address' },
        ],
        rows: [
          ['1', cashDetails.name, cashDetails.bank_name ?? '', cashDetails.account_number ?? '', cashDetails.account_holder_name ?? '', cashDetails.address ?? ''],
          ...accounts.map((acc, i) => [
            String(i + 2),
            acc.name,
            acc.bank_name ?? '',
            acc.account_number ?? '',
            acc.account_holder_name ?? '',
            acc.address ?? '',
          ]),
        ],
      },
    ],
  }));

  // The name, the back button (phones), Print / Excel and "Add account" live in the top bar.
  const layout = useBookLayout();
  useBarActions(
    {
      wide: layout.wide,
      right: () => (
        <>
          {reportButtons}
          {!showAdd && (
            <ToolbarButton
              icon="add"
              label={layout.wide ? 'Add account' : 'Add'}
              onPress={() => {
                setEditingId(null);
                setShowAdd(true);
              }}
            />
          )}
        </>
      ),
    },
    [showAdd]
  );

  const openEdit = (id: string) => {
    setShowAdd(false);
    setEditingId(id);
  };

  const addForm = showAdd && (
    <AccountForm
      key="new"
      onSave={async (details) => {
        await create(details);
        setShowAdd(false);
      }}
      onCancel={() => setShowAdd(false)}
    />
  );
  const editForm = (acc: BankAccount) => (
    <AccountForm
      key={acc.id}
      initial={toDetails(acc)}
      onSave={async (details) => {
        await update(acc.id, details);
        setEditingId(null);
      }}
      onCancel={() => setEditingId(null)}
      onDelete={async () => {
        await remove(acc.id);
        setEditingId(null);
      }}
    />
  );

  const footnote = (
    <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
      Tap an account to edit it. Cash is the account used when no bank is chosen, so it can be renamed and given details, and Remove puts its details back to the default - it is always there.
    </Text>
  );

  // Web: the same cash-book look as the Day Book and the Ledger - one bordered
  // table, the form as a compact card above it. Phones keep the card list below.
  if (Platform.OS === 'web') {
    const cashAcc = { id: 'cash', owner_id: userId ?? '', created_at: '', updated_at: '', ...cashDetails } as BankAccount;
    const rows: Row[] = [{ id: 'cash', acc: cashAcc }, ...accounts.map((acc) => ({ id: acc.id, acc }))];

    const account = (row: Row, withDetails: boolean) => {
      if (!row.acc) return null;
      const sub = withDetails ? [row.acc.bank_name, row.acc.account_number ? `A/C ${row.acc.account_number}` : null].filter(Boolean).join(' · ') : '';
      return (
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Ionicons name={row.id === 'cash' ? 'cash-outline' : 'business-outline'} size={16} color="#2563EB" />
          <View style={{ minWidth: 0, flexShrink: 1 }}>
            <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
              {row.acc.name}
            </Text>
            {!!sub && (
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                {sub}
              </Text>
            )}
          </View>
        </View>
      );
    };

    const action: BookColumn<Row> = {
      key: 'edit',
      label: '',
      width: 44,
      align: 'right',
      render: (row) => (row.acc ? <Ionicons name="pencil-outline" size={16} color="#9CA3AF" /> : null),
    };

    const columns: BookColumn<Row>[] = layout.full
      ? [
          { key: 'account', label: 'Account', render: (row) => account(row, false) },
          { key: 'bank', label: 'Bank', width: 160, render: (row) => (row.acc ? cellText(row.acc.bank_name) : dash) },
          { key: 'number', label: 'Account number', width: 170, render: (row) => (row.acc ? cellText(row.acc.account_number) : dash) },
          { key: 'holder', label: 'Account holder', width: 170, render: (row) => (row.acc ? cellText(row.acc.account_holder_name) : dash) },
          { key: 'address', label: 'Branch / Address', width: 200, render: (row) => (row.acc ? cellText(row.acc.address) : dash) },
          action,
        ]
      : [{ key: 'account', label: 'Account', render: (row) => account(row, true) }, action];

    return (
      <BookPage wide={layout.wide}>
        {addForm}

        <BookTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowPress={(row) => {
            if (row.id === 'cash') {
              setShowAdd(false);
              setEditingId(null);
              setEditingCash(true);
            } else if (row.acc) openEdit(row.acc.id);
          }}
          highlight={(row) => row.id === editingId || (row.id === 'cash' && editingCash)}
          expanded={(row) =>
            row.id === 'cash' && editingCash ? (
              <View className="border-b border-gray-200 bg-gray-50 p-3">{cashForm}</View>
            ) : row.acc && row.id === editingId ? (
              <View className="border-b border-gray-200 bg-gray-50 p-3">{editForm(row.acc)}</View>
            ) : null
          }
        />

        {accounts.length === 0 && !showAdd && (
          <Text className="px-1 text-[13px] text-gray-500">No bank accounts yet - add one with Add account.</Text>
        )}

        {footnote}
      </BookPage>
    );
  }

  return (
    <BookPage wide={false}>
      {addForm}

      <View>
        {editingCash ? (
          <View className="mb-2.5">{cashForm}</View>
        ) : (
          <Pressable
            onPress={() => setEditingCash(true)}
            className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
              <Ionicons name="cash-outline" size={16} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-gray-900">{cashDetails.name}</Text>
              {!!cashDetails.account_number && <Text className="text-xs text-gray-400">A/C {cashDetails.account_number}</Text>}
            </View>
            <Ionicons name="pencil-outline" size={17} color="#9CA3AF" />
          </Pressable>
        )}

        {accounts.length === 0 && !showAdd ? (
          <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
            <Ionicons name="business-outline" size={28} color="#D1D5DB" />
            <Text className="mt-2 text-gray-500">No bank accounts yet — add one above.</Text>
          </View>
        ) : (
          accounts.map((acc) =>
            editingId === acc.id ? (
              <View key={acc.id} className="mb-2.5">
                {editForm(acc)}
              </View>
            ) : (
              <Pressable
                key={acc.id}
                onPress={() => openEdit(acc.id)}
                className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
              >
                <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
                  <Ionicons name="business-outline" size={16} color="#2563EB" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-gray-900">{acc.name}</Text>
                  {!!acc.account_number && <Text className="text-xs text-gray-400">A/C {acc.account_number}</Text>}
                </View>
                <Ionicons name="pencil-outline" size={17} color="#9CA3AF" />
              </Pressable>
            )
          )
        )}
      </View>

      {footnote}
    </BookPage>
  );
}
