// lib/components/finance/dashboard/dashboardData.ts
import { toBsDayChartLabel } from '../../../utils/nepaliDate';
import { formatMoney } from '../../../utils/money';
import type { BusinessTransaction, BusinessTransactionType } from '../../../../types/database.types';

export type PeriodKey = '1d' | '1w' | '1m';

/** The three views of the Sales trend: today by the hour, the last 7 days, and
 * the last 30 days. `caption` finishes the sentence "NPR 12,000 ...". */
export const PERIODS: { key: PeriodKey; label: string; caption: string }[] = [
  { key: '1d', label: '1 day', caption: 'today' },
  { key: '1w', label: '1 week', caption: 'in the last 7 days' },
  { key: '1m', label: '1 month', caption: 'in the last 30 days' },
];

export interface Bucket {
  start: number;
  end: number;
  label: string;
}

export interface DashboardRange {
  buckets: Bucket[];
  /** How many buckets have happened yet - every one, except for today by the hour. */
  upTo: number;
  from: number;
  to: number;
  prevFrom: number;
  prevTo: number;
}

/** Epoch ms of an entry's date. A bare 'YYYY-MM-DD' is read as local midnight
 * (new Date() would read it as UTC midnight); a full timestamp is used as-is. */
export function dayTime(date: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(date).getTime();
}

/** The date a transaction is FOR (bill date), falling back to when it was entered. */
export function txTime(t: Pick<BusinessTransaction, 'bill_date' | 'created_at'>): number {
  return dayTime(t.bill_date ?? t.created_at);
}

/** When a transaction happened. A bill carries its bill date, which is a day
 * with no hour - so for the hourly view use the time it was entered, when that
 * was the same day. A backdated bill has no real hour and stays at midnight. */
export function txMoment(t: Pick<BusinessTransaction, 'bill_date' | 'created_at'>): number {
  const day = txTime(t);
  if (!t.bill_date) return day;
  const created = new Date(t.created_at);
  const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
  return createdDay === day ? created.getTime() : day;
}

function hourLabel(h: number): string {
  return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
}

/** The 24 hours of a day (`daysAgo` 0 = today). */
function hourBuckets(daysAgo: number): Bucket[] {
  const now = new Date();
  const out: Bucket[] = [];
  for (let h = 0; h < 24; h++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h + 1);
    out.push({ start: start.getTime(), end: end.getTime(), label: hourLabel(h) });
  }
  return out;
}

function dayBuckets(n: number, endOffsetDays: number): Bucket[] {
  const now = new Date();
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - endOffsetDays - i);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    out.push({ start: d.getTime(), end: next.getTime(), label: toBsDayChartLabel(d) });
  }
  return out;
}

export function buildRange(period: PeriodKey): DashboardRange {
  if (period === '1d') {
    const buckets = hourBuckets(0);
    const prev = hourBuckets(1);
    return {
      buckets,
      upTo: new Date().getHours() + 1,
      from: buckets[0].start,
      to: buckets[buckets.length - 1].end,
      prevFrom: prev[0].start,
      prevTo: prev[prev.length - 1].end,
    };
  }
  const count = period === '1w' ? 7 : 30;
  const buckets = dayBuckets(count, 0);
  const prev = dayBuckets(count, count);
  return {
    buckets,
    upTo: buckets.length,
    from: buckets[0].start,
    to: buckets[buckets.length - 1].end,
    prevFrom: prev[0].start,
    prevTo: prev[prev.length - 1].end,
  };
}

export function sumType(txs: BusinessTransaction[], type: BusinessTransactionType, from: number, to: number): number {
  let sum = 0;
  for (const t of txs) {
    if (t.type !== type) continue;
    const time = txTime(t);
    if (time >= from && time < to) sum += t.amount;
  }
  return sum;
}

export function seriesByBucket(txs: BusinessTransaction[], type: BusinessTransactionType, buckets: Bucket[]): number[] {
  const values = buckets.map(() => 0);
  for (const t of txs) {
    if (t.type !== type) continue;
    const time = txMoment(t);
    const i = buckets.findIndex((b) => time >= b.start && time < b.end);
    if (i >= 0) values[i] += t.amount;
  }
  return values;
}

/** Rupees with thousands separators (and paise when there are some), matching the app's "NPR 12,345" look. */
export function npr(v: number): string {
  return `NPR ${formatMoney(v)}`;
}

/** Axis-friendly amounts in the units Nepali businesses use: 25k, 1.5L (lakh), 2Cr (crore). */
export function compactNpr(v: number): string {
  const a = Math.abs(v);
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (a >= 1e7) return `${trim(v / 1e7)}Cr`;
  if (a >= 1e5) return `${trim(v / 1e5)}L`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  return String(Math.round(v));
}
