// lib/components/finance/BankBalancesScreen.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseInsert, useSupabaseDelete } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { useAccountBalances, type AccountActivityItem } from '../../hooks/useAccountBalances';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { DateField } from '../DateTimeFields';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { ToolbarButton, useBarActions, useBookLayout } from './BookKit';
import { localTodayIso } from '../../utils/localDate';
import { useReportActions } from './PrintButton';
import type { PrintReport, PrintSection } from '../../utils/printReport';

// Local date, not UTC - see localTodayIso.
const todayIso = localTodayIso;

/** One line of an account's ledger - what actually made up its balance.
 * Tapping it goes wherever that money movement can be edited: the
 * Transactions list for an Expense, the customer/vendor's own page for a
 * Payment In/Out or vendor payment, or (for a transfer between your own
 * accounts, which has no such page) a delete confirmation right here. */
function ActivityRow({
  item,
  basePath,
  onDeleteTransfer,
}: {
  item: AccountActivityItem;
  basePath: string;
  onDeleteTransfer: (id: string) => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  return (
    <Pressable
      onPress={() => {
        if (item.nav.kind === 'transfer') {
          showAlert('Remove this transfer?', 'This undoes the move between your accounts.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => onDeleteTransfer(item.nav.kind === 'transfer' ? item.nav.transferId : '') },
          ]);
          return;
        }
        router.push(
          (item.nav.kind === 'transactions'
            ? `${basePath}/transactions?type=${item.nav.type}`
            : `${basePath}/customer/${item.nav.partyId}`) as any
        );
      }}
      className="flex-row items-center gap-2 border-t border-gray-100 py-2"
    >
      <Ionicons
        name={item.nav.kind === 'transfer' ? 'swap-horizontal' : item.isInflow ? 'arrow-down-circle' : 'arrow-up-circle'}
        size={16}
        color={item.isInflow ? '#059669' : '#DC2626'}
      />
      <View className="flex-1 pr-2">
        <Text className="text-xs font-semibold text-gray-900" numberOfLines={1}>
          {item.label}
        </Text>
        <Text className="text-[10px] text-gray-400" numberOfLines={1}>
          {[item.sub, toBsHistoryLabel(item.date)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text className="text-xs font-bold" style={{ color: item.isInflow ? '#059669' : '#DC2626' }}>
        {item.isInflow ? '+' : '−'} NPR {item.amount.toLocaleString()}
      </Text>
    </Pressable>
  );
}

/** Move money between the business's own accounts (e.g. withdrawing cash
 * from a bank, or moving Esewa funds into a bank account) - not a Sale,
 * Purchase, Expense, or party payment, so it gets its own small form
 * instead of overloading one of those. `bare` is for a form that is already in a card of its own
 * (the Day Book's Contra popup): no border and no title of its own. */
export function TransferForm({ userId, onDone, bare = false }: { userId: string; onDone: () => void; bare?: boolean }) {
  const { accounts, rename, remove } = useBankAccounts(userId);
  const insertTransfer = useSupabaseInsert('account_transfers');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<'from' | 'to' | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const nameFor = (id: string | null) => (id ? accounts.find((a) => a.id === id)?.name ?? 'Bank' : 'Cash');

  async function handleSave() {
    const value = Number(amount);
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    if (fromAccountId === toAccountId) {
      showAlert('Pick two different accounts', "The 'from' and 'to' accounts can't be the same.");
      return;
    }
    setSaving(true);
    try {
      await insertTransfer.mutateAsync({
        owner_id: userId,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: value,
        note: note.trim() || null,
        transfer_date: date,
      });
      onDone();
    } catch (err) {
      showAlert('Could not save transfer', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className={bare ? '' : 'mb-4 rounded-2xl border border-gray-200 bg-white p-4'}>
      {!bare && <Text className="mb-3 text-sm font-semibold text-gray-900">Transfer money</Text>}

      <View className="mb-2.5 flex-row" style={{ gap: 10 }}>
        <View style={{ flex: 1.3, minWidth: 0 }}>
          <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
          <DateField value={date} onChange={setDate} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="mb-1 text-xs font-medium text-gray-500">Amount (NPR)</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 5000"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
          />
        </View>
      </View>

      <Text className="mb-1 text-xs font-medium text-gray-500">From</Text>
      <Pressable
        onPress={() => setPickerOpen('from')}
        className="mb-2.5 flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
      >
        <Text className="text-sm text-gray-900">{nameFor(fromAccountId)}</Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>

      <Text className="mb-1 text-xs font-medium text-gray-500">To</Text>
      <Pressable
        onPress={() => setPickerOpen('to')}
        className="mb-2.5 flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
      >
        <Text className="text-sm text-gray-900">{nameFor(toAccountId)}</Text>
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>

      <Text className="mb-1 text-xs font-medium text-gray-500">Remarks (optional)</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Cash withdrawal"
        placeholderTextColor="#9CA3AF"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
      />

      <View className="flex-row gap-2">
        <Pressable onPress={onDone} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable onPress={handleSave} disabled={saving} className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-50">
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Transfer'}</Text>
        </Pressable>
      </View>

      <BankAccountPickerModal
        visible={pickerOpen != null}
        accounts={accounts}
        selectedId={pickerOpen === 'from' ? fromAccountId : toAccountId}
        onSelect={(id) => (pickerOpen === 'from' ? setFromAccountId(id) : setToAccountId(id))}
        onClose={() => setPickerOpen(null)}
        onRename={rename}
        onDelete={remove}
      />
    </View>
  );
}

/** Read-only view (aside from transfers) behind the dashboard's Available
 * Balance tile - how much is in Cash and each bank account, and what makes
 * up each one. Managing the accounts themselves (adding one, editing its
 * details, removing it) is a deliberately separate screen reached from
 * Finance's Shortcuts, not from here. */
export function BankBalancesScreen({ basePath }: { basePath: string }) {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const balances = useAccountBalances(userId);
  const deleteTransfer = useSupabaseDelete('account_transfers');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);

  const bankTotal = balances.perAccount.reduce((sum, a) => sum + a.balance, 0);

  function handleDeleteTransfer(id: string) {
    if (!id) return;
    deleteTransfer.mutate(id, {
      onError: (err) => showAlert('Could not remove transfer', getErrorMessage(err)),
    });
  }

  // Print and Excel: what each account holds, and - for the one opened - what makes up its balance.
  const reportButtons = useReportActions((): PrintReport => {
    const activityOf = (name: string, items: AccountActivityItem[]): PrintSection => ({
      heading: `${name} - activity`,
      columns: [{ label: 'Date' }, { label: 'Details' }, { label: 'Amount (NPR)', align: 'right' }],
      rows: items.map((item) => [
        toBsHistoryLabel(item.date),
        [item.label, item.sub].filter(Boolean).join(' · '),
        `${item.isInflow ? '+' : '-'}${item.amount.toLocaleString()}`,
      ]),
      emptyText: 'No activity yet.',
    });
    const opened =
      expandedKey === 'cash'
        ? activityOf('Cash', balances.cashActivity)
        : balances.perAccount.filter((a) => a.id === expandedKey).map((a) => activityOf(a.name, a.activity))[0];
    return {
      title: 'Bank Balances',
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary: [
        { label: 'Available balance (Cash + Banks)', value: `NPR ${balances.total.toLocaleString()}` },
        { label: 'Bank total', value: `NPR ${bankTotal.toLocaleString()}` },
        { label: 'Cash', value: `NPR ${balances.cash.toLocaleString()}` },
      ],
      sections: [
        {
          columns: [{ label: 'SN' }, { label: 'Account' }, { label: 'Balance (NPR)', align: 'right' }],
          rows: [
            ['1', 'Cash', balances.cash.toLocaleString()],
            ...balances.perAccount.map((a, i) => [String(i + 2), a.name, a.balance.toLocaleString()]),
          ],
          footer: ['', 'Total', balances.total.toLocaleString()],
        },
        ...(opened ? [opened] : []),
      ],
    };
  });

  // The name, the back button (phones), Print / Excel and Transfer live in the top bar.
  useBarActions(
    {
      wide: layout.wide,
      right: userId
        ? () => (
            <>
              {reportButtons}
              {!showTransfer && <ToolbarButton icon="swap-horizontal" label="Transfer" onPress={() => setShowTransfer(true)} />}
            </>
          )
        : undefined,
    },
    [showTransfer, userId]
  );

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {showTransfer && userId && <TransferForm userId={userId} onDone={() => setShowTransfer(false)} />}

      <View className="mb-3 rounded-2xl p-4" style={{ backgroundColor: balances.total >= 0 ? '#EFF6FF' : '#FEF2F2' }}>
        <Text className="text-xs font-semibold" style={{ color: balances.total >= 0 ? '#2563EB' : '#DC2626' }}>
          Available Balance (Cash + Banks)
        </Text>
        <Text className="text-2xl font-extrabold" style={{ color: balances.total >= 0 ? '#2563EB' : '#DC2626' }}>
          NPR {balances.total.toLocaleString()}
        </Text>
      </View>

      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="text-xs font-semibold text-gray-500">Bank Total</Text>
        <Text className="text-lg font-extrabold" style={{ color: bankTotal >= 0 ? '#111827' : '#DC2626' }}>
          NPR {bankTotal.toLocaleString()}
        </Text>
      </View>

      <Pressable
        onPress={() => setExpandedKey((k) => (k === 'cash' ? null : 'cash'))}
        className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4"
      >
        <View className="flex-row items-center gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-gray-100">
            <Ionicons name="cash-outline" size={16} color="#6B7280" />
          </View>
          <Text className="flex-1 text-sm font-semibold text-gray-900">Cash</Text>
          <Text className="text-sm font-bold" style={{ color: balances.cash >= 0 ? '#111827' : '#DC2626' }}>
            NPR {balances.cash.toLocaleString()}
          </Text>
          <Ionicons name={expandedKey === 'cash' ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </View>
        {expandedKey === 'cash' &&
          (balances.cashActivity.length === 0 ? (
            <Text className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">No cash activity yet.</Text>
          ) : (
            <View className="mt-1">
              {balances.cashActivity.map((item) => (
                <ActivityRow key={item.id} item={item} basePath={basePath} onDeleteTransfer={handleDeleteTransfer} />
              ))}
            </View>
          ))}
      </Pressable>

      {balances.perAccount.length === 0 ? (
        <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
          <Ionicons name="business-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">No bank accounts yet.</Text>
          <Text className="mt-1 text-xs text-gray-400">Add one from Finance → Shortcuts → Bank Accounts.</Text>
        </View>
      ) : (
        balances.perAccount.map((acc) => {
          const isExpanded = expandedKey === acc.id;
          return (
            <Pressable
              key={acc.id}
              onPress={() => setExpandedKey((k) => (k === acc.id ? null : acc.id))}
              className="mb-2.5 rounded-2xl border border-gray-200 bg-white p-4"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
                  <Ionicons name="business-outline" size={16} color="#2563EB" />
                </View>
                <Text className="flex-1 text-sm font-semibold text-gray-900">{acc.name}</Text>
                <Text className="text-sm font-bold" style={{ color: acc.balance >= 0 ? '#059669' : '#DC2626' }}>
                  NPR {acc.balance.toLocaleString()}
                </Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
              </View>
              {isExpanded &&
                (acc.activity.length === 0 ? (
                  <Text className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">No activity yet.</Text>
                ) : (
                  <View className="mt-1">
                    {acc.activity.map((item) => (
                      <ActivityRow key={item.id} item={item} basePath={basePath} onDeleteTransfer={handleDeleteTransfer} />
                    ))}
                  </View>
                ))}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}
