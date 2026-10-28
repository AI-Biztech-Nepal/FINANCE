// lib/utils/emi.ts
import { round2 } from './money';
import type { EmiPlan } from '../../types/database.types';
import { themeColors } from '../theme/accent';

/** 'YYYY-MM-DD' `n` months after `iso`, on the same day (the month's last day when it has fewer). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const date = new Date(y, m - 1 + n, Math.min(d, last));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Where a plan stands today. `paid` is everything received from the customer for the vehicle (their Received entries
 * naming it), down payment included. The down payment is due on the day of sale; each instalment on its day.
 */
export function emiFigures(plan: Pick<EmiPlan, 'down_payment' | 'installment' | 'months' | 'first_due' | 'closed_on'>, paid: number, today: string) {
  const down = Number(plan.down_payment) || 0;
  const inst = Number(plan.installment) || 0;
  const months = Math.max(1, Number(plan.months) || 1);
  const total = round2(down + inst * months);
  let dueCount = 0;
  for (let k = 0; k < months; k++) if (addMonths(plan.first_due, k) <= today) dueCount += 1;
  const dueByNow = round2(down + inst * dueCount);
  const overdue = round2(Math.max(0, dueByNow - paid));
  const remaining = round2(Math.max(0, total - paid));
  // The next instalment not yet covered by what was paid.
  let next: string | null = null;
  for (let k = 0; k < months; k++) {
    if (round2(down + inst * (k + 1)) > paid) {
      next = addMonths(plan.first_due, k);
      break;
    }
  }
  const status =
    plan.closed_on || remaining === 0
      ? { label: 'Completed', color: '#047857', bg: '#ECFDF5' }
      : overdue > 0
        ? { label: 'Overdue', color: '#B91C1C', bg: '#FEF2F2' }
        : { label: 'Running', color: themeColors.c700, bg: themeColors.c50 };
  return { total, paid: round2(paid), dueCount, dueByNow, overdue, remaining, next: remaining === 0 ? null : next, status };
}
