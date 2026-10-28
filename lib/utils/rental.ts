// lib/utils/rental.ts
import { round2 } from './money';
import type { Rental } from '../../types/database.types';
import { themeColors } from '../theme/accent';

/** Whole days from one 'YYYY-MM-DD' to another (a day number, so differences are exact across months). */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** What a rental comes to. It is billed by the day, counting the day it went out and the day it came
 * back: to the day it returned; else to the day it is due back, if that is still ahead; else up to today
 * (it is overdue, and every day it stays out is a day more). At least one day. */
export function rentalFigures(
  r: Pick<Rental, 'start_date' | 'end_date' | 'returned_on' | 'rate_per_day' | 'payments'>,
  today: string
) {
  const until = r.returned_on ?? (r.end_date && r.end_date > today ? r.end_date : today);
  const days = Math.max(1, dayNumber(until) - dayNumber(r.start_date) + 1);
  const total = round2(days * Number(r.rate_per_day || 0));
  const received = round2((r.payments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  return { days, total, received, due: round2(total - received) };
}

/** Where a rental stands: returned, overdue (past its due-back day and still out) or out. */
export function rentalStatus(r: Pick<Rental, 'end_date' | 'returned_on'>, today: string) {
  if (r.returned_on) return { label: 'Returned', color: '#374151', bg: '#F3F4F6' };
  if (r.end_date && r.end_date < today) return { label: 'Overdue', color: '#B91C1C', bg: '#FEF2F2' };
  return { label: 'Out', color: themeColors.c700, bg: themeColors.c50 };
}
