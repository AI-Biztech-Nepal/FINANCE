// lib/components/finance/ImportStatementScreen.tsx
import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBarActions, useBookLayout } from './BookKit';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { useStatementImport, usePendingStatementRows, type ReviewRow } from '../../hooks/useStatementImport';
import { showAlert } from '../../utils/alert';
import { DEBIT_TYPES, CREDIT_TYPES, type StatementAction } from '../../utils/parseStatement';
import type { Customer } from '../../../types/database.types';
import { formatMoney } from '../../utils/money';

const TYPE_META: Record<StatementAction, { label: string; color: string; bg: string }> = {
  payment_out: { label: 'Paid', color: '#DC2626', bg: '#FEF2F2' },
  expense: { label: 'Expenses', color: '#DC2626', bg: '#FEF2F2' },
  withdraw: { label: 'Withdraw', color: '#4B5563', bg: '#F3F4F6' },
  payment_in: { label: 'Received', color: '#059669', bg: '#ECFDF5' },
  deposit: { label: 'Deposit', color: '#059669', bg: '#ECFDF5' },
};

// Only one dropdown (party suggestions, type picker, or expense category)
// is ever open at a time, and always for exactly one row - across all three
// kinds, not per-kind, so opening one always closes whatever else was open.
type OpenMenu = { index: number; kind: 'party' | 'type' | 'category' } | null;

/** Bulk-imports an eSewa (or similar) statement export into Finance: pick
 * the file, review every parsed row (type, party, remark, amount all
 * editable, each individually toggleable), then commit only what's checked.
 * Rows already imported before (by Reference Code) never show up again, so
 * re-running the same file - or one with an overlapping date range - can't
 * double up entries. Nothing here writes anything until "Import Selected"
 * is tapped. */
export function ImportStatementScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((state) => state.ownerId ?? undefined);
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { data: expenseCategories } = useSupabaseQuery('expense_categories', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  const { picking, importing, pickAndParse, importSelected } = useStatementImport(userId);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  // A file attached in the Sagar chat arrives already parsed.
  const pendingRows = usePendingStatementRows((state) => state.rows);
  useEffect(() => {
    if (!pendingRows) return;
    setRows(pendingRows);
    setOpenMenu(null);
    usePendingStatementRows.getState().clear();
  }, [pendingRows]);

  async function handlePick() {
    setOpenMenu(null);
    const parsed = await pickAndParse();
    if (parsed) setRows(parsed);
  }

  function handleChangeFile() {
    setRows(null);
    setOpenMenu(null);
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  }

  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  async function handleImport() {
    if (!rows) return;
    const missingParty = rows.some(
      (r) => r.selected && (r.type === 'payment_in' || r.type === 'payment_out') && !r.party.trim()
    );
    if (missingParty) {
      showAlert('Add a name', 'Every checked Received / Paid row needs a customer or vendor name before it can be imported.');
      return;
    }
    const { imported, failed } = await importSelected(rows, customers ?? []);
    showAlert(
      'Import finished',
      failed > 0
        ? `Added ${imported} ${imported === 1 ? 'entry' : 'entries'}. ${failed} couldn't be saved.`
        : `Added ${imported} ${imported === 1 ? 'entry' : 'entries'} to Finance Nepal.`
    );
    if (imported > 0) router.back();
  }

  function matchingCustomers(query: string): Customer[] {
    const q = query.trim().toLowerCase();
    if (!q) return (customers ?? []).slice(0, 5);
    return (customers ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5);
  }

  // The name, the back button (phones) and "Change file" live in the top bar.
  const layout = useBookLayout();
  const changeFileRef = useRef<() => void>(() => {});
  changeFileRef.current = handleChangeFile;
  useBarActions(
    {
      wide: layout.wide,
      right: rows
        ? () => (
            <Pressable
              onPress={() => changeFileRef.current()}
              className="h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5"
            >
              <Text className="text-[13px] font-semibold text-blue-700">Change file</Text>
            </Pressable>
          )
        : undefined,
    },
    [!!rows]
  );

  return (
    <View className="flex-1 bg-gray-50">
      {!rows ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="document-attach-outline" size={40} color="#9CA3AF" />
          <Text className="mt-3 mb-1 text-center text-sm font-semibold text-gray-700">
            Import a wallet or bank statement
          </Text>
          <Text className="mb-5 text-center text-xs text-gray-400">
            Pick an eSewa (or similar) statement export (.xls/.xlsx). You'll review and choose what to add before
            anything is saved.
          </Text>
          <Pressable
            onPress={handlePick}
            disabled={picking}
            className="flex-row items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 disabled:opacity-50"
          >
            <Ionicons name={picking ? 'hourglass-outline' : 'folder-open-outline'} size={16} color="white" />
            <Text className="text-sm font-semibold text-white">{picking ? 'Reading…' : 'Choose File'}</Text>
          </Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="checkmark-circle-outline" size={40} color="#059669" />
          <Text className="mt-3 mb-5 text-center text-sm text-gray-500">
            Everything in that file has already been imported.
          </Text>
          <Pressable onPress={handlePick} disabled={picking} className="rounded-lg bg-blue-600 px-5 py-3 disabled:opacity-50">
            <Text className="text-sm font-semibold text-white">{picking ? 'Reading…' : 'Choose Another File'}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.referenceCode}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            renderItem={({ item, index }) => {
              const meta = TYPE_META[item.type];
              const needsParty = item.type === 'payment_in' || item.type === 'payment_out';
              const typeOptions = item.credit > 0 ? CREDIT_TYPES : DEBIT_TYPES;
              const selectedCategory = (expenseCategories ?? []).find((c) => c.id === item.expenseCategoryId) ?? null;
              const suggestions =
                openMenu?.index === index && openMenu.kind === 'party' ? matchingCustomers(item.party) : [];

              return (
                <View className="mb-2 rounded-xl border border-gray-200 bg-white p-3">
                  <View className="flex-row items-start gap-2">
                    <Pressable
                      onPress={() => updateRow(index, { selected: !item.selected })}
                      hitSlop={8}
                      className="mt-0.5"
                    >
                      <Ionicons name={item.selected ? 'checkbox' : 'square-outline'} size={20} color="#2563EB" />
                    </Pressable>
                    <View className="flex-1">
                      {/* Party name first, like party_name is the bold line
                          in every other Finance list - matching an existing
                          customer is one tap away via the suggestions list
                          below, same as ContactPickerModal elsewhere. */}
                      <TextInput
                        value={item.party}
                        onChangeText={(v) => updateRow(index, { party: v })}
                        onFocus={() => setOpenMenu({ index, kind: 'party' })}
                        onBlur={() =>
                          setTimeout(
                            () => setOpenMenu((cur) => (cur?.index === index && cur.kind === 'party' ? null : cur)),
                            150
                          )
                        }
                        placeholder={item.type === 'payment_out' ? 'Vendor name' : needsParty ? 'Customer name' : 'Name (optional)'}
                        placeholderTextColor="#9CA3AF"
                        className="text-sm font-semibold text-gray-900"
                      />
                      {suggestions.length > 0 && (
                        <View className="mt-1 rounded-lg border border-gray-200 bg-white">
                          {suggestions.map((c) => (
                            <Pressable
                              key={c.id}
                              onPress={() => {
                                updateRow(index, { party: c.name });
                                setOpenMenu(null);
                              }}
                              className="border-b border-gray-100 px-2.5 py-1.5 last:border-b-0"
                            >
                              <Text className="text-xs text-gray-700">{c.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                      <TextInput
                        value={item.description}
                        onChangeText={(v) => updateRow(index, { description: v })}
                        placeholder="Remarks"
                        placeholderTextColor="#9CA3AF"
                        multiline
                        className="mt-1 text-xs text-gray-500"
                      />
                      <Text className="mt-0.5 text-[11px] text-gray-400">{item.date}</Text>
                    </View>
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: item.credit > 0 ? '#059669' : '#DC2626' }}
                    >
                      {item.credit > 0 ? '+' : '-'}
                      {formatMoney((item.credit || item.debit))}
                    </Text>
                  </View>

                  <View className="mt-2 flex-row flex-wrap items-start gap-2">
                    <View>
                      <Pressable
                        onPress={() => setOpenMenu((cur) => (cur?.index === index && cur.kind === 'type' ? null : { index, kind: 'type' }))}
                        className="flex-row items-center gap-1 rounded-full px-3 py-1"
                        style={{ backgroundColor: meta.bg }}
                      >
                        <Text className="text-xs font-semibold" style={{ color: meta.color }}>
                          {meta.label}
                        </Text>
                        <Ionicons name="chevron-down" size={12} color={meta.color} />
                      </Pressable>
                      {openMenu?.index === index && openMenu.kind === 'type' && (
                        <View className="mt-1 rounded-lg border border-gray-200 bg-white" style={{ minWidth: 140 }}>
                          {typeOptions.map((opt) => (
                            <Pressable
                              key={opt}
                              onPress={() => {
                                updateRow(index, { type: opt });
                                setOpenMenu(null);
                              }}
                              className="border-b border-gray-100 px-3 py-2 last:border-b-0"
                            >
                              <Text className="text-xs font-semibold" style={{ color: TYPE_META[opt].color }}>
                                {TYPE_META[opt].label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>

                    {item.type === 'expense' && (
                      <View>
                        <Pressable
                          onPress={() =>
                            setOpenMenu((cur) => (cur?.index === index && cur.kind === 'category' ? null : { index, kind: 'category' }))
                          }
                          className="flex-row items-center gap-1 rounded-full border border-gray-300 px-3 py-1"
                        >
                          <Text className="text-xs font-medium text-gray-600">
                            {selectedCategory?.name ?? 'Choose category'}
                          </Text>
                          <Ionicons name="chevron-down" size={12} color="#6B7280" />
                        </Pressable>
                        {openMenu?.index === index && openMenu.kind === 'category' && (
                          <View className="mt-1 rounded-lg border border-gray-200 bg-white" style={{ minWidth: 160 }}>
                            {(expenseCategories ?? []).length === 0 ? (
                              <Text className="px-3 py-2 text-xs text-gray-400">No categories yet</Text>
                            ) : (
                              (expenseCategories ?? []).map((cat) => (
                                <Pressable
                                  key={cat.id}
                                  onPress={() => {
                                    updateRow(index, { expenseCategoryId: cat.id });
                                    setOpenMenu(null);
                                  }}
                                  className="border-b border-gray-100 px-3 py-2 last:border-b-0"
                                >
                                  <Text className="text-xs text-gray-700">{cat.name}</Text>
                                </Pressable>
                              ))
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
          />

          <View
            className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <Pressable
              onPress={handleImport}
              disabled={importing || selectedCount === 0}
              className="items-center rounded-lg bg-blue-600 py-3 disabled:opacity-40"
            >
              <Text className="text-sm font-semibold text-white">
                {importing ? 'Importing…' : `Import Selected (${selectedCount})`}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
