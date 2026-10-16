// lib/utils/ledgerStatement.ts
//
// The arithmetic behind the Ledger page and a party's statement, kept free of
// React so it can be checked on its own.
//
// A party has two ledgers (customer_ledger_entries and vendor_ledger_entries,
// opposite polarity - see 0059_vendor_ledger.sql). A statement shows them as ONE
// account from the business's side, the way a debtors' ledger does:
//   Debit  = the party owes you more
//   Credit = the party owes you less
//   Balance = Debit - Credit; positive = they owe you (Receivable), negative =
//   you owe them (Payable).
// So a sale and a payment you made out are Debits; money you received and a
// purchase on credit are Credits. That is exactly the figure partyPosition()
// already netted (customer balance - vendor balance), just with its two halves
// shown.

/** There is no due date on a sale or a ledger entry, so each one is treated as
 * due this many days after its own date. Anything unpaid beyond that is
 * overdue, and the aging buckets count days past that point. */
export const CREDIT_DAYS = 30;

export type LedgerSide = 'customer' | 'vendor';
export type EntryKind = 'debit' | 'credit';

/** A ledger entry from either table, reduced to what the statement needs. */
export interface LedgerItem {
  id: string;
  side: LedgerSide;
  /** As stored on that ledger - not yet turned into the party's Debit / Credit. */
  entryType: EntryKind;
  amount: number;
  /** 'YYYY-MM-DD': the entry's own date, else the day it was entered. */
  day: string;
  createdAt: string;
  /** The remark written on it, when there is one. */
  note?: string | null;
}

/** Both ends optional: '' means no limit on that side. 'YYYY-MM-DD'. */
export interface DateRange {
  from: string;
  to: string;
}

export const NO_RANGE: DateRange = { from: '', to: '' };

/** The day an entry belongs to, in the device's own time zone. */
export function entryDay(entryDate: string | null | undefined, createdAt: string): string {
  if (entryDate) return entryDate.slice(0, 10);
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** An entry as the party's Debit / Credit (see the top of this file). */
export function drCr(side: LedgerSide, entryType: EntryKind, amount: number): { debit: number; credit: number } {
  const owedToYou = (side === 'customer') === (entryType === 'debit');
  return owedToYou ? { debit: amount, credit: 0 } : { debit: 0, credit: amount };
}

export function compareItems(a: { day: string; createdAt: string }, b: { day: string; createdAt: string }): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

export interface PartyTotals {
  /** Where the account stood the day before the range started (0 with no start). */
  opening: number;
  debit: number;
  credit: number;
  /** opening + debit - credit: where it stands at the end of the range. */
  closing: number;
  /** The party's latest entry of all - not limited to the range. */
  lastDay: string | null;
  hasCustomer: boolean;
  hasVendor: boolean;
  count: number;
}

/** Opening balance, the range's Debit and Credit, and the closing balance.
 * Entries after the range's end are not part of it. */
export function summarize(items: readonly LedgerItem[], range: DateRange = NO_RANGE): PartyTotals {
  let opening = 0;
  let debit = 0;
  let credit = 0;
  let lastDay: string | null = null;
  let hasCustomer = false;
  let hasVendor = false;
  for (const item of items) {
    const { debit: d, credit: c } = drCr(item.side, item.entryType, item.amount);
    if (!lastDay || item.day > lastDay) lastDay = item.day;
    if (item.side === 'customer') hasCustomer = true;
    else hasVendor = true;
    if (range.from && item.day < range.from) opening += d - c;
    else if (!range.to || item.day <= range.to) {
      debit += d;
      credit += c;
    }
  }
  return { opening, debit, credit, closing: opening + debit - credit, lastDay, hasCustomer, hasVendor, count: items.length };
}

export interface SideTotals {
  /** Customer ledger: billed to them (sale bills and "customer owes" entries). */
  billed: number;
  /** Customer ledger: money received from them. */
  received: number;
  /** Vendor ledger: bought from them on credit. */
  purchased: number;
  /** Vendor ledger: paid out to them. */
  paid: number;
}

/** What went each way on each ledger inside the range - the "total sales /
 * total payments" figures on a statement. */
export function sideTotals(items: readonly LedgerItem[], range: DateRange = NO_RANGE): SideTotals {
  const totals: SideTotals = { billed: 0, received: 0, purchased: 0, paid: 0 };
  for (const item of items) {
    if (range.from && item.day < range.from) continue;
    if (range.to && item.day > range.to) continue;
    if (item.side === 'customer') {
      if (item.entryType === 'debit') totals.billed += item.amount;
      else totals.received += item.amount;
    } else if (item.entryType === 'debit') totals.purchased += item.amount;
    else totals.paid += item.amount;
  }
  return totals;
}

/** Adds each line's balance after it, starting from `opening`. Give the lines
 * oldest first. */
export function withRunningBalance<T extends { debit: number; credit: number }>(
  linesOldestFirst: readonly T[],
  opening: number
): (T & { balance: number })[] {
  let balance = opening;
  return linesOldestFirst.map((line) => {
    balance += line.debit - line.credit;
    return { ...line, balance };
  });
}

export type PartyStatus = 'receivable' | 'payable' | 'settled';

/** Whole rupees, like every figure on screen: 0.4 is settled. */
export function statusOf(balance: number): PartyStatus {
  const whole = Math.round(balance);
  return whole > 0 ? 'receivable' : whole < 0 ? 'payable' : 'settled';
}

export interface Aging {
  /** Not past due yet. */
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  /** Everything still unpaid on the customer ledger. */
  total: number;
  /** Everything past due: the four buckets after Current. */
  overdue: number;
}

export const AGING_BUCKETS: { key: keyof Omit<Aging, 'total' | 'overdue'>; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'days1to30', label: '1–30 days' },
  { key: 'days31to60', label: '31–60 days' },
  { key: 'days61to90', label: '61–90 days' },
  { key: 'days90plus', label: '90+ days' },
];

/** Whole days from `fromDay` to `toDay` (both 'YYYY-MM-DD'); negative when `toDay` is earlier. */
export function daysBetween(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const CENT = 0.005;

/** What a customer still owes, by how late it is. Payments are matched to the
 * oldest unpaid bill first (and a payment made before any bill is held and
 * applied to the next one), so what is left is the newest billing. Only the
 * customer ledger counts - this is receivables; the vendor side has no aging. */
export function receivableAging(items: readonly LedgerItem[], asOf: string, creditDays = CREDIT_DAYS): Aging {
  const customer = items.filter((i) => i.side === 'customer').sort(compareItems);
  const open: { day: string; left: number }[] = [];
  let spare = 0;
  for (const item of customer) {
    if (item.entryType === 'debit') {
      let left = item.amount;
      const used = Math.min(spare, left);
      spare -= used;
      left -= used;
      if (left > CENT) open.push({ day: item.day, left });
    } else {
      let payment = item.amount;
      while (payment > CENT && open.length > 0) {
        const oldest = open[0];
        const taken = Math.min(oldest.left, payment);
        oldest.left -= taken;
        payment -= taken;
        if (oldest.left <= CENT) open.shift();
      }
      spare += Math.max(payment, 0);
    }
  }

  const aging: Aging = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, total: 0, overdue: 0 };
  for (const { day, left } of open) {
    const pastDue = daysBetween(day, asOf) - creditDays;
    if (pastDue <= 0) aging.current += left;
    else if (pastDue <= 30) aging.days1to30 += left;
    else if (pastDue <= 60) aging.days31to60 += left;
    else if (pastDue <= 90) aging.days61to90 += left;
    else aging.days90plus += left;
    aging.total += left;
  }
  aging.overdue = aging.total - aging.current;
  return aging;
}

/** How much of what the party owes you is overdue. It can never be more than
 * they owe you in all - if you owe them on the vendor ledger too, that is netted
 * off first - and someone who is not in debt to you has nothing overdue. */
export function overdueAmount(balance: number, aging: Aging): number {
  const owed = Math.round(balance);
  if (owed <= 0) return 0;
  return Math.min(Math.round(aging.overdue), owed);
}

/** "Today", "Yesterday", "5 days ago", "3 months ago" - for a Last Transaction cell. */
export function relativeDay(day: string, today: string): string {
  const days = daysBetween(day, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
