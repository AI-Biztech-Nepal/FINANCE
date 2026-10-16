// lib/utils/exportLedger.ts
//
// Print / download for a party's statement and for the Ledger list. The
// platform endings (browser print dialog, share sheet, file download) are the
// ones exportWorkRecord already uses.
import * as XLSX from 'xlsx';
import { deliver, escapeHtml, printHtml } from './exportWorkRecord';
import { formatMoney, round2 } from './money';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Rupees with separators (and paise when there are some). */
const rs = (n: number) => formatMoney(n);

/** "98,900 Dr" (they owe you) / "12,000 Cr" (you owe them) / "0". */
export function drCrText(balance: number): string {
  const exact = round2(balance);
  if (exact === 0) return '0';
  return `${formatMoney(Math.abs(exact))} ${exact > 0 ? 'Dr' : 'Cr'}`;
}

export interface StatementLine {
  /** The date as the app shows it (Bikram Sambat). */
  dateLabel: string;
  /** 'YYYY-MM-DD', for the spreadsheet. */
  adDate: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementData {
  businessName: string;
  partyName: string;
  phone: string;
  address: string;
  /** The ledger type, when one is set. */
  ledgerType: string;
  periodLabel: string;
  printedOn: string;
  opening: number;
  totalDebit: number;
  totalCredit: number;
  closing: number;
  /** The headline figures: Total Sales, Total Payments ... */
  summary: { label: string; value: string }[];
  /** Oldest first, with the opening balance as a line of its own when there is one. */
  lines: StatementLine[];
}

/** The statement as a finished HTML page - what the print preview shows and Print prints. */
export function statementHtml(s: StatementData): string {
  const rows = s.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.dateLabel)}</td>
        <td>${escapeHtml(l.description)}</td>
        <td>${escapeHtml(l.reference)}</td>
        <td class="num">${l.debit ? rs(l.debit) : ''}</td>
        <td class="num">${l.credit ? rs(l.credit) : ''}</td>
        <td class="num">${escapeHtml(drCrText(l.balance))}</td>
      </tr>`
    )
    .join('');
  const summary = s.summary
    .map((m) => `<div class="card"><div class="k">${escapeHtml(m.label)}</div><div class="v">${escapeHtml(m.value)}</div></div>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>Statement - ${escapeHtml(s.partyName)}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; padding: 24px; font-size: 12px; }
    h1 { font-size: 18px; margin: 0; }
    h2 { font-size: 13px; margin: 18px 0 6px; }
    .sub { margin: 2px 0 0; color: #6B7280; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .party { margin: 14px 0; padding: 10px 12px; border: 1px solid #D1D5DB; border-radius: 6px; }
    .party b { font-size: 14px; }
    .cards { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .card { flex: 1; min-width: 120px; border: 1px solid #D1D5DB; border-radius: 6px; padding: 8px 10px; }
    .k { color: #6B7280; font-size: 10px; text-transform: capitalize; letter-spacing: .04em; }
    .v { font-size: 15px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #D1D5DB; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #F3F4F6; font-size: 10px; text-transform: capitalize; letter-spacing: .04em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tfoot td { font-weight: 700; background: #F9FAFB; }
    .note { margin-top: 10px; color: #6B7280; font-size: 10px; }
    @page { size: A4; margin: 12mm; }
  </style></head><body>
  <div class="head">
    <div><h1>Statement of Account</h1><p class="sub">${escapeHtml(s.businessName)}</p></div>
    <div class="sub" style="text-align:right">${escapeHtml(s.periodLabel)}<br/>Printed ${escapeHtml(s.printedOn)}</div>
  </div>
  <div class="party">
    <b>${escapeHtml(s.partyName)}</b>${s.ledgerType ? ` · ${escapeHtml(s.ledgerType)}` : ''}<br/>
    ${[s.phone, s.address].filter(Boolean).map(escapeHtml).join(' · ')}
  </div>
  <div class="cards">${summary}</div>
  <h2>Transactions</h2>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>Invoice / Reference</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">No transactions in this period.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${rs(s.totalDebit)}</td><td class="num">${rs(s.totalCredit)}</td><td class="num">${escapeHtml(drCrText(s.closing))}</td></tr></tfoot>
  </table>
  <p class="note">Dr = they owe you (receivable). Cr = you owe them (payable). Debit: sales and payments you made out. Credit: payments you received and purchases on credit.</p>
  </body></html>`;
}

/** The statement for printing: the browser's print dialog (Save as PDF there)
 * on web, a PDF in the share sheet on a phone. */
export async function printStatement(s: StatementData) {
  await printHtml(statementHtml(s));
}

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'party';
}

/** The statement as a spreadsheet. */
export async function exportStatementXlsx(s: StatementData) {
  const aoa: (string | number)[][] = [
    ['Statement of Account'],
    [s.businessName],
    [],
    ['Party', s.partyName],
    ...(s.ledgerType ? [['Ledger type', s.ledgerType]] : []),
    ...(s.phone ? [['Phone', s.phone]] : []),
    ...(s.address ? [['Address', s.address]] : []),
    ['Period', s.periodLabel],
    [],
    ...s.summary.map((m) => [m.label, m.value]),
    [],
    ['Date (BS)', 'Date (AD)', 'Description', 'Invoice / Reference', 'Debit', 'Credit', 'Balance', 'Dr / Cr'],
    ...s.lines.map((l) => [
      l.dateLabel,
      l.adDate,
      l.description,
      l.reference,
      l.debit ? round2(l.debit) : '',
      l.credit ? round2(l.credit) : '',
      Math.abs(round2(l.balance)),
      round2(l.balance) > 0 ? 'Dr' : round2(l.balance) < 0 ? 'Cr' : '',
    ]),
    ['', '', '', 'Total', round2(s.totalDebit), round2(s.totalCredit), Math.abs(round2(s.closing)), round2(s.closing) > 0 ? 'Dr' : round2(s.closing) < 0 ? 'Cr' : ''],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 40 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 7 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Statement');
  const base64 = XLSX.write(book, { bookType: 'xlsx', type: 'base64' });
  await deliver(base64, `statement_${safeName(s.partyName)}.xlsx`, XLSX_MIME);
}

export interface PartyListRow {
  Party: string;
  'Ledger type': string;
  Phone: string;
  Address: string;
  'Last transaction': string;
  Sales: number;
  Purchases: number;
  Payments: number;
  Balance: number;
  'Dr / Cr': string;
  Status: string;
  Overdue: number;
}

const PARTY_COLUMNS: (keyof PartyListRow)[] = [
  'Party', 'Ledger type', 'Phone', 'Address', 'Last transaction', 'Sales', 'Purchases', 'Payments', 'Balance', 'Dr / Cr', 'Status', 'Overdue',
];

/** The Ledger list (or the rows ticked in it) as a spreadsheet. */
export async function exportPartiesXlsx(rows: PartyListRow[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: PARTY_COLUMNS as string[] });
  sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 7 }, { wch: 12 }, { wch: 12 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Ledger');
  const base64 = XLSX.write(book, { bookType: 'xlsx', type: 'base64' });
  await deliver(base64, 'ledger.xlsx', XLSX_MIME);
}
