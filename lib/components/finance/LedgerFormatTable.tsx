// lib/components/finance/LedgerFormatTable.tsx
import { Text, View } from 'react-native';
import { BookTable, money, type BookColumn } from './BookKit';
import { highlightText } from './Highlight';
import { LEDGER_TONE } from './ledger/LedgerUi';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { round2 } from '../../utils/money';
import type { PartyFigures } from '../../utils/partyFigures';

/** One line: a person (or, for an Expense, what it was spent on) and their Ledger figures. */
export interface LedgerFormatRow extends PartyFigures {
  key: string;
  name: string;
  ledgerType: string;
}

/**
 * The Ledger page's own table, for the reports of a vehicle account: SN, Party, Ledger Type, Last Transaction (with
 * its number under the date), Balance (the price billed, black), Total Paid (red), Total Received (green), Payable
 * (red) and Receivable (green), and a totals line. A line opens what the report opens for that person.
 */
export function LedgerFormatTable({
  rows,
  full,
  search = '',
  partyLabel = 'Party',
  onOpen,
}: {
  rows: LedgerFormatRow[];
  full: boolean;
  search?: string;
  partyLabel?: string;
  onOpen?: (row: LedgerFormatRow) => void;
}) {
  const fig = (v: number, color: string, strong = false) =>
    v ? (
      <Text className={`text-[12.5px] ${strong ? 'font-extrabold' : 'font-bold'}`} style={{ color }} numberOfLines={1}>
        {money(v)}
      </Text>
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const sum = (f: (r: LedgerFormatRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const lastCell = (r: LedgerFormatRow) =>
    r.lastDay ? (
      <View style={{ minWidth: 0 }}>
        <Text className="text-[12.5px] text-gray-700">{toBsHistoryLabel(r.lastDay)}</Text>
        {!!r.lastRef && (
          <Text className="text-[11px] text-gray-400" numberOfLines={1}>
            {`Ref ${r.lastRef}`}
          </Text>
        )}
      </View>
    ) : (
      <Text className="text-[12.5px] text-gray-300">—</Text>
    );
  const name = (r: LedgerFormatRow) => (
    <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
      {highlightText(r.name, search)}
    </Text>
  );
  const columns: BookColumn<LedgerFormatRow>[] = full
    ? [
        { key: 'sn', label: 'SN', width: 52, render: (_r, i) => <Text className="text-[12.5px] text-gray-500">{i + 1}</Text> },
        { key: 'party', label: partyLabel, render: name },
        {
          key: 'type',
          label: 'Ledger Type',
          width: 140,
          render: (r) => (
            <Text className="text-[12.5px] font-semibold text-gray-700" numberOfLines={1}>
              {r.ledgerType || '—'}
            </Text>
          ),
        },
        { key: 'last', label: 'Last Transaction', width: 160, render: lastCell },
        { key: 'balance', label: 'Balance', width: 120, align: 'right', render: (r) => fig(r.billed, '#111827') },
        { key: 'paid', label: 'Total Paid', width: 110, align: 'right', render: (r) => fig(r.paid, LEDGER_TONE.payable.text) },
        { key: 'received', label: 'Total Received', width: 120, align: 'right', render: (r) => fig(r.received, LEDGER_TONE.receivable.text) },
        { key: 'payable', label: 'Payable', width: 110, align: 'right', render: (r) => fig(r.payable, LEDGER_TONE.payable.text) },
        { key: 'receivable', label: 'Receivable', width: 110, align: 'right', render: (r) => fig(r.receivable, LEDGER_TONE.receivable.text) },
      ]
    : [
        {
          key: 'party',
          label: partyLabel,
          render: (r) => (
            <View style={{ minWidth: 0, gap: 2 }}>
              {name(r)}
              <Text className="text-[11px] text-gray-400" numberOfLines={1}>
                {[r.ledgerType || null, r.billed ? `Balance ${money(r.billed)}` : null, r.paid ? `Paid ${money(r.paid)}` : null, r.received ? `Received ${money(r.received)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ),
        },
        {
          key: 'left',
          label: 'Payable / Receivable',
          width: 120,
          align: 'right',
          render: (r) => (r.payable ? fig(r.payable, LEDGER_TONE.payable.text) : fig(r.receivable, LEDGER_TONE.receivable.text)),
        },
      ];
  return (
    <BookTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      onRowPress={onOpen}
      stickyHeader
      footer={{
        label: `${rows.length} ${rows.length === 1 ? 'party' : 'parties'} · Total`,
        cells: full
          ? {
              balance: fig(sum((r) => r.billed), '#111827', true),
              paid: fig(sum((r) => r.paid), LEDGER_TONE.payable.text, true),
              received: fig(sum((r) => r.received), LEDGER_TONE.receivable.text, true),
              payable: fig(sum((r) => r.payable), LEDGER_TONE.payable.text, true),
              receivable: fig(sum((r) => r.receivable), LEDGER_TONE.receivable.text, true),
            }
          : { left: fig(Math.abs(sum((r) => r.payable) - sum((r) => r.receivable)), LEDGER_TONE.payable.text, true) },
      }}
    />
  );
}
