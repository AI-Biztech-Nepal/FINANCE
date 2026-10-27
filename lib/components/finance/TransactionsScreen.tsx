// lib/components/finance/TransactionsScreen.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, View, Text, TextInput, Pressable, Modal, ScrollView, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { KeyboardAwareSectionList } from 'react-native-keyboard-aware-scroll-view';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useRole } from '../../hooks/useAuth';
import { sellsVehicles } from '../../utils/accountFeatures';
import { useConfirmNewParty } from './NewPartyConfirm';
import { highlightText } from './Highlight';
import { useSupabaseInsert, useSupabaseQuery, useSupabaseRow, useSupabaseUpdate, useSupabaseUpsert, useSupabaseDelete } from '../../hooks/useSupabase';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { useIsWideWeb } from '../../hooks/useWideGrid';
import { usePhoneContacts } from '../../hooks/usePhoneContacts';
import { useScanBill } from '../../hooks/useScanBill';
import { DateField } from '../DateTimeFields';
import { Field, FieldRow, FormActions, INPUT, PopupCard, RenamePartyPopup, Segmented } from './FormKit';
import { EntryWhenFields, PartyMoveField, PaymentMethodButton, stampOf, timeOf, useEntryParty, useEntryWhen } from './EntryEditParts';
import { MONEY } from './moneyColors';
import { TrendChartCard } from './TrendChartCard';
import { BankAccountPickerModal } from './BankAccountPickerModal';
import { ContactPickerModal } from '../ContactPickerModal';
import { ToggleSwitch } from '../ToggleSwitch';
import { FormSection } from './FormSection';
import { BillItemsTable, type BillItemsTableHandle } from './BillItemsTable';
import { KeyboardDateInput } from './KeyboardDateInput';
import { KeyboardSelect } from './KeyboardSelect';
import { optionLabel } from '../../hooks/useAvailableAmounts';
import { useAccountBalances } from '../../hooks/useAccountBalances';
import { ExpenseEntryTable, type ExpenseEntryRow as ExpenseRow, type ExpenseEntryTableHandle } from './ExpenseEntryTable';
import { KeyInput } from './KeyInput';
import { useConfirmSave } from './ConfirmSave';
import { AddStockItemDialog } from './AddStockItemDialog';
import { TransactionsBook } from './TransactionsBook';
import { tidyName } from '../../utils/nameCaps';
import { BookTable, type BookColumn } from './BookKit';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../../utils/customerSuggestions';
import { readKey } from '../../utils/webKeys';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { toBsLabel, toBsHistoryLabel } from '../../utils/nepaliDate';
import { dateLabels, useCalendarMode } from '../../hooks/useCalendarMode';
import { entryDay } from '../../utils/ledgerStatement';
import type {
  AccountTransfer,
  BusinessTransaction,
  BusinessTransactionType,
  Customer,
  CustomerLedgerEntry,
  ExpenseCategory,
  FinanceItem,
  Product,
  VendorLedgerEntry,
} from '../../../types/database.types';
import { localTodayIso } from '../../utils/localDate';
import { round2, formatMoney } from '../../utils/money';

// Local date, not UTC - see localTodayIso.
const todayIso = localTodayIso;


interface ItemRowState {
  hs_code?: string;
  /** Model number - entered on a vehicle account's Purchase bill. */
  model?: string;
  description: string;
  qty: string;
  rate: string;
}

let expenseRowSeq = 0;
function makeExpenseRowKey() {
  expenseRowSeq += 1;
  return `expense-row-${expenseRowSeq}`;
}

// Web only: recording several expenses under one Date/Payment method in a
// single save, same "shared voucher, per-row table" shape as Received / Payment
// Out - see ExpenseEntryTable and the web branch of TransactionForm below.
function emptyExpenseRow(): ExpenseRow {
  return { key: makeExpenseRowKey(), partyName: '', customerId: null, categoryId: null, amount: '', note: '' };
}

/** The "Add ... as new customer / vendor" row in the bill's party box. */
const ADD_PARTY_KEY = '__add-party__';

function lineTotal(row: ItemRowState) {
  return round2((Number(row.qty) || 0) * (Number(row.rate) || 0));
}

/** A line that actually gets saved on the bill - the subtotal only counts
 * these, so the saved total always matches the saved items. */
function isSavableItem(row: ItemRowState) {
  return !!row.description.trim() && Number(row.qty) > 0 && Number(row.rate) >= 0;
}

/** One item, one line: name (tap to pick/change the stocked product), a
 * compact qty x rate pair, the computed amount, and a remove button. Qty and
 * rate stay directly editable inline so adjusting an already-picked item
 * never needs a second popup. */
function ItemLineRow({
  item,
  onEditProduct,
  onQtyChange,
  onRateChange,
  onRemove,
}: {
  item: ItemRowState;
  onEditProduct: () => void;
  onQtyChange: (v: string) => void;
  onRateChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <View className="mb-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2">
      {/* Name gets its own full-width row (up to 2 lines) so a long product
          name is actually readable, instead of squeezed into flex-1 next to
          the qty/rate/total inputs on one line. */}
      <View className="mb-1.5 flex-row items-start justify-between gap-2">
        <Pressable onPress={onEditProduct} className="flex-1 flex-row items-start gap-1.5 pr-1">
          <Ionicons name="cube-outline" size={13} color="#9CA3AF" style={{ marginTop: 2 }} />
          <Text
            className={`flex-1 text-sm font-semibold ${item.description ? 'text-gray-900' : 'text-gray-400'}`}
            numberOfLines={2}
          >
            {item.description || 'Tap to pick an item'}
          </Text>
        </Pressable>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color="#D1D5DB" />
        </Pressable>
      </View>
      <View className="flex-row items-center justify-end gap-1.5">
        <TextInput
          value={item.qty}
          onChangeText={onQtyChange}
          keyboardType="numeric"
          placeholder="Qty"
          placeholderTextColor="#9CA3AF"
          className="w-12 rounded border border-gray-200 py-1 text-center text-xs text-gray-900"
        />
        <Text className="text-[10px] text-gray-400">×</Text>
        <TextInput
          value={item.rate}
          onChangeText={onRateChange}
          keyboardType="numeric"
          placeholder="Rate"
          placeholderTextColor="#9CA3AF"
          className="w-16 rounded border border-gray-200 py-1 text-center text-xs text-gray-900"
        />
        <Text className="text-[10px] text-gray-400">=</Text>
        <Text className="text-right text-xs font-bold text-gray-900" numberOfLines={1}>
          NPR {formatMoney(lineTotal(item))}
        </Text>
      </View>
    </View>
  );
}

/** The "go pick from stock" popup behind each item line: one search field
 * over the reseller's own products (with live stock + price) that also
 * doubles as the name for a one-off item that isn't in the catalog - typing
 * something with no match surfaces a "+ Add as new item" row right in the
 * list instead of a second, separate input. Picking that opens a small
 * confirm step (name + rate, Save/Cancel) before it's actually added.
 * Opened either from "+ Add item" (appends a new line) or by tapping an
 * existing line's name (replaces that line's product). */
type PickableRow =
  | { key: string; kind: 'product'; product: Product }
  | { key: string; kind: 'financeItem'; item: FinanceItem };

function ItemPickerModal({
  visible,
  products,
  financeItems,
  onPick,
  onPickFinanceItem,
  onPickCustom,
  onClose,
}: {
  visible: boolean;
  products: Product[];
  financeItems: FinanceItem[];
  onPick: (p: Product) => void;
  onPickFinanceItem: (item: FinanceItem) => void;
  onPickCustom: (name: string, rate: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [customRate, setCustomRate] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const productRows: PickableRow[] = products
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((product) => ({ key: `p-${product.id}`, kind: 'product', product }));
    // Previously typed one-off names (not real stock - see
    // 0063_finance_items.sql) offered alongside real products so they're
    // reachable again instead of needing to be retyped from scratch.
    const financeRows: PickableRow[] = financeItems
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .map((item) => ({ key: `f-${item.id}`, kind: 'financeItem', item }));
    return [...productRows, ...financeRows];
  }, [products, financeItems, search]);

  function reset() {
    setSearch('');
    setConfirmingName(null);
    setCustomRate('');
  }

  function submitCustom() {
    if (!confirmingName?.trim()) return;
    onPickCustom(confirmingName.trim(), customRate);
    reset();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={reset}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '80%' }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900">
              {confirmingName != null ? 'Add new item' : 'Pick from your stock'}
            </Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-semibold text-blue-700">Close</Text>
            </Pressable>
          </View>

          {confirmingName != null ? (
            <>
              <Text className="mb-1 text-xs font-medium text-gray-500">Item name</Text>
              <TextInput
                value={confirmingName}
                onChangeText={setConfirmingName}
                placeholder="Item name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                className="mb-2.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <Text className="mb-1 text-xs font-medium text-gray-500">Rate (NPR)</Text>
              <TextInput
                value={customRate}
                onChangeText={setCustomRate}
                placeholder="Optional — fill in on the item line instead"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                onSubmitEditing={submitCustom}
                className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <View className="flex-row gap-2">
                <Pressable onPress={() => setConfirmingName(null)} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submitCustom}
                  disabled={!confirmingName.trim()}
                  className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
                >
                  <Text className="text-sm font-semibold text-white">Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search your products, or type a new item name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                className="mb-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <FlatList
                data={matches}
                keyExtractor={(row) => row.key}
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 300 }}
                renderItem={({ item: row }) =>
                  row.kind === 'product' ? (
                    <Pressable
                      onPress={() => onPick(row.product)}
                      className="flex-row items-center justify-between border-b border-gray-100 px-2 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                          {highlightText(row.product.name, search)}
                        </Text>
                        <Text className={`text-xs ${row.product.stock_level > 0 ? 'text-gray-500' : 'text-red-500'}`}>
                          {row.product.stock_level} in stock
                        </Text>
                      </View>
                      <Text className="text-sm font-semibold text-gray-900">NPR {formatMoney(Number(row.product.price))}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => onPickFinanceItem(row.item)}
                      className="flex-row items-center justify-between border-b border-gray-100 px-2 py-2.5"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                          {highlightText(row.item.name, search)}
                        </Text>
                        <Text className="text-xs text-gray-400">Not in stock — used before</Text>
                      </View>
                      {row.item.rate != null && (
                        <Text className="text-sm font-semibold text-gray-900">NPR {formatMoney(Number(row.item.rate))}</Text>
                      )}
                    </Pressable>
                  )
                }
                ListEmptyComponent={<Text className="px-2 py-3 text-center text-sm text-gray-400">No matching products.</Text>}
                ListFooterComponent={
                  search.trim() ? (
                    <Pressable
                      onPress={() => setConfirmingName(search.trim())}
                      className="mt-1 flex-row items-center gap-1.5 rounded-lg bg-orange-50 px-2 py-2.5"
                    >
                      <Ionicons name="add-circle" size={16} color="#EA580C" />
                      <Text className="text-sm font-semibold text-orange-600">Add "{search.trim()}" as a new item</Text>
                    </Pressable>
                  ) : null
                }
              />
            </>
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const TYPE_META: Record<BusinessTransactionType, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  sale: { label: 'Sale', color: '#059669', bg: 'bg-emerald-50', icon: 'trending-up' },
  purchase: { label: 'Purchase', color: '#dc2626', bg: 'bg-red-50', icon: 'cart' },
  expense: { label: 'Expense', color: '#dc2626', bg: 'bg-red-50', icon: 'receipt' },
};

const FILTERS: { key: 'all' | BusinessTransactionType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sale', label: 'Sales' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'expense', label: 'Expenses' },
];


/** Web only: a short "what did I just enter recently" reference list below
 * the live summary card, so a reseller can glance at their last few
 * Sale/Purchase/Expense entries without leaving the form. Sale/Purchase/
 * Expense all read business_transactions directly (Payment In/Out's own
 * version of this lives in QuickPaymentScreen, over the ledger tables).
 *
 * Laid out as a small table (party and date, amount). Each entry opens the
 * same read-only receipt the list uses (`onOpen`), which carries the Edit and
 * Delete buttons - so a mistake can be fixed or removed from here without
 * leaving the entry screen. `activeId` marks the entry currently loaded in the
 * form. */
function RecentEntriesCard({
  userId,
  type,
  color,
  activeId,
  onOpen,
}: {
  userId: string;
  type: BusinessTransactionType;
  color: string;
  activeId?: string;
  onOpen?: (tx: BusinessTransaction) => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const { data } = useSupabaseQuery('business_transactions', {
    filters: { owner_id: userId, type },
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const recent = (data ?? []).slice(0, 5);

  const columns: BookColumn<BusinessTransaction>[] = [
    {
      key: 'party',
      label: 'Party',
      render: (tx) => (
        <View style={{ minWidth: 0 }}>
          <Text numberOfLines={1} className="text-xs font-semibold text-gray-800">
            {tidyName(tx.party_name) || 'Unnamed'}
          </Text>
          <Text className="text-[10px] text-gray-400">
            {toBsHistoryLabel(tx.bill_date ?? tx.created_at)}
            {activeId === tx.id ? ' · editing' : ''}
          </Text>
        </View>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      width: 84,
      align: 'right',
      render: (tx) => (
        <Text className="text-xs font-bold" style={{ color, fontVariant: ['tabular-nums'] }}>
          {formatMoney(tx.amount)}
        </Text>
      ),
    },
  ];

  return (
    <View className="mt-4">
      <Text className="text-[11px] font-bold capitalize tracking-wide text-gray-400">Recent {TYPE_META[type].label}s</Text>
      {!!onOpen && recent.length > 0 && (
        <Text className="mb-2 mt-0.5 text-[10.5px] text-gray-400">Tap an entry to view, edit or delete it</Text>
      )}
      {recent.length === 0 ? (
        <View className="mt-2 rounded-xl border border-gray-300 bg-white p-4">
          <Text className="text-xs text-gray-400">No entries yet.</Text>
        </View>
      ) : (
        <BookTable
          columns={columns}
          rows={recent}
          rowKey={(tx) => tx.id}
          onRowPress={onOpen}
          highlight={(tx) => tx.id === activeId}
        />
      )}
    </View>
  );
}

function CategoryPickerModal({
  visible,
  categories,
  selectedId,
  onSelect,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  visible: boolean;
  categories: ExpenseCategory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onCreate: (name: string, group: 'direct' | 'indirect') => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  // The Add popup: the name and whether it is a Direct or an Indirect expense, then Save or Cancel.
  const [adding, setAdding] = useState(false);
  const [newGroup, setNewGroup] = useState<'direct' | 'indirect'>('indirect');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onCreate(newName.trim(), newGroup);
      setNewName('');
      setNewGroup('indirect');
      setAdding(false);
    } catch (err) {
      showAlert('Could not add category', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    setSaving(true);
    try {
      await onRename(id, renameValue.trim());
      setRenamingId(null);
    } catch (err) {
      showAlert('Could not rename category', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '75%' }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-base font-semibold text-gray-900">Expense categories</Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-semibold text-blue-700">Close</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setAdding(true)}
            className="mb-3 flex-row items-center justify-center rounded-lg bg-orange-500 py-2.5"
            style={{ gap: 6 }}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text className="text-sm font-semibold text-white">Add expense head</Text>
          </Pressable>

          {adding && (
            <View className="absolute inset-0 items-center justify-center rounded-xl bg-black/30 px-3" style={{ zIndex: 20 }}>
              <View className="w-full rounded-xl bg-white p-4" style={{ gap: 10 }}>
                <Text className="text-base font-semibold text-gray-900">New expense head</Text>
                <View>
                  <Text className="mb-1 text-xs font-semibold text-gray-600">Name *</Text>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                    placeholder="e.g. Salary Advance"
                    placeholderTextColor="#9CA3AF"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  />
                </View>
                <View>
                  <Text className="mb-1 text-xs font-semibold text-gray-600">Category</Text>
                  <View className="flex-row" style={{ gap: 8 }}>
                    {([['indirect', 'Indirect expense'], ['direct', 'Direct expense']] as const).map(([k, label]) => (
                      <Pressable
                        key={k}
                        onPress={() => setNewGroup(k)}
                        className="flex-1 items-center rounded-lg border py-2"
                        style={{ borderColor: newGroup === k ? '#2563EB' : '#D1D5DB', backgroundColor: newGroup === k ? '#EFF6FF' : '#FFFFFF' }}
                      >
                        <Text className="text-[13px] font-semibold" style={{ color: newGroup === k ? '#1D4ED8' : '#374151' }}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text className="mt-1 text-[11.5px] text-gray-500">
                    Direct costs (freight, repairs, labour) are taken off sales before gross profit; indirect ones (salary, rent, phone) after it.
                  </Text>
                </View>
                <View className="flex-row justify-end" style={{ gap: 10 }}>
                  <Pressable
                    onPress={() => {
                      setAdding(false);
                      setNewName('');
                      setNewGroup('indirect');
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2"
                  >
                    <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleCreate}
                    disabled={saving || !newName.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 disabled:opacity-50"
                  >
                    <Text className="text-sm font-semibold text-white">{saving ? 'Saving...' : 'Save'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {categories.length === 0 ? (
            <Text className="px-2 py-3 text-center text-sm text-gray-400">No categories yet — add one above.</Text>
          ) : (
            categories.map((cat) => (
              <View key={cat.id} className="mb-1.5 flex-row items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5">
                {renamingId === cat.id ? (
                  <>
                    <TextInput
                      value={renameValue}
                      onChangeText={setRenameValue}
                      autoFocus
                      className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                    />
                    <Pressable onPress={() => handleRename(cat.id)} hitSlop={8} disabled={saving}>
                      <Ionicons name="checkmark" size={18} color="#059669" />
                    </Pressable>
                    <Pressable onPress={() => setRenamingId(null)} hitSlop={8}>
                      <Ionicons name="close" size={18} color="#9CA3AF" />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => {
                        onSelect(cat.id);
                        onClose();
                      }}
                      className="flex-1 flex-row items-center gap-2 py-1"
                    >
                      {selectedId === cat.id && <Ionicons name="checkmark-circle" size={16} color="#EA580C" />}
                      <Text className="text-sm font-medium text-gray-900">{cat.name}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setRenamingId(cat.id);
                        setRenameValue(cat.name);
                      }}
                      hitSlop={8}
                    >
                      <Ionicons name="pencil-outline" size={15} color="#9CA3AF" />
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        showAlert('Remove this category?', undefined, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => onDelete(cat.id) },
                        ])
                      }
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={15} color="#9CA3AF" />
                    </Pressable>
                  </>
                )}
              </View>
            ))
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TransactionForm({
  userId,
  initial,
  type,
  existingNames,
  customers,
  products,
  voicePrefill,
  presetPartyId,
  onOpenRecent,
  onDone,
  onCancel,
}: {
  userId: string;
  initial?: BusinessTransaction;
  type: BusinessTransactionType;
  existingNames: string[];
  customers: Customer[];
  products: Product[];
  voicePrefill?: { amount?: string; party?: string; date?: string; note?: string } | null;
  /** A saved party to start the bill with - "New Sale" from their statement. */
  presetPartyId?: string;
  /** Opens an entry from the Recent list (web) - see RecentEntriesCard. */
  onOpenRecent?: (tx: BusinessTransaction) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  // The keyboard-driven desk layout is for a wide web screen; a phone (or a
  // phone browser) gets the same touch form the native app does.
  const desktopWeb = useIsWideWeb();
  // A vehicle account's Purchase bill has a Model No. beside each item.
  const profile = useAuthStore((state) => state.profile);
  const withModel = type === 'purchase' && sellsVehicles(profile?.business_name?.trim() || profile?.full_name);
  const createTx = useSupabaseInsert('business_transactions');
  const { confirm: confirmSave, dialog: confirmDialog } = useConfirmSave();
  // A new customer / vendor made from a typed name is checked first, with its name editable.
  const { askNewParty, dialog: newPartyDialog } = useConfirmNewParty();
  const newPartyKind = type === 'purchase' ? 'vendor' : type === 'sale' ? 'customer' : 'payee';
  const updateTx = useSupabaseUpdate('business_transactions');
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: { owner_id: userId },
    orderBy: { column: 'name' },
  });
  const createCategory = useSupabaseInsert('expense_categories');
  const updateCategory = useSupabaseUpdate('expense_categories');
  const deleteCategory = useSupabaseDelete('expense_categories');
  const bankAccounts = useBankAccounts(userId);
  const createCustomer = useSupabaseInsert('customers');
  const updateCustomer = useSupabaseUpdate('customers');
  const { data: financeItems } = useSupabaseQuery('finance_items', {
    filters: { owner_id: userId },
    enabled: !!userId,
  });
  const createProduct = useSupabaseInsert('products');
  const updateProduct = useSupabaseUpdate('products');
  const phoneContacts = usePhoneContacts();
  const { scanning, pickAndScan } = useScanBill();
  // Pre-fills the party picker's search box with whatever name Scan Bill
  // read off the photo, instead of a silent auto-pick - a scanned name can
  // be misread, so it still needs a tap to confirm which real customer/
  // vendor it actually is.
  const [partyPickerQuery, setPartyPickerQuery] = useState('');

  // Expense: date + addable name + a managed category + amount + remark.
  const [amount, setAmount] = useState(initial && initial.type === 'expense' ? String(initial.amount) : '');
  const [expenseDate, setExpenseDate] = useState(initial?.bill_date ?? todayIso());
  // Money in each bank / wallet account, shown beside it in an expense's Payment method dropdown - new
  // or being edited: the books' own figures, as every list of accounts shows them. Cash has none. (The
  // other kinds of entry read them when their list of accounts is opened.)
  const balances = useAccountBalances(type === 'expense' ? userId : undefined);
  const available = useMemo(
    () => (balances.ready ? { byId: Object.fromEntries(balances.perAccount.map((a) => [a.id, round2(a.balance)])) } : null),
    [balances]
  );
  const [categoryId, setCategoryId] = useState<string | null>(initial?.expense_category_id ?? null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Sale/Purchase: entered as a proper itemized bill.
  const [billNo, setBillNo] = useState(initial?.bill_no ?? '');
  const [billDate, setBillDate] = useState(initial?.bill_date ?? todayIso());
  const [items, setItems] = useState<ItemRowState[]>(
    initial
      ? initial.items.map((i) => ({ hs_code: i.hs_code ?? '', model: i.model ?? '', description: i.description, qty: String(i.qty), rate: String(i.rate) }))
      : []
  );
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  // The "Add new stock item" popup opened from the desktop item dropdown: which
  // row asked for it, and the name / rate typed there so far.
  const [addStockFor, setAddStockFor] = useState<{ index: number; name: string; rate: string } | null>(null);

  // Discount is typed as a plain NPR amount (its % is only ever a derived
  // read-out); VAT is typed as a percentage (defaulting to Nepal's standard
  // 13%) since it's normally a fixed rate applied to whatever the subtotal
  // is. They're independent, separately collapsible rows - adding one
  // doesn't imply the other.
  const initialSubtotal = initial ? initial.items.reduce((sum, i) => sum + i.amount, 0) : 0;
  const [discountAmountInput, setDiscountAmountInput] = useState(initial ? String(initial.discount_amount) : '0');
  // Web: the discount can be typed as a percent of the subtotal or as an NPR
  // amount - whichever was typed last drives the other, so a percent keeps
  // following the subtotal as items change. Native only ever uses the amount.
  // An existing discount shows in rupees, exactly as saved; otherwise the same
  // default as a new bill.
  const [discountMode, setDiscountMode] = useState<'percent' | 'amount'>(
    desktopWeb && !(initial && initial.discount_amount > 0) ? 'percent' : 'amount'
  );
  const [discountPercentInput, setDiscountPercentInput] = useState('');
  // Defaults to 0 (not 13) for a brand-new bill - the VAT row itself starts
  // collapsed, but the percent still fed into vatAmount even while
  // collapsed, so every new Sale/Purchase silently had 13% VAT baked into
  // its total whether the reseller ever opened that row or not. 13% only
  // ever gets filled in when they actually tap to turn VAT on (see the
  // toggle below).
  const [vatPercent, setVatPercent] = useState(
    initial && initialSubtotal - initial.discount_amount > 0
      ? String(Math.round(((initial.vat_amount / (initialSubtotal - initial.discount_amount)) * 100) * 100) / 100)
      : '0'
  );
  const [showDiscount, setShowDiscount] = useState(!!initial && initial.discount_amount > 0);
  const [showVat, setShowVat] = useState(!!initial && initial.vat_amount > 0);

  const [partyName, setPartyName] = useState(initial?.party_name ?? '');
  // Links this bill to a real saved customer/vendor record, not just its
  // free-text name - a Sale/Purchase always books against this party's
  // ledger now (see 0061_sale_purchase_always_ledger.sql), so it's required
  // for a bill, same as Quick Payment already requires a real customer.
  // Only ever set by actually picking a saved contact below, never typing.
  const [customerId, setCustomerId] = useState<string | null>(initial?.customer_id ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [bankAccountId, setBankAccountId] = useState<string | null>(initial?.bank_account_id ?? null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const isBill = type !== 'expense';
  const subtotal = round2(items.filter(isSavableItem).reduce((sum, row) => sum + lineTotal(row), 0));
  const discountAmount =
    discountMode === 'percent'
      ? round2((subtotal * Math.min(Number(discountPercentInput) || 0, 100)) / 100)
      : round2(Number(discountAmountInput) || 0);
  const discountPercentDisplay = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  // Flips the single discount box between a percent and an NPR amount, carrying
  // the value across so what is on screen never changes meaning under the user.
  function setDiscountUnit(unit: 'percent' | 'amount') {
    if (unit === discountMode) return;
    if (unit === 'amount') {
      setDiscountAmountInput(String(discountAmount));
    } else {
      setDiscountPercentInput(subtotal > 0 && discountAmount > 0 ? String(Math.round(discountPercentDisplay * 100) / 100) : '');
    }
    setDiscountMode(unit);
  }
  const discountInputValue = discountMode === 'percent' ? discountPercentInput : discountAmountInput;
  const vatAmount = round2(((subtotal - discountAmount) * (Number(vatPercent) || 0)) / 100);
  const grandTotal = round2(subtotal - discountAmount + vatAmount);
  const selectedCategory = (categories ?? []).find((c) => c.id === categoryId) ?? null;
  const selectedAccountName = bankAccountId
    ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash'
    : 'Cash';

  const [showPartyPicker, setShowPartyPicker] = useState(false);
  // Lets a typo in a just-added (or existing) customer/vendor's name get
  // fixed right here - picking a different party is a totally different
  // action (the picker), and a customer created by mistyping a name
  // otherwise has no easy way back to fix it short of hunting it down in
  // Customers.
  const [showRenameParty, setShowRenameParty] = useState(false);
  const [renamePartyValue, setRenamePartyValue] = useState('');
  const [renamingParty, setRenamingParty] = useState(false);

  async function handleRenameParty() {
    if (!customerId || !renamePartyValue.trim()) return;
    setRenamingParty(true);
    try {
      await updateCustomer.mutateAsync({ id: customerId, values: { name: renamePartyValue.trim() } });
      setPartyName(renamePartyValue.trim());
      setShowRenameParty(false);
    } catch (err) {
      showAlert('Could not rename', getErrorMessage(err));
    } finally {
      setRenamingParty(false);
    }
  }

  function selectCustomer(c: Customer) {
    setPartyName(c.name);
    setCustomerId(c.id);
    setShowPartyPicker(false);
  }

  // A phone contact not saved yet is saved as a real customer now (so
  // picking them here actually adds them to the book and links customer_id).
  // A plain typed name with no phone used to just fill the free-text field
  // with no real customer behind it - harmless for Expense (party_name is
  // all it's ever needed), but a Sale/Purchase now requires a real
  // customer_id to save at all (0061_sale_purchase_always_ledger.sql), so
  // that left the "+ add new" flow looking broken: you'd type a name, it
  // seemed to "take", then Save would refuse with "Pick a customer". Create
  // a real customer here too when this is a bill, same as Quick Payment
  // already does.
  async function handleSelectPartyNew(name: string, phone: string | null, confirmName = false) {
    setShowPartyPicker(false);
    if (!phone && !isBill) {
      setPartyName(name);
      setCustomerId(null);
      return;
    }
    if (phone) {
      const existing = customers.find((c) => c.phone === phone);
      if (existing) {
        selectCustomer(existing);
        return;
      }
    }
    // A name typed in the box is checked first; one the picker's own step already confirmed is not asked again.
    let finalName = name;
    if (confirmName) {
      const checked = await askNewParty({ name, kind: newPartyKind });
      if (!checked) return;
      finalName = checked;
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name: finalName, phone });
      selectCustomer(created);
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  async function handleCreateCategory(name: string, group: 'direct' | 'indirect' = 'indirect') {
    const created = await createCategory.mutateAsync({ owner_id: userId, name, ...(group === 'direct' ? { expense_group: 'direct' } : {}) } as never);
    setCategoryId(created.id);
  }
  async function handleRenameCategory(id: string, name: string) {
    await updateCategory.mutateAsync({ id, values: { name } });
  }
  async function handleDeleteCategory(id: string) {
    await deleteCategory.mutateAsync(id);
    if (categoryId === id) setCategoryId(null);
  }

  function updateItem(index: number, next: ItemRowState) {
    setItems((prev) => prev.map((row, i) => (i === index ? next : row)));
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }
  function openItemPicker(index: number | null) {
    setEditingItemIndex(index);
    setShowItemPicker(true);
  }
  function handlePickProduct(p: Product) {
    const row: ItemRowState = { description: p.name, qty: '1', rate: Number(p.price) > 0 ? String(p.price) : '' };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
  }
  function handlePickFinanceItem(item: FinanceItem) {
    const row: ItemRowState = { description: item.name, qty: '1', rate: item.rate != null ? String(item.rate) : '' };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
  }
  // An item a bill names that isn't on the shelf yet becomes a real product
  // (the shelf is what the stock trigger moves - 0002_profiles_inventory.sql -
  // and a bill line only counts toward stock when its name matches a product).
  // It starts at 0: the trigger moves this bill's own quantity when the bill is
  // saved (a purchase adds it, a sale takes it off - so a new item sold before
  // it was ever bought shows a negative balance until stock is entered), and
  // seeding it with the quantity here would count it twice.
  // Resolves to why it failed, or null when the product was created or was
  // already there.
  async function createStockProduct(name: string, rate: string): Promise<string | null> {
    const amount = Number(rate) > 0 ? Number(rate) : 0;
    try {
      await createProduct.mutateAsync({
        owner_id: userId,
        name,
        // The rate on a sale is what it sells for; on a purchase, what it cost.
        price: type === 'sale' ? amount : 0,
        purchase_price: type === 'purchase' && amount > 0 ? amount : null,
        stock_level: 0,
      });
      return null;
    } catch (err) {
      const msg = getErrorMessage(err);
      // Already on the shelf under this name (the list was just out of date) -
      // the bill line matches it by name, so there is nothing left to do.
      return /duplicate key/i.test(msg) ? null : msg;
    }
  }
  async function addStockItem(name: string, rate: string) {
    const problem = await createStockProduct(name, rate);
    if (problem) showAlert('Added to this bill, but could not add it to your stock', problem);
  }

  // Save on the popup: the line takes the item (quantity 1 unless one was typed)
  // and the caret moves on to Qty; the item itself is created in the background.
  function saveNewStockItem(name: string, rate: string) {
    if (!addStockFor) return;
    const { index } = addStockFor;
    setAddStockFor(null);
    const row = items[index];
    if (row) updateItem(index, { ...row, description: name, qty: row.qty.trim() ? row.qty : '1', rate });
    setTimeout(() => itemsTableRef.current?.focusRow(index, 1), 80);
    void addStockItem(name, rate);
  }
  // Cancel: nothing is created and the line stays as typed, caret back in it.
  function cancelNewStockItem() {
    const index = addStockFor?.index;
    setAddStockFor(null);
    if (index != null) setTimeout(() => itemsTableRef.current?.focusRow(index, 0), 80);
  }

  // Typing a brand-new item used to only ever add it to this one bill's
  // line items, invisibly to the catalog - the next time "Pick from your
  // stock" opened, that same name wouldn't show up, since nothing was ever
  // saved anywhere. It is now added to the stock (above), on a sale as well as
  // a purchase.
  async function handlePickCustomItem(name: string, rate: string) {
    const row: ItemRowState = { description: name, qty: '1', rate: rate.trim() };
    if (editingItemIndex != null) updateItem(editingItemIndex, row);
    else setItems((prev) => [...prev, row]);
    setShowItemPicker(false);
    setEditingItemIndex(null);
    await addStockItem(name, rate);
  }

  async function handleSave() {
    if (saving) return;
    if (isBill) {
      const validItems = items.filter(isSavableItem);
      if (validItems.length === 0) {
        showAlert('Add at least one item', 'Enter a description and a quantity for at least one item. The rate can be left blank.');
        return;
      }
      // A bill with no rates yet (amount 0) is fine - it records the goods and
      // moves stock, and the amount can be filled in later by editing it. Only a
      // negative total (discount bigger than the items) is a mistake.
      if (grandTotal < 0) {
        showAlert('Check the total', 'The discount is more than the items add up to — check the discount and VAT.');
        return;
      }
      if (!customerId && !partyName.trim()) {
        showAlert(
          type === 'purchase' ? 'Pick a vendor' : 'Pick a customer',
          `Every ${type} books against a real ${type === 'purchase' ? 'vendor' : 'customer'}'s ledger now — tap the ${type === 'purchase' ? 'Vendor' : 'Customer'} field above and choose or add one.`
        );
        return;
      }
      const ok = await confirmSave({
        title: `${initial ? 'Save changes to this' : 'Save this'} ${TYPE_META[type].label.toLowerCase()}?`,
        rows: [
          { label: type === 'purchase' ? 'Vendor' : 'Customer', value: partyName.trim() },
          { label: 'Items', value: String(validItems.length) },
          ...(billNo.trim() ? [{ label: 'Bill no.', value: billNo.trim() }] : []),
          ...(discountAmount > 0 ? [{ label: 'Discount', value: `− NPR ${formatMoney(discountAmount)}` }] : []),
          ...(vatAmount > 0 ? [{ label: 'VAT', value: `+ NPR ${formatMoney(vatAmount)}` }] : []),
        ],
        total: { label: 'Grand total', value: `NPR ${formatMoney(grandTotal)}`, color: TYPE_META[type].color },
      });
      if (!ok) return;
      setSaving(true);
      try {
        // A name typed in full without picking it from the list still means
        // the saved party of that name - and a brand-new name is saved as a
        // new customer/vendor on the spot, same as Quick Payment does.
        let resolvedCustomerId = customerId;
        let savedPartyName = partyName;
        if (!resolvedCustomerId) {
          const typed = partyName.trim();
          const existing = customers.find((c) => c.name.trim().toLowerCase() === typed.toLowerCase());
          if (existing) {
            resolvedCustomerId = existing.id;
          } else {
            const finalName = await askNewParty({ name: typed, kind: newPartyKind });
            if (!finalName) return;
            const created = await createCustomer.mutateAsync({ owner_id: userId, name: finalName, phone: null });
            resolvedCustomerId = created.id;
            savedPartyName = created.name;
            setPartyName(created.name);
          }
          setCustomerId(resolvedCustomerId);
        }
        // Every item the bill names becomes a real product before the bill is
        // saved, so the stock trigger can move it (it matches products by name,
        // and an item typed straight into a line - not picked, not added through
        // the popup - has none yet). Otherwise it would sit in Inventory as a
        // "Bills only" estimate. A failure here doesn't block the bill.
        const known = new Set(products.map((p) => p.name.trim().toLowerCase()));
        for (const r of validItems) {
          const name = r.description.trim();
          if (!name || known.has(name.toLowerCase())) continue;
          known.add(name.toLowerCase());
          await createStockProduct(name, r.rate);
        }
        // A purchase's rate is what the item cost. A product first bought with no rate has no cost price,
        // so its stock value stays blank - the first rate a purchase bill gives it becomes its cost price.
        // A failure here doesn't block the bill either.
        if (type === 'purchase') {
          const costless = new Map(products.filter((p) => p.purchase_price == null).map((p) => [p.name.trim().toLowerCase(), p]));
          for (const r of validItems) {
            const key = r.description.trim().toLowerCase();
            const product = costless.get(key);
            if (!product || !(Number(r.rate) > 0)) continue;
            costless.delete(key);
            try {
              await updateProduct.mutateAsync({ id: product.id, values: { purchase_price: Number(r.rate) } });
            } catch {
              // the bill itself still saves
            }
          }
        }
        const values = {
          type,
          amount: grandTotal,
          party_name: tidyName(savedPartyName.trim()) || null,
          customer_id: resolvedCustomerId,
          note: note.trim() || null,
          bill_no: billNo.trim() || null,
          bill_date: billDate || null,
          items: validItems.map((r) => ({
            ...(r.hs_code?.trim() ? { hs_code: r.hs_code.trim() } : {}),
            ...(r.model?.trim() ? { model: r.model.trim() } : {}),
            description: r.description.trim(),
            qty: Number(r.qty),
            rate: Number(r.rate),
            amount: round2(Number(r.qty) * Number(r.rate)),
          })),
          discount_amount: round2(discountAmount),
          vat_amount: vatAmount,
          // A new bill is saved as cash. Editing one keeps the method it already has - that is changed
          // from the bill's card (tap Payment Method) - instead of putting it back to cash on every save.
          payment_mode: initial?.payment_mode ?? ('cash' as const),
          bank_account_id: initial?.bank_account_id ?? null,
        };
        if (initial) {
          await updateTx.mutateAsync({ id: initial.id, values });
        } else {
          await createTx.mutateAsync({ owner_id: userId, ...values });
        }
        onDone();
      } catch (err) {
        showAlert('Could not save', getErrorMessage(err));
      } finally {
        setSaving(false);
      }
      return;
    }

    const value = round2(Number(amount));
    if (!amount.trim() || Number.isNaN(value) || value <= 0) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    const ok = await confirmSave({
      title: `${initial ? 'Save changes to this' : 'Save this'} expense?`,
      rows: [
        ...(partyName.trim() ? [{ label: 'Paid to', value: partyName.trim() }] : []),
        ...(selectedCategory ? [{ label: 'Category', value: selectedCategory.name }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Amount', value: `NPR ${formatMoney(value)}`, color: TYPE_META.expense.color },
    });
    if (!ok) return;
    setSaving(true);
    try {
      const values = {
        type,
        amount: value,
        party_name: tidyName(partyName.trim()) || null,
        customer_id: customerId,
        note: note.trim() || null,
        bill_date: expenseDate || null,
        expense_category_id: categoryId,
        payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const),
        bank_account_id: bankAccountId,
      };
      if (initial) {
        await updateTx.mutateAsync({ id: initial.id, values });
      } else {
        await createTx.mutateAsync({ owner_id: userId, ...values });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Applies whatever the voice-command button understood (voicePrefill is
  // only ever passed on a brand-new entry, never while editing - see the
  // TransactionsScreen caller). Same "review before save" rule as Scan
  // Bill: this only fills fields, it never saves on its own, and the party
  // still needs an explicit tap to confirm via the picker it opens. Depends
  // on voicePrefill itself (memoized by the caller on the actual param
  // values) rather than firing once on mount, since those params aren't
  // always hydrated yet on a freshly-pushed route's first render.
  useEffect(() => {
    if (!voicePrefill) return;
    if (voicePrefill.note) setNote(voicePrefill.note);
    if (voicePrefill.date) {
      if (isBill) setBillDate(voicePrefill.date);
      else setExpenseDate(voicePrefill.date);
    }
    if (voicePrefill.party) {
      setPartyPickerQuery(voicePrefill.party);
      setShowPartyPicker(true);
    }
    if (isBill && voicePrefill.amount) {
      const label = voicePrefill.party
        ? `${type === 'purchase' ? 'Purchase from' : 'Sale to'} ${voicePrefill.party}`
        : 'Voice entry';
      setItems((prev) => [...prev, { description: label, qty: '1', rate: voicePrefill.amount! }]);
    } else if (!isBill && voicePrefill.amount) {
      setAmount(voicePrefill.amount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voicePrefill]);

  // Starts a new bill with the party it was opened for. The customer list can
  // still be loading on the first render, so this waits for it - and runs once,
  // so choosing someone else afterwards is never undone.
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current || !presetPartyId || initial || !isBill) return;
    const party = customers.find((c) => c.id === presetPartyId);
    if (!party) return;
    presetApplied.current = true;
    setPartyName(party.name);
    setCustomerId(party.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPartyId, customers]);

  // Fills in whatever Scan Bill could read off the photo; the reseller still
  // reviews and can edit every field afterward, and still has to actually
  // tap-confirm the party (see partyPickerQuery above) since a misread name
  // should never silently become a wrong customer/vendor.
  async function handleScan() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;

    if (scanned.note) setNote(scanned.note);
    if (scanned.vendor_name) {
      setPartyPickerQuery(scanned.vendor_name);
      setShowPartyPicker(true);
    }

    if (isBill) {
      if (scanned.bill_no) setBillNo(scanned.bill_no);
      if (scanned.date) setBillDate(scanned.date);
      if (scanned.items.length > 0) {
        setItems((prev) => [
          ...prev,
          ...scanned.items.map((i) => ({ description: i.description, qty: String(i.qty), rate: String(i.rate) })),
        ]);
        if (scanned.discount_amount) {
          setDiscountMode('amount');
          setDiscountAmountInput(String(scanned.discount_amount));
          setShowDiscount(true);
        }
        if (scanned.vat_amount) {
          const scannedSubtotal = scanned.items.reduce((s, i) => s + i.qty * i.rate, 0) - (scanned.discount_amount ?? 0);
          if (scannedSubtotal > 0) {
            setVatPercent(String(Math.round((scanned.vat_amount / scannedSubtotal) * 10000) / 100));
            setShowVat(true);
          }
        }
      } else if (scanned.amount) {
        // No itemized list on the bill (e.g. a simple slip) - one line for
        // the whole amount, rather than leaving items empty and blocking
        // Save (a bill always needs at least one item).
        setItems((prev) => [
          ...prev,
          { description: scanned.vendor_name ? `Bill from ${scanned.vendor_name}` : 'Scanned bill', qty: '1', rate: String(scanned.amount) },
        ]);
      }
    } else {
      if (scanned.amount) setAmount(String(scanned.amount));
      if (scanned.date) setExpenseDate(scanned.date);
    }
  }

  // Web-only multi-expense table (new entries only - editing an existing
  // expense, `initial` set, stays the single-entry form below regardless of
  // platform). Purely additive: the single-entry amount/partyName/categoryId
  // state and handleSave above are untouched and still drive every other
  // path (native, sale/purchase, and editing).
  // Editing an expense is the same table page as adding one, with just its one row.
  const editingExpense = !!initial && initial.type === 'expense';
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>(() =>
    initial && initial.type === 'expense'
      ? [
          {
            key: makeExpenseRowKey(),
            partyName: initial.party_name ?? '',
            customerId: initial.customer_id,
            categoryId: initial.expense_category_id,
            amount: String(initial.amount),
            note: initial.note ?? '',
          },
        ]
      : [emptyExpenseRow()]
  );
  const [activePartyRowKey, setActivePartyRowKey] = useState<string | null>(null);
  const [activeCategoryRowKey, setActiveCategoryRowKey] = useState<string | null>(null);
  const [expenseRowPickerQuery, setExpenseRowPickerQuery] = useState('');
  const expenseRowsTotal = expenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  function addExpenseRow() {
    setExpenseRows((prev) => [...prev, emptyExpenseRow()]);
  }

  function removeExpenseRow(key: string) {
    setExpenseRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function updateExpenseRow(key: string, patch: Partial<ExpenseRow>) {
    setExpenseRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function selectPartyForExpenseRow(c: Customer) {
    if (activePartyRowKey) updateExpenseRow(activePartyRowKey, { partyName: c.name, customerId: c.id });
    setActivePartyRowKey(null);
  }

  // Same "a plain typed name with no phone just fills party_name, a phone
  // number links or creates a real customer" behavior as handleSelectPartyNew
  // above (expense never requires a real customer_id, unlike a bill).
  async function handleSelectNewPartyForExpenseRow(name: string, phone: string | null) {
    const key = activePartyRowKey;
    setActivePartyRowKey(null);
    if (key) await attachContactToExpenseRow(key, name, phone);
  }

  async function attachContactToExpenseRow(key: string, name: string, phone: string | null) {
    if (!phone) {
      updateExpenseRow(key, { partyName: name, customerId: null });
      return;
    }
    const existing = customers.find((c) => c.phone === phone);
    if (existing) {
      updateExpenseRow(key, { partyName: existing.name, customerId: existing.id });
      return;
    }
    try {
      const created = await createCustomer.mutateAsync({ owner_id: userId, name, phone });
      updateExpenseRow(key, { partyName: created.name, customerId: created.id });
    } catch (err) {
      showAlert('Could not add customer', getErrorMessage(err));
    }
  }

  function selectCategoryForRow(id: string) {
    const key = activeCategoryRowKey;
    if (key) {
      updateExpenseRow(key, { categoryId: id });
      // Once the list has closed - keep typing from the Amount cell.
      setTimeout(() => expenseTableRef.current?.focusRow(key, 2), 80);
    }
    setActiveCategoryRowKey(null);
  }

  // Scanning a bill in the multi-expense table adds a fresh row for it
  // instead of overwriting whichever row is already being edited.
  async function handleScanForExpenseRow() {
    phoneContacts.request();
    const scanned = await pickAndScan();
    if (!scanned) return;
    // Editing: the scan fills the one row. Adding: it becomes a fresh row.
    const key = editingExpense ? expenseRows[0].key : makeExpenseRowKey();
    const fromScan = {
      partyName: scanned.vendor_name ?? '',
      customerId: null,
      categoryId: null,
      amount: scanned.amount ? String(scanned.amount) : '',
      note: scanned.note ?? '',
    };
    setExpenseRows((prev) => (editingExpense ? [{ ...prev[0], ...fromScan, categoryId: prev[0].categoryId }] : [...prev, { key, ...fromScan }]));
    if (scanned.date) setExpenseDate(scanned.date);
    if (scanned.vendor_name) {
      setExpenseRowPickerQuery(scanned.vendor_name);
      setActivePartyRowKey(key);
    }
  }

  async function handleSaveAllExpenses() {
    if (editingExpense && initial) {
      const row = expenseRows[0];
      const value = round2(Number(row.amount));
      if (!row.amount.trim() || !Number.isFinite(value) || value <= 0) {
        showAlert('Enter an amount', 'Add a valid amount in NPR.');
        return;
      }
      const categoryName = (categories ?? []).find((c) => c.id === row.categoryId)?.name;
      const ok = await confirmSave({
        title: 'Save changes to this expense?',
        rows: [
          ...(row.partyName.trim() ? [{ label: 'Paid to', value: row.partyName.trim() }] : []),
          ...(categoryName ? [{ label: 'Category', value: categoryName }] : []),
          { label: 'Paid via', value: selectedAccountName },
        ],
        total: { label: 'Amount', value: `NPR ${formatMoney(value)}`, color: TYPE_META.expense.color },
      });
      if (!ok) return;
      setSaving(true);
      try {
        await updateTx.mutateAsync({
          id: initial.id,
          values: {
            type,
            amount: value,
            party_name: tidyName(row.partyName.trim()) || null,
            customer_id: row.customerId,
            note: row.note.trim() || null,
            bill_date: expenseDate || null,
            expense_category_id: row.categoryId,
            payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const),
            bank_account_id: bankAccountId,
          },
        });
        onDone();
      } catch (err) {
        showAlert('Could not save', getErrorMessage(err));
      } finally {
        setSaving(false);
      }
      return;
    }
    const validRows = expenseRows.filter((r) => Number(r.amount) > 0);
    if (validRows.length === 0) {
      showAlert('Add an expense', 'Add at least one expense with a valid amount.');
      return;
    }
    const sum = validRows.reduce((s, r) => s + Number(r.amount), 0);
    const ok = await confirmSave({
      title: `Save ${validRows.length === 1 ? 'this' : `these ${validRows.length}`} expense${validRows.length === 1 ? '' : 's'}?`,
      rows: [
        ...validRows.slice(0, 5).map((r) => {
          const cat = (categories ?? []).find((c) => c.id === r.categoryId)?.name;
          return { label: `${r.partyName.trim() || 'Expenses'}${cat ? ' · ' + cat : ''}`, value: `NPR ${formatMoney(Number(r.amount))}` };
        }),
        ...(validRows.length > 5 ? [{ label: `+ ${validRows.length - 5} more` }] : []),
        { label: 'Paid via', value: selectedAccountName },
      ],
      total: { label: 'Total', value: `NPR ${formatMoney(sum)}`, color: TYPE_META.expense.color },
    });
    if (!ok) return;
    setSaving(true);
    try {
      for (const row of validRows) {
        await createTx.mutateAsync({
          owner_id: userId,
          type: 'expense',
          amount: round2(Number(row.amount)),
          party_name: tidyName(row.partyName.trim()) || null,
          customer_id: row.customerId,
          note: row.note.trim() || null,
          bill_date: expenseDate || null,
          expense_category_id: row.categoryId,
          payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const),
          bank_account_id: bankAccountId,
        });
        // Drop each row once saved, so a failure part-way leaves only the
        // unsaved ones - saving again never records an expense twice.
        setExpenseRows((prev) => {
          const rest = prev.filter((r) => r.key !== row.key);
          return rest.length ? rest : [emptyExpenseRow()];
        });
      }
      onDone();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Web Sale/Purchase form only: refs for the keyboard walk between fields,
  // the vendor typeahead, and an always-present blank last item row (typing
  // into it adds the next one, so there is never an "Add item" to reach for).
  const vendorRef = useRef<TextInput | null>(null);
  const billNoRef = useRef<TextInput>(null);
  const billDateRef = useRef<TextInput>(null);
  const discountRef = useRef<TextInput>(null);
  const vatRef = useRef<TextInput>(null);
  const remarkRef = useRef<TextInput>(null);
  const saveButtonRef = useRef<View>(null);
  const expenseTableRef = useRef<ExpenseEntryTableHandle>(null);
  const methodRef = useRef<HTMLSelectElement | null>(null);
  const itemsTableRef = useRef<BillItemsTableHandle>(null);
  const [vendorFocused, setVendorFocused] = useState(false);

  const vendorSuggestions = useMemo<CustomerSuggestion[]>(() => {
    if (!vendorFocused || !isBill) return [];
    const q = partyName.trim();
    if (!q) return [];
    if (customerId && customers.find((c) => c.id === customerId)?.name === partyName) return [];
    return buildCustomerSuggestions(customers, phoneContacts.contacts, q, 6);
  }, [vendorFocused, isBill, partyName, customerId, customers, phoneContacts.contacts]);

  const vendorOptions = useMemo<SuggestOption[]>(() => {
    const options: SuggestOption[] = vendorSuggestions.map((s) => ({
      key: s.key,
      label: s.name,
      hint: s.customer ? s.phone : 'From contacts',
    }));
    // Nobody saved goes by what was typed: offer to add them right here, like the stock item box does.
    const typed = partyName.trim();
    const linkedExact = !!customerId && customers.find((c) => c.id === customerId)?.name === partyName;
    if (vendorFocused && isBill && typed && !linkedExact && !customers.some((c) => c.name.trim().toLowerCase() === typed.toLowerCase())) {
      options.push({ key: ADD_PARTY_KEY, label: `Add "${typed}" as new ${type === 'purchase' ? 'vendor' : 'customer'}`, kind: 'add' });
    }
    return options;
  }, [vendorSuggestions, vendorFocused, isBill, partyName, customerId, customers, type]);

  useEffect(() => {
    if (!desktopWeb || !isBill) return;
    const last = items[items.length - 1];
    if (!last || last.description.trim() || last.qty.trim() || last.rate.trim() || last.hs_code?.trim() || last.model?.trim()) {
      setItems((prev) => [...prev, { description: '', qty: '', rate: '' }]);
    }
  }, [items, isBill, desktopWeb]);

  // On web the form's name and its Scan Bill button live in the top bar; the
  // heading row that used to repeat the name under it is gone.
  const newExpenses = type === 'expense' && !initial;
  // The expense table page - the same one for adding and for editing.
  const expenseTable = desktopWeb && type === 'expense';
  const scanRef = useRef<() => void>(() => {});
  scanRef.current = expenseTable ? handleScanForExpenseRow : handleScan;
  useScreenHeader(
    desktopWeb
      ? {
          title: newExpenses ? 'Expenses' : `${initial ? 'Edit' : 'New'} ${TYPE_META[type].label}`,
          resetTitle: 'Statement',
          headerRight: () => (
            <Pressable
              onPress={() => scanRef.current()}
              disabled={scanning}
              className="h-9 flex-row items-center justify-center rounded-lg border border-blue-600 bg-blue-50 px-3.5 disabled:opacity-50"
              style={{ gap: 6 }}
            >
              <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={15} color="#2563EB" />
              <Text className="text-[13px] font-semibold text-blue-700">{scanning ? 'Reading…' : 'Scan Bill'}</Text>
            </Pressable>
          ),
        }
      : {},
    [type, initial?.id, scanning]
  );

  if (expenseTable) {
    const accent = FINANCE_ENTRY_ACCENT;
    return (
      <View className="mb-4">
        <View className="mb-4 flex-row" style={{ gap: 24 }}>
          <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
            {/* Date and Payment method apply to every row in the table below -
                one voucher covering several expenses, the same shape as
                Received. Tab/Enter walk Date -> Payment method -> the table,
                and Ctrl+Enter saves from anywhere. */}
            <View
              className="mb-4 rounded-2xl border border-gray-200 bg-white px-5 py-4"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)' }}
            >
              <View className="mb-3 flex-row items-center gap-2">
                <Ionicons name="document-text-outline" size={14} color="#6B7280" />
                <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">Details</Text>
              </View>
              <View className="flex-row" style={{ gap: 14 }}>
                <View style={{ flex: 1.3, minWidth: 0 }}>
                  <Text className="mb-1.5 text-xs font-semibold text-gray-600">Date</Text>
                  <KeyboardDateInput
                    value={expenseDate}
                    onChange={setExpenseDate}
                    autoFocus
                    accent={accent}
                    onEnter={() => methodRef.current?.focus()}
                    onRequestSave={handleSaveAllExpenses}
                  />
                </View>
                <View style={{ flex: 1.1, minWidth: 0 }}>
                  <Text className="mb-1.5 text-xs font-semibold text-gray-600">Payment method</Text>
                  <KeyboardSelect
                    value={bankAccountId ?? '__cash__'}
                    options={[
                      { value: '__cash__', label: 'Cash' },
                      ...bankAccounts.accounts.map((a) => ({ value: a.id, label: optionLabel(a.name, available?.byId[a.id]) })),
                    ]}
                    onChange={(v) => setBankAccountId(v === '__cash__' ? null : v)}
                    selectRef={(el) => {
                      methodRef.current = el;
                    }}
                    onEnter={() => expenseTableRef.current?.focusRow(expenseRows[0].key, 0)}
                    onRequestSave={handleSaveAllExpenses}
                    accent={accent}
                    label="Payment method"
                  />
                </View>
              </View>
            </View>

            <ExpenseEntryTable
              ref={expenseTableRef}
              rows={expenseRows}
              customers={customers}
              phoneContacts={phoneContacts.contacts}
              categories={categories ?? []}
              accent={accent}
              totalColor={TYPE_META.expense.color}
              single={editingExpense}
              onUpdateRow={updateExpenseRow}
              onCreateParty={async (name) => {
                try {
                  const finalName = await askNewParty({ name: tidyName(name), kind: 'payee' });
                  if (!finalName) return null;
                  return await createCustomer.mutateAsync({ owner_id: userId, name: finalName, phone: null });
                } catch (err) {
                  showAlert('Could not add vendor', getErrorMessage(err));
                  return null;
                }
              }}
              onAddRow={() => {
                const row = emptyExpenseRow();
                setExpenseRows((prev) => [...prev, row]);
                return row.key;
              }}
              onRemoveRow={removeExpenseRow}
              onPickCategory={setActiveCategoryRowKey}
              onSelectContact={attachContactToExpenseRow}
              onRequestSave={handleSaveAllExpenses}
              onExit={() => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.()}
            />

            <View className="mt-4 flex-row items-center justify-end" style={{ gap: 16 }}>
              <View className="flex-row" style={{ gap: 10 }}>
                <Pressable onPress={onCancel} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  ref={saveButtonRef}
                  onPress={handleSaveAllExpenses}
                  disabled={saving}
                  className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
                  style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${FINANCE_ENTRY_SHADOW}` }}
                >
                  <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={{ width: 320 }}>
            <RecentEntriesCard userId={userId} type="expense" color={FINANCE_ENTRY_ACCENT} activeId={initial?.id} onOpen={onOpenRecent} />
          </View>
        </View>

        {confirmDialog}

        {newPartyDialog}

        <ContactPickerModal
          visible={activePartyRowKey != null}
          initialQuery={expenseRowPickerQuery}
          customers={customers}
          phoneContacts={phoneContacts.contacts}
          onSelectCustomer={selectPartyForExpenseRow}
          onSelectNew={handleSelectNewPartyForExpenseRow}
          onClose={() => setActivePartyRowKey(null)}
        />
        <CategoryPickerModal
          visible={activeCategoryRowKey != null}
          categories={categories ?? []}
          selectedId={activeCategoryRowKey ? expenseRows.find((r) => r.key === activeCategoryRowKey)?.categoryId ?? null : null}
          onSelect={selectCategoryForRow}
          onClose={() => setActiveCategoryRowKey(null)}
          onCreate={handleCreateCategory}
          onRename={handleRenameCategory}
          onDelete={handleDeleteCategory}
        />
      </View>
    );
  }

  // Web bill layout (Sale/Purchase): unlike Payment/Expense, a bill always
  // belongs to exactly one party and already has its own per-item table, so
  // this isn't a multi-party batch - it's the same single bill, just laid
  // out in the same "top fields, main table, live summary, Save/Cancel
  // below" shape as the rest of the redesigned web forms. Applies to
  // editing an existing bill too (unlike Expense's new-only table), since
  // it's still one bill either way. All state/handlers below are the exact
  // same ones the original single-column return further down uses -
  // nothing here is a separate calculation.
  if (desktopWeb && isBill) {
    const accent = FINANCE_ENTRY_ACCENT;
    const accentShadow = FINANCE_ENTRY_SHADOW;
    const partyLabel = type === 'purchase' ? 'Vendor' : 'Customer';

    return (
      <View className="mb-4">
        <View className="mb-4 flex-row" style={{ gap: 24 }}>
          <View className="flex-1" style={{ minWidth: 0, maxWidth: 1500 }}>
            {/* Vendor, bill number and date share one row - everything that
                identifies the bill - and the whole form is keyboard-driven:
                Tab/Enter walk Vendor -> Bill No. -> Date -> Items -> Discount
                -> VAT -> Remark -> Save, Ctrl+Enter saves from anywhere. */}
            <View
              className="mb-4 rounded-2xl border border-gray-200 bg-white px-5 py-4"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)', zIndex: 20 }}
            >
              <View className="flex-row" style={{ gap: 14 }}>
                <View style={{ flex: 1.7, minWidth: 0 }}>
                  <View className="mb-1.5 flex-row items-center justify-between">
                    <Text className="text-[11px] font-semibold text-gray-600">{partyLabel}</Text>
                    {!!customerId && (
                      <Pressable
                        onPress={() => {
                          setRenamePartyValue(partyName);
                          setShowRenameParty(true);
                        }}
                        tabIndex={-1}
                        hitSlop={8}
                        accessibilityLabel={`Rename ${partyLabel.toLowerCase()}`}
                      >
                        <Ionicons name="pencil-outline" size={13} color="#9CA3AF" />
                      </Pressable>
                    )}
                  </View>
                  <SuggestInput
                    value={partyName}
                    onChangeText={(v) => {
                      setPartyName(v);
                      if (customerId) {
                        const linked = customers.find((c) => c.id === customerId);
                        if (!linked || linked.name !== v) setCustomerId(null);
                      }
                    }}
                    options={vendorOptions}
                    onSelectOption={async (opt, via) => {
                      if (opt.key === ADD_PARTY_KEY) {
                        if (via !== 'tab') billNoRef.current?.focus();
                        await handleSelectPartyNew(tidyName(partyName.trim()), null, true);
                        return;
                      }
                      const s = vendorSuggestions.find((x) => x.key === opt.key);
                      if (!s) return;
                      if (via !== 'tab') billNoRef.current?.focus();
                      if (s.customer) {
                        setPartyName(s.name);
                        setCustomerId(s.customer.id);
                      } else {
                        await handleSelectPartyNew(s.name, s.phone);
                      }
                    }}
                    inputRef={(el) => {
                      vendorRef.current = el;
                    }}
                    onFocus={() => setVendorFocused(true)}
                    onBlur={() => setVendorFocused(false)}
                    onKeyPress={(e) => {
                      const k = readKey(e);
                      if (k.key !== 'Enter') return;
                      k.prevent();
                      if (k.ctrl) handleSave();
                      else billNoRef.current?.focus();
                    }}
                    placeholder={type === 'purchase' ? 'Vendor / supplier name' : 'Customer name'}
                    accessibilityLabel={partyLabel}
                    accent={accent}
                    compact
                    inputClassName="rounded-lg px-3 py-2.5 text-xs font-semibold text-gray-900"
                    inputStyle={[
                      { borderWidth: 1, borderColor: vendorFocused ? accent : '#D1D5DB', backgroundColor: '#FFFFFF' },
                      vendorFocused ? { boxShadow: `0 0 0 3px ${accent}29` } : null,
                      { outlineStyle: 'none' } as object,
                    ]}
                    adornmentWidth={54}
                    adornment={
                      customerId ? (
                        <Ionicons name="checkmark-circle" size={16} color={accent} />
                      ) : partyName.trim() ? (
                        <Text className="text-[10px] font-bold capitalize text-gray-400">New</Text>
                      ) : null
                    }
                  />
                </View>
                <View style={{ flex: 0.8, minWidth: 0 }}>
                  <Text className="mb-1.5 text-[11px] font-semibold text-gray-600">Bill No.</Text>
                  <KeyInput
                    value={billNo}
                    onChangeText={setBillNo}
                    inputRef={billNoRef}
                    onEnter={() => itemsTableRef.current?.focusRow(0)}
                    onRequestSave={handleSave}
                    accent={accent}
                    placeholder="e.g. 0234"
                    accessibilityLabel="Bill number"
                    className="rounded-lg px-3 py-2.5 text-xs font-semibold text-gray-900"
                  />
                </View>
                <View style={{ flex: 1.1, minWidth: 0 }}>
                  <Text className="mb-1.5 text-[11px] font-semibold text-gray-600">Bill date</Text>
                  <KeyboardDateInput
                    value={billDate}
                    onChange={setBillDate}
                    inputRef={billDateRef}
                    accent={accent}
                    autoFocus={!initial}
                    onEnter={() => vendorRef.current?.focus()}
                    onRequestSave={handleSave}
                    compact
                  />
                </View>
              </View>
              {showRenameParty && (
                <RenamePartyPopup
                  title={`Edit ${partyLabel.toLowerCase()}`}
                  value={renamePartyValue}
                  onChange={setRenamePartyValue}
                  onSave={handleRenameParty}
                  onClose={() => setShowRenameParty(false)}
                  saving={renamingParty}
                />
              )}
            </View>

            <BillItemsTable
              ref={itemsTableRef}
              items={items}
              products={products}
              financeItems={financeItems ?? []}
              accent={accent}
              onUpdate={updateItem}
              onRemove={removeItem}
              onRequestSave={handleSave}
              withModel={withModel}
              onAddStockItem={(name, rate, index) => setAddStockFor({ index, name, rate })}
              onExit={() => discountRef.current?.focus()}
              footer={
                <>
                <View
                  className="flex-row flex-wrap border-t border-gray-200 bg-gray-50 px-5 py-4"
                  style={{ columnGap: 28, rowGap: 14, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
                >
                  <View style={{ flex: 1, minWidth: 240 }}>
                    <Text className="mb-1.5 text-[11px] font-semibold text-gray-600">Remarks</Text>
                    <KeyInput
                      value={note}
                      onChangeText={setNote}
                      inputRef={remarkRef}
                      onEnter={() => (saveButtonRef.current as unknown as { focus?: () => void } | null)?.focus?.()}
                      onRequestSave={handleSave}
                      accent={accent}
                      placeholder="Optional"
                      accessibilityLabel="Remarks"
                      className="rounded-lg px-3 py-2.5 text-xs text-gray-900"
                    />
                  </View>

                  <View style={{ width: 320 }}>
                    <View className="flex-row items-center justify-between py-1.5">
                      <Text className="text-xs text-gray-500">Subtotal</Text>
                      <Text className="text-xs font-semibold text-gray-700">NPR {formatMoney(subtotal)}</Text>
                    </View>
                    <View className="flex-row items-center justify-between py-1">
                      <Text className="text-xs text-gray-500">{discountMode === 'percent' ? 'Discount (%)' : 'Discount (Rs)'}</Text>
                      <View className="flex-row items-center" style={{ gap: 8 }}>
                        <View style={{ width: 84 }}>
                          <KeyInput
                            value={discountInputValue}
                            onChangeText={(v) => {
                              if (discountMode === 'percent') setDiscountPercentInput(Number(v) > 100 ? '100' : v);
                              else setDiscountAmountInput(v);
                            }}
                            onKey={(k) => {
                              if (k.ctrl || k.alt) return;
                              const unit = k.key === '%' ? 'percent' : ['r', 'R', 'n', 'N'].includes(k.key) ? 'amount' : null;
                              if (!unit) return;
                              k.prevent();
                              setDiscountUnit(unit);
                              // The converted number comes up selected, so typing replaces it.
                              setTimeout(() => (discountRef.current as unknown as HTMLInputElement | null)?.select?.(), 0);
                            }}
                            inputRef={discountRef}
                            onEnter={() => (showVat ? vatRef : remarkRef).current?.focus()}
                            onRequestSave={handleSave}
                            accent={accent}
                            numeric
                            align="right"
                            placeholder="0"
                            accessibilityLabel={discountMode === 'percent' ? 'Discount percent' : 'Discount in NPR'}
                            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-900"
                          />
                        </View>
                        <View
                          className="flex-row overflow-hidden rounded-md border border-gray-300 bg-white"
                          style={{ width: 42 }}
                          accessibilityLabel="Discount unit: percent or rupees (press % or R in the box)"
                        >
                          {(
                            [
                              ['percent', '%'],
                              ['amount', 'Rs'],
                            ] as const
                          ).map(([unit, label]) => {
                            const on = discountMode === unit;
                            return (
                              <Pressable
                                key={unit}
                                onPress={() => setDiscountUnit(unit)}
                                tabIndex={-1}
                                className="flex-1 items-center py-0.5"
                                style={{ backgroundColor: on ? accent : 'transparent' }}
                              >
                                <Text className="text-[10px] font-bold" style={{ color: on ? '#fff' : '#6B7280' }}>
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text className="text-right text-xs font-semibold text-gray-700" style={{ width: 70 }}>
                          − {formatMoney(discountAmount)}
                        </Text>
                      </View>
                    </View>
                    {showVat ? (
                      <View className="flex-row items-center justify-between py-1">
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                          <Text className="text-xs text-gray-500">VAT (%)</Text>
                          <Pressable
                            onPress={() => {
                              setShowVat(false);
                              setVatPercent('0');
                            }}
                            tabIndex={-1}
                            hitSlop={6}
                            accessibilityLabel="Remove VAT"
                          >
                            <Ionicons name="close-circle" size={14} color="#9CA3AF" />
                          </Pressable>
                        </View>
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                          <View style={{ width: 84 }}>
                            <KeyInput
                              value={vatPercent}
                              onChangeText={setVatPercent}
                              inputRef={vatRef}
                              onEnter={() => remarkRef.current?.focus()}
                              onRequestSave={handleSave}
                              accent={accent}
                              numeric
                              align="right"
                              accessibilityLabel="VAT percent"
                              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-900"
                            />
                          </View>
                          <Pressable
                            onPress={() => setVatPercent('13')}
                            tabIndex={-1}
                            className="items-center rounded-md border border-gray-300 bg-white px-1.5 py-0.5"
                            style={{ width: 42 }}
                            accessibilityLabel="Use standard 13 percent VAT"
                          >
                            <Text className="text-[10px] font-semibold text-gray-500">13%</Text>
                          </Pressable>
                          <Text className="text-right text-xs font-semibold text-gray-700" style={{ width: 70 }}>
                            + {formatMoney(vatAmount)}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      // VAT is optional: a bill saves without it, and adding it starts
                      // at Nepal's standard 13%, which can be typed over.
                      <Pressable
                        onPress={() => {
                          setShowVat(true);
                          setVatPercent((v) => (!v.trim() || Number(v) === 0 ? '13' : v));
                          setTimeout(() => vatRef.current?.focus(), 50);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Add VAT"
                        className="flex-row items-center self-start py-1"
                        style={{ gap: 5 }}
                      >
                        <Ionicons name="add-circle" size={14} color={accent} />
                        <Text className="text-xs font-semibold" style={{ color: accent }}>
                          Add VAT
                        </Text>
                      </Pressable>
                    )}
                    <View className="mt-2 flex-row items-center justify-between border-t border-gray-300 pt-2.5">
                      <Text className="text-xs font-bold text-gray-900">G. Total</Text>
                      <Text className="text-lg font-extrabold" style={{ color: TYPE_META[type].color }}>
                        NPR {formatMoney(grandTotal)}
                      </Text>
                    </View>
                  </View>
                </View>
                </>
              }
            />

            <View className="mt-4 flex-row flex-wrap items-center justify-end" style={{ gap: 16 }}>
              <View className="flex-row" style={{ gap: 10 }}>
                <Pressable onPress={onCancel} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
                  <Text className="text-xs font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  ref={saveButtonRef}
                  onPress={handleSave}
                  disabled={saving}
                  className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
                  style={{ backgroundColor: accent, boxShadow: `0 2px 6px ${accentShadow}` }}
                >
                  <Text className="text-xs font-bold text-white">{saving ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={{ width: 300 }}>
            <RecentEntriesCard
              userId={userId}
              type={type}
              color={TYPE_META[type].color}
              activeId={initial?.id}
              onOpen={onOpenRecent}
            />
          </View>
        </View>

        {confirmDialog}

        {newPartyDialog}

        {addStockFor && (
          <AddStockItemDialog
            sale={type === 'sale'}
            initialName={addStockFor.name}
            initialRate={addStockFor.rate}
            onSave={saveNewStockItem}
            onCancel={cancelNewStockItem}
          />
        )}

        <ContactPickerModal
          visible={showPartyPicker}
          initialQuery={partyPickerQuery}
          customers={customers}
          phoneContacts={phoneContacts.contacts}
          onSelectCustomer={selectCustomer}
          onSelectNew={handleSelectPartyNew}
          onClose={() => setShowPartyPicker(false)}
        />
      </View>
    );
  }

  return (
    <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <Pressable
        onPress={handleScan}
        disabled={scanning}
        className="mb-3 flex-row items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-50 py-2.5 disabled:opacity-50"
      >
        <Ionicons name={scanning ? 'hourglass-outline' : 'camera-outline'} size={16} color="#2563EB" />
        <Text className="text-sm font-semibold text-blue-700">{scanning ? 'Reading the bill…' : 'Scan Bill'}</Text>
      </Pressable>
      {isBill ? (
        <>
          <FormSection icon="receipt-outline" title="Bill info" first>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
                <DateField value={billDate} onChange={setBillDate} />
              </View>
              <View className="flex-1">
                <Text className="mb-1 text-xs font-medium text-gray-500">Bill No.</Text>
                <View className="rounded-lg border border-gray-300 bg-white px-3 py-2">
                  <TextInput
                    value={billNo}
                    onChangeText={setBillNo}
                    placeholder="e.g. 0234"
                    placeholderTextColor="#9CA3AF"
                    className="text-xs font-bold text-gray-900"
                    style={{ padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' }}
                  />
                  <Text className="mt-0.5 text-[10px] text-gray-500"> </Text>
                </View>
              </View>
            </View>
          </FormSection>

          <FormSection icon="person-outline" title={type === 'purchase' ? 'Vendor' : 'Customer'} tight>
            <View className="mb-1 flex-row items-center gap-2">
              <Pressable
                onPress={() => {
                  phoneContacts.request();
                  setPartyPickerQuery('');
                  setShowPartyPicker(true);
                }}
                className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
              >
                <Text className={`flex-1 text-sm ${partyName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                  {partyName || (type === 'purchase' ? 'Vendor/supplier name' : 'Party name')}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
              </Pressable>
              {!!customerId && (
                <Pressable
                  onPress={() => {
                    setRenamePartyValue(partyName);
                    setShowRenameParty(true);
                  }}
                  hitSlop={8}
                  className="rounded-lg border border-gray-300 bg-white p-2.5"
                >
                  <Ionicons name="pencil-outline" size={16} color="#6B7280" />
                </Pressable>
              )}
            </View>
            {showRenameParty && (
              <RenamePartyPopup
                title={type === 'purchase' ? 'Edit vendor' : 'Edit customer'}
                value={renamePartyValue}
                onChange={setRenamePartyValue}
                onSave={handleRenameParty}
                onClose={() => setShowRenameParty(false)}
                saving={renamingParty}
              />
            )}
            <Text className="text-[11px] text-gray-400">
              Required — this bill books against their ledger. Tap to search your saved customers and phone contacts,
              or the pencil to fix a name.
            </Text>
          </FormSection>

          <FormSection icon="cube-outline" title="Items">
            {items.length === 0 && (
              <Text className="mb-2 text-xs text-gray-400">No items yet — tap "+ Add item" below.</Text>
            )}
            {items.map((item, index) => (
              <ItemLineRow
                key={index}
                item={item}
                onEditProduct={() => openItemPicker(index)}
                onQtyChange={(v) => updateItem(index, { ...item, qty: v })}
                onRateChange={(v) => updateItem(index, { ...item, rate: v })}
                onRemove={() => removeItem(index)}
              />
            ))}
            <Pressable
              onPress={() => openItemPicker(null)}
              className="mt-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-2.5"
            >
              <Ionicons name="add-circle" size={16} color="white" />
              <Text className="text-sm font-semibold text-white">Add item</Text>
            </Pressable>
          </FormSection>

          <FormSection icon="calculator-outline" title="Totals">
            <View className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1">
              <View className="flex-row items-center justify-between py-1.5">
                <Text className="text-xs text-gray-500">Subtotal</Text>
                <Text className="text-xs font-semibold text-gray-700">NPR {formatMoney(subtotal)}</Text>
              </View>
              {/* The +/close toggle always sits in the same leading spot, whether the row
                  is collapsed or expanded, so tapping it never means aiming at a target
                  that just jumped somewhere else. */}
              <View className="flex-row items-center justify-between border-t border-gray-200 py-1.5">
                <Pressable
                  onPress={() => {
                    if (showDiscount) {
                      setShowDiscount(false);
                      setDiscountAmountInput('0');
                    } else {
                      setShowDiscount(true);
                    }
                  }}
                  className="flex-row items-center gap-1.5"
                >
                  <Ionicons name={showDiscount ? 'close-circle' : 'add-circle'} size={14} color={showDiscount ? '#9CA3AF' : '#EA580C'} />
                  <Text className={`text-xs ${showDiscount ? 'text-gray-500' : 'font-semibold text-orange-600'}`}>Discount</Text>
                </Pressable>
                {showDiscount && (
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={discountAmountInput}
                      onChangeText={setDiscountAmountInput}
                      keyboardType="numeric"
                      className="w-14 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-xs text-gray-900"
                    />
                    <Text className="text-[10px] text-gray-400">({discountPercentDisplay.toFixed(1)}%)</Text>
                    <Text className="w-16 text-right text-xs text-gray-700">− NPR {formatMoney(discountAmount)}</Text>
                  </View>
                )}
              </View>
              <View className="flex-row items-center justify-between border-t border-gray-200 py-1.5">
                <Pressable
                  onPress={() => {
                    if (showVat) {
                      setShowVat(false);
                      setVatPercent('0');
                    } else {
                      setShowVat(true);
                      setVatPercent((v) => (v === '0' ? '13' : v));
                    }
                  }}
                  className="flex-row items-center gap-1.5"
                >
                  <Ionicons name={showVat ? 'close-circle' : 'add-circle'} size={14} color={showVat ? '#9CA3AF' : '#EA580C'} />
                  <Text className={`text-xs ${showVat ? 'text-gray-500' : 'font-semibold text-orange-600'}`}>VAT</Text>
                </Pressable>
                {showVat && (
                  <View className="flex-row items-center gap-2">
                    <View className="flex-row items-center gap-1">
                      <TextInput
                        value={vatPercent}
                        onChangeText={setVatPercent}
                        keyboardType="numeric"
                        className="w-10 rounded border border-gray-300 bg-white px-1 py-0.5 text-center text-xs text-gray-900"
                      />
                      <Text className="text-[10px] text-gray-400">%</Text>
                    </View>
                    <Text className="w-16 text-right text-xs text-gray-700">+ NPR {formatMoney(vatAmount)}</Text>
                  </View>
                )}
              </View>
            </View>
            <View className="flex-row items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
              <Text className="text-sm font-bold text-gray-900">G. Total</Text>
              <Text className="text-base font-extrabold text-gray-900">NPR {formatMoney(grandTotal)}</Text>
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Remarks"
              placeholderTextColor="#9CA3AF"
              className="mt-3 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </FormSection>

          <ItemPickerModal
            visible={showItemPicker}
            products={products}
            financeItems={financeItems ?? []}
            onPick={handlePickProduct}
            onPickFinanceItem={handlePickFinanceItem}
            onPickCustom={handlePickCustomItem}
            onClose={() => {
              setShowItemPicker(false);
              setEditingItemIndex(null);
            }}
          />
        </>
      ) : (
        <>
          <FormSection icon="document-text-outline" title="Details" first>
            <Text className="mb-1 text-xs font-medium text-gray-500">Date</Text>
            <View className="mb-2.5">
              <DateField value={expenseDate} onChange={setExpenseDate} />
            </View>

            <Text className="mb-1 text-xs font-medium text-gray-500">Name</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => {
                  phoneContacts.request();
                  setPartyPickerQuery('');
                  setShowPartyPicker(true);
                }}
                className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5"
              >
                <Text className={`flex-1 text-sm ${partyName ? 'text-gray-900' : 'text-gray-400'}`} numberOfLines={1}>
                  {partyName || 'Who was this paid to?'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
              </Pressable>
              {!!customerId && (
                <Pressable
                  onPress={() => {
                    setRenamePartyValue(partyName);
                    setShowRenameParty(true);
                  }}
                  hitSlop={8}
                  className="rounded-lg border border-gray-300 bg-white p-2.5"
                >
                  <Ionicons name="pencil-outline" size={16} color="#6B7280" />
                </Pressable>
              )}
            </View>
            {showRenameParty && (
              <RenamePartyPopup
                title={'Edit payee'}
                value={renamePartyValue}
                onChange={setRenamePartyValue}
                onSave={handleRenameParty}
                onClose={() => setShowRenameParty(false)}
                saving={renamingParty}
              />
            )}
            <Text className="mb-2.5 mt-1 text-[11px] text-gray-400">
              Tap to search your saved customers and phone contacts.
            </Text>

            <Text className="mb-1 text-xs font-medium text-gray-500">Expense category</Text>
            <Pressable
              onPress={() => setShowCategoryPicker(true)}
              className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
            >
              <Text className={`text-sm ${selectedCategory ? 'text-gray-900' : 'text-gray-400'}`}>
                {selectedCategory?.name ?? 'Select a category'}
              </Text>
              <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
            </Pressable>
          </FormSection>

          <FormSection icon="cash-outline" title="Amount">
            <Text className="mb-1 text-xs font-medium text-gray-500">Amount (NPR)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 500"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              className="mb-2.5 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
            <Text className="mb-1 text-xs font-medium text-gray-500">Remarks (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Office rent"
              placeholderTextColor="#9CA3AF"
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </FormSection>

          <CategoryPickerModal
            visible={showCategoryPicker}
            categories={categories ?? []}
            selectedId={categoryId}
            onSelect={setCategoryId}
            onClose={() => setShowCategoryPicker(false)}
            onCreate={handleCreateCategory}
            onRename={handleRenameCategory}
            onDelete={handleDeleteCategory}
          />
        </>
      )}

      {type === 'expense' && (
        <FormSection icon="wallet-outline" title="Payment method">
          <Pressable
            onPress={() => setShowAccountPicker(true)}
            className="flex-row items-center justify-between rounded-lg border border-gray-300 px-3 py-2.5"
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name={bankAccountId ? 'business-outline' : 'cash-outline'} size={16} color="#6B7280" />
              <Text className="text-sm text-gray-900">{selectedAccountName}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
          </Pressable>
        </FormSection>
      )}
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
        available={available}
      />
      {confirmDialog}
      {newPartyDialog}
      <ContactPickerModal
        visible={showPartyPicker}
        initialQuery={partyPickerQuery}
        customers={customers}
        phoneContacts={phoneContacts.contacts}
        onSelectCustomer={selectCustomer}
        onSelectNew={handleSelectPartyNew}
        onClose={() => setShowPartyPicker(false)}
      />
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} className="flex-1 items-center rounded-lg border border-gray-300 py-2.5">
          <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          className="flex-1 items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
        >
          <Text className="text-sm font-semibold text-white">{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TransactionRow({
  tx,
  categoryName,
  bankAccountName,
  onPress,
  onDelete,
}: {
  tx: BusinessTransaction;
  categoryName: string | null;
  bankAccountName: string | null;
  onPress: () => void;
  onDelete: () => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const meta = TYPE_META[tx.type];
  const accountLabel = tx.bank_account_id ? bankAccountName ?? 'Bank' : 'Cash';
  return (
    <Pressable onPress={onPress} className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <View className={`h-9 w-9 items-center justify-center rounded-full ${meta.bg}`}>
        <Ionicons name={meta.icon} size={16} color={meta.color} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900">
          {meta.label}
          {tx.party_name ? ` · ${tidyName(tx.party_name)}` : ''}
          {tx.bill_no ? ` · Bill #${tx.bill_no}` : ''}
          {categoryName ? ` · ${categoryName}` : ''}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {[
            tx.items.length > 0 ? `${tx.items.length} item${tx.items.length === 1 ? '' : 's'}` : tx.note,
            toBsHistoryLabel(tx.bill_date ?? tx.created_at),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-extrabold" style={{ color: meta.color }}>
          NPR {formatMoney(tx.amount)}
        </Text>
        {tx.type === 'expense' && (
          <View className="mt-0.5 flex-row items-center gap-1">
            <Ionicons name={tx.bank_account_id ? 'business-outline' : 'cash-outline'} size={10} color="#9CA3AF" />
            <Text className="text-[10px] text-gray-400" numberOfLines={1}>
              {accountLabel}
            </Text>
          </View>
        )}
      </View>
      <Pressable onPress={onDelete} hitSlop={8} className="ml-1">
        <Ionicons name="trash-outline" size={16} color="#9CA3AF" />
      </Pressable>
    </Pressable>
  );
}

// The widths of the bill's item columns - the Total column is as wide as the Amount column
// above it, so the sums line up under the figures they add up.
const BILL_COL = { sn: 38, hs: 72, qty: 46, rate: 72, amount: 88 };

/** One cell of the bill's item table. It is a View of its own so that its rule (the line on
 * its right edge - the last cell has none) shows the same everywhere - a border on a Text does
 * not. No width = the wide one. */
function BillCell({
  width,
  ruled = true,
  align = 'left',
  head,
  textClass = 'text-gray-700',
  children,
}: {
  width?: number;
  ruled?: boolean;
  align?: 'left' | 'center' | 'right';
  head?: boolean;
  textClass?: string;
  children: ReactNode;
}) {
  return (
    <View
      className={`px-2 py-2 ${ruled ? 'border-r border-gray-200' : ''}`}
      style={[
        width ? { width } : { flex: 1, minWidth: 0 },
        { justifyContent: 'center', alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' },
      ]}
    >
      <Text className={head ? 'text-[11px] font-bold text-gray-600' : `text-xs ${textClass}`}>{children}</Text>
    </View>
  );
}

/** One line of a printed bill: what it is in a shaded cell on the left, its value on the right. */
function BillLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="flex-row border-t border-gray-300">
      <View className="justify-center border-r border-gray-300 bg-gray-50 px-3 py-2" style={{ width: 104 }}>
        <Text className="text-[11px] font-semibold text-gray-500">{label}</Text>
      </View>
      <View className="flex-1 justify-center px-3 py-2" style={{ minWidth: 0 }}>
        {children}
      </View>
    </View>
  );
}

/** A line of the bill's sums: its name on the right of the wide cell, the figure under the Amount column. */
function BillTotal({ label, value, tint, color, strong }: { label: string; value: string; tint?: string; color?: string; strong?: boolean }) {
  return (
    <View className={`flex-row ${strong ? `border-t border-gray-300 ${tint ?? ''}` : 'border-t border-gray-200'}`}>
      <View className={`flex-1 justify-center border-r px-3 py-2 ${strong ? 'border-gray-300' : 'border-gray-200'}`} style={{ minWidth: 0 }}>
        <Text className={`text-right ${strong ? 'text-xs font-bold text-gray-900' : 'text-xs text-gray-500'}`}>{label}</Text>
      </View>
      <View className="justify-center px-2 py-2" style={{ width: BILL_COL.amount, alignItems: 'flex-end' }}>
        <Text
          className={strong ? 'text-sm font-extrabold' : 'text-xs font-semibold text-gray-700'}
          style={strong && color ? { color } : undefined}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

/** A Sale / Purchase's quick edit, laid out like a ledger entry's popup: Sale or Purchase, who it is
 * with, its date and time, bill number, amount and remarks - and, under them, the bill's items. A
 * bill with items keeps its amount worked out from them - those are changed in the full form
 * (`onEditItems`).
 *
 * Whatever is changed is saved on the bill; its ledger entry follows (a Sale is what the party owes
 * you, a Purchase what you owe them), so switching Sale / Purchase or the person moves it there. */
function BillEditPopup({
  tx,
  onClose,
  onEditItems,
  onDelete,
}: {
  tx: BusinessTransaction;
  onClose: () => void;
  onEditItems: () => void;
  /** Shown as Remove, left of Cancel / Save, only where the caller can remove the bill. */
  onDelete?: () => void;
}) {
  const updateTx = useSupabaseUpdate('business_transactions');
  const bankAccounts = useBankAccounts(tx.owner_id);
  const [bankAccountId, setBankAccountId] = useState<string | null>(tx.bank_account_id);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const accountName = bankAccountId ? bankAccounts.accounts.find((a) => a.id === bankAccountId)?.name ?? 'Cash' : 'Cash';
  const [type, setType] = useState<'sale' | 'purchase'>(tx.type === 'purchase' ? 'purchase' : 'sale');
  const { partyId, movedTo, setParty } = useEntryParty(tx.customer_id ?? '');
  const when = useEntryWhen({ entry_date: tx.bill_date, created_at: tx.created_at });
  const [billNo, setBillNo] = useState(tx.bill_no ?? '');
  const [amount, setAmount] = useState(String(tx.amount));
  const [note, setNote] = useState(tx.note ?? '');
  const [saving, setSaving] = useState(false);
  const hasItems = tx.items.length > 0;

  async function handleSave() {
    const value = round2(Number(amount));
    if (!hasItems && (!amount.trim() || Number.isNaN(value) || value <= 0)) {
      showAlert('Enter an amount', 'Add a valid amount in NPR.');
      return;
    }
    if (!when.date) {
      showAlert('Pick a date', 'Choose the date of this bill.');
      return;
    }
    setSaving(true);
    try {
      await updateTx.mutateAsync({
        id: tx.id,
        values: {
          ...(type !== tx.type ? { type } : {}),
          // Another person: the bill is theirs now, so what was written for the old one (address,
          // VAT / PAN) goes rather than staying on the wrong person.
          ...(movedTo ? { customer_id: movedTo.id, party_name: movedTo.name, party_address: null, vat_pan_no: null } : {}),
          bill_no: billNo.trim() || null,
          note: note.trim() || null,
          // A bill with items has its amount from them; only one without can be typed.
          ...(hasItems ? {} : { amount: value }),
          // Only once the date or time was touched, so a plain edit leaves both as they were.
          ...(when.changed ? { bill_date: when.date, created_at: stampOf(when.date, when.time) } : {}),
          // Likewise the payment method: only when another was picked.
          ...(bankAccountId !== tx.bank_account_id
            ? { bank_account_id: bankAccountId, payment_mode: bankAccountId ? ('bank' as const) : ('cash' as const) }
            : {}),
        },
      });
      if (type !== tx.type) {
        showAlert(
          `Changed to a ${TYPE_META[type].label.toLowerCase()}`,
          'Payments already recorded for them are not changed - check that they are Paid / Received the right way round.'
        );
      }
      onClose();
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PopupCard title="Edit Entry" onClose={onClose}>
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { key: 'sale' as const, label: 'Sale', color: MONEY.in.text, bg: MONEY.in.bg, border: MONEY.in.base },
          { key: 'purchase' as const, label: 'Purchase', color: MONEY.out.text, bg: MONEY.out.bg, border: MONEY.out.base },
        ]}
      />
      <PartyMoveField
        ownerId={tx.owner_id}
        partyId={partyId}
        pickedName={movedTo?.name ?? tx.party_name ?? undefined}
        onPick={setParty}
        hint="Entered on the wrong person? Pick the right one and save - this bill moves to their ledger."
        pickerTitle="Move this bill to"
      />
      <EntryWhenFields date={when.date} time={when.time} onDate={when.setDate} onTime={when.setTime} />
      <FieldRow>
        <Field label="Bill No." basis={110}>
          <TextInput
            value={billNo}
            onChangeText={setBillNo}
            placeholder="e.g. 0234"
            placeholderTextColor="#9CA3AF"
            className={INPUT}
          />
        </Field>
        <Field label="Amount (NPR)" basis={160}>
          {hasItems ? (
            <View className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <Text className="text-sm font-semibold text-gray-700">{formatMoney(tx.amount)}</Text>
            </View>
          ) : (
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 1000"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              className={INPUT}
            />
          )}
        </Field>
        <Field label="Payment Method" basis={200}>
          <PaymentMethodButton name={accountName} isBank={!!bankAccountId} onPress={() => setShowAccountPicker(true)} />
        </Field>
        <Field label="Remarks" basis={260}>
          <TextInput value={note} onChangeText={setNote} placeholder="Optional" placeholderTextColor="#9CA3AF" className={INPUT} />
        </Field>
      </FieldRow>
      {hasItems && (
        <View style={{ gap: 8 }}>
          {/* The bill's items, ruled like the printed bill: what the amount above is made of. */}
          <BillItemsReadOnly tx={tx} />
          <Pressable onPress={onEditItems} accessibilityRole="button" className="flex-row items-center self-start" style={{ gap: 6 }}>
            <Ionicons name="create-outline" size={14} color="#1D4ED8" />
            <Text className="text-[12px] font-semibold text-blue-700">Edit the items</Text>
          </Pressable>
        </View>
      )}
      <FormActions onCancel={onClose} onSave={handleSave} saving={saving} onRemove={onDelete} />
      <BankAccountPickerModal
        visible={showAccountPicker}
        accounts={bankAccounts.accounts}
        selectedId={bankAccountId}
        onSelect={setBankAccountId}
        onClose={() => setShowAccountPicker(false)}
        onRename={bankAccounts.rename}
        onDelete={bankAccounts.remove}
      />
    </PopupCard>
  );
}

/** A bill's items ruled like the printed bill: what its amount is made of, with the sums under it. */
function BillItemsReadOnly({ tx }: { tx: BusinessTransaction }) {
  return (
    <View className="overflow-hidden rounded-lg border border-gray-300 bg-white">
      <View className="flex-row bg-gray-50">
        <BillCell head align="center" width={BILL_COL.sn}>
          S.N.
        </BillCell>
        <BillCell head>Item</BillCell>
        <BillCell head align="right" width={BILL_COL.qty}>
          Qty
        </BillCell>
        <BillCell head align="right" width={BILL_COL.rate}>
          Rate
        </BillCell>
        <BillCell head ruled={false} align="right" width={BILL_COL.amount}>
          Amount
        </BillCell>
      </View>
      {tx.items.map((item, idx) => (
        <View key={idx} className="flex-row border-t border-gray-200">
          <BillCell align="center" width={BILL_COL.sn} textClass="text-gray-500">
            {idx + 1}
          </BillCell>
          <BillCell textClass="text-gray-900">{item.description}</BillCell>
          <BillCell align="right" width={BILL_COL.qty}>
            {item.qty}
          </BillCell>
          <BillCell align="right" width={BILL_COL.rate}>
            {formatMoney(item.rate)}
          </BillCell>
          <BillCell ruled={false} align="right" width={BILL_COL.amount} textClass="font-semibold text-gray-900">
            {formatMoney(item.amount)}
          </BillCell>
        </View>
      ))}
      {(tx.discount_amount > 0 || tx.vat_amount > 0) && (
        <BillTotal label="Sub-total" value={formatMoney(tx.items.reduce((sum, item) => sum + item.amount, 0))} />
      )}
      {tx.discount_amount > 0 && <BillTotal label="Discount" value={`− ${formatMoney(tx.discount_amount)}`} />}
      {tx.vat_amount > 0 && <BillTotal label="VAT" value={`+ ${formatMoney(tx.vat_amount)}`} />}
      <BillTotal
        label="Total (NPR)"
        value={formatMoney(tx.amount)}
        tint={TYPE_META[tx.type].bg}
        color={TYPE_META[tx.type].color}
        strong
      />
    </View>
  );
}

/** One read-only box of a bill's card - what a typed box of BillEditPopup shows, as plain text. */
function ReadBox({ children, icon }: { children: ReactNode; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View className="flex-row items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5" style={{ gap: 8 }}>
      {!!icon && <Ionicons name={icon} size={16} color="#6B7280" />}
      <Text className="flex-1 text-sm text-gray-900" numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** A Sale / Purchase laid out like BillEditPopup, but to read - nothing in it is typed. Edit, where
 * Save would be, goes to the bill's own edit page (the one New is) with the bill loaded. It is the
 * bill as a document - who, when, how much, what was on it - so it has no payment method: how the
 * money moved is in the payment entries, not on the bill. */
function BillViewPopup({
  tx,
  onClose,
  onEdit,
  onDelete,
}: {
  tx: BusinessTransaction;
  onClose: () => void;
  onEdit: () => void;
  /** Shown as Remove, left of Cancel / Edit, only where the caller can remove the bill. */
  onDelete?: () => void;
}) {
  const [calendarMode] = useCalendarMode();
  const [dateMain, dateOther] = dateLabels(entryDay(tx.bill_date, tx.created_at), calendarMode);
  const meta = TYPE_META[tx.type];
  const tone = tx.type === 'purchase' ? MONEY.out : MONEY.in;
  return (
    <PopupCard title={`${meta.label} bill`} onClose={onClose} closeOnOutside>
      <View className="self-start rounded-lg border px-4 py-2" style={{ borderColor: tone.base, backgroundColor: tone.bg }}>
        <Text className="text-xs font-bold" style={{ color: tone.text }}>
          {meta.label}
        </Text>
      </View>
      <FieldRow>
        <Field label="Person" basis={300}>
          <ReadBox icon="person-outline">{tidyName(tx.party_name) || '—'}</ReadBox>
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Date" basis={220}>
          <View className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <Text className="text-sm font-bold text-gray-900">{dateMain}</Text>
            <Text className="text-[11px] text-gray-500">{dateOther}</Text>
          </View>
        </Field>
        <Field label="Time" basis={140}>
          <ReadBox>{timeOf(tx.created_at)}</ReadBox>
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Bill No." basis={110}>
          <ReadBox>{tx.bill_no || '—'}</ReadBox>
        </Field>
        <Field label="Amount (NPR)" basis={160}>
          <ReadBox>{formatMoney(tx.amount)}</ReadBox>
        </Field>
        <Field label="Remarks" basis={260}>
          <ReadBox>{tx.note || '—'}</ReadBox>
        </Field>
      </FieldRow>
      {tx.items.length > 0 && <BillItemsReadOnly tx={tx} />}
      <FormActions onCancel={onClose} onSave={onEdit} saveLabel="Edit" onRemove={onDelete} />
    </PopupCard>
  );
}

// What opens when a past transaction is tapped. A Sale / Purchase opens straight into its edit popup
// (BillEditPopup, laid out like a ledger entry's); an Expense is a read-only receipt - you can see
// what's in it without immediately dropping into an editable form. Edit is an explicit action from
// there, not the default, and so is Delete (beside it, only where the caller passes `onDelete`).
// Exported so a customer/vendor's own page (CustomerDetailScreen) can reuse the same one for a
// linked bill instead of building a second.
// With `editOnPage` (the Statement, the Day Book, the reports and a person's ledger) a Sale / Purchase
// opens as a card to read (BillViewPopup) whose Edit button goes to the bill's edit page, rather than
// as BillEditPopup, which saves in place.
export function TransactionDetailModal({
  tx,
  categoryName,
  bankAccountName,
  onClose,
  onEdit,
  onDelete,
  editOnPage,
}: {
  tx: BusinessTransaction | null;
  categoryName: string | null;
  bankAccountName: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  /** A Sale / Purchase opens to read, with Edit (-> `onEdit`) in place of Save. */
  editOnPage?: boolean;
}) {
  if (!tx) return null;
  // A Sale / Purchase opens straight into its edit popup (see BillEditPopup), laid out like a ledger
  // entry's - there is no read-only sheet in front of it. The full form, with the items, is one step
  // on from there. An Expense keeps the sheet.
  if (tx.type !== 'expense') {
    if (editOnPage) {
      return <BillViewPopup key={tx.id} tx={tx} onClose={onClose} onEdit={onEdit} onDelete={onDelete} />;
    }
    return <BillEditPopup key={tx.id} tx={tx} onClose={onClose} onEditItems={onEdit} onDelete={onDelete} />;
  }
  const meta = TYPE_META[tx.type];
  const accountLabel = tx.bank_account_id ? bankAccountName ?? 'Bank' : 'Cash';
  const isBill = tx.type !== 'expense';

  // The bill's own sums, as the Sale / Purchase form works them out: the items add up to the
  // sub-total, less the discount, plus the VAT.
  const subtotal = tx.items.reduce((sum, item) => sum + item.amount, 0);
  const showSubtotal = tx.items.length > 0 && (tx.discount_amount > 0 || tx.vat_amount > 0);
  // Only bills that carry an HS code get the column, so older bills look as they did.
  const showHsCode = tx.items.some((item) => !!item.hs_code);
  const hasBillNo = isBill && !!tx.bill_no;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-4" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full rounded-2xl bg-white" style={{ maxWidth: 640, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* The bill itself: one bordered sheet ruled into rows and columns, like a printed bill. */}
            <View className="overflow-hidden rounded-lg border border-gray-300 bg-white">
              <View className={`flex-row items-center justify-between px-3 py-2.5 ${meta.bg}`}>
                <View className="flex-row items-center gap-2">
                  <Ionicons name={meta.icon} size={16} color={meta.color} />
                  <Text className="text-sm font-extrabold capitalize tracking-wide" style={{ color: meta.color }}>
                    {isBill ? `${meta.label} bill` : 'Expenses'}
                  </Text>
                </View>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={20} color="#6B7280" />
                </Pressable>
              </View>

              {(hasBillNo || !!tx.bill_date) && (
                <View className="flex-row border-t border-gray-300">
                  {hasBillNo && (
                    <View className={`flex-1 px-3 py-2 ${tx.bill_date ? 'border-r border-gray-300' : ''}`} style={{ minWidth: 0 }}>
                      <Text className="text-[11px] font-semibold text-gray-500">Bill No.</Text>
                      <Text className="text-sm font-bold text-gray-900">{tx.bill_no}</Text>
                    </View>
                  )}
                  {!!tx.bill_date && (
                    <View className="flex-1 px-3 py-2" style={{ minWidth: 0 }}>
                      <Text className="text-[11px] font-semibold text-gray-500">Date</Text>
                      <Text className="text-sm font-bold text-gray-900">{toBsLabel(tx.bill_date)}</Text>
                      <Text className="text-[10px] text-gray-400">{new Date(tx.bill_date).toLocaleDateString()}</Text>
                    </View>
                  )}
                </View>
              )}

              {!!tx.party_name && (
                <BillLine label="Paid to">
                  <Text className="text-sm font-bold text-gray-900">{tidyName(tx.party_name)}</Text>
                </BillLine>
              )}
              {!!tx.party_address && (
                <BillLine label="Address">
                  <Text className="text-xs text-gray-900">{tx.party_address}</Text>
                </BillLine>
              )}
              {!!tx.vat_pan_no && (
                <BillLine label="VAT/PAN">
                  <Text className="text-xs text-gray-900">{tx.vat_pan_no}</Text>
                </BillLine>
              )}
              {!!categoryName && (
                <BillLine label="Category">
                  <Text className="text-xs text-gray-900">{categoryName}</Text>
                </BillLine>
              )}
              {tx.type === 'expense' && (
                <BillLine label="Payment account">
                  <Text className="text-xs text-gray-900">{accountLabel}</Text>
                </BillLine>
              )}

              {tx.items.length > 0 && (
                <>
                  <View className="flex-row border-t border-gray-300 bg-gray-50">
                    <BillCell head align="center" width={BILL_COL.sn}>
                      S.N.
                    </BillCell>
                    {showHsCode && <BillCell head width={BILL_COL.hs}>HS Code</BillCell>}
                    <BillCell head>Item</BillCell>
                    <BillCell head align="right" width={BILL_COL.qty}>
                      Qty
                    </BillCell>
                    <BillCell head align="right" width={BILL_COL.rate}>
                      Rate
                    </BillCell>
                    <BillCell head ruled={false} align="right" width={BILL_COL.amount}>
                      Amount
                    </BillCell>
                  </View>
                  {tx.items.map((item, idx) => (
                    <View key={idx} className="flex-row border-t border-gray-200">
                      <BillCell align="center" width={BILL_COL.sn} textClass="text-gray-500">
                        {idx + 1}
                      </BillCell>
                      {showHsCode && (
                        <BillCell width={BILL_COL.hs} textClass="text-gray-500">
                          {item.hs_code ?? ''}
                        </BillCell>
                      )}
                      <BillCell textClass="text-gray-900">{item.description}</BillCell>
                      <BillCell align="right" width={BILL_COL.qty}>
                        {item.qty}
                      </BillCell>
                      <BillCell align="right" width={BILL_COL.rate}>
                        {formatMoney(item.rate)}
                      </BillCell>
                      <BillCell ruled={false} align="right" width={BILL_COL.amount} textClass="font-semibold text-gray-900">
                        {formatMoney(item.amount)}
                      </BillCell>
                    </View>
                  ))}
                </>
              )}

              {showSubtotal && <BillTotal label="Sub-total" value={formatMoney(subtotal)} />}
              {tx.discount_amount > 0 && <BillTotal label="Discount" value={`− ${formatMoney(tx.discount_amount)}`} />}
              {tx.vat_amount > 0 && <BillTotal label="VAT" value={`+ ${formatMoney(tx.vat_amount)}`} />}
              <BillTotal label="Total (NPR)" value={formatMoney(tx.amount)} tint={meta.bg} color={meta.color} strong />

              {!!tx.note && (
                <BillLine label="Remarks">
                  <Text className="text-xs text-gray-700">{tx.note}</Text>
                </BillLine>
              )}
            </View>

            <View className="mt-3 flex-row" style={{ gap: 8 }}>
              <Pressable onPress={onEdit} className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-3">
                <Ionicons name="pencil" size={14} color="white" />
                <Text className="text-sm font-semibold text-white">Edit</Text>
              </Pressable>
              {!!onDelete && (
                <Pressable
                  onPress={onDelete}
                  className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border bg-white py-3"
                  style={{ borderColor: '#FECACA' }}
                >
                  <Ionicons name="trash-outline" size={14} color="#DC2626" />
                  <Text className="text-sm font-semibold" style={{ color: '#DC2626' }}>
                    Delete
                  </Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// `date` is the transaction's own date (bill_date/entry_date) where it has
// one, falling back to created_at only for entries that don't - editing a
// Sale/Purchase's date (or a ledger entry's) used to leave it grouped and
// sorted under whichever day it was first *entered*, so an old bill's date
// edited to a past day would still show up under "Today" if that's when it
// was typed in.
export type FeedItem =
  | { kind: 'business'; id: string; date: string; tx: BusinessTransaction }
  | { kind: 'ledger'; id: string; date: string; entry: CustomerLedgerEntry; customerName: string | null }
  | { kind: 'vendor'; id: string; date: string; entry: VendorLedgerEntry; vendorName: string | null }
  | { kind: 'transfer'; id: string; date: string; transfer: AccountTransfer };

// "Today" / "Yesterday" / "N days ago" for anything in the past; falls back
// to a plain date for anything future-dated (shouldn't normally happen).
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((todayStart - dayStart) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function LedgerRow({ item, customerName, basePath }: { item: CustomerLedgerEntry; customerName: string | null; basePath?: string }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const isDebit = item.entry_type === 'debit';
  // Money we gave the customer (Payment Out) is red; money they paid, or that is still receivable, is green.
  const isOut = isDebit && item.source === 'manual';
  return (
    <Pressable
      onPress={() => basePath && router.push(`${basePath}/customer/${item.customer_id}` as any)}
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full ${isOut ? 'bg-red-50' : 'bg-emerald-50'}`}>
        <Ionicons name={isDebit ? 'arrow-up' : 'arrow-down'} size={16} color={isOut ? '#DC2626' : '#059669'} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          {!isDebit ? 'Received' : isOut ? 'Paid' : 'Receivable'} · {customerName ?? 'Unknown customer'}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {item.note ?? (item.source === 'booking' ? 'From a booked job' : 'Manual entry')} ·{' '}
          {toBsHistoryLabel(item.entry_date ?? item.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold" style={{ color: isOut ? '#DC2626' : '#059669' }}>
        NPR {formatMoney(item.amount)}
      </Text>
    </Pressable>
  );
}

function VendorFeedRow({ item, vendorName, basePath }: { item: VendorLedgerEntry; vendorName: string | null; basePath?: string }) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const isDebit = item.entry_type === 'debit';
  return (
    <Pressable
      onPress={() => basePath && router.push(`${basePath}/customer/${item.vendor_id}` as any)}
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-orange-100 bg-white p-4"
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full bg-red-50`}>
        <Ionicons name={isDebit ? 'cart-outline' : 'arrow-down'} size={16} color="#DC2626" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          {isDebit ? 'Bought on credit' : 'Paid'} · {vendorName ?? 'Unknown vendor'}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {item.note ?? (item.source === 'booking' ? 'From a credit purchase' : 'Manual entry')} ·{' '}
          {toBsHistoryLabel(item.entry_date ?? item.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold" style={{ color: '#DC2626' }}>
        NPR {formatMoney(item.amount)}
      </Text>
    </Pressable>
  );
}

// Moving money between the business's own accounts - not a Sale, Purchase,
// Expense, or party payment (see 0064_account_transfers.sql), so it's shown
// plainly here rather than tinted like the money-earned/spent rows around
// it, and tapping it offers to remove it instead of navigating anywhere.
function TransferFeedRow({
  transfer,
  accountName,
  onDelete,
}: {
  transfer: AccountTransfer;
  accountName: (id: string | null) => string;
  onDelete: () => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  return (
    <Pressable
      onPress={() =>
        showAlert('Remove this transfer?', 'This undoes the move between your accounts.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: onDelete },
        ])
      }
      className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-50">
        <Ionicons name="swap-horizontal" size={16} color="#2563EB" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
          Transfer · {accountName(transfer.from_account_id)} → {accountName(transfer.to_account_id)}
        </Text>
        <Text className="text-xs text-gray-400" numberOfLines={1}>
          {transfer.note ?? 'Between your own accounts'} · {toBsHistoryLabel(transfer.transfer_date ?? transfer.created_at)}
        </Text>
      </View>
      <Text className="text-sm font-extrabold text-gray-900">NPR {formatMoney(transfer.amount)}</Text>
    </Pressable>
  );
}

export function TransactionsScreen({ basePath }: { basePath?: string }) {
  const desktopWeb = useIsWideWeb();
  // voice* params arrive from Sagar AI Assistant (see FloatingAssistantChat)
  // - a spoken or typed command gets routed here the same way a Shortcuts
  // tap does (?type=...&add=1), just with these extra fields for
  // TransactionForm to pre-fill on that first render.
  const {
    type: typeParam,
    add: addParam,
    edit: editParam,
    partyId: partyIdParam,
    voiceAmount,
    voiceParty,
    voiceDate,
    voiceNote,
  } = useLocalSearchParams<{
    type?: string;
    add?: string;
    edit?: string;
    partyId?: string;
    voiceAmount?: string;
    voiceParty?: string;
    voiceDate?: string;
    voiceNote?: string;
  }>();
  // Memoized on the actual param values (not recreated every render) so the
  // form's effect below can safely depend on this object's identity instead
  // of only running "on mount" - Expo Router doesn't always have these
  // hydrated on the very first render of a freshly-pushed route, so a plain
  // object literal here would otherwise still leave that first mount effect
  // seeing stale/empty values with no second chance to pick up the real ones.
  const voicePrefill = useMemo(
    () =>
      voiceAmount || voiceParty || voiceDate || voiceNote
        ? { amount: voiceAmount, party: voiceParty, date: voiceDate, note: voiceNote }
        : null,
    [voiceAmount, voiceParty, voiceDate, voiceNote]
  );
  const userId = useAuthStore((state) => state.session?.user.id);
  const role = useRole();
  const { data: products } = useSupabaseQuery('products', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId && !!role,
  });
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: ledgerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: vendorLedgerEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const { data: transfers } = useSupabaseQuery('account_transfers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'created_at', ascending: false },
    enabled: !!userId,
  });
  const deleteTransfer = useSupabaseDelete('account_transfers');
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: categories } = useSupabaseQuery('expense_categories', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const bankAccounts = useBankAccounts(userId);
  const deleteTx = useSupabaseDelete('business_transactions');

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const bankAccountNameById = useMemo(() => {
    const map = new Map<string, string>();
    bankAccounts.accounts.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [bankAccounts.accounts]);

  // Previously used expense payee names, so the Name field can suggest one
  // instead of always starting from scratch.
  const existingExpenseNames = useMemo(() => {
    const names = new Set<string>();
    (transactions ?? []).forEach((t) => {
      if (t.type === 'expense' && t.party_name) names.add(t.party_name);
    });
    return Array.from(names);
  }, [transactions]);

  const initialFilter = (typeParam as BusinessTransactionType) && ['sale', 'purchase', 'expense'].includes(typeParam ?? '')
    ? (typeParam as BusinessTransactionType)
    : 'all';
  // Only an explicit ?add=1 (set by the Shortcuts icons) means "open the
  // form to add one." Arriving at a type-locked view any other way (the
  // Sales/Purchase/Expense dashboard cards) is a view-only visit - entries
  // are only ever added from Shortcuts.
  const isAddFlow = addParam === '1';
  const [filter, setFilter] = useState<'all' | BusinessTransactionType>(initialFilter);
  const [showFormState, setShowForm] = useState(isAddFlow);
  // Bumped after each save in the web quick-add flow so the form remounts
  // empty (see onDone below) instead of closing to the history list.
  const [formKey, setFormKey] = useState(0);
  const [editingTxState, setEditingTx] = useState<BusinessTransaction | null>(null);
  // An edit link (?edit=<id>) - from the Statement, the Day Book or a customer's
  // page - lands on this same page as "New", with that bill loaded into the form.
  // It is read straight from the link, so it needs no effect to open: the form
  // shows as soon as the bill has loaded, and is gone when the link is.
  const { data: editRow } = useSupabaseRow('business_transactions', editParam);
  const editLinkTx = editParam && editRow && editRow.id === editParam ? editRow : null;
  const editingTx = editLinkTx ?? editingTxState;
  const showForm = showFormState || !!editLinkTx;
  // A bill entered as the wrong kind (a Sale that was really a Purchase) can be switched while it
  // is being edited; the bill's own ledger entry follows when it is saved.
  const [typeOverride, setTypeOverride] = useState<{ id: string; type: BusinessTransactionType } | null>(null);
  const editType: BusinessTransactionType | undefined = editingTx
    ? typeOverride && typeOverride.id === editingTx.id && editingTx.type !== 'expense'
      ? typeOverride.type
      : editingTx.type
    : undefined;
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);
  // The form renders inside the list's own header, so opening it while
  // scrolled down through history (which is exactly when someone taps Edit
  // on an older entry) leaves it off-screen above the current scroll
  // position - scroll back to the top whenever it opens so it's actually
  // visible instead of looking like nothing happened.
  const listRef = useRef<KeyboardAwareSectionList>(null);
  function openForm(tx: BusinessTransaction | null) {
    setEditingTx(tx);
    setShowForm(true);
    setTimeout(() => listRef.current?.scrollToPosition(0, 0, true), 0);
  }

  // Expo Router reuses this same screen instance when navigating between
  // shortcuts that share this route (Sales/Purchase/Expense/Net
  // Balance/Transactions all point here with a different or absent ?type=),
  // so the state above - set from typeParam only on first mount - would
  // otherwise go stale: the form would keep showing whatever type/filter was
  // active before, no matter which shortcut was actually tapped. Re-sync
  // whenever the param itself changes instead.
  useEffect(() => {
    setFilter(initialFilter);
    setShowForm(isAddFlow);
    setEditingTx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeParam, addParam]);

  // Arriving with a specific ?type= (from the Sales/Purchase/Expense
  // shortcuts or dashboard cards) means "show me only this" - lock the view
  // to that one type instead of dropping the reseller into the shared
  // All/Sales/Purchase/Expense hub they'd then have to filter themselves.
  // The Transactions shortcut (no type param) still opens that full hub.
  const isLockedToType = !!typeParam && initialFilter !== 'all';
  // The form auto-opens on arrival only for the Shortcuts add flow - there's
  // nothing else to do there once it's dismissed (no + button to reopen it,
  // by design), so dismissing it should leave the screen entirely instead of
  // stranding the reseller on a dead end they'd have to back out of anyway.
  // Editing an existing row (tapped from the list) is a different flow and
  // should just close back to that list.
  const inAddFlow = isLockedToType && isAddFlow;
  const isQuickAddFlow = inAddFlow && !editingTx;

  // Edit a bill: from the entry page itself (its Recent list) load it right here;
  // from anywhere else go to that same entry page with the bill loaded - so Edit
  // is the very page "New" is, never a different layout.
  function editBill(tx: BusinessTransaction | null) {
    if (!tx) return;
    if (inAddFlow) openForm(tx);
    else router.push(`${basePath}/transactions?type=${tx.type}&add=1&edit=${tx.id}` as any);
  }

  // Done with, or backed out of, an edit that was opened by a link: back to
  // wherever it was opened from (or the list, if the page was opened directly).
  function leaveEdit() {
    const type = editingTx?.type;
    setEditingTx(null);
    if (router.canGoBack()) router.back();
    else router.replace(`${basePath}/transactions${type ? `?type=${type}` : ''}` as any);
  }

  // Pressing the Android hardware back button while editing an existing
  // entry should close the form and stay on the list; during the locked
  // view's auto-opened quick-add form, let the default back navigation
  // happen instead of closing to a dead end with no way to reopen it.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewingTx) {
        setViewingTx(null);
        return true;
      }
      if (showForm && !isQuickAddFlow && !editLinkTx) {
        setShowForm(false);
        setEditingTx(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [showForm, isQuickAddFlow, viewingTx, editLinkTx]);

  // "All" is a full daily feed across every money-moving table (general
  // sales/purchase/expense entries plus per-customer debit/credit entries),
  // newest first. The type filters stay business_transactions-only, since
  // ledger entries don't have a sale/purchase/expense dimension.
  const feed = useMemo((): FeedItem[] => {
    if (filter !== 'all') {
      return (transactions ?? [])
        .filter((t) => t.type === filter)
        .map((tx) => ({ kind: 'business' as const, id: tx.id, date: tx.bill_date ?? tx.created_at, tx }))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    const businessItems: FeedItem[] = (transactions ?? []).map((tx) => ({
      kind: 'business',
      id: tx.id,
      date: tx.bill_date ?? tx.created_at,
      tx,
    }));
    // Skip entries auto-synced from a Sale/Purchase's own ledger debt (see
    // 0061_sale_purchase_always_ledger.sql) - the business_transactions row
    // above already represents that bill, so showing both here would be the
    // same bill twice.
    const isAutoSyncedFromBill = (source: string, sourceType: string | null) => source === 'booking' && sourceType === 'business_transaction';
    const ledgerItems: FeedItem[] = (ledgerEntries ?? [])
      .filter((entry) => !isAutoSyncedFromBill(entry.source, entry.source_type))
      .map((entry) => ({
        kind: 'ledger',
        id: entry.id,
        date: entry.entry_date ?? entry.created_at,
        entry,
        customerName: customerNameById.get(entry.customer_id) ?? null,
      }));
    const vendorItems: FeedItem[] = (vendorLedgerEntries ?? [])
      .filter((entry) => !isAutoSyncedFromBill(entry.source, entry.source_type))
      .map((entry) => ({
        kind: 'vendor',
        id: entry.id,
        date: entry.entry_date ?? entry.created_at,
        entry,
        vendorName: customerNameById.get(entry.vendor_id) ?? null,
      }));
    const transferItems: FeedItem[] = (transfers ?? []).map((transfer) => ({
      kind: 'transfer',
      id: transfer.id,
      date: transfer.transfer_date ?? transfer.created_at,
      transfer,
    }));
    return [...businessItems, ...ledgerItems, ...vendorItems, ...transferItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [transactions, ledgerEntries, vendorLedgerEntries, transfers, customerNameById, filter]);

  // feed is already newest-first, so grouping by day label as we walk it
  // naturally keeps each day's items together in one contiguous section.
  const sections = useMemo(() => {
    const groups: { title: string; data: FeedItem[] }[] = [];
    for (const item of feed) {
      const title = dayLabel(item.date);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.title === title) {
        lastGroup.data.push(item);
      } else {
        groups.push({ title, data: [item] });
      }
    }
    return groups;
  }, [feed]);

  // On web the open form already lists recent entries down its right side,
  // so repeating the whole history underneath it showed the same statement
  // twice - see RecentEntriesCard.
  const hideFeed = showForm && desktopWeb;

  function handleDelete(tx: BusinessTransaction) {
    showAlert('Delete this transaction?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTx.mutate(tx.id) },
    ]);
  }

  // Delete from the receipt (opened from the list or the Recent entries beside
  // the form): names the entry so the right one is being removed, and if it is
  // the one loaded in the form, the form goes back to blank instead of keeping
  // a bill that no longer exists.
  function handleDeleteFromReceipt(tx: BusinessTransaction) {
    setViewingTx(null);
    const label = TYPE_META[tx.type].label.toLowerCase();
    showAlert(
      `Delete this ${label}?`,
      `${tidyName(tx.party_name) || 'Unnamed'} · NPR ${formatMoney(tx.amount)}${tx.customer_id ? '. It is also taken off their ledger.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTx.mutateAsync(tx.id);
              if (editingTx?.id === tx.id) {
                setEditingTx(null);
                setFormKey((k) => k + 1);
              }
            } catch (err) {
              showAlert('Could not delete', getErrorMessage(err));
            }
          },
        },
      ]
    );
  }

  // Web: the list view is a Day Book style cash-book table (the entry form
  // keeps its own layout below). Phones keep the card list.
  if (Platform.OS === 'web' && !showForm) {
    return (
      <>
        <TransactionsBook
          feed={feed}
          filters={FILTERS}
          filter={filter}
          onFilter={setFilter}
          locked={isLockedToType}
          title={isLockedToType ? `${TYPE_META[initialFilter].label}s` : 'Statement'}
          onBack={isLockedToType ? () => router.back() : undefined}
          basePath={basePath}
          categoryNameById={categoryNameById}
          bankAccountNameById={bankAccountNameById}
          accountName={(id) => (id ? (bankAccountNameById.get(id) ?? 'Bank') : 'Cash')}
          onOpenTx={setViewingTx}
          onDeleteTx={handleDelete}
          onDeleteTransfer={(transfer) =>
            showAlert('Remove this transfer?', 'This undoes the move between your accounts.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteTransfer.mutate(transfer.id) },
            ])
          }
        />
        <TransactionDetailModal
          tx={viewingTx}
          categoryName={viewingTx?.expense_category_id ? categoryNameById.get(viewingTx.expense_category_id) ?? null : null}
          bankAccountName={viewingTx?.bank_account_id ? bankAccountNameById.get(viewingTx.bank_account_id) ?? null : null}
          onClose={() => setViewingTx(null)}
          onEdit={() => {
            setViewingTx(null);
            editBill(viewingTx);
          }}
          editOnPage
          onDelete={viewingTx ? () => handleDeleteFromReceipt(viewingTx) : undefined}
        />
      </>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-4">
      <KeyboardAwareSectionList
        ref={listRef}
        enableOnAndroid
        extraScrollHeight={20}
        sections={hideFeed ? [] : sections}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={
          <>
            {/* On web the top bar already carries the name. */}
            {!desktopWeb && (
            <View className="mb-3 flex-row items-center justify-between">
              {isLockedToType ? (
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => {
                      if (editLinkTx) {
                        leaveEdit();
                      } else if (showForm && !isQuickAddFlow) {
                        setShowForm(false);
                        setEditingTx(null);
                      } else {
                        router.back();
                      }
                    }}
                    hitSlop={8}
                    className="p-1"
                  >
                    <Ionicons name="chevron-back" size={20} color="#374151" />
                  </Pressable>
                  <Text className="text-base font-bold text-gray-900">{initialFilter === 'expense' ? 'Expenses' : TYPE_META[initialFilter].label}</Text>
                </View>
              ) : (
                <View className="flex-row gap-2">
                  {FILTERS.map((f) => {
                    const selected = filter === f.key;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => setFilter(f.key)}
                        className={`rounded-full px-3 py-1.5 ${selected ? 'bg-orange-500' : 'bg-white border border-gray-200'}`}
                      >
                        <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {!isLockedToType && (
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  {/* Import (a bank / wallet statement file) - it used to be its own menu page. */}
                  {!!basePath && (
                    <Pressable
                      onPress={() => router.push(`${basePath}/import-statement` as any)}
                      accessibilityRole="button"
                      accessibilityLabel="Import a statement"
                      className="h-10 flex-row items-center justify-center rounded-2xl border border-gray-300 bg-white px-3"
                      style={{ gap: 6 }}
                    >
                      <Ionicons name="cloud-upload-outline" size={17} color="#1D4ED8" />
                      <Text className="text-[13px] font-semibold text-gray-700">Import</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      setEditingTx(null);
                      setShowForm((v) => !v);
                    }}
                    className="h-10 w-10 items-center justify-center rounded-2xl bg-orange-500"
                  >
                    <Ionicons name={showForm ? 'close' : 'add'} size={20} color="white" />
                  </Pressable>
                </View>
              )}
            </View>
            )}

            {!(showForm && (inAddFlow || desktopWeb)) && (
              <TrendChartCard key={filter} transactions={transactions ?? []} metrics={[filter]} />
            )}

            {showForm && userId && editingTx && editingTx.type !== 'expense' && (
              <View className="mb-3 flex-row items-center rounded-xl border border-gray-200 bg-white px-3 py-2" style={{ gap: 8 }}>
                <Text className="text-xs font-semibold text-gray-500">Entered as</Text>
                {(['sale', 'purchase'] as const).map((k) => {
                  const on = editType === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => setTypeOverride({ id: editingTx.id, type: k })}
                      className="rounded-lg border px-3 py-1.5"
                      style={{ borderColor: on ? TYPE_META[k].color : '#D1D5DB', backgroundColor: on ? TYPE_META[k].bg : '#FFFFFF' }}
                      accessibilityState={{ selected: on }}
                    >
                      <Text className="text-[13px] font-semibold" style={{ color: on ? TYPE_META[k].color : '#6B7280' }}>
                        {TYPE_META[k].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {showForm && userId && (
              <TransactionForm
                key={`${editingTx?.id ?? (filter === 'all' ? 'sale' : filter)}-${formKey}`}
                userId={userId}
                initial={editingTx ?? undefined}
                type={editType ?? (filter === 'all' ? 'sale' : filter)}
                existingNames={existingExpenseNames}
                customers={customers ?? []}
                products={products ?? []}
                voicePrefill={editingTx || formKey > 0 ? null : voicePrefill}
                presetPartyId={editingTx || formKey > 0 ? undefined : partyIdParam}
                onOpenRecent={desktopWeb ? setViewingTx : undefined}
                onDone={() => {
                  if (editLinkTx) {
                    leaveEdit();
                    return;
                  }
                  // Entering several bills in a row is the whole point of
                  // the web entry screen: stay on it with a blank form and a
                  // quick confirmation, rather than dropping back to history.
                  // An entry fixed from the Recent list (editingTx) is the
                  // same: back to the blank form, not out to the history.
                  if (desktopWeb && inAddFlow) {
                    showAlert(`${TYPE_META[initialFilter].label} ${editingTx ? 'updated' : 'saved'}`, 'The form is ready for the next entry.');
                    setEditingTx(null);
                    setFormKey((k) => k + 1);
                    setTimeout(() => listRef.current?.scrollToPosition(0, 0, true), 0);
                    return;
                  }
                  setShowForm(false);
                  setEditingTx(null);
                  if (isQuickAddFlow) router.back();
                }}
                onCancel={() => {
                  if (editLinkTx) {
                    leaveEdit();
                    return;
                  }
                  // Backing out of an edit started from the Recent list returns
                  // to the blank entry form; only a blank form leaves the screen.
                  if (desktopWeb && inAddFlow && editingTx) {
                    setEditingTx(null);
                    setFormKey((k) => k + 1);
                    return;
                  }
                  setShowForm(false);
                  setEditingTx(null);
                  if (isQuickAddFlow) router.back();
                }}
              />
            )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text className="mb-2 mt-3 text-xs font-bold capitalize tracking-wide text-gray-400">{section.title}</Text>
        )}
        renderItem={({ item }) =>
          item.kind === 'business' ? (
            <TransactionRow
              tx={item.tx}
              categoryName={item.tx.expense_category_id ? categoryNameById.get(item.tx.expense_category_id) ?? null : null}
              bankAccountName={item.tx.bank_account_id ? bankAccountNameById.get(item.tx.bank_account_id) ?? null : null}
              onPress={() => setViewingTx(item.tx)}
              onDelete={() => handleDelete(item.tx)}
            />
          ) : item.kind === 'ledger' ? (
            <LedgerRow item={item.entry} customerName={item.customerName} basePath={basePath} />
          ) : item.kind === 'vendor' ? (
            <VendorFeedRow item={item.entry} vendorName={item.vendorName} basePath={basePath} />
          ) : (
            <TransferFeedRow
              transfer={item.transfer}
              accountName={(id) => (id ? bankAccountNameById.get(id) ?? 'Bank' : 'Cash')}
              onDelete={() => deleteTransfer.mutate(item.transfer.id)}
            />
          )
        }
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          // While the web form is open the list is deliberately empty (the
          // form's own right column carries the recent entries), so there's
          // nothing missing to announce.
          hideFeed ? null : (
            <View className="items-center rounded-2xl border border-dashed border-gray-200 bg-white py-10">
              <Ionicons name="cash-outline" size={28} color="#D1D5DB" />
              <Text className="mt-2 text-gray-500">No transactions yet.</Text>
            </View>
          )
        }
      />

      <TransactionDetailModal
        tx={viewingTx}
        categoryName={viewingTx?.expense_category_id ? categoryNameById.get(viewingTx.expense_category_id) ?? null : null}
        bankAccountName={viewingTx?.bank_account_id ? bankAccountNameById.get(viewingTx.bank_account_id) ?? null : null}
        onClose={() => setViewingTx(null)}
        onEdit={() => {
          setViewingTx(null);
          editBill(viewingTx);
        }}
        editOnPage
        onDelete={viewingTx ? () => handleDeleteFromReceipt(viewingTx) : undefined}
      />
    </View>
  );
}
