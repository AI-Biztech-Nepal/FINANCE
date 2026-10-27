// lib/components/finance/BookKit.tsx
//
// The cash-book look the Day Book established - a strip of stat tiles and one
// bordered table with a totals footer, with each page's own controls up in the
// top bar - as reusable pieces, so the book pages read as one family.
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Text } from './CapsText';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { formatMoney } from '../../utils/money';
import { WEB_SIDEBAR_MIN_WIDTH } from '../web/WebSidebarShell';

/** Rupees with thousands separators, and paise when there are some; a dash for "nothing". */
export function money(n: number | null | undefined): string {
  return n == null ? '—' : formatMoney(n);
}

/** Same breakpoints the Day Book uses: `wide` once the sidebar layout is on,
 * `full` once every column fits beside it. */
export function useBookLayout(): { wide: boolean; full: boolean } {
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  return { wide, full: wide && width >= 1280 };
}

export function BookPage({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: wide ? 24 : 12, paddingTop: wide ? 24 : 12, paddingBottom: 48, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/** Segmented control for a page's filters - sits in the top bar on a wide screen. */
export function FilterTabs<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  /** The selected one - or null when none is (a preset that no longer matches). */
  value: K | null;
  onChange: (key: K) => void;
}) {
  return (
    <View className="flex-row rounded-lg bg-gray-100 p-1" style={{ gap: 2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            className="rounded-md px-3 py-1.5"
            style={on ? { backgroundColor: '#fff' } : undefined}
          >
            <Text className={`text-xs font-bold ${on ? 'text-blue-700' : 'text-gray-500'}`}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A page's main action (New sale, Add product ...). */
export function ToolbarButton({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-9 flex-row items-center justify-center rounded-lg px-3.5"
      style={{ backgroundColor: '#1D4ED8', gap: 6 }}
    >
      <Ionicons name={icon} size={16} color="#FFFFFF" />
      <Text className="text-[13px] font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

/** `label`: where it goes back to ("Balance Sheet"), beside the arrow. */
export function BackButton({ onPress, label }: { onPress: () => void; label?: string }) {
  if (label) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={`Back to ${label}`}
        className="h-9 flex-row items-center rounded-lg border border-gray-200 pl-2 pr-3"
        style={{ gap: 4 }}
      >
        <Ionicons name="chevron-back" size={18} color="#374151" />
        <Text className="text-[13px] font-semibold text-gray-700">{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityLabel="Back" className="h-9 w-9 items-center justify-center rounded-lg border border-gray-200">
      <Ionicons name="chevron-back" size={18} color="#374151" />
    </Pressable>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  wide,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** A fixed-width box in the top bar; otherwise it takes the row's spare width. */
  wide: boolean;
}) {
  return (
    <View
      className="h-9 flex-row items-center rounded-lg border border-gray-200 bg-white px-3"
      style={wide ? { width: 250 } : { flexGrow: 1, minWidth: 180 }}
    >
      <Ionicons name="search" size={15} color="#9CA3AF" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        autoComplete="off"
        spellCheck={false}
        className="ml-2 flex-1 text-sm text-gray-900"
        style={{ outlineStyle: 'none' } as object}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={15} color="#9CA3AF" />
        </Pressable>
      )}
    </View>
  );
}

/** For a page whose name is already in the top bar: its back button (phones only -
 * on a wide screen the sidebar does that job) and its main action go up there
 * too, so the page needs no title row of its own. `right` is registered when
 * `deps` change; read callbacks through a ref if they must be current. */
export function useBarActions(
  { wide, right, left }: { wide: boolean; right?: () => ReactNode; left?: () => ReactNode },
  deps: readonly unknown[]
) {
  useScreenHeader(
    { headerLeft: left ?? (wide ? undefined : () => <BackButton onPress={() => router.back()} />), headerRight: right },
    [wide, !!right, !!left, ...deps]
  );
}

/** Below this window width the top bar has no room for a page's controls (the
 * sidebar already takes 240px of it) - they drop to a row in the page instead. */
const TOOLBAR_IN_BAR_MIN_WIDTH = 1000;

/** Where a book page keeps its title controls: in the top bar beside the page
 * title on a wide screen (no card of their own), and - since a phone's or a
 * narrow window's bar has no room for them - as a plain wrapping row at the top
 * of the page otherwise. `right` is told which one it is being drawn for.
 * Render the returned node first inside <BookPage>.
 *
 * `left` (a back button) always goes in the bar. `right` is called for each
 * placement; it is registered with the bar only when `deps` change, so list
 * everything it reads (selected filter, search text ...) and read callbacks
 * through a ref. */
export function useBookToolbar(
  {
    title,
    resetTitle,
    wide,
    inBarMinWidth,
    left,
    right,
  }: {
    title?: string;
    resetTitle?: string;
    wide: boolean;
    /** Window width needed to keep the controls in the bar; a page with more of them asks for more. */
    inBarMinWidth?: number;
    left?: () => ReactNode;
    right?: (inBar: boolean) => ReactNode;
  },
  deps: readonly unknown[]
): ReactNode {
  const { width } = useWindowDimensions();
  const inBar = wide && width >= (inBarMinWidth ?? TOOLBAR_IN_BAR_MIN_WIDTH);
  useScreenHeader({ title, resetTitle, headerLeft: left, headerRight: inBar && right ? () => right(true) : undefined }, [title, inBar, !!left, !!right, ...deps]);
  if (inBar || !right) return null;
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
      {right(false)}
    </View>
  );
}

export function BookStats({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 10 }}>
      {children}
    </View>
  );
}

export function BookStat({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  /** Already formatted, e.g. "NPR 12,000" or "14". */
  value: string;
  color: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5"
      style={{ flexGrow: 1, flexBasis: 140 }}
    >
      <Text className="text-[11px] font-semibold capitalize tracking-wide text-gray-400">{label}</Text>
      <Text className="mt-0.5 text-[16px] font-extrabold" style={{ color }}>
        {value}
      </Text>
    </Pressable>
  );
}

export function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: bg }}>
      <Text className="text-[10.5px] font-bold" style={{ color }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export interface BookColumn<T> {
  key: string;
  label: string;
  /** Fixed width; leave out for the one column that takes the rest. */
  width?: number;
  align?: 'left' | 'right';
  render: (row: T, index: number) => ReactNode;
}

const CELL = 'px-2.5 py-2 border-r border-gray-200';

/** One bordered table: grey header row, bordered cells, optional day-group
 * rows and a totals footer. The single flexible column (the one without a
 * `width`) must come before any footer cells, which line up with the fixed
 * columns after it. */
export function BookTable<T>({
  columns,
  rows,
  rowKey,
  onRowPress,
  rowPressable,
  groupOf,
  highlight,
  expanded,
  footer,
  stickyHeader,
  bare,
  hideHeader,
  maxRows,
}: {
  columns: BookColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowPress?: (row: T) => void;
  /** Return false for a row that should not respond to `onRowPress` (it then has no tap/hover affordance). */
  rowPressable?: (row: T) => boolean;
  groupOf?: (row: T) => string;
  /** Rows to tint, e.g. the one currently open for editing. */
  highlight?: (row: T) => boolean;
  /** Content shown directly under a row, e.g. its edit form; return null for a row with none. */
  expanded?: (row: T) => ReactNode;
  footer?: { label: string; cells: Record<string, ReactNode> };
  /** Keep the header row pinned to the top of the page's scroll area (web only). */
  stickyHeader?: boolean;
  /** No border or rounded corners of its own - for a table that sits inside a card that has them. */
  bare?: boolean;
  /** No column-title row - for a table whose titles are shown by the header above it. */
  hideHeader?: boolean;
  /** Past this many rows the table stops growing and scrolls inside itself - exactly this many rows show - with
   * its header row and totals footer kept in view (web). */
  maxRows?: number;
}) {
  const limited = maxRows != null && maxRows > 0 && rows.length > maxRows && Platform.OS === 'web';
  // The page's own scroll pins the header; a table that scrolls inside itself pins it within that.
  const sticky = (stickyHeader && Platform.OS === 'web') || limited;
  // The rows' own heights, measured, so that exactly `maxRows` of them (with the header and footer) fit.
  const [heights, setHeights] = useState<{ head: number; foot: number; rows: Record<number, number> }>({ head: 0, foot: 0, rows: {} });
  const measure = (key: 'head' | 'foot', h: number) => setHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }));
  const measureRow = (index: number, h: number) =>
    setHeights((prev) => (prev.rows[index] === h ? prev : { ...prev, rows: { ...prev.rows, [index]: h } }));
  const shown = limited ? Array.from({ length: maxRows! }, (_, i) => heights.rows[i]) : [];
  const scrollHeight = limited && shown.every((h) => h != null) ? shown.reduce((a, b) => a + b, 0) + heights.head + heights.foot : undefined;
  const cellStyle = (c: BookColumn<T>) => (c.width ? { width: c.width } : { flex: 1, minWidth: 0 });
  const lastIndex = columns.length - 1;
  const footerStart = footer ? columns.findIndex((c) => c.key in footer.cells) : -1;

  const content = (
    <>
      {!hideHeader && <View
        className={`flex-row border-b border-gray-300 bg-gray-50 ${sticky && !limited ? 'rounded-t-xl' : ''}`}
        style={sticky ? ({ position: 'sticky', top: 0, zIndex: 10 } as any) : undefined}
        onLayout={limited ? (e) => measure('head', e.nativeEvent.layout.height) : undefined}
      >
        {columns.map((c, i) => (
          <Text
            key={c.key}
            className={`px-2.5 py-2 text-[11.5px] font-bold text-gray-600 ${i < lastIndex ? 'border-r border-gray-200' : ''} ${c.align === 'right' ? 'text-right' : ''}`}
            style={cellStyle(c)}
          >
            {c.label}
          </Text>
        ))}
      </View>}

      {rows.map((row, index) => {
        const group = groupOf?.(row);
        const showGroup = group != null && (index === 0 || groupOf!(rows[index - 1]) !== group);
        return (
          <View key={rowKey(row)} onLayout={limited && index < maxRows! ? (e) => measureRow(index, e.nativeEvent.layout.height) : undefined}>
            {showGroup && (
              <View className="border-b border-gray-200 bg-gray-50 px-2.5 py-1.5">
                <Text className="text-[11px] font-bold capitalize tracking-wide text-gray-500">{group}</Text>
              </View>
            )}
            <Pressable
              onPress={onRowPress ? () => onRowPress(row) : undefined}
              disabled={!onRowPress || rowPressable?.(row) === false}
              className="flex-row border-b border-gray-200"
              style={highlight?.(row) ? { backgroundColor: '#EFF6FF' } : undefined}
            >
              {columns.map((c, i) => (
                <View
                  key={c.key}
                  className={`px-2.5 py-2 ${i < lastIndex ? 'border-r border-gray-200' : ''}`}
                  style={[cellStyle(c), c.align === 'right' ? { alignItems: 'flex-end', justifyContent: 'center' } : { justifyContent: 'center' }]}
                >
                  {c.render(row, index)}
                </View>
              ))}
            </Pressable>
            {expanded?.(row)}
          </View>
        );
      })}

      {footer && footerStart >= 0 && (
        <View
          className={`flex-row bg-gray-50 ${sticky && !limited ? 'rounded-b-xl' : ''} ${limited ? 'border-t border-gray-300' : ''}`}
          style={limited ? ({ position: 'sticky', bottom: 0, zIndex: 10 } as any) : undefined}
          onLayout={limited ? (e) => measure('foot', e.nativeEvent.layout.height) : undefined}
        >
          <Text className={`${CELL} flex-1 text-right text-[12.5px] font-bold text-gray-700`}>{footer.label}</Text>
          {columns.slice(footerStart).map((c, i, arr) => (
            <View
              key={c.key}
              className={`px-2.5 py-2 ${i < arr.length - 1 ? 'border-r border-gray-200' : ''}`}
              style={{ width: c.width, alignItems: 'flex-end', justifyContent: 'center' }}
            >
              {footer.cells[c.key]}
            </View>
          ))}
        </View>
      )}
    </>
  );

  return (
    <View className={`bg-white ${bare ? '' : 'rounded-xl border border-gray-300'} ${sticky && !limited ? '' : 'overflow-hidden'}`}>
      {limited ? (
        <ScrollView style={{ maxHeight: scrollHeight }} nestedScrollEnabled showsVerticalScrollIndicator>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}
