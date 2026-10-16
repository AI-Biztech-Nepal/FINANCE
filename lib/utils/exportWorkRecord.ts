// lib/utils/exportWorkRecord.ts
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import * as XLSX from 'xlsx';

export interface WorkRecordRow {
  Ticket: string;
  Date: string;
  Time: string;
  Job: string;
  Customer: string;
  Phone: string;
  Address: string;
  'Assigned to': string;
  Status: string;
  Payment: string;
  Amount: number | '';
}

export const WORK_COLUMNS: (keyof WorkRecordRow)[] = [
  'Ticket',
  'Date',
  'Time',
  'Job',
  'Customer',
  'Phone',
  'Address',
  'Assigned to',
  'Status',
  'Payment',
  'Amount',
];

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHtml(title: string, subtitle: string, rows: WorkRecordRow[]): string {
  const total = rows.reduce((sum, r) => sum + (typeof r.Amount === 'number' ? r.Amount : 0), 0);
  const body = rows
    .map(
      (r) => `<tr>${WORK_COLUMNS.map((c) => {
        const value = c === 'Amount' && typeof r.Amount === 'number' ? r.Amount.toLocaleString() : r[c];
        const align = c === 'Amount' ? ' class="num"' : '';
        return `<td${align}>${escapeHtml(value)}</td>`;
      }).join('')}</tr>`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; padding: 24px; }
    h1 { font-size: 18px; margin: 0; }
    p.sub { margin: 4px 0 16px; color: #6B7280; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #D1D5DB; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #F3F4F6; text-transform: capitalize; font-size: 10px; letter-spacing: 0.04em; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tfoot td { font-weight: 700; background: #F9FAFB; }
    @page { size: A4 landscape; margin: 12mm; }
  </style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${escapeHtml(subtitle)}</p>
  <table>
    <thead><tr>${WORK_COLUMNS.map((c) => `<th${c === 'Amount' ? ' class="num"' : ''}>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${body || `<tr><td colspan="${WORK_COLUMNS.length}">No work in this period.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="${WORK_COLUMNS.length - 1}">Total (${rows.length} job${rows.length === 1 ? '' : 's'})</td><td class="num">${total.toLocaleString()}</td></tr></tfoot>
  </table></body></html>`;
}

/** Hands the finished file to the person: the share sheet on a phone, a
 * download in a browser. Web has no share sheet and expo-sharing is a
 * no-op there, so the two platforms genuinely need different endings. */
export async function deliver(base64: string, filename: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'com.microsoft.excel.xlsx' });
  }
}

/** A printable copy of the period's work. On web the browser's own print
 * dialog ("Save as PDF") does the saving - expo-print there just prints
 * the app page itself, so it opens the table in its own window instead. */
export async function exportWorkPdf(title: string, subtitle: string, rows: WorkRecordRow[]) {
  await printHtml(buildHtml(title, subtitle, rows));
}

/** Prints a finished HTML document: the browser's print dialog on web, a PDF
 * handed to the share sheet on a phone. */
export async function printHtml(html: string) {
  if (Platform.OS === 'web') {
    const win = window.open('', '_blank');
    if (!win) throw new Error('Your browser blocked the window - allow pop-ups for this site and try again.');
    // Printing is triggered from inside the document: a handler attached
    // from here can miss a load that fires during document.close().
    win.document.write(`${html.replace('</body>', '<script>window.onload=function(){window.focus();window.print();};</script></body>')}`);
    win.document.close();
    return;
  }

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  }
}

/** Opens a finished HTML document in the system's own print preview - the pages on one side, the
 * printer / pages / colour settings and Print / Cancel on the other - and prints from there.
 *
 * On web the document is loaded into a hidden frame and that frame is printed, so the browser's
 * preview opens right over the page the person is on (no new tab, nothing to pop-up-block); its
 * title is the page title in the preview's header. On a phone it is expo-print's print screen,
 * which previews the same way. Nothing is printed until Print is pressed there. */
export async function printWithPreview(html: string) {
  if (Platform.OS !== 'web') {
    await Print.printAsync({ html });
    return;
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error('Could not open the print preview in this browser.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  // Gone once the preview is closed; the timer is for a browser that never says so.
  win.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5 * 60 * 1000);
  // A beat for the document to lay out, then the preview.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  }, 250);
}

/** The same rows as a spreadsheet, for anyone who wants to total or filter
 * them afterwards. */
export async function exportWorkXlsx(filename: string, sheetName: string, rows: WorkRecordRow[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: WORK_COLUMNS as string[] });
  sheet['!cols'] = [
    { wch: 9 }, { wch: 12 }, { wch: 7 }, { wch: 30 }, { wch: 22 }, { wch: 13 },
    { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 11 },
  ];
  const book = XLSX.utils.book_new();
  // Excel refuses sheet names over 31 characters or with []:*?/\ in them.
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const base64 = XLSX.write(book, { bookType: 'xlsx', type: 'base64' });
  await deliver(base64, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
