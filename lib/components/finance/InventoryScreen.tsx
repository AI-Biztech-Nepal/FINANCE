// lib/components/finance/InventoryScreen.tsx
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery, useSupabaseInsert, useSupabaseUpdate, useSupabaseDelete } from '../../hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { ConfirmSaveCard, type ConfirmSaveOptions } from './ConfirmSave';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import {
  BackButton,
  BookPage,
  BookStat,
  BookStats,
  BookTable,
  FilterTabs,
  Pill,
  ToolbarButton,
  ToolbarSearch,
  money,
  useBookLayout,
  useBookToolbar,
  type BookColumn,
} from './BookKit';
import { PopupCard } from './FormKit';
import { ExcelButton, PrintButton, exportReportDocument, printReportDocument } from './PrintButton';
import { useReportActions } from './PrintButton';
import { TransactionDetailModal } from './TransactionsScreen';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { compareItems, entryDay } from '../../utils/ledgerStatement';
import { reportHtml, type PrintReport } from '../../utils/printReport';
import type { BusinessTransaction, Product } from '../../../types/database.types';

type StockStatus = 'ok' | 'out' | 'untracked';
type StatusFilter = 'all' | 'out';

const STATUS = {
  ok: { label: 'In stock', color: '#047857', bg: '#ECFDF5' },
  out: { label: 'Out', color: '#B91C1C', bg: '#FEF2F2' },
  untracked: { label: 'Bills only', color: '#4B5563', bg: '#F3F4F6' },
} satisfies Record<StockStatus, { label: string; color: string; bg: string }>;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'out', label: 'Out' },
];

const IN_TONE = { label: 'Stock in', color: '#047857', bg: '#ECFDF5' };
const OUT_TONE = { label: 'Stock out', color: '#B91C1C', bg: '#FEF2F2' };

interface InventoryRow {
  key: string;
  name: string;
  category: string | null;
  price: number | null;
  cost: number | null;
  stockLevel: number | null; // null = not a real catalog product, so no tracked stock level
  sold: number;
  purchased: number;
  status: StockStatus;
  /** Stock on hand at cost price; null when there's no stock level or no cost. */
  value: number | null;
  /** The shelf product behind this row; absent for an item only ever typed into a bill. */
  product?: Product;
}

/** One line of an item on a bill: units that came in (a Purchase) or went out (a Sale). */
interface Movement {
  key: string;
  tx: BusinessTransaction;
  dir: 'in' | 'out';
  /** 'YYYY-MM-DD' */
  day: string;
  createdAt: string;
  billNo: string;
  party: string;
  qty: number;
  rate: number;
  amount: number;
  hsCode: string;
}

/** Quantities and prices keep their decimals (2.5 kg, Rs 12.50); `money` would round. */
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const rs = (n: number | null) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  price: string;
  purchase_price: string;
  stock_level: string;
  reorder_level: string;
}

const EMPTY_FORM: FormState = {
  name: '', sku: '', barcode: '', category: '', unit: 'pcs', price: '', purchase_price: '', stock_level: '', reorder_level: '',
};

// The form's field order - down the rows, left to right - which is also the
// order Enter walks through them (the last one saves).
const FORM_ROWS: (keyof FormState)[][] = [
  ['name'],
  ['sku', 'barcode'],
  ['category', 'unit'],
  ['price', 'purchase_price'],
  ['stock_level', 'reorder_level'],
];
const FORM_ORDER = FORM_ROWS.flat();
const NUMERIC_FIELDS = new Set<keyof FormState>(['price', 'purchase_price', 'stock_level', 'reorder_level']);

/** What a save writes to `products` (the form's text, parsed). */
interface ProductValues {
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
  price: number;
  purchase_price: number | null;
  stock_level: number;
  reorder_level: number;
}

function formFromProduct(p: Product): FormState {
  return {
    name: p.name,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    category: p.category ?? '',
    unit: p.unit,
    price: String(p.price),
    purchase_price: p.purchase_price != null ? String(p.purchase_price) : '',
    stock_level: String(p.stock_level),
    reorder_level: String(p.reorder_level),
  };
}

function Field({
  label,
  value,
  onChange,
  numeric,
  inputRef,
  onSubmit,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  inputRef: (el: TextInput | null) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="mb-3 flex-1">
      <Text className="mb-1 text-xs font-semibold text-gray-500">{label}</Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : undefined}
        onSubmitEditing={onSubmit}
        blurOnSubmit={false}
        selectTextOnFocus
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor="#9CA3AF"
        className="rounded-lg border bg-white px-3 py-2.5 text-sm text-gray-900"
        style={[{ borderColor: focused ? '#2563EB' : '#D1D5DB' }, { outlineStyle: 'none' } as object]}
      />
    </View>
  );
}

/** The name an item is matched by across bills: trimmed, any case. */
const nameKey = (name: string) => name.trim().toLowerCase();

/** One item's stock history in a popup: how many units are in stock now and what is known of them
 * (cost, price, last bought, last sold), then every bill line that brought units in (a Purchase,
 * which includes what was bought from a wholesaler) or took them out (a Sale), with the running
 * net after each. Tapping a line opens its bill. Print and Excel for it are in the blue bar. */
function StockItemPopup({
  row,
  moves,
  businessName,
  onOpenBill,
  onEdit,
  onEditPurchase,
  onClose,
}: {
  row: InventoryRow;
  /** Opens the product form: edit this product, or start tracking a bills-only item. */
  onEdit: () => void;
  /** Opens a Purchase bill on the bill form, filled in, to edit it. */
  onEditPurchase: (tx: BusinessTransaction) => void;
  /** Oldest first. */
  moves: Movement[];
  businessName: string;
  onOpenBill: (tx: BusinessTransaction) => void;
  onClose: () => void;
}) {
  useCalendarMode(); // draws its dates again when the AD / BS toggle changes
  const { width } = useWindowDimensions();
  const roomy = width >= 860;

  // Newest first to read; the running net is worked out oldest first.
  const lines = useMemo(() => {
    let net = 0;
    return moves
      .map((m) => {
        net += m.dir === 'in' ? m.qty : -m.qty;
        return { ...m, net };
      })
      .reverse();
  }, [moves]);
  type Line = (typeof lines)[number];

  const totalIn = moves.filter((m) => m.dir === 'in').reduce((sum, m) => sum + m.qty, 0);
  const totalOut = moves.filter((m) => m.dir === 'out').reduce((sum, m) => sum + m.qty, 0);
  const net = totalIn - totalOut;
  const lastIn = [...moves].reverse().find((m) => m.dir === 'in');
  const lastOut = [...moves].reverse().find((m) => m.dir === 'out');
  const hsCode = [...moves].reverse().find((m) => m.hsCode)?.hsCode ?? '';
  const valueIn = moves.filter((m) => m.dir === 'in').reduce((sum, m) => sum + m.amount, 0);
  const valueOut = moves.filter((m) => m.dir === 'out').reduce((sum, m) => sum + m.amount, 0);

  const whenOf = (m: Movement | undefined) =>
    m ? [toBsHistoryLabel(m.day), m.party || null, `@ ${rs(m.rate)}`].filter(Boolean).join(' · ') : '—';
  const details: [string, string][] = [
    ['Category', row.category || '—'],
    ['Status', STATUS[row.status].label],
    ['HS code', hsCode || '—'],
    ['Cost price', rs(row.cost)],
    ['Selling price', rs(row.price)],
    ['Stock value (cost)', row.value != null ? `NPR ${money(row.value)}` : '—'],
    ['Last bought', whenOf(lastIn)],
    ['Last sold', whenOf(lastOut)],
  ];

  const typeLabel = (m: Movement) => (m.dir === 'in' ? IN_TONE : OUT_TONE);
  const buildReport = (): PrintReport => ({
    title: `${row.name} - stock in and out`,
    businessName,
    subtitle: [row.category, hsCode ? `HS ${hsCode}` : null].filter(Boolean).join(' · ') || undefined,
    printedOn: toBsHistoryLabel(localTodayIso()),
    summary: [
      { label: 'In stock now', value: row.stockLevel != null ? qty(row.stockLevel) : 'Bills only' },
      { label: 'Stock in', value: qty(totalIn) },
      { label: 'Stock out', value: qty(totalOut) },
      { label: 'Net on bills', value: qty(net) },
    ],
    sections: [
      {
        columns: [
          { label: 'SN' },
          { label: 'Date' },
          { label: 'Type' },
          { label: 'Bill no.' },
          { label: 'Party' },
          { label: 'In', align: 'right' },
          { label: 'Out', align: 'right' },
          { label: 'Rate', align: 'right' },
          { label: 'Amount (NPR)', align: 'right' },
          { label: 'Net so far', align: 'right' },
        ],
        rows: lines.map((l, i) => [
          String(i + 1),
          toBsHistoryLabel(l.day),
          typeLabel(l).label,
          l.billNo || '',
          l.party || '',
          l.dir === 'in' ? qty(l.qty) : '',
          l.dir === 'out' ? qty(l.qty) : '',
          rs(l.rate),
          money(l.amount),
          qty(l.net),
        ]),
        footer: ['', '', '', '', 'Total', qty(totalIn), qty(totalOut), '', '', qty(net)],
        emptyText: 'No bill has this item yet.',
      },
    ],
    note: 'Stock in is a Purchase bill (wholesale orders included); stock out is a Sale bill. "Net so far" adds them up bill by bill.',
  });

  const sn = (_l: Line, i: number) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text>;
  const qtyCell = (l: Line, dir: 'in' | 'out') =>
    l.dir === dir ? (
      <Text className="text-[12.5px] font-bold" style={{ color: dir === 'in' ? IN_TONE.color : OUT_TONE.color }}>
        {qty(l.qty)}
      </Text>
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const netCell = (l: Line) => (
    <Text className="text-[12.5px] font-bold text-gray-700" numberOfLines={1}>
      {qty(l.net)}
    </Text>
  );
  const columns: BookColumn<Line>[] = roomy
    ? [
        { key: 'sn', label: 'SN', width: 52, render: sn },
        { key: 'date', label: 'Date', width: 128, render: (l) => <Text className="text-[12.5px] text-gray-600">{toBsHistoryLabel(l.day)}</Text> },
        { key: 'type', label: 'Type', width: 100, render: (l) => <Pill text={typeLabel(l).label} color={typeLabel(l).color} bg={typeLabel(l).bg} /> },
        {
          key: 'bill',
          label: 'Bill no.',
          width: 140,
          render: (l) =>
            l.billNo ? (
              <Text className="text-[12.5px] font-semibold text-gray-700" numberOfLines={1}>
                {l.billNo}
              </Text>
            ) : (
              <Text className="text-[12.5px] text-gray-300">—</Text>
            ),
        },
        {
          key: 'party',
          label: 'Party',
          render: (l) => (
            <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
              {l.party || '—'}
            </Text>
          ),
        },
        { key: 'in', label: 'In', width: 76, align: 'right', render: (l) => qtyCell(l, 'in') },
        { key: 'out', label: 'Out', width: 76, align: 'right', render: (l) => qtyCell(l, 'out') },
        { key: 'rate', label: 'Rate', width: 90, align: 'right', render: (l) => <Text className="text-[12.5px] text-gray-700">{rs(l.rate)}</Text> },
        { key: 'amount', label: 'Amount', width: 110, align: 'right', render: (l) => <Text className="text-[12.5px] font-medium text-gray-900">{money(l.amount)}</Text> },
        { key: 'net', label: 'Net so far', width: 100, align: 'right', render: netCell },
      ]
    : [
        { key: 'sn', label: 'SN', width: 38, render: sn },
        {
          key: 'details',
          label: 'Details',
          render: (l) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
                {l.party || typeLabel(l).label}
              </Text>
              <Pill text={typeLabel(l).label} color={typeLabel(l).color} bg={typeLabel(l).bg} />
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                {[toBsHistoryLabel(l.day), l.billNo || null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ),
        },
        {
          key: 'qty',
          label: 'Qty',
          width: 84,
          align: 'right',
          render: (l) => (
            <View className="items-end">
              <Text className="text-[12.5px] font-bold" style={{ color: typeLabel(l).color }}>
                {l.dir === 'in' ? '+' : '−'}
                {qty(l.qty)}
              </Text>
              <Text className="text-[11px] text-gray-400">Net {qty(l.net)}</Text>
            </View>
          ),
        },
      ];
  const footerCells = roomy
    ? {
        in: <Text className="text-[13px] font-extrabold" style={{ color: IN_TONE.color }}>{qty(totalIn)}</Text>,
        out: <Text className="text-[13px] font-extrabold" style={{ color: OUT_TONE.color }}>{qty(totalOut)}</Text>,
        amount: <Text className="text-[13px] font-extrabold text-gray-900">{money(valueIn - valueOut)}</Text>,
        net: <Text className="text-[13px] font-extrabold text-gray-900">{qty(net)}</Text>,
      }
    : { qty: <Text className="text-[13px] font-extrabold text-gray-900">{qty(net)}</Text> };

  // The product's own stock level also moves outside bills (opening stock, job parts, corrections), so
  // it can differ from what the bills add up to - say so rather than leave the two figures unexplained.
  const outsideBills = row.stockLevel != null ? row.stockLevel - net : null;

  return (
    <PopupCard
      title={row.name}
      onClose={onClose}
      maxWidth={1040}
      closeOnOutside
      headerRight={
        <>
          <PrintButton onPress={() => void printReportDocument(reportHtml(buildReport()))} />
          <ExcelButton onPress={() => void exportReportDocument(buildReport())} />
        </>
      }
    >
      <BookStats>
        <BookStat label="In stock now" value={row.stockLevel != null ? qty(row.stockLevel) : 'Bills only'} color={row.status === 'out' ? '#B91C1C' : '#111827'} />
        <BookStat label="Stock in" value={qty(totalIn)} color={IN_TONE.color} />
        <BookStat label="Stock out" value={qty(totalOut)} color={OUT_TONE.color} />
        <BookStat label="Net on bills" value={qty(net)} color="#374151" />
      </BookStats>

      <View className="flex-row flex-wrap rounded-xl border border-gray-200 bg-white px-4 py-3" style={{ columnGap: 28, rowGap: 10 }}>
        {details.map(([label, value]) => (
          <View key={label} style={{ minWidth: 150, maxWidth: 320 }}>
            <Text className="text-[11px] font-semibold capitalize tracking-wide text-gray-400">{label}</Text>
            <Text className="mt-0.5 text-[13px] font-medium text-gray-900">{value}</Text>
          </View>
        ))}
      </View>

      {lines.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-8">
          <Text className="text-gray-500">No bill has this item yet.</Text>
        </View>
      ) : (
        <BookTable
          stickyHeader
          columns={columns}
          rows={lines}
          rowKey={(l) => l.key}
          onRowPress={(l) => onOpenBill(l.tx)}
          footer={{ label: `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} · Total`, cells: footerCells }}
        />
      )}

      <Text className="text-[11.5px] leading-[17px] text-gray-400">
        Stock in is a Purchase bill - a wholesale order that arrived is one - and stock out is a Sale bill. Tap a line to open its bill.
        {outsideBills != null && Math.abs(outsideBills) > 0.0005
          ? ` The stock now (${qty(row.stockLevel ?? 0)}) differs from what the bills add up to by ${qty(Math.abs(outsideBills))}: stock also changes outside bills - opening stock, parts used on a job, a correction.`
          : ''}
      </Text>
      <View className="flex-row" style={{ gap: 10 }}>
        {/* An item that was bought opens its latest Purchase bill - vendor, rate and all - to edit; the
            product's own fields (cost price, stock) are the second button. */}
        {lastIn ? (
          <>
            <Pressable onPress={() => onEditPurchase(lastIn.tx)} accessibilityRole="button" className="rounded-lg px-4 py-2.5" style={{ backgroundColor: '#1D4ED8' }}>
              <Text className="text-[13px] font-bold text-white">Edit purchase</Text>
            </Pressable>
            <Pressable onPress={onEdit} accessibilityRole="button" className="rounded-lg border px-4 py-2.5" style={{ borderColor: '#1D4ED8' }}>
              <Text className="text-[13px] font-bold" style={{ color: '#1D4ED8' }}>{row.product ? 'Edit product' : 'Track as a product'}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={onEdit} accessibilityRole="button" className="rounded-lg px-4 py-2.5" style={{ backgroundColor: '#1D4ED8' }}>
            <Text className="text-[13px] font-bold text-white">{row.product ? 'Edit product' : 'Track as a product'}</Text>
          </Pressable>
        )}
      </View>
    </PopupCard>
  );
}

/** Stock and Inventory: the stock list cross-referenced with Finance - each product's current stock
 * level next to how many units of it have actually moved through Sale and Purchase bills (matched by
 * item name, since a bill's line items are typed or picked names, not a foreign key back to
 * `products`). Also includes items that only ever exist as a typed name in a bill (finance_items,
 * 0063_finance_items.sql) - a reseller can't add just any name to the real product catalog (it's
 * admin-curated), so plenty of what's actually bought and sold only lives there, not in `products`.
 *
 * A reseller buys stock from here too (the Buy Stock button, on to the wholesale marketplace) - what
 * arrives comes back as a Purchase bill, so it is in the item's stock-in history. Tapping an item
 * opens that history. Read-only: products are managed by admins, not from here. */
export function InventoryScreen({ basePath }: { basePath: string }) {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.session?.user.id);
  const profile = useAuthStore((state) => state.profile);
  const bankAccounts = useBankAccounts(userId);
  const { data: products } = useSupabaseQuery('products', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'name' },
    enabled: !!userId,
  });
  const { data: financeItems } = useSupabaseQuery('finance_items', {
    filters: userId ? { owner_id: userId } : {},
    enabled: !!userId,
  });
  // `all`: every unit on every bill is counted, and a plain read stops at the API's first 1000 bills.
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const createProduct = useSupabaseInsert('products');
  const updateProduct = useSupabaseUpdate('products');
  const deleteProduct = useSupabaseDelete('products');
  const [editing, setEditing] = useState<{ id: string | null; form: FormState; hint?: string } | null>(null);
  // "Save this product?" is asked inside the dialog itself (not as a second modal), holding the
  // values it will save if confirmed.
  const [confirming, setConfirming] = useState<{ options: ConfirmSaveOptions; values: ProductValues } | null>(null);
  const inputs = useRef<(TextInput | null)[]>([]);

  // The item whose stock history is open in a popup, and a bill opened from it.
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [viewingTx, setViewingTx] = useState<BusinessTransaction | null>(null);

  // Print and Excel: the list as it is on screen (see buildReport, below).
  const reportButtons = useReportActions(() => buildReport());

  // Search, the All / Out filter, Print, Excel and Add product live in the top bar on a wide screen (a
  // plain row above the tiles on a phone).
  const toolbar = useBookToolbar(
    {
      wide: layout.wide,
      inBarMinWidth: 1320,
      left: layout.wide ? undefined : () => <BackButton onPress={() => router.back()} />,
      right: (inBar) => (
        <>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search your products" wide={inBar} />
          <FilterTabs options={FILTERS} value={filter} onChange={setFilter} />
          {reportButtons}
          <ToolbarButton icon="add" label="Add product" onPress={() => setEditing({ id: null, form: EMPTY_FORM })} />
        </>
      ),
    },
    [search, filter, reportButtons]
  );

  // Every bill line of every item, by item name: a Purchase brings units in, a Sale takes them out.
  const movementsByName = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const t of transactions ?? []) {
      if (t.type !== 'sale' && t.type !== 'purchase') continue;
      (t.items ?? []).forEach((item, i) => {
        const key = nameKey(item.description ?? '');
        if (!key) return;
        const q = Number(item.qty) || 0;
        const r = Number(item.rate) || 0;
        const list = map.get(key) ?? [];
        list.push({
          key: `${t.id}:${i}`,
          tx: t,
          dir: t.type === 'purchase' ? 'in' : 'out',
          day: entryDay(t.bill_date, t.created_at),
          createdAt: t.created_at,
          billNo: t.bill_no?.trim() ?? '',
          party: t.party_name?.trim() ?? '',
          qty: q,
          rate: r,
          amount: Number(item.amount) || q * r,
          hsCode: item.hs_code ?? '',
        });
        map.set(key, list);
      });
    }
    for (const list of map.values()) list.sort(compareItems);
    return map;
  }, [transactions]);

  const rows = useMemo((): InventoryRow[] => {
    const soldByName = new Map<string, number>();
    const purchasedByName = new Map<string, number>();
    for (const [key, list] of movementsByName) {
      for (const m of list) {
        const target = m.dir === 'out' ? soldByName : purchasedByName;
        target.set(key, (target.get(key) ?? 0) + m.qty);
      }
    }

    const seenNames = new Set<string>();
    const productRows: InventoryRow[] = (products ?? []).map((product) => {
      const key = nameKey(product.name);
      seenNames.add(key);
      const stock = Number(product.stock_level);
      // A product bought before its bill had a rate has no cost price of its own: it is what its latest
      // purchase bill with a rate paid for it.
      const billedCost = [...(movementsByName.get(key) ?? [])].reverse().find((m) => m.dir === 'in' && m.rate > 0)?.rate ?? null;
      const cost = product.purchase_price != null ? Number(product.purchase_price) : billedCost;
      return {
        key: `p-${product.id}`,
        name: product.name,
        category: product.category,
        price: Number(product.price),
        cost,
        stockLevel: stock,
        sold: soldByName.get(key) ?? 0,
        purchased: purchasedByName.get(key) ?? 0,
        status: stock <= 0 ? 'out' : 'ok',
        value: cost != null && stock > 0 ? stock * cost : null,
        product,
      };
    });

    // A typed item that's never actually shown up in a bill (rate saved but
    // never used) isn't real inventory yet - only list ones with activity.
    const financeItemRows: InventoryRow[] = (financeItems ?? [])
      .filter((item) => !seenNames.has(nameKey(item.name)))
      .map((item): InventoryRow | null => {
        const key = nameKey(item.name);
        const sold = soldByName.get(key) ?? 0;
        const purchased = purchasedByName.get(key) ?? 0;
        if (sold === 0 && purchased === 0) return null;
        return {
          key: `f-${item.id}`,
          name: item.name,
          category: null,
          price: item.rate,
          cost: null,
          stockLevel: null,
          sold,
          purchased,
          status: 'untracked',
          value: null,
        };
      })
      .filter((r): r is InventoryRow => r !== null);

    const hasStock = (r: InventoryRow) => (r.stockLevel ?? 0) > 0;
    return [...productRows, ...financeItemRows].sort(
      (a, b) => Number(hasStock(b)) - Number(hasStock(a)) || a.name.localeCompare(b.name)
    );
  }, [products, financeItems, movementsByName]);

  const stats = useMemo(
    () => ({
      items: rows.length,
      value: rows.reduce((sum, r) => sum + (r.value ?? 0), 0),
      out: rows.filter((r) => r.status === 'out').length,
    }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'out' && r.status !== 'out') return false;
      return !q || r.name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  const totals = useMemo(
    () => ({
      sold: filteredRows.reduce((sum, r) => sum + r.sold, 0),
      purchased: filteredRows.reduce((sum, r) => sum + r.purchased, 0),
      value: filteredRows.reduce((sum, r) => sum + (r.value ?? 0), 0),
    }),
    [filteredRows]
  );

  const num = (text: string, color = '#374151', bold = false) => (
    <Text className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color }} numberOfLines={1}>
      {text}
    </Text>
  );
  const dash = <Text className="text-[12.5px] text-gray-400">—</Text>;

  const stockColor = (r: InventoryRow) => (r.status === 'out' ? '#B91C1C' : '#111827');

  const itemCell = (r: InventoryRow, compact: boolean) => (
    <View style={{ minWidth: 0, gap: 2 }}>
      <Text className="text-[13px] font-medium text-gray-900" numberOfLines={1}>
        {r.name}
      </Text>
      {compact && <Pill text={STATUS[r.status].label} color={STATUS[r.status].color} bg={STATUS[r.status].bg} />}
      {!!r.category && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          {r.category}
        </Text>
      )}
      {compact && (
        <Text className="text-[11px] text-gray-400" numberOfLines={1}>
          Sold {qty(r.sold)} · Bought {qty(r.purchased)}
        </Text>
      )}
    </View>
  );

  const snColumn = (width: number): BookColumn<InventoryRow> => ({
    key: 'sn',
    label: 'SN',
    width,
    render: (_r, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text>,
  });
  const columns: BookColumn<InventoryRow>[] = layout.full
    ? [
        snColumn(52),
        { key: 'item', label: 'Item', render: (r) => itemCell(r, false) },
        { key: 'stock', label: 'In stock', width: 96, align: 'right', render: (r) => (r.stockLevel != null ? num(qty(r.stockLevel), stockColor(r), true) : dash) },
        { key: 'status', label: 'Status', width: 90, render: (r) => <Pill text={STATUS[r.status].label} color={STATUS[r.status].color} bg={STATUS[r.status].bg} /> },
        { key: 'cost', label: 'Cost price', width: 90, align: 'right', render: (r) => (r.cost != null ? num(rs(r.cost), '#4B5563') : dash) },
        { key: 'price', label: 'Selling price', width: 100, align: 'right', render: (r) => (r.price != null ? num(rs(r.price)) : dash) },
        { key: 'sold', label: 'Sold', width: 72, align: 'right', render: (r) => num(qty(r.sold), '#047857', true) },
        { key: 'purchased', label: 'Purchased', width: 92, align: 'right', render: (r) => num(qty(r.purchased), '#B91C1C', true) },
        { key: 'value', label: 'Stock value', width: 108, align: 'right', render: (r) => (r.value != null ? num(money(r.value)) : dash) },
        { key: 'act', label: '', width: 34, align: 'right', render: () => <Ionicons name="chevron-forward" size={14} color="#D1D5DB" /> },
      ]
    : [
        snColumn(38),
        { key: 'item', label: 'Item', render: (r) => itemCell(r, true) },
        { key: 'stock', label: 'In stock', width: 84, align: 'right', render: (r) => (r.stockLevel != null ? num(qty(r.stockLevel), stockColor(r), true) : dash) },
        { key: 'price', label: 'Price', width: 80, align: 'right', render: (r) => (r.price != null ? num(rs(r.price)) : dash) },
      ];

  const footer = layout.full
    ? {
        label: `${filteredRows.length} ${filteredRows.length === 1 ? 'item' : 'items'} · Totals`,
        cells: {
          sold: <Text className="text-[13px] font-extrabold" style={{ color: '#047857' }}>{qty(totals.sold)}</Text>,
          purchased: <Text className="text-[13px] font-extrabold" style={{ color: '#B91C1C' }}>{qty(totals.purchased)}</Text>,
          value: <Text className="text-[13px] font-extrabold text-gray-900">{money(totals.value)}</Text>,
        },
      }
    : undefined;

  const toggleOut = () => setFilter((f) => (f === 'out' ? 'all' : 'out'));

  // Step one of saving: check the form, then ask. Nothing is written yet.
  function save() {
    if (!editing || !userId || confirming) return;
    const f = editing.form;
    if (!f.name.trim()) {
      showAlert('Add a name', 'Enter the product name.');
      return;
    }
    const values: ProductValues = {
      name: f.name.trim(),
      sku: f.sku.trim() || null,
      barcode: f.barcode.trim() || null,
      category: f.category.trim() || null,
      unit: f.unit.trim() || 'pcs',
      price: Number(f.price) || 0,
      purchase_price: f.purchase_price.trim() ? Number(f.purchase_price) : null,
      stock_level: Number(f.stock_level) || 0,
      reorder_level: Number(f.reorder_level) || 0,
    };
    setConfirming({
      values,
      options: {
        title: editing.id ? 'Save changes to this product?' : 'Add this product?',
        rows: [
          { label: 'Product', value: values.name },
          { label: editing.id ? 'In stock' : 'Opening stock', value: `${qty(values.stock_level)} ${values.unit}` },
          { label: 'Selling price', value: `NPR ${rs(values.price)}` },
          ...(values.purchase_price != null ? [{ label: 'Cost price', value: `NPR ${rs(values.purchase_price)}` }] : []),
        ],
      },
    });
  }

  // Step two, after "Yes, save".
  async function commitSave() {
    if (!editing || !userId || !confirming) return;
    if (createProduct.isPending || updateProduct.isPending) return;
    const { values } = confirming;
    try {
      if (editing.id) await updateProduct.mutateAsync({ id: editing.id, values });
      else await createProduct.mutateAsync({ owner_id: userId, ...values });
      setConfirming(null);
      setEditing(null);
    } catch (err) {
      setConfirming(null);
      const msg = getErrorMessage(err);
      showAlert('Could not save', /duplicate key/i.test(msg) ? 'A product with this name or barcode already exists.' : msg);
    }
  }

  function confirmDelete(p: Product) {
    showAlert('Delete product?', `${p.name} will be removed from inventory. Past bills are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProduct.mutateAsync(p.id);
            setEditing(null);
          } catch (err) {
            showAlert('Could not delete', getErrorMessage(err));
          }
        },
      },
    ]);
  }


  // Opens the product form: the product itself, or - for an item only ever typed into a bill - a new
  // product already filled from what the bills say, so tracking it for real is a check-and-save.
  const openEdit = (r: InventoryRow) => {
    setViewingKey(null);
    if (r.product) {
      setEditing({ id: r.product.id, form: formFromProduct(r.product) });
      return;
    }
    setEditing({
      id: null,
      hint: 'Filled in from your bills (bought minus sold). Opening stock was never entered, so check the numbers before saving.',
      form: {
        ...EMPTY_FORM,
        name: r.name,
        price: r.price != null ? String(r.price) : '',
        stock_level: String(Math.max(0, r.purchased - r.sold)),
      },
    });
  };
  const closeDialog = () => {
    setConfirming(null);
    setEditing(null);
  };
  // Esc / "No" on the question goes back to the form with the caret on the last field, rather than
  // throwing away what was typed.
  const backToForm = () => {
    setConfirming(null);
    setTimeout(() => inputs.current[FORM_ORDER.length - 1]?.focus(), 0);
  };
  const set = (k: keyof FormState) => (v: string) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  // The stock list as a document: the items on screen with their stock, prices and what moved.
  function buildReport(): PrintReport {
    const cell = (v: number | null) => (v == null ? '' : rs(v));
    return {
      title: 'Stock and Inventory',
      businessName: profile?.business_name ?? profile?.full_name ?? '',
      subtitle: [filter === 'out' ? 'Out of stock' : null, search.trim() ? `Matching "${search.trim()}"` : null].filter(Boolean).join(' · ') || undefined,
      printedOn: toBsHistoryLabel(localTodayIso()),
      summary: [
        { label: 'Items', value: String(stats.items) },
        { label: 'Stock value (cost)', value: `NPR ${money(stats.value)}` },
        { label: 'Out of stock', value: String(stats.out) },
      ],
      sections: [
        {
          columns: [
            { label: 'SN' },
            { label: 'Item' },
            { label: 'Category' },
            { label: 'In stock', align: 'right' },
            { label: 'Status' },
            { label: 'Cost price', align: 'right' },
            { label: 'Selling price', align: 'right' },
            { label: 'Sold', align: 'right' },
            { label: 'Purchased', align: 'right' },
            { label: 'Stock value', align: 'right' },
          ],
          rows: filteredRows.map((r, n) => [
            String(n + 1),
            r.name,
            r.category ?? '',
            r.stockLevel != null ? qty(r.stockLevel) : '',
            STATUS[r.status].label,
            cell(r.cost),
            cell(r.price),
            qty(r.sold),
            qty(r.purchased),
            r.value != null ? money(r.value) : '',
          ]),
          footer: ['', `${filteredRows.length} ${filteredRows.length === 1 ? 'item' : 'items'} · Totals`, '', '', '', '', '', qty(totals.sold), qty(totals.purchased), money(totals.value)],
          emptyText: rows.length > 0 ? 'No matches.' : 'Nothing bought or sold yet.',
        },
      ],
      note: 'Sold and Purchased count the units on Sale and Purchase bills, matched to products by item name.',
    };
  }

  const viewingRow = viewingKey ? rows.find((r) => r.key === viewingKey) ?? null : null;

  const dialogMode = layout.wide;

  const fieldLabel = (key: keyof FormState): string => {
    switch (key) {
      case 'name': return 'Name';
      case 'sku': return 'SKU';
      case 'barcode': return 'Barcode';
      case 'category': return 'Category';
      case 'unit': return 'Unit';
      case 'price': return 'Selling price';
      case 'purchase_price': return 'Cost price';
      case 'stock_level': return editing?.id ? 'In stock' : 'Opening stock';
      case 'reorder_level': return 'Reorder level';
    }
  };

  const formFields = editing
    ? FORM_ROWS.map((fields) => (
        <View key={fields.join('-')} className="flex-row" style={{ gap: 12 }}>
          {fields.map((key) => {
            const index = FORM_ORDER.indexOf(key);
            return (
              <Field
                key={key}
                label={fieldLabel(key)}
                value={editing.form[key]}
                onChange={set(key)}
                numeric={NUMERIC_FIELDS.has(key)}
                inputRef={(el) => {
                  inputs.current[index] = el;
                }}
                onSubmit={() => (index < FORM_ORDER.length - 1 ? inputs.current[index + 1]?.focus() : void save())}
                autoFocus={dialogMode && index === 0}
              />
            );
          })}
        </View>
      ))
    : null;

  const saving = createProduct.isPending || updateProduct.isPending;
  const deletable = editing?.id ? (products ?? []).find((p) => p.id === editing.id) : undefined;

  // While the "save this?" question is up the form is only hidden, not
  // unmounted, so everything typed (and the caret's place) survives a "No".
  const dialogBody: ReactNode = editing && (
    <>
      {confirming && <ConfirmSaveCard options={confirming.options} onConfirm={commitSave} onCancel={backToForm} />}
      <View style={confirming ? { display: 'none' } : undefined}>
        <View className="mb-4 flex-row items-center justify-between">
          <Text className={dialogMode ? 'text-lg font-extrabold text-gray-900' : 'text-lg font-bold text-gray-900'}>
            {editing.id ? 'Edit product' : 'New product'}
          </Text>
          <Pressable onPress={closeDialog} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#374151" />
          </Pressable>
        </View>
        {!!editing.hint && <Text className="-mt-2 mb-4 text-xs leading-[17px] text-gray-500">{editing.hint}</Text>}
        {formFields}
        {dialogMode ? (
          <View className="mt-2 flex-row items-center" style={{ gap: 10 }}>
            {deletable && (
              <Pressable onPress={() => confirmDelete(deletable)} className="rounded-xl border border-red-200 px-4 py-3">
                <Text className="text-sm font-bold text-red-600">Delete</Text>
              </Pressable>
            )}
            <View className="flex-1" />
            <Pressable onPress={closeDialog} className="rounded-xl border border-gray-300 bg-white px-5 py-3">
              <Text className="text-sm font-bold text-gray-600">Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} className="rounded-xl px-6 py-3 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
              <Text className="text-sm font-bold text-white">Save</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable onPress={save} disabled={saving} className="mt-2 items-center rounded-xl bg-blue-600 py-3.5 disabled:opacity-50">
              <Text className="text-[15px] font-bold text-white">Save</Text>
            </Pressable>
            {deletable && (
              <Pressable onPress={() => confirmDelete(deletable)} className="mt-3 items-center rounded-xl border border-red-200 py-3.5">
                <Text className="text-[15px] font-bold text-red-600">Delete product</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </>
  );


  return (
    <BookPage wide={layout.wide}>
      {toolbar}

      <BookStats>
        <BookStat label="Items" value={String(stats.items)} color="#374151" />
        <BookStat label="Stock value (cost)" value={`NPR ${money(stats.value)}`} color="#1D4ED8" />
        <BookStat label="Out of stock" value={String(stats.out)} color="#B91C1C" onPress={toggleOut} />
      </BookStats>

      {filteredRows.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-300 bg-white py-10">
          <Ionicons name="cube-outline" size={28} color="#D1D5DB" />
          <Text className="mt-2 text-gray-500">{rows.length > 0 ? 'No matches.' : 'No products yet. Tap Add product.'}</Text>
        </View>
      ) : (
        <BookTable columns={columns} rows={filteredRows} rowKey={(r) => r.key} onRowPress={(r) => setViewingKey(r.key)} footer={footer} />
      )}

      <Text className="px-1 text-[11.5px] leading-[17px] text-gray-400">
        Tap an item to see every unit that came in and went out, and to edit it. Sold and Purchased count the units on your Sale and Purchase bills, matched to
        products by item name. Items marked "Bills only" were typed into a bill and are not tracked products yet - open one to start tracking it.
      </Text>

      {viewingRow && (
        <StockItemPopup
          key={viewingRow.key}
          row={viewingRow}
          moves={movementsByName.get(nameKey(viewingRow.name)) ?? []}
          businessName={profile?.business_name ?? profile?.full_name ?? ''}
          onOpenBill={setViewingTx}
          onEdit={() => openEdit(viewingRow)}
          onEditPurchase={(tx) => {
            router.push(`${basePath}/transactions?type=${tx.type}&add=1&edit=${tx.id}` as never);
            setViewingKey(null);
          }}
          onClose={() => setViewingKey(null)}
        />
      )}
      <TransactionDetailModal
        tx={viewingTx}
        categoryName={null}
        bankAccountName={
          viewingTx?.bank_account_id ? bankAccounts.accounts.find((a) => a.id === viewingTx.bank_account_id)?.name ?? null : null
        }
        onClose={() => setViewingTx(null)}
        onEdit={() => {
          if (viewingTx) router.push(`${basePath}/transactions?type=${viewingTx.type}&add=1&edit=${viewingTx.id}` as never);
          setViewingTx(null);
          setViewingKey(null);
        }}
        editOnPage
      />

      <Modal
        visible={!!editing}
        transparent={dialogMode}
        animationType={dialogMode ? 'fade' : 'slide'}
        onRequestClose={confirming ? backToForm : closeDialog}
      >
        {dialogMode ? (
          <View className="flex-1 items-center justify-center bg-black/40 px-6">
            <View
              className="w-full rounded-2xl bg-white"
              style={{ maxWidth: 560, padding: 24, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' }}
            >
              {dialogBody}
            </View>
          </View>
        ) : (
          <View className="flex-1 bg-gray-50 px-6 pt-12">
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
              {dialogBody}
            </ScrollView>
          </View>
        )}
      </Modal>
    </BookPage>
  );
}
