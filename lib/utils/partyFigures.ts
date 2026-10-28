// lib/utils/partyFigures.ts
import { round2 } from './money';
import { entryDay } from './ledgerStatement';
import { journalOf } from './journalVoucher';

type Entry = {
  entry_type: string;
  amount: number;
  source: string;
  note: string | null;
  receipt_no: string | null;
  entry_date: string | null;
  created_at: string;
};

/** One person's figures as the Ledger table shows them. */
export interface PartyFigures {
  /** Billed with them in the period: what they were sold (their customer ledger) and what was bought from them. */
  billed: number;
  /** Money paid to them in the period (and money paid back to a customer); money received from them. */
  paid: number;
  received: number;
  /** Their two ledgers netted, as they stood at the period's end: owed to you, or by you. */
  receivable: number;
  payable: number;
  /** The last entry up to the period's end, and its number. */
  lastDay: string;
  lastRef: string;
}

/**
 * Every person's Ledger figures from their two ledgers - the same reading as the Ledger page: billed, paid and
 * received count within the period (`from`..`to`, '' = open), what is owed counts every entry up to its end. A
 * journal voucher's halves are not money paid or received.
 */
export function partyFigures(
  customerEntries: (Entry & { customer_id: string })[],
  vendorEntries: (Entry & { vendor_id: string })[],
  from: string,
  to: string
): Map<string, PartyFigures> {
  const map = new Map<string, PartyFigures & { net: number }>();
  const of = (id: string) => {
    let f = map.get(id);
    if (!f) {
      f = { billed: 0, paid: 0, received: 0, receivable: 0, payable: 0, lastDay: '', lastRef: '', net: 0 };
      map.set(id, f);
    }
    return f;
  };
  const take = (id: string, e: Entry, side: 'customer' | 'vendor') => {
    const day = entryDay(e.entry_date, e.created_at);
    if (to && day > to) return;
    const f = of(id);
    const amount = Number(e.amount);
    const debit = e.entry_type === 'debit';
    // What they owe you, net: a customer's debit adds to it, a vendor's debit takes from it.
    f.net += side === 'customer' ? (debit ? amount : -amount) : debit ? -amount : amount;
    if (day >= f.lastDay) {
      f.lastDay = day;
      f.lastRef = e.receipt_no?.trim() || f.lastRef;
    }
    if (from && day < from) return;
    const journal = !!journalOf(e.note);
    if (side === 'customer') {
      if (!debit) {
        if (!journal) f.received += amount;
      } else if (e.source === 'manual') {
        if (!journal) f.paid += amount;
      } else f.billed += amount;
    } else if (debit) f.billed += amount;
    else if (!journal) f.paid += amount;
  };
  for (const e of customerEntries) take(e.customer_id, e, 'customer');
  for (const e of vendorEntries) take(e.vendor_id, e, 'vendor');
  const out = new Map<string, PartyFigures>();
  for (const [id, f] of map) {
    const net = round2(f.net);
    out.set(id, {
      billed: round2(f.billed),
      paid: round2(f.paid),
      received: round2(f.received),
      receivable: Math.max(0, net),
      payable: Math.max(0, -net),
      lastDay: f.lastDay,
      lastRef: f.lastRef,
    });
  }
  return out;
}
