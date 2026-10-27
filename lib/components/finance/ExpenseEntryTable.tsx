// lib/components/finance/ExpenseEntryTable.tsx
//
// The Expenses entry table - the same desk-style table Received / Payment Out
// use (PaymentEntryTable): numbered rows, a header strip, keyboard walk between
// cells, "Add" + a running total underneath. An expense also has a Category,
// and its "Paid to" name is optional, so it has its own table rather than a
// column bolted onto the payment one.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Customer, ExpenseCategory } from '../../../types/database.types';
import type { PhoneContactEntry } from '../../hooks/usePhoneContacts';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../../utils/customerSuggestions';
import { readKey } from '../../utils/webKeys';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { decimalInput } from '../../utils/number';
import { formatMoney } from '../../utils/money';

export interface ExpenseEntryRow {
  key: string;
  partyName: string;
  /** Set when "Paid to" is one of the saved customers / vendors. */
  customerId: string | null;
  categoryId: string | null;
  amount: string;
  note: string;
}

/** 0 Paid to, 1 Category, 2 Amount, 3 Remarks. */
export type ExpenseCol = 0 | 1 | 2 | 3;

export interface ExpenseEntryTableHandle {
  /** Puts the caret in a cell of the row with this key (works for a row added in the same tick). */
  focusRow: (rowKey: string, col?: ExpenseCol) => void;
}

const MAX_SUGGESTIONS = 6;
const ADD_PARTY_KEY = '__add-party__';
const LAST_COL: ExpenseCol = 3;

type Focusable = { focus: () => void };

interface Props {
  rows: ExpenseEntryRow[];
  customers: Customer[];
  phoneContacts: PhoneContactEntry[];
  categories: ExpenseCategory[];
  accent: string;
  totalColor?: string;
  /** Editing one expense: just its row - no adding or removing rows. */
  single?: boolean;
  onUpdateRow: (key: string, patch: Partial<ExpenseEntryRow>) => void;
  /** Appends an empty row and returns its key. */
  onAddRow: () => string;
  onRemoveRow: (key: string) => void;
  /** Opens the category list (pick, add, rename) for this row. */
  onPickCategory: (rowKey: string) => void;
  /** A phone contact that isn't a saved customer was picked as "Paid to". */
  onSelectContact: (rowKey: string, name: string, phone: string | null) => void;
  onRequestSave: () => void;
  /** Enter on a blank last row: the list is finished, move on (to Save). */
  onExit: () => void;
  autoFocusFirst?: boolean;
  /** Saves a typed "Paid to" name as a new vendor on the spot. The "Add ... as new vendor" row only shows when this is given. */
  onCreateParty?: (name: string) => Promise<Customer | null>;
}

function rowHasContent(row: ExpenseEntryRow): boolean {
  return !!(row.partyName.trim() || row.categoryId || row.amount.trim() || row.note.trim());
}

export const ExpenseEntryTable = forwardRef<ExpenseEntryTableHandle, Props>(function ExpenseEntryTable(
  {
    rows,
    customers,
    phoneContacts,
    categories,
    accent,
    totalColor,
    single,
    onUpdateRow,
    onAddRow,
    onRemoveRow,
    onPickCategory,
    onSelectContact,
    onRequestSave,
    onExit,
    autoFocusFirst,
    onCreateParty,
  },
  ref
) {
  const inputRefs = useRef<Record<string, Focusable | null>>({});
  const pendingFocus = useRef<{ key: string; col: ExpenseCol } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ key: string; col: ExpenseCol } | null>(null);

  const filled = rows.filter(rowHasContent).length;
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // A row added a moment ago only has its inputs after the re-render, so the
  // caret move waits for that render instead of racing it.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const el = inputRefs.current[`${target.key}:${target.col}`];
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  }, [rows]);

  useImperativeHandle(ref, () => ({
    focusRow: (rowKey, col = 0) => {
      pendingFocus.current = { key: rowKey, col };
      const el = inputRefs.current[`${rowKey}:${col}`];
      if (el) {
        pendingFocus.current = null;
        el.focus();
      }
    },
  }));

  const focusedRowKey = focusedCell?.col === 0 ? focusedCell.key : null;
  const suggestions = useMemo<CustomerSuggestion[]>(() => {
    if (!focusedRowKey) return [];
    const row = rows.find((r) => r.key === focusedRowKey);
    const q = row?.partyName.trim();
    if (!row || !q) return [];
    if (row.customerId && customers.find((c) => c.id === row.customerId)?.name === row.partyName) return [];
    return buildCustomerSuggestions(customers, phoneContacts, q, MAX_SUGGESTIONS);
  }, [focusedRowKey, rows, customers, phoneContacts]);

  const suggestionOptions = useMemo<SuggestOption[]>(() => {
    const options: SuggestOption[] = suggestions.map((s) => ({
      key: s.key,
      label: s.name,
      hint: s.customer ? s.phone : 'From contacts',
    }));
    // Nobody saved goes by what was typed: offer to add them right here, like the stock item box does.
    const row = focusedRowKey ? rows.find((r) => r.key === focusedRowKey) : null;
    const typed = row?.partyName.trim() ?? '';
    const linkedExact = !!row?.customerId && customers.find((c) => c.id === row.customerId)?.name === row.partyName;
    if (onCreateParty && typed && !linkedExact && !customers.some((c) => c.name.trim().toLowerCase() === typed.toLowerCase())) {
      options.push({ key: ADD_PARTY_KEY, label: `Add "${typed}" as new vendor`, kind: 'add' });
    }
    return options;
  }, [suggestions, focusedRowKey, rows, customers, onCreateParty]);

  function focusCell(rowIndex: number, col: ExpenseCol) {
    const row = rows[rowIndex];
    if (row) inputRefs.current[`${row.key}:${col}`]?.focus();
  }

  function addRowAndFocus(col: ExpenseCol) {
    pendingFocus.current = { key: onAddRow(), col };
  }

  // Enter = Tab, except in the last cell of the last row: a row with
  // something in it starts a new row, a blank one means "done" and moves on.
  function advance(rowIndex: number, col: ExpenseCol) {
    if (col < LAST_COL) focusCell(rowIndex, (col + 1) as ExpenseCol);
    else if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, 0);
    else if (!single && rowHasContent(rows[rowIndex])) addRowAndFocus(0);
    else onExit();
  }

  // Shift+Enter is Shift+Tab: back one cell, or to the last cell of the row above.
  function retreat(rowIndex: number, col: ExpenseCol) {
    if (col > 0) focusCell(rowIndex, (col - 1) as ExpenseCol);
    else if (rowIndex > 0) focusCell(rowIndex - 1, LAST_COL);
  }

  function handleKeyPress(e: unknown, row: ExpenseEntryRow, rowIndex: number, col: ExpenseCol) {
    const k = readKey(e);
    if (k.key === 'Enter' && k.ctrl) {
      k.prevent();
      onRequestSave();
    } else if (k.key === 'Enter' && k.shift) {
      k.prevent();
      retreat(rowIndex, col);
    } else if (k.key === 'Enter') {
      k.prevent();
      advance(rowIndex, col);
    } else if (k.key === 'ArrowDown') {
      k.prevent();
      if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, col);
      else if (!single && rowHasContent(row)) addRowAndFocus(col);
    } else if (k.key === 'ArrowUp' && rowIndex > 0) {
      k.prevent();
      focusCell(rowIndex - 1, col);
    }
  }

  function cellStyle(rowKey: string, col: ExpenseCol) {
    const focused = focusedCell?.key === rowKey && focusedCell.col === col;
    return [
      {
        borderWidth: 1.5,
        borderColor: focused ? accent : '#F1F2F4',
        backgroundColor: focused ? '#FFFFFF' : 'transparent',
      },
      focused ? { boxShadow: `0 0 0 3px ${accent}29` } : null,
      { outlineStyle: 'none' } as object,
    ];
  }

  const cellClass = 'rounded-lg px-2.5 py-2.5 text-sm text-gray-900';
  const headClass = 'px-2.5 text-[11px] font-bold capitalize tracking-wider text-gray-500';

  return (
    <View
      className="rounded-2xl border border-gray-200 bg-white"
      // zIndex: react-native-web gives every View its own stacking context, so
      // without it the typeahead list would paint under whatever follows the card.
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)', zIndex: 10 }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="receipt-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">Expenses</Text>
        </View>
        <Text className="text-xs text-gray-400">
          {filled} {filled === 1 ? 'entry' : 'entries'}
        </Text>
      </View>

      <View className="flex-row items-center border-y border-gray-200 bg-gray-50 px-2 py-2">
        <Text className="text-center text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ width: 36 }}>
          #
        </Text>
        <Text className={headClass} style={{ flex: 1.35 }}>
          Paid to
        </Text>
        <Text className={headClass} style={{ flex: 1.1 }}>
          Category
        </Text>
        <Text className={`${headClass} text-right`} style={{ width: 160 }}>
          Amount (NPR)
        </Text>
        <Text className={headClass} style={{ flex: 1.1 }}>
          Remarks
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {rows.map((row, rowIndex) => {
        const rowFocused = focusedCell?.key === row.key;
        const category = categories.find((c) => c.id === row.categoryId) ?? null;
        const linked = !!row.customerId && customers.find((c) => c.id === row.customerId)?.name === row.partyName;
        return (
          <View
            key={row.key}
            className="flex-row items-center border-b border-gray-100 px-2 py-0.5"
            style={{ backgroundColor: rowFocused ? `${accent}0D` : 'transparent', zIndex: rowFocused ? 5 : 0 }}
          >
            <Text className="text-center text-[13px] font-semibold text-gray-400" style={{ width: 36 }}>
              {rowIndex + 1}
            </Text>

            <View style={{ flex: 1.35, minWidth: 0 }}>
              <SuggestInput
                value={row.partyName}
                onChangeText={(v) => {
                  const stillLinked = !!row.customerId && customers.find((c) => c.id === row.customerId)?.name === v;
                  onUpdateRow(row.key, { partyName: v, customerId: stillLinked ? row.customerId : null });
                }}
                options={focusedRowKey === row.key ? suggestionOptions : []}
                onSelectOption={async (opt, via) => {
                  if (opt.key === ADD_PARTY_KEY) {
                    const created = await onCreateParty?.(row.partyName.trim());
                    // Cancelled in the confirmation: the typed name stays and the caret stays in the box.
                    if (created) {
                      onUpdateRow(row.key, { partyName: created.name, customerId: created.id });
                      if (via !== 'tab') inputRefs.current[`${row.key}:1`]?.focus();
                    }
                    return;
                  }
                  const s = suggestions.find((x) => x.key === opt.key);
                  if (!s) return;
                  if (s.customer) onUpdateRow(row.key, { partyName: s.name, customerId: s.customer.id });
                  else onSelectContact(row.key, s.name, s.phone);
                  if (via !== 'tab') inputRefs.current[`${row.key}:1`]?.focus();
                }}
                inputRef={(el) => {
                  inputRefs.current[`${row.key}:0`] = el;
                }}
                onFocus={() => setFocusedCell({ key: row.key, col: 0 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 0 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 0)}
                enterAddsNew
                placeholder="Who was this paid to?"
                accessibilityLabel={`Paid to, row ${rowIndex + 1}`}
                autoFocus={autoFocusFirst && rowIndex === 0}
                accent={accent}
                inputClassName={cellClass}
                inputStyle={cellStyle(row.key, 0)}
                adornmentWidth={30}
                adornment={linked ? <Ionicons name="checkmark-circle" size={15} color={accent} /> : null}
              />
            </View>

            <View style={{ flex: 1.1, minWidth: 0 }}>
              {/* Enter or Space on the focused cell opens the category list. */}
              <Pressable
                ref={(el) => {
                  inputRefs.current[`${row.key}:1`] = el as unknown as Focusable | null;
                }}
                onPress={() => onPickCategory(row.key)}
                onFocus={() => setFocusedCell({ key: row.key, col: 1 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 1 ? null : cur))}
                accessibilityRole="button"
                accessibilityLabel={`Category, row ${rowIndex + 1}`}
                className={`${cellClass} flex-row items-center justify-between`}
                style={cellStyle(row.key, 1)}
              >
                <Text className="flex-1 text-sm" style={{ color: category ? '#111827' : '#B2B8C1' }} numberOfLines={1}>
                  {category?.name ?? 'Category'}
                </Text>
                <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
              </Pressable>
            </View>

            <View style={{ width: 160 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${row.key}:2`] = el;
                }}
                value={row.amount}
                onChangeText={(v) => onUpdateRow(row.key, { amount: decimalInput(v) })}
                onFocus={() => setFocusedCell({ key: row.key, col: 2 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 2 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 2)}
                placeholder="0"
                placeholderTextColor="#B2B8C1"
                keyboardType="numeric"
                accessibilityLabel={`Amount in NPR, row ${rowIndex + 1}`}
                selectTextOnFocus
                className={`${cellClass} text-right font-semibold`}
                style={cellStyle(row.key, 2)}
              />
            </View>

            <View style={{ flex: 1.1, minWidth: 0 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${row.key}:3`] = el;
                }}
                value={row.note}
                onChangeText={(v) => onUpdateRow(row.key, { note: v })}
                onFocus={() => setFocusedCell({ key: row.key, col: 3 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 3 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 3)}
                placeholder="Optional"
                placeholderTextColor="#B2B8C1"
                accessibilityLabel={`Remarks, row ${rowIndex + 1}`}
                selectTextOnFocus
                className={cellClass}
                style={cellStyle(row.key, 3)}
              />
            </View>

            <View style={{ width: 36, alignItems: 'center' }}>
              {!single && (
                <Pressable
                  onPress={() => onRemoveRow(row.key)}
                  disabled={rows.length === 1}
                  tabIndex={-1}
                  hitSlop={6}
                  accessibilityLabel={`Remove row ${rowIndex + 1}`}
                  style={{ opacity: rows.length === 1 ? 0 : 0.6 }}
                >
                  <Ionicons name="close-circle" size={18} color="#DC2626" />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      <View
        className="flex-row flex-wrap items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2.5"
        style={{ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
      >
        {single ? (
          <View />
        ) : (
          <Pressable
            onPress={() => addRowAndFocus(0)}
            tabIndex={-1}
            className="flex-row items-center gap-1.5 rounded-lg px-2 py-2"
            accessibilityLabel="Add expense"
          >
            <Ionicons name="add-circle-outline" size={17} color={accent} />
            <Text className="text-sm font-bold" style={{ color: accent }}>
              Add expense
            </Text>
          </Pressable>
        )}
        <View className="flex-row items-baseline gap-3 pr-2">
          <Text className="text-[13px] font-semibold text-gray-500">Total Expenses</Text>
          <Text className="text-xl font-extrabold" style={{ color: totalColor ?? accent }}>
            NPR {formatMoney(total)}
          </Text>
        </View>
      </View>
    </View>
  );
});
