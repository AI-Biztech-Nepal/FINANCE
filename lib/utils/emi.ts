// lib/utils/emi.ts
import { round2 } from './money';
import { itemListOf } from './accountFeatures';
import type { BillItem, BusinessTransaction, EmiPlan, Product } from '../../types/database.types';

/** What a stock item bought on EMI is set up with: 12 monthly installments, 10% interest a year (reducing balance). */
export const EMI_STOCK_MONTHS = 12;
export const EMI_STOCK_RATE = 10;

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Which way a plan runs: 'sale' (the customer pays us) unless it says 'purchase' (we pay the vendor). */
export const emiDirection = (plan: Pick<EmiPlan, 'direction'>): 'sale' | 'purchase' => (plan.direction === 'purchase' ? 'purchase' : 'sale');

/** The monthly installment (EMI) the way banks work it out: `ratePct` is the interest a year, charged each month (a
 * twelfth of it) on what is still unpaid - reducing balance - so every installment is the same and the interest in it
 * shrinks as the loan is paid down. 100,000 over 12 months at 10% a year -> 8,791.59 a month, 5,499.08 interest in all.
 * With no interest, the amount over the months. */
export function emiInstallment(financed: number, months: number, ratePct: number): number {
  if (!(financed > 0) || !(months > 0)) return 0;
  const r = (Number(ratePct) || 0) / 12 / 100;
  if (!(r > 0)) return round2(financed / months);
  const grow = Math.pow(1 + r, months);
  return round2((financed * r * grow) / (grow - 1));
}

/** 'YYYY-MM-DD' `n` months after `iso`, on the same day (the month's last day when it has fewer). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const date = new Date(y, m - 1 + n, Math.min(d, last));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type Billed = { total: number; bill: BusinessTransaction; line: BillItem; date: string };
type PlanRow = Omit<EmiPlan, 'id' | 'owner_id' | 'created_at' | 'updated_at'>;

/** Each item's lines on the `type` bills (Purchase or Sale), by name: what they come to, and the latest bill's party, line and
 * date. Read the way Stock and Inventory and the Payable Report read a car's bill: the whole bill (VAT and discount
 * included) when the car is the only one on it, else the car's own line. */
function billedBy(bills: BusinessTransaction[], type: 'purchase' | 'sale'): Map<string, Billed> {
  const found = new Map<string, Billed>();
  for (const bill of bills) {
    if (bill.type !== type) continue;
    const date = (bill.bill_date ?? bill.created_at).slice(0, 10);
    const sole = itemListOf(bill.items).length === 1;
    const counted = new Set<string>();
    for (const line of bill.items ?? []) {
      const k = norm(line.description);
      if (!k) continue;
      let amount = Number(line.amount) > 0 ? Number(line.amount) : (Number(line.qty) || 0) * (Number(line.rate) || 0);
      if (sole) {
        // the one car's bill is counted once, however many lines it has
        amount = counted.has(k) ? 0 : Number(bill.amount) || amount;
        counted.add(k);
      }
      const seen = found.get(k);
      if (!seen) found.set(k, { total: amount, bill, line, date });
      else {
        seen.total += amount;
        if (date > seen.date) Object.assign(seen, { bill, line, date });
      }
    }
  }
  return found;
}

/** What one vehicle's `type` bills (Sale or Purchase) come to - read as Stock and Inventory reads them (see billedBy) -
 * and the model on its latest bill line; null when it is on no such bill. */
export function billedVehicle(bills: BusinessTransaction[], type: 'purchase' | 'sale', name: string): { price: number; model: string } | null {
  const found = billedBy(bills, type).get(norm(name));
  return found && found.total > 0 ? { price: round2(found.total), model: found.line.model?.trim() ?? '' } : null;
}

/** Who sold each vehicle: the party on its latest Purchase bill, by name. */
export function vendorsByVehicle(bills: BusinessTransaction[]): Map<string, string> {
  const vendors = new Map<string, string>();
  for (const [k, found] of billedBy(bills, 'purchase')) if (found.bill.party_name) vendors.set(k, found.bill.party_name);
  return vendors;
}

/**
 * The EMI plans for every vehicle bought - in stock or since sold, none of them is paid up - one per item, on
 * installments from the vendor of its latest Purchase bill: its price (what its Purchase bills come to - the same figure
 * as the car's bill on Stock and Inventory; with no bill, the cost price), `months` installments with `rate`% interest a year (reducing balance), the first one a month after the bill. What was
 * already paid is not taken off here - the plan reads it from the Paid entries, so Remaining shows what is left. An
 * item that already has a purchase plan is left out, so adding twice makes no duplicates; one with no price anywhere
 * is reported in `noPrice` instead.
 */
export function emiStockPlans(input: {
  products: Product[];
  bills: BusinessTransaction[];
  plans: Pick<EmiPlan, 'car' | 'direction'>[];
  today: string;
  months: number;
  rate: number;
}): { rows: PlanRow[]; noPrice: string[] } {
  const have = new Set(input.plans.filter((p) => emiDirection(p) === 'purchase').map((p) => norm(p.car)));
  const found = billedBy(input.bills, 'purchase');
  const rows: PlanRow[] = [];
  const noPrice: string[] = [];
  for (const p of input.products) {
    if (p.is_active === false) continue;
    const k = norm(p.name);
    if (!k || have.has(k)) continue;
    have.add(k);
    const f = found.get(k);
    // Its bills come to the price; with no (priced) bill, the cost price for what is in stock - or for one, when it has been sold.
    const price = round2(f && f.total > 0 ? f.total : Number(p.purchase_price) > 0 ? Number(p.purchase_price) * Math.max(1, Number(p.stock_level) || 0) : 0);
    if (!(price > 0)) {
      noPrice.push(p.name);
      continue;
    }
    rows.push({
      direction: 'purchase',
      car: p.name,
      model: f?.line.model?.trim() || null,
      customer_id: f?.bill.customer_id ?? null,
      customer_name: f?.bill.party_name ?? null,
      sale_price: price,
      down_payment: 0,
      installment: emiInstallment(price, input.months, input.rate),
      months: input.months,
      interest_rate: input.rate,
      first_due: addMonths(f?.date ?? input.today, 1),
      product_id: p.id,
      note: null,
      closed_on: null,
    });
  }
  return { rows, noPrice };
}

/**
 * The other side of the same vehicles: each one already sold (it is on a Sale bill) is a plan for the customer to pay
 * us - the price its Sale bills come to, `months` installments with `rate`% interest a year (reducing balance), the first one a
 * month after the sale, the model from the vehicle's Purchase bill. What the customer already paid is not taken off here: the plan
 * reads it from their Received entries naming the vehicle. A vehicle that already has a sale plan is left out.
 */
export function emiSoldPlans(input: {
  products: Product[];
  bills: BusinessTransaction[];
  plans: Pick<EmiPlan, 'car' | 'direction'>[];
  months: number;
  rate: number;
}): { rows: PlanRow[] } {
  const have = new Set(input.plans.filter((p) => emiDirection(p) === 'sale').map((p) => norm(p.car)));
  const sold = billedBy(input.bills, 'sale');
  const bought = billedBy(input.bills, 'purchase');
  const rows: PlanRow[] = [];
  for (const p of input.products) {
    if (p.is_active === false) continue;
    const k = norm(p.name);
    const sale = sold.get(k);
    if (!k || have.has(k) || !sale || !(sale.total > 0)) continue;
    have.add(k);
    const price = round2(sale.total);
    rows.push({
      direction: 'sale',
      car: p.name,
      model: bought.get(k)?.line.model?.trim() || null,
      customer_id: sale.bill.customer_id ?? null,
      customer_name: sale.bill.party_name ?? null,
      sale_price: price,
      down_payment: 0,
      installment: emiInstallment(price, input.months, input.rate),
      months: input.months,
      interest_rate: input.rate,
      first_due: addMonths(sale.date, 1),
      product_id: p.id,
      note: null,
      closed_on: null,
    });
  }
  return { rows };
}

/**
 * Where a plan stands today. The down payment is entered only once it is paid, so it counts as paid; `received` is
 * what came in for the vehicle besides it (the customer's Received entries naming it - the vendor's Paid entries for a
 * purchase), which pays the installments, each due on its day.
 */
export function emiFigures(plan: Pick<EmiPlan, 'down_payment' | 'installment' | 'months' | 'first_due' | 'closed_on'>, received: number, today: string) {
  const down = Number(plan.down_payment) || 0;
  const paid = down + (Number(received) || 0);
  const inst = Number(plan.installment) || 0;
  const months = Math.max(1, Number(plan.months) || 1);
  const total = round2(down + inst * months);
  let dueCount = 0;
  for (let k = 0; k < months; k++) if (addMonths(plan.first_due, k) <= today) dueCount += 1;
  const dueByNow = round2(down + inst * dueCount);
  const overdue = round2(Math.max(0, dueByNow - paid));
  const remaining = round2(Math.max(0, total - paid));
  // The next installment not yet covered by what was paid.
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
