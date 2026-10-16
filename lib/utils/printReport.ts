// lib/utils/printReport.ts
//
// The printable page behind every report's Print button: a title, the headline figures, and one or
// more tables. It is only HTML - Print hands it to the system's print preview (printWithPreview),
// where the pages are shown beside the printer settings and nothing prints until Print is pressed.
import * as XLSX from 'xlsx';
import { deliver, escapeHtml } from './exportWorkRecord';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface PrintColumn {
  label: string;
  align?: 'left' | 'right';
}

export interface PrintSection {
  /** A line above the table: a category, a person ... */
  heading?: string;
  columns: PrintColumn[];
  rows: string[][];
  /** The totals row, one cell per column ('' for none). */
  footer?: string[];
  /** Shown instead of the table when it has no rows. */
  emptyText?: string;
}

export interface PrintReport {
  title: string;
  businessName: string;
  /** Under the title: the period, the category picked ... */
  subtitle?: string;
  printedOn: string;
  summary?: { label: string; value: string }[];
  sections: PrintSection[];
  note?: string;
}

function tableHtml(s: PrintSection): string {
  const head = s.columns.map((c) => `<th${c.align === 'right' ? ' class="num"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = s.rows
    .map((r) => `<tr>${r.map((cell, i) => `<td${s.columns[i]?.align === 'right' ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const foot = s.footer
    ? `<tfoot><tr>${s.footer.map((cell, i) => `<td${s.columns[i]?.align === 'right' ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr></tfoot>`
    : '';
  return `${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${s.columns.length}">${escapeHtml(s.emptyText ?? 'Nothing to show.')}</td></tr>`}</tbody>
    ${s.rows.length > 0 ? foot : ''}
  </table>`;
}

/** A right-aligned cell that is a figure ("1,200", "-500") goes to the spreadsheet as a number, so it
 * can be added up there; anything else stays text. */
function sheetCell(cell: string, align?: 'left' | 'right'): string | number {
  if (align === 'right' && /^-?[\d,]+(\.\d+)?$/.test(cell.trim())) return Number(cell.replace(/,/g, ''));
  return cell;
}

/** The report as a spreadsheet: the same document the print is - the title, the figures, then each
 * table with its heading and total - so Excel carries exactly what Print would. Downloaded in a
 * browser, handed to the share sheet on a phone. */
export async function exportReportXlsx(r: PrintReport) {
  const aoa: (string | number)[][] = [[r.title]];
  if (r.businessName) aoa.push([r.businessName]);
  if (r.subtitle) aoa.push([r.subtitle]);
  aoa.push([`Printed ${r.printedOn}`]);
  if (r.summary?.length) {
    aoa.push([]);
    for (const m of r.summary) aoa.push([m.label, m.value]);
  }
  const tableStart = aoa.length;
  for (const s of r.sections) {
    aoa.push([]);
    if (s.heading) aoa.push([s.heading]);
    aoa.push(s.columns.map((c) => c.label));
    if (s.rows.length === 0) aoa.push([s.emptyText ?? 'Nothing to show.']);
    for (const row of s.rows) aoa.push(row.map((cell, i) => sheetCell(cell, s.columns[i]?.align)));
    if (s.footer && s.rows.length > 0) aoa.push(s.footer.map((cell, i) => sheetCell(cell, s.columns[i]?.align)));
  }
  if (r.note) {
    aoa.push([]);
    aoa.push([r.note]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Widths from what the tables hold (the title lines above them may run over).
  const widths: number[] = [];
  for (const row of aoa.slice(tableStart)) {
    if (row.length < 2) continue;
    row.forEach((cell, i) => {
      widths[i] = Math.min(60, Math.max(widths[i] ?? 10, String(cell).length + 2));
    });
  }
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, r.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Report');
  const base64 = XLSX.write(book, { bookType: 'xlsx', type: 'base64' });
  const name = r.title.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'report';
  await deliver(base64, `${name}_${new Date().toISOString().slice(0, 10)}.xlsx`, XLSX_MIME);
}

/** The report as a finished HTML document, A4, ready to preview and print. */
export function reportHtml(r: PrintReport): string {
  const summary = (r.summary ?? [])
    .map((m) => `<div class="card"><div class="k">${escapeHtml(m.label)}</div><div class="v">${escapeHtml(m.value)}</div></div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>${escapeHtml(r.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; padding: 24px; font-size: 12px; margin: 0; }
    h1 { font-size: 18px; margin: 0; }
    h2 { font-size: 13px; margin: 18px 0 6px; page-break-after: avoid; }
    .sub { margin: 2px 0 0; color: #6B7280; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .cards { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .card { flex: 1; min-width: 110px; border: 1px solid #D1D5DB; border-radius: 6px; padding: 8px 10px; }
    .k { color: #6B7280; font-size: 10px; letter-spacing: .04em; }
    .v { font-size: 15px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 4px; }
    th, td { border: 1px solid #D1D5DB; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #F3F4F6; font-size: 10px; letter-spacing: .04em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot td { font-weight: 700; background: #F9FAFB; }
    .note { margin-top: 12px; color: #6B7280; font-size: 10px; }
    @page { size: A4; margin: 12mm; }
  </style></head><body>
  <div class="head">
    <div><h1>${escapeHtml(r.title)}</h1><p class="sub">${escapeHtml(r.businessName)}</p>${r.subtitle ? `<p class="sub">${escapeHtml(r.subtitle)}</p>` : ''}</div>
    <div class="sub" style="text-align:right">Printed ${escapeHtml(r.printedOn)}</div>
  </div>
  ${summary ? `<div class="cards">${summary}</div>` : ''}
  ${r.sections.map(tableHtml).join('\n')}
  ${r.note ? `<p class="note">${escapeHtml(r.note)}</p>` : ''}
  </body></html>`;
}
