// lib/hooks/useYearCashTotals.ts
import { useMemo } from 'react';
import { useSupabaseQuery } from './useSupabase';
import { isSettledOnTheSpot } from './useAccountBalances';
import { journalOf } from '../utils/journalVoucher';

/** Epoch ms for a bill/entry date. A bare 'YYYY-MM-DD' is read as local
 * midnight (new Date() would read it as UTC midnight); a full timestamp
 * (the created_at fallback) is used as-is. */
function dayTime(date: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(date).getTime();
}

/** This year's real cash movement - what the Receivable / Payable Report
 * cards show as Total received / Total paid. The same definition as the
 * Finance dashboard's tiles of the same name: "received" is a payment
 * actually collected from a customer (or a sale settled on the spot), "paid"
 * is every expense, every manual Payment Out to a customer, every payment
 * made to a vendor and every purchase settled on the spot. A bill on credit
 * isn't cash until it's settled, so it doesn't count.
 *
 * `tillDate`: every entry from the first one up to today instead of this year only. */
export function useYearCashTotals(userId: string | undefined, { tillDate = false }: { tillDate?: boolean } = {}) {
  // `all`: these are sums over every entry; a plain read stops at 1000 rows.
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });

  return useMemo(() => {
    const year = new Date().getFullYear();
    const endOfToday = new Date().setHours(23, 59, 59, 999);
    const inYear = (date: string) => (tillDate ? dayTime(date) <= endOfToday : new Date(dayTime(date)).getFullYear() === year);
    let received = 0;
    let paid = 0;
    for (const t of transactions ?? []) {
      if (!inYear(t.bill_date ?? t.created_at)) continue;
      if (t.type === 'expense') paid += t.amount;
      if (isSettledOnTheSpot(t)) {
        if (t.type === 'sale') received += t.amount;
        else paid += t.amount;
      }
    }
    for (const e of customerEntries ?? []) {
      // A journal voucher's halves are not money received or paid.
      if (journalOf(e.note)) continue;
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') received += e.amount;
      if (e.entry_type === 'debit' && e.source === 'manual') paid += e.amount;
    }
    for (const e of vendorEntries ?? []) {
      if (journalOf(e.note)) continue;
      if (!inYear(e.entry_date ?? e.created_at)) continue;
      if (e.entry_type === 'credit') paid += e.amount;
    }
    return { received, paid };
  }, [transactions, customerEntries, vendorEntries, tillDate]);
}
