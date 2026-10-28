// lib/utils/emi.ts
import { round2 } from './money';
import type { BillItem, BusinessTransaction, EmiPlan, Product } from '../../types/database.types';

/** What a stock item bought on EMI is set up with: 12 monthly instalments, 10% a month (flat). */
export const EMI_STOCK_MONTHS = 12;
export const EMI_STOCK_RATE = 10;

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Which way a plan runs: 'sale' (the customer pays us) unless it says 'purchase' (we pay the vendor). */
export const emiDirection = (plan: Pick<EmiPlan, 'direction'>): 'sale' | 'purchase' => (plan.direction === 'purchase' ? 'purchase' : 'sale');

/** The monthly instalment with flat interest: the financed amount spread over the months, plus `ratePct` percent of
 * the financed amount every month. 100,000 over 12 months at 10% -> 8,333.33 + 10,000 = 18,333.33 a month. */
export function flatInstallment(financed: number, months: number, ratePct: number): number {
  if (!(financed > 0) || !(months > 0)) return 0;
  return round2(financed / months + (financed * (Number(ratePct) || 0)) / 100);
}

/** 'YYYY-MM-DD' `n` months after `iso`, on the same day (the month's last day when it has fewer). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const date = new Date(y, m - 1 + n, Math.min(d, last));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The EMI plans for the stock that has been bought and is on the shelf (stock above 0), one per item, bought on
 * instalments from the vendor of its latest Purchase bill: its price (the cost price times what is in stock, else the
 * bill's rate), `months` instalments with `rate`% a month flat, the first one a month after the bill. An item that
 * already has a purchase plan is left out, so adding twice makes no duplicates; one with no price anywhere is
 * reported in `noPrice` instead.
 */
export function emiStockPlans(input: {
  products: Product[];
  bills: BusinessTransaction[];
  plans: Pick<EmiPlan, 'car' | 'direction'>[];
  today: string;
  months: number;
  rate: number;
}): { rows: Omit<EmiPlan, 'id' | 'owner_id' | 'created_at' | 'updated_at'>[]; noPrice: string[] } {
  const have = new Set(input.plans.filter((p) => emiDirection(p) === 'purchase').map((p) => norm(p.car)));
  const latest = new Map<string, { bill: BusinessTransaction; line: BillItem; date: string }>();
  for (const bill of input.bills) {
    if (bill.type !== 'purchase') continue;
    const date = (bill.bill_date ?? bill.created_at).slice(0, 10);
    for (const line of bill.items ?? []) {
      const k = norm(line.description);
      if (!k) continue;
      const seen = latest.get(k);
      if (!seen || date > seen.date) latest.set(k, { bill, line, date });
    }
  }
  const rows: Omit<EmiPlan, 'id' | 'owner_id' | 'created_at' | 'updated_at'>[] = [];
  const noPrice: string[] = [];
  for (const p of input.products) {
    if (p.is_active === false || !(Number(p.stock_level) > 0)) continue;
    const k = norm(p.name);
    if (!k || have.has(k)) continue;
    have.add(k);
    const found = latest.get(k);
    const unit = Number(p.purchase_price) > 0 ? Number(p.purchase_price) : Number(found?.line.rate) > 0 ? Number(found?.line.rate) : 0;
    const price = round2(unit * Number(p.stock_level));
    if (!(price > 0)) {
      noPrice.push(p.name);
      continue;
    }
    rows.push({
      direction: 'purchase',
      car: p.name,
      model: found?.line.model?.trim() || null,
      customer_id: found?.bill.customer_id ?? null,
      customer_name: found?.bill.party_name ?? null,
      sale_price: price,
      down_payment: 0,
      installment: flatInstallment(price, input.months, input.rate),
      months: input.months,
      interest_rate: input.rate,
      first_due: addMonths(found?.date ?? input.today, 1),
      product_id: p.id,
      note: null,
      closed_on: null,
    });
  }
  return { rows, noPrice };
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
        : { label: 'Running', color: '#1D4ED8', bg: '#EFF6FF' };
  return { total, paid: round2(paid), dueCount, dueByNow, overdue, remaining, next: remaining === 0 ? null : next, status };
}
