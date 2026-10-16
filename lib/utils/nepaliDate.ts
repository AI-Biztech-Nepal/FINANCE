// lib/utils/nepaliDate.ts
import NepaliDate, { dateConfigMap } from 'nepali-date-converter';
import { localTodayIso } from './localDate';

// Same order as NepaliDate's 0-based month index and the dateConfigMap keys.
export const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Aswin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

/** Which calendar the app's date labels are drawn in - the choice made with the AD / BS toggle in
 * the top bar (see useCalendarMode, which keeps this in step with it). The label helpers below read
 * it, so a date on any page follows the toggle without each page asking for it. */
let labelMode: 'bs' | 'ad' = 'bs';

export function setLabelCalendarMode(mode: 'bs' | 'ad') {
  labelMode = mode;
}

export function getLabelCalendarMode(): 'bs' | 'ad' {
  return labelMode;
}

const AD_SHORT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const AD_LONG: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

export interface BsDate {
  year: number;
  month: number; // 0-based, matches BS_MONTHS
  date: number;
}

// Nepal's official fiscal year runs Shrawan 1 - Ashad end (BS_MONTHS index 3
// through the end of index 2 the following year), not Baisakh-Chaitra - used
// for the "083/84" style suffix on a quotation number. Verified against a
// real quotation: 2083-05 (Bhadra, index 4) -> "083/84".
export function nepaliFiscalYearSuffix(bsYear: number, bsMonth: number): string {
  const startYear = bsMonth >= 3 ? bsYear : bsYear - 1;
  return `${String(startYear).slice(-3)}/${String(startYear + 1).slice(-2)}`;
}

/** Bikram Sambat label for an AD date string ('YYYY-MM-DD'), e.g. "Falgun 27, 2082".
 * Nepal runs on the BS calendar day-to-day, so every date shown or picked in the app
 * should carry its BS equivalent alongside the AD one - not just the Gregorian date. */
export function toBsLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  try {
    const bs = new NepaliDate(new Date(y, m - 1, d));
    return bs.format('MMMM DD, YYYY');
  } catch {
    return '';
  }
}

/** Compact BS label for a chart axis, e.g. "Bhadra 5" - takes a JS Date (or
 * epoch ms) directly rather than a string, so it reads local
 * year/month/date the same way every chart bucket is already built (going
 * through an ISO string first would round-trip via UTC and could land on
 * the wrong day for Nepal's +5:45 offset). */
export function toBsDayChartLabel(date: Date | number): string {
  if (labelMode === 'ad') return new Date(date).toLocaleDateString('en-US', AD_SHORT);
  try {
    const bs = new NepaliDate(new Date(date)).getBS();
    return `${BS_MONTHS[bs.month]} ${bs.date}`;
  } catch {
    return '';
  }
}

/** Compact BS month label for a chart axis, e.g. "Bhadra" - the BS month
 * that overlaps the given AD date (typically a month-bucket's start), for
 * charts bucketed by AD month. An AD month doesn't align to one BS month,
 * so this is which BS month that bucket *starts* in, not an exact range. */
export function toBsMonthChartLabel(date: Date | number): string {
  if (labelMode === 'ad') return new Date(date).toLocaleDateString('en-US', { month: 'short' });
  try {
    const bs = new NepaliDate(new Date(date)).getBS();
    return BS_MONTHS[bs.month];
  } catch {
    return '';
  }
}

/** BS label for a plain 'YYYY-MM-DD' date OR a full ISO timestamp
 * ('YYYY-MM-DDTHH:mm:ss.sssZ') - transaction history rows carry
 * `created_at` timestamps rather than bare dates, and Nepal runs on the BS
 * calendar day-to-day, so every history row should show its date this way
 * by default rather than the Gregorian one. Falls back to the plain AD date
 * if BS conversion fails, so a row never ends up with no date at all. */
export function toBsHistoryLabel(dateStr: string): string {
  const dateOnly = dateStr.slice(0, 10);
  // Read in AD (the toggle in the top bar), the same date is the English one: "Oct 12, 2026".
  if (labelMode === 'ad') {
    const [y, m, d] = dateOnly.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d).toLocaleDateString('en-US', AD_LONG);
  }
  return toBsLabel(dateOnly) || new Date(dateStr).toLocaleDateString();
}

/** A date without its year, for a narrow column: "Aswin 25" read in BS, "Oct 12" in AD. */
export function shortDateLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  if (labelMode === 'ad') return new Date(y, m - 1, d).toLocaleDateString('en-US', AD_SHORT);
  const bs = adStringToBs(adDateStr);
  return bs ? `${BS_MONTHS[bs.month]} ${bs.date}` : '';
}

/** A date as 00/00/0000 - day / month / year - in the calendar the app is read in: BS ("27/06/2083") or
 * AD ("13/10/2026"). Short and a fixed width, for a table column that has no room for a month name. */
export function numericDateLabel(adDateStr: string | null | undefined): string {
  if (!adDateStr) return '';
  const day = adDateStr.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  const two = (v: number) => String(v).padStart(2, '0');
  if (labelMode === 'ad') return `${two(d)}/${two(m)}/${y}`;
  const bs = adStringToBs(day);
  return bs ? `${two(bs.date)}/${two(bs.month + 1)}/${bs.year}` : `${two(d)}/${two(m)}/${y}`;
}

/** The month a date is in, as a row heading: "Aswin 2083" read in BS, "Oct 2026" in AD. */
export function monthGroupLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return 'Other';
  if (labelMode === 'ad') return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const bs = adStringToBs(adDateStr);
  return bs ? `${BS_MONTHS[bs.month]} ${bs.year}` : 'Other';
}

/** English (Gregorian) label for an AD date string, e.g. "Wed, Feb 18, 2026". */
export function toAdLabel(adDateStr: string): string {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** AD date string -> its BS calendar fields, for driving a BS calendar grid.
 * Null if the string is malformed or falls outside the library's supported
 * BS 2000-2090 range (roughly AD 1943-2033) - NepaliDate throws rather than
 * clamping, and this must never crash whatever's rendering the date. */
export function adStringToBs(adDateStr: string): BsDate | null {
  const [y, m, d] = adDateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  try {
    const bs = new NepaliDate(new Date(y, m - 1, d)).getBS();
    return { year: bs.year, month: bs.month, date: bs.date };
  } catch {
    return null;
  }
}

/** Same as adStringToBs, but falls back to today's BS date instead of null
 * so callers that need a definite grid position (e.g. a picker's initial
 * state) can never end up with an invalid year/month. */
export function adStringToBsOrToday(adDateStr: string): BsDate {
  return adStringToBs(adDateStr) ?? adStringToBs(localTodayIso())!;
}

/** BS calendar fields -> the 'YYYY-MM-DD' AD string every date is stored as. */
export function bsToAdString(year: number, month: number, date: number): string {
  const js = new NepaliDate(year, month, date).toJsDate();
  const yy = js.getFullYear();
  const mm = String(js.getMonth() + 1).padStart(2, '0');
  const dd = String(js.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** How many days a given BS year/month has - needed to lay out the grid. */
export function bsDaysInMonth(year: number, month: number): number {
  const cfg = (dateConfigMap as unknown as Record<string, Record<string, number>>)[String(year)];
  return cfg?.[BS_MONTHS[month]] ?? 30;
}

/** Weekday (0=Sunday...6=Saturday) of the 1st of a given BS year/month - the
 * leading blank offset for the grid. */
export function bsWeekdayOfFirst(year: number, month: number): number {
  try {
    return new NepaliDate(year, month, 1).getDay();
  } catch {
    return 0;
  }
}
