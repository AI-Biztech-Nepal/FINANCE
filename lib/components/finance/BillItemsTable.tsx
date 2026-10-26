// lib/components/finance/BillItemsTable.tsx
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FinanceItem, Product } from '../../../types/database.types';
import { readKey } from '../../utils/webKeys';
import { SuggestInput, type SuggestOption } from './SuggestInput';
import { round2, formatMoney } from '../../utils/money';
import { decimalInput } from '../../utils/number';

export interface BillItemRow {
  /** Optional HS code of the item (customs / tariff classification). */
  hs_code?: string;
  description: string;
  qty: string;
  rate: string;
  hsCode?: string;
  /** Optional model number of the item (see `withModel`). */
  model?: string;
}

export interface BillItemsTableHandle {
  focusRow: (index: number, col?: 0 | 1 | 2 | 3) => void;
}

/** 0 Item, 1 Qty, 2 Rate, 3 HS code, 4 Model No. */
type Col = 0 | 1 | 2 | 3 | 4;
/** The order the keyboard walks a row in - the order the cells are drawn: HS code, Item, (Model No.,) Qty,
 * Rate. Enter goes forward through it (and from the Rate to the next row's HS code), Shift+Enter goes
 * back. The HS code is optional, but it is always in the way: Enter on an empty one just moves on. */
const WALK: Col[] = [3, 0, 1, 2];
const WALK_WITH_MODEL: Col[] = [3, 0, 4, 1, 2];
const MAX_SUGGESTIONS = 6;
const ADD_STOCK_ITEM_KEY = '__add-stock-item__';

interface ItemSuggestion {
  key: string;
  name: string;
  rate: number | null;
  hint: string;
}

interface Props {
  items: BillItemRow[];
  products: Product[];
  financeItems: FinanceItem[];
  accent: string;
  onUpdate: (index: number, next: BillItemRow) => void;
  onRemove: (index: number) => void;
  onRequestSave: () => void;
  /** When set, a name that isn't a stock item yet gets an "Add as new stock
   * item" row at the bottom of the dropdown; choosing it calls this with the
   * name and rate typed so far and the row it was typed in. The owner shows
   * its Save / Cancel popup and fills the row in (see `focusRow`) only if the
   * item is saved - the row is left exactly as typed until then. */
  onAddStockItem?: (name: string, rate: string, index: number) => void;
  /** Enter on the blank last row: the list is finished, move on (to Discount). */
  onExit: () => void;
  /** Rendered inside the card under the rows (the totals band). */
  footer?: ReactNode;
  /** Adds a Model No. column beside the item - for goods that are told apart by model (a vehicle). */
  withModel?: boolean;
}

function isBlank(row: BillItemRow): boolean {
  return !row.description.trim() && !row.qty.trim() && !row.rate.trim() && !row.hsCode?.trim() && !row.model?.trim();
}

function amountOf(row: BillItemRow): number {
  return round2((Number(row.qty) || 0) * (Number(row.rate) || 0));
}

function cleanNumber(v: string): string {
  return decimalInput(v);
}

export const BillItemsTable = forwardRef<BillItemsTableHandle, Props>(function BillItemsTable(
  { items, products, financeItems, accent, onUpdate, onRemove, onRequestSave, onAddStockItem, onExit, footer, withModel },
  ref
) {
  const walk = withModel ? WALK_WITH_MODEL : WALK;
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const [focusedCell, setFocusedCell] = useState<{ index: number; col: Col } | null>(null);

  useImperativeHandle(ref, () => ({
    // Starts at the first cell drawn - the HS code.
    focusRow: (index, col = 3) => {
      inputRefs.current[`${index}:${col}`]?.focus();
    },
  }));

  const catalog = useMemo<ItemSuggestion[]>(() => {
    const seen = new Set<string>();
    const out: ItemSuggestion[] = [];
    for (const p of products) {
      const k = p.name.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: `p-${p.id}`,
        name: p.name,
        rate: Number(p.price) > 0 ? Number(p.price) : null,
        hint: `${Number(p.price) > 0 ? `NPR ${formatMoney(Number(p.price))} · ` : ''}stock ${p.stock_level}`,
      });
    }
    for (const f of financeItems) {
      const k = f.name.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: `f-${f.id}`,
        name: f.name,
        rate: f.rate != null ? Number(f.rate) : null,
        hint: f.rate != null ? `NPR ${formatMoney(Number(f.rate))}` : 'Saved item',
      });
    }
    return out;
  }, [products, financeItems]);

  const focusedItemIndex = focusedCell?.col === 0 ? focusedCell.index : null;
  const suggestions = useMemo<ItemSuggestion[]>(() => {
    if (focusedItemIndex == null) return [];
    const q = items[focusedItemIndex]?.description.trim().toLowerCase();
    if (!q) return [];
    const matches = catalog.filter((c) => c.name.toLowerCase().includes(q));
    matches.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)));
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [focusedItemIndex, items, catalog]);

  const suggestionOptions = useMemo<SuggestOption[]>(() => {
    const options: SuggestOption[] = suggestions.map((s) => ({ key: s.key, label: s.name, hint: s.hint }));
    const typed = focusedItemIndex != null ? (items[focusedItemIndex]?.description.trim() ?? '') : '';
    // Only a real product counts as "already in stock" - a name that was merely
    // typed into an earlier bill (financeItems) can still be promoted here.
    if (onAddStockItem && typed && !products.some((p) => p.name.trim().toLowerCase() === typed.toLowerCase())) {
      options.push({ key: ADD_STOCK_ITEM_KEY, label: `Add "${typed}" as new stock item`, kind: 'add' });
    }
    return options;
  }, [suggestions, focusedItemIndex, items, products, onAddStockItem]);

  function focusCell(index: number, col: Col) {
    inputRefs.current[`${index}:${col}`]?.focus();
  }

  function handleKeyPress(e: unknown, index: number, col: Col) {
    const k = readKey(e);
    if (k.key === 'Enter' && k.ctrl) {
      k.prevent();
      onRequestSave();
    } else if (k.key === 'Enter' && k.shift) {
      // Back one cell - and from a row's first cell to the Rate of the row above.
      k.prevent();
      const at = walk.indexOf(col);
      if (at > 0) focusCell(index, walk[at - 1]);
      else if (index > 0) focusCell(index - 1, walk[walk.length - 1]);
    } else if (k.key === 'Enter') {
      k.prevent();
      const at = walk.indexOf(col);
      if (at < walk.length - 1) focusCell(index, walk[at + 1]);
      else if (index < items.length - 1) focusCell(index + 1, walk[0]);
      else onExit();
    } else if (k.key === 'ArrowDown' && index < items.length - 1) {
      k.prevent();
      focusCell(index + 1, col);
    } else if (k.key === 'ArrowUp' && index > 0) {
      k.prevent();
      focusCell(index - 1, col);
    }
  }

  function cellStyle(index: number, col: Col) {
    const focused = focusedCell?.index === index && focusedCell.col === col;
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
  const filled = items.filter((r) => !isBlank(r)).length;

  return (
    <View
      className="rounded-2xl border border-gray-200 bg-white"
      // zIndex: react-native-web gives every View its own stacking context, so
      // without it the typeahead list would paint under whatever follows the card.
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)', zIndex: 10 }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="cube-outline" size={14} color="#6B7280" />
          <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">Items</Text>
        </View>
        <Text className="text-[11px] text-gray-400">
          {filled} {filled === 1 ? 'item' : 'items'}
        </Text>
      </View>

      <View className="flex-row items-center border-y border-gray-200 bg-gray-50 px-2 py-2">
        <Text className="text-center text-[11px] font-bold capitalize tracking-wider text-gray-500" style={{ width: 36 }}>
          #
        </Text>
        <Text className={headClass} style={{ width: 110 }}>
          HS Code
        </Text>
        <Text className={headClass} style={{ flex: 1 }}>
          Item
        </Text>
        {withModel && (
          <Text className={headClass} style={{ width: 150 }}>
            Model No.
          </Text>
        )}
        <Text className={`${headClass} text-right`} style={{ width: 90 }}>
          Qty
        </Text>
        <Text className={`${headClass} text-right`} style={{ width: 120 }}>
          Rate
        </Text>
        <Text className={`${headClass} text-right`} style={{ width: 130 }}>
          Amount
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {items.map((row, index) => {
        const rowFocused = focusedCell?.index === index;
        const blank = isBlank(row);
        const amount = amountOf(row);
        return (
          <View
            key={index}
            className="flex-row items-center border-b border-gray-100 px-2 py-0.5"
            style={{ backgroundColor: rowFocused ? `${accent}0D` : 'transparent', zIndex: rowFocused ? 5 : 0 }}
          >
            <Text className="text-center text-xs font-semibold text-gray-400" style={{ width: 36 }}>
              {index + 1}
            </Text>

            <View style={{ width: 110 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${index}:3`] = el;
                }}
                value={row.hs_code ?? ''}
                onChangeText={(v) => onUpdate(index, { ...row, hs_code: v.replace(/[^0-9.]/g, '') })}
                onFocus={() => setFocusedCell({ index, col: 3 })}
                onBlur={() => setFocusedCell((cur) => (cur?.index === index && cur.col === 3 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, index, 3)}
                placeholder="HS code"
                placeholderTextColor="#B2B8C1"
                accessibilityLabel={`HS code, row ${index + 1}`}
                selectTextOnFocus
                className={cellClass}
                style={cellStyle(index, 3)}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <SuggestInput
                value={row.description}
                onChangeText={(v) => onUpdate(index, { ...row, description: v })}
                options={focusedItemIndex === index ? suggestionOptions : []}
                onSelectOption={(opt, via) => {
                  if (opt.key === ADD_STOCK_ITEM_KEY) {
                    onAddStockItem?.(row.description.trim(), row.rate, index);
                    return;
                  }
                  const s = suggestions.find((x) => x.key === opt.key);
                  if (!s) return;
                  onUpdate(index, {
                    hs_code: row.hs_code,
                    model: row.model,
                    description: s.name,
                    qty: row.qty.trim() ? row.qty : '1',
                    rate: s.rate != null ? String(s.rate) : row.rate,
                  });
                  if (via !== 'tab') focusCell(index, 1);
                }}
                inputRef={(el) => {
                  inputRefs.current[`${index}:0`] = el;
                }}
                onFocus={() => setFocusedCell({ index, col: 0 })}
                onBlur={() => setFocusedCell((cur) => (cur?.index === index && cur.col === 0 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, index, 0)}
                placeholder={blank ? 'Item name…' : 'Item'}
                accessibilityLabel={`Item, row ${index + 1}`}
                accent={accent}
                compact
                inputClassName={cellClass}
                inputStyle={cellStyle(index, 0)}
              />
            </View>

            {withModel && (
              <View style={{ width: 150 }}>
                <TextInput
                  ref={(el) => {
                    inputRefs.current[`${index}:4`] = el;
                  }}
                  value={row.model ?? ''}
                  onChangeText={(v) => onUpdate(index, { ...row, model: v })}
                  onFocus={() => setFocusedCell({ index, col: 4 })}
                  onBlur={() => setFocusedCell((cur) => (cur?.index === index && cur.col === 4 ? null : cur))}
                  onKeyPress={(e) => handleKeyPress(e, index, 4)}
                  placeholder="Model no."
                  placeholderTextColor="#B2B8C1"
                  accessibilityLabel={`Model number, row ${index + 1}`}
                  selectTextOnFocus
                  className={cellClass}
                  style={cellStyle(index, 4)}
                />
              </View>
            )}

            <View style={{ width: 90 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${index}:1`] = el;
                }}
                value={row.qty}
                onChangeText={(v) => onUpdate(index, { ...row, qty: cleanNumber(v) })}
                onFocus={() => setFocusedCell({ index, col: 1 })}
                onBlur={() => setFocusedCell((cur) => (cur?.index === index && cur.col === 1 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, index, 1)}
                placeholder="0"
                placeholderTextColor="#B2B8C1"
                keyboardType="numeric"
                accessibilityLabel={`Quantity, row ${index + 1}`}
                selectTextOnFocus
                className={`${cellClass} text-right`}
                style={cellStyle(index, 1)}
              />
            </View>

            <View style={{ width: 120 }}>
              <TextInput
                ref={(el) => {
                  inputRefs.current[`${index}:2`] = el;
                }}
                value={row.rate}
                onChangeText={(v) => onUpdate(index, { ...row, rate: cleanNumber(v) })}
                onFocus={() => setFocusedCell({ index, col: 2 })}
                onBlur={() => setFocusedCell((cur) => (cur?.index === index && cur.col === 2 ? null : cur))}
                onKeyPress={(e) => handleKeyPress(e, index, 2)}
                placeholder="0"
                placeholderTextColor="#B2B8C1"
                keyboardType="numeric"
                accessibilityLabel={`Rate, row ${index + 1}`}
                selectTextOnFocus
                className={`${cellClass} text-right`}
                style={cellStyle(index, 2)}
              />
            </View>

            <Text
              className={`px-2.5 text-right text-xs font-bold ${amount > 0 ? 'text-gray-900' : 'text-gray-300'}`}
              style={{ width: 130 }}
              numberOfLines={1}
            >
              {amount > 0 ? formatMoney(amount) : '—'}
            </Text>

            <View style={{ width: 36, alignItems: 'center' }}>
              {!blank && (
                <Pressable
                  onPress={() => onRemove(index)}
                  tabIndex={-1}
                  hitSlop={6}
                  accessibilityLabel={`Remove row ${index + 1}`}
                  style={{ opacity: 0.6 }}
                >
                  <Ionicons name="close-circle" size={18} color="#DC2626" />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      {footer}
    </View>
  );
});
