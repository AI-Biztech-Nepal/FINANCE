// lib/components/finance/PaymentEntryTable.tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Customer } from '../../../types/database.types';
import type { PhoneContactEntry } from '../../hooks/usePhoneContacts';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../../utils/customerSuggestions';
import { readKey } from '../../utils/webKeys';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { decimalInput } from '../../utils/number';
import { formatMoney } from '../../utils/money';

export interface PaymentRow {
  key: string;
  customerName: string;
  selectedCustomer: Customer | null;
  // Phone of a phone-contact suggestion that isn't a saved customer yet -
  // used when that customer is created at save time.
  pendingPhone: string | null;
  amount: string;
  note: string;
  /** The car (its number) a payment is for - only on a vehicle account (see `withCar`). */
  item: string;
}

export interface PaymentEntryTableHandle {
  /** Puts the caret in a cell of the row with this key (works for a row added in the same tick). */
  focusRow: (rowKey: string, col?: 0 | 1 | 2) => void;
}

// 0 party, 1 amount, 2 remarks; 3 item sits between the party and the amount when `withCar`.
type Col = 0 | 1 | 2 | 3;
const MAX_SUGGESTIONS = 6;
const ADD_PARTY_KEY = '__add-party__';

interface Props {
  rows: PaymentRow[];
  customers: Customer[];
  phoneContacts: PhoneContactEntry[];
  accent: string;
  partyLabel: string;
  addLabel: string;
  totalLabel: string;
  /** The total's colour - green for money in, red for money out; defaults to `accent`. */
  totalColor?: string;
  onUpdateRow: (key: string, patch: Partial<PaymentRow>) => void;
  /** Appends an empty row and returns its key. */
  onAddRow: () => string;
  onRemoveRow: (key: string) => void;
  onRequestSave: () => void;
  /** Enter on a blank last row: the list is finished, move on (to Save). */
  onExit: () => void;
  autoFocusFirst?: boolean;
  /** Saves a typed name as a new customer / vendor on the spot. The "Add ... as new ..." row only shows when this is given. */
  onCreateParty?: (name: string) => Promise<Customer | null>;
  /** A vehicle account: each row also names the car it pays for (Item). */
  withCar?: boolean;
  /** The cars to pick for a row's vendor - only theirs - narrowed by what is typed. */
  carOptionsFor?: (vendor: Customer | null, typed: string) => SuggestOption[];
  /** What is still owed to a saved vendor (negative = paid ahead). When given, the vendor box shows it. */
  dueOf?: (partyId: string) => number;
  /** What is still owed on one car of a vendor; null when it is not one of theirs. When given, the Item box shows it. */
  itemDueOf?: (vendor: Customer | null, item: string) => number | null;
}

function rowHasContent(row: PaymentRow): boolean {
  return !!(row.customerName.trim() || row.amount.trim() || row.note.trim() || row.item.trim());
}

export const PaymentEntryTable = forwardRef<PaymentEntryTableHandle, Props>(function PaymentEntryTable(
  {
    rows,
    customers,
    phoneContacts,
    accent,
    partyLabel,
    addLabel,
    totalLabel,
    totalColor,
    onUpdateRow,
    onAddRow,
    onRemoveRow,
    onRequestSave,
    onExit,
    autoFocusFirst,
    onCreateParty,
    withCar,
    carOptionsFor,
    dueOf,
    itemDueOf,
  },
  ref
) {
  // The order Enter / Tab walk along a row.
  const order: Col[] = withCar ? [0, 3, 1, 2] : [0, 1, 2];
  const amountWidth = withCar ? 140 : 160;
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const pendingFocus = useRef<{ key: string; col: Col } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ key: string; col: Col } | null>(null);

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
    const q = row?.customerName.trim();
    if (!row || !q) return [];
    if (row.selectedCustomer && row.selectedCustomer.name === row.customerName) return [];
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
    const typed = row?.customerName.trim() ?? '';
    const linkedExact = !!row?.selectedCustomer && row.selectedCustomer.name === row.customerName;
    if (onCreateParty && typed && !linkedExact && !customers.some((c) => c.name.trim().toLowerCase() === typed.toLowerCase())) {
      options.push({ key: ADD_PARTY_KEY, label: `Add "${typed}" as new ${partyLabel.toLowerCase()}`, kind: 'add' });
    }
    return options;
  }, [suggestions, focusedRowKey, rows, customers, onCreateParty, partyLabel]);

  function focusCell(rowIndex: number, col: Col) {
    const row = rows[rowIndex];
    if (row) inputRefs.current[`${row.key}:${col}`]?.focus();
  }

  function addRowAndFocus(col: Col) {
    pendingFocus.current = { key: onAddRow(), col };
  }

  // Enter = Tab, except in the last cell of the last row: a row with
  // something in it starts a new row, a blank one means "done" and moves on.
  function advance(rowIndex: number, col: Col) {
    const at = order.indexOf(col);
    if (at < order.length - 1) focusCell(rowIndex, order[at + 1]);
    else if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, 0);
    else if (rowHasContent(rows[rowIndex])) addRowAndFocus(0);
    else onExit();
  }

  // Shift+Enter is Shift+Tab: back one cell, or to the last cell of the row above.
  function retreat(rowIndex: number, col: Col) {
    const at = order.indexOf(col);
    if (at > 0) focusCell(rowIndex, order[at - 1]);
    else if (rowIndex > 0) focusCell(rowIndex - 1, order[order.length - 1]);
  }

  function handleKeyPress(e: unknown, row: PaymentRow, rowIndex: number, col: Col) {
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
      else if (rowHasContent(row)) addRowAndFocus(col);
    } else if (k.key === 'ArrowUp' && rowIndex > 0) {
      k.prevent();
      focusCell(rowIndex - 1, col);
    }
  }

  function cellStyle(rowKey: string, col: Col) {
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

  return (
    <View
      className="rounded-2xl border border-gray-200 bg-white"
      // zIndex: react-native-web gives every View its own stacking context, so
      // without it the typeahead list would paint under whatever follows the card.
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)', zIndex: 10 }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="people-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">{partyLabel}s</Text>
        </View>
        <Text className="text-xs text-gray-400">
          {filled} {filled === 1 ? 'entry' : 'entries'}
        </Text>
      </View>

      <View className="flex-row items-center border-y border-gray-200 bg-gray-50 px-2 py-2">
        <Text className="text-center text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ width: 36 }}>
          #
        </Text>
        <Text className="px-2.5 text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ flex: 1.35 }}>
          {partyLabel}
        </Text>
        {withCar && (
          <Text className="px-2.5 text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ flex: 1.2 }}>
            Item
          </Text>
        )}
        <Text
          className="px-2.5 text-right text-[11px] font-bold capitalize tracking-wider text-gray-500"
          style={{ width: amountWidth }}
        >
          Amount (NPR)
        </Text>
        <Text className="px-2.5 text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ flex: 1.1 }}>
          Remarks
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {rows.map((row, rowIndex) => {
        const rowFocused = focusedCell?.key === row.key;
        const linked =
          row.selectedCustomer ??
          (row.customerName.trim()
            ? (customers.find((c) => c.name.trim().toLowerCase() === row.customerName.trim().toLowerCase()) ?? null)
            : null);
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
                value={row.customerName}
                onChangeText={(v) => {
                  const stillLinked = row.selectedCustomer && row.selectedCustomer.name === v;
                  onUpdateRow(row.key, {
                    customerName: v,
                    selectedCustomer: stillLinked ? row.selectedCustomer : null,
                    pendingPhone: null,
                  });
                }}
                options={focusedRowKey === row.key ? suggestionOptions : []}
                onSelectOption={async (opt, via) => {
                  if (opt.key === ADD_PARTY_KEY) {
                    const created = await onCreateParty?.(row.customerName.trim());
                    if (created) {
                      onUpdateRow(row.key, { customerName: created.name, selectedCustomer: created, pendingPhone: null });
                      if (via !== 'tab') inputRefs.current[`${row.key}:${order[1]}`]?.focus();
                    } else {
                      // Cancelled in the confirmation: the name is dropped, so it cannot be saved by accident.
                      onUpdateRow(row.key, { customerName: '', selectedCustomer: null, pendingPhone: null });
                    }
                    return;
                  }
                  const s = suggestions.find((x) => x.key === opt.key);
                  if (!s) return;
                  onUpdateRow(row.key, {
                    customerName: s.name,
                    selectedCustomer: s.customer,
                    pendingPhone: s.customer ? null : s.phone,
                  });
                  if (via !== 'tab') inputRefs.current[`${row.key}:${order[1]}`]?.focus();
                }}
                inputRef={(el) => {
                  inputRefs.current[`${row.key}:0`] = el;
                }}
                onFocus={() => setFocusedCell({ key: row.key, col: 0 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 0 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 0)}
                enterAddsNew
                placeholder="Who is this from?"
                accessibilityLabel={`${partyLabel}, row ${rowIndex + 1}`}
                autoFocus={autoFocusFirst && rowIndex === 0}
                accent={accent}
                inputClassName={cellClass}
                inputStyle={cellStyle(row.key, 0)}
                adornmentWidth={54}
                adornment={
                  linked ? (
                    <Ionicons name="checkmark-circle" size={15} color={accent} />
                  ) : row.customerName.trim() ? (
                    <Text className="text-[10px] font-bold capitalize text-gray-400">New</Text>
                  ) : null
                }
              />
              {/* What is still owed to the chosen vendor, so the amount can be set against it. */}
              {linked && dueOf ? (
                (() => {
                  const due = dueOf(linked.id);
                  return (
                    <Text
                      className="px-2.5 pb-1 text-[11px] font-semibold"
                      style={{ color: due > 0 ? '#B91C1C' : due < 0 ? '#047857' : '#9CA3AF' }}
                      numberOfLines={1}
                    >
                      {due > 0 ? `Due NPR ${formatMoney(due)}` : due < 0 ? `Paid ahead NPR ${formatMoney(-due)}` : 'Nothing due'}
                    </Text>
                  );
                })()
              ) : null}
            </View>

            {withCar && (
              <>
                {/* The car this payment is for: only the cars bought from this vendor. */}
                <View style={{ flex: 1.2, minWidth: 0 }}>
                  <SuggestInput
                    value={row.item}
                    onChangeText={(v) => onUpdateRow(row.key, { item: v })}
                    options={focusedCell?.key === row.key && focusedCell.col === 3 ? carOptionsFor?.(linked, row.item) ?? [] : []}
                    showWhenEmpty
                    onSelectOption={(opt, via) => {
                      onUpdateRow(row.key, { item: opt.label });
                      if (via !== 'tab') inputRefs.current[`${row.key}:1`]?.focus();
                    }}
                    inputRef={(el) => {
                      inputRefs.current[`${row.key}:3`] = el;
                    }}
                    onFocus={() => setFocusedCell({ key: row.key, col: 3 })}
                    onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 3 ? null : cur))}
                    onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 3)}
                    placeholder="Car number"
                    accessibilityLabel={`Item, row ${rowIndex + 1}`}
                    accent={accent}
                    inputClassName={cellClass}
                    inputStyle={cellStyle(row.key, 3)}
                    compact
                  />
                  {/* What is left to pay on this car, under it - as the vendor's due is under the vendor. */}
                  {itemDueOf
                    ? (() => {
                        const due = itemDueOf(linked, row.item);
                        if (due == null) return null;
                        return (
                          <Text
                            className="px-2.5 pb-1 text-[11px] font-semibold"
                            style={{ color: due > 0 ? '#B91C1C' : due < 0 ? '#047857' : '#9CA3AF' }}
                            numberOfLines={1}
                          >
                            {due > 0 ? `Due NPR ${formatMoney(due)}` : due < 0 ? `Paid ahead NPR ${formatMoney(-due)}` : 'Cleared'}
                          </Text>
                        );
                      })()
                    : null}
                </View>
              </>
            )}

            <View style={{ width: amountWidth }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${row.key}:1`] = el;
                }}
                value={row.amount}
                onChangeText={(v) => onUpdateRow(row.key, { amount: decimalInput(v) })}
                onFocus={() => setFocusedCell({ key: row.key, col: 1 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 1 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 1)}
                placeholder="0"
                placeholderTextColor="#B2B8C1"
                keyboardType="numeric"
                accessibilityLabel={`Amount in NPR, row ${rowIndex + 1}`}
                selectTextOnFocus
                className={`${cellClass} text-right font-semibold`}
                style={cellStyle(row.key, 1)}
              />
            </View>

            <View style={{ flex: 1.1, minWidth: 0 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${row.key}:2`] = el;
                }}
                value={row.note}
                onChangeText={(v) => onUpdateRow(row.key, { note: v })}
                onFocus={() => setFocusedCell({ key: row.key, col: 2 })}
                onBlur={() => setFocusedCell((cur) => (cur?.key === row.key && cur.col === 2 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, row, rowIndex, 2)}
                placeholder="Optional"
                placeholderTextColor="#B2B8C1"
                accessibilityLabel={`Remarks, row ${rowIndex + 1}`}
                selectTextOnFocus
                className={cellClass}
                style={cellStyle(row.key, 2)}
              />
            </View>

            <View style={{ width: 36, alignItems: 'center' }}>
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
            </View>
          </View>
        );
      })}

      <View
        className="flex-row flex-wrap items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2.5"
        style={{ borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
      >
        <Pressable
          onPress={() => addRowAndFocus(0)}
          tabIndex={-1}
          className="flex-row items-center gap-1.5 rounded-lg px-2 py-2"
          accessibilityLabel={addLabel}
        >
          <Ionicons name="add-circle-outline" size={17} color={accent} />
          <Text className="text-sm font-bold" style={{ color: accent }}>
            {addLabel}
          </Text>
        </Pressable>
        <View className="flex-row items-baseline gap-3 pr-2">
          <Text className="text-[13px] font-semibold text-gray-500">{totalLabel}</Text>
          <Text className="text-xl font-extrabold" style={{ color: totalColor ?? accent }}>
            NPR {formatMoney(total)}
          </Text>
        </View>
      </View>
    </View>
  );
});
