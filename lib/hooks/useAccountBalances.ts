// lib/hooks/useAccountBalances.ts
import { useMemo } from 'react';
import { journalOf } from '../utils/journalVoucher';
import { useSupabaseQuery } from './useSupabase';
import { useBankAccounts } from './useBankAccounts';

/** A Sale or Purchase that isn't billed to a saved party, so no ledger debt
 * is booked for it (0061) - its money moved when it was recorded. Shared by
 * every Finance figure that counts cash in/out, so they all agree. */
export function isSettledOnTheSpot(t: { type: string; customer_id?: string | null }): boolean {
  return (t.type === 'sale' || t.type === 'purchase') && !t.customer_id;
}

export interface AccountActivityItem {
  id: string;
  date: string;
  label: string;
  sub: string;
  amount: number;
  isInflow: boolean;
  nav:
    | { kind: 'transactions'; type: 'sale' | 'purchase' | 'expense' }
    | { kind: 'party'; partyId: string }
    | { kind: 'transfer'; transferId: string };
}

/**
 * The actual cash-in-hand + per-bank-account balance. Sale and Purchase
 * don't move cash by themselves any more (0061_sale_purchase_always_ledger.sql
 * turned them into a party-ledger debt instead), so the real inflow/outflow
 * this counts is: Expenses (still immediate cash), Payment In/Out against a
 * customer, and payments actually made to a vendor. This is the one place
 * all of Finance's "how much money do we actually have" figures should come
 * from, so the Available Balance tile and its Bank Accounts detail view can
 * never drift apart - `activity` is the same underlying records, one line
 * per entry instead of summed, so each account's balance can be traced back
 * to what actually made it up (its "ledger").
 */
export function useAccountBalances(userId: string | undefined) {
  const { accounts } = useBankAccounts(userId);
  const { data: transactions } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    // Every row, not the API's first 1000 - a balance is a sum of all of them.
    all: true,
    enabled: !!userId,
  });
  const { data: customerEntries } = useSupabaseQuery('customer_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    // Every row, not the API's first 1000 - a balance is a sum of all of them.
    all: true,
    enabled: !!userId,
  });
  const { data: vendorEntries } = useSupabaseQuery('vendor_ledger_entries', {
    filters: userId ? { owner_id: userId } : {},
    // Every row, not the API's first 1000 - a balance is a sum of all of them.
    all: true,
    enabled: !!userId,
  });
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    // Every row, not the API's first 1000 - a balance is a sum of all of them.
    all: true,
    enabled: !!userId,
  });
  const { data: transfers } = useSupabaseQuery('account_transfers', {
    filters: userId ? { owner_id: userId } : {},
    // Every row, not the API's first 1000 - a balance is a sum of all of them.
    all: true,
    enabled: !!userId,
  });

  return useMemo(() => {
    const nameById = new Map<string, string>();
    (customers ?? []).forEach((c) => nameById.set(c.id, c.name));

    const byAccount: Record<string, number> = { cash: 0 };
    const activity: Record<string, AccountActivityItem[]> = { cash: [] };
    const key = (bankAccountId: string | null) => bankAccountId ?? 'cash';
    const add = (bankAccountId: string | null, amount: number, item: Omit<AccountActivityItem, 'amount'>) => {
      const k = key(bankAccountId);
      byAccount[k] = (byAccount[k] ?? 0) + amount;
      (activity[k] ??= []).push({ ...item, amount: Math.abs(amount) });
    };

    // Sale and Purchase no longer move cash directly - each one books a
    // debt on the party's ledger instead (0061_sale_purchase_always_ledger.sql),
    // and it's *that* ledger being settled (a Payment In/Out or vendor
    // payment) that actually moves money. Only Expense still spends cash
    // the moment it's logged.
    for (const t of transactions ?? []) {
      // A Sale/Purchase with no party behind it has no ledger to settle
      // later - a paid walk-in job (0037), or a delivered cash-on-delivery
      // order (0050). The money changed hands there and then, so it counts
      // as cash straight away; leaving it out made real takings vanish from
      // the balance.
      if (isSettledOnTheSpot(t)) {
        const isSale = t.type === 'sale';
        add(t.bank_account_id, isSale ? t.amount : -t.amount, {
          id: t.id,
          date: t.bill_date ?? t.created_at,
          label: `${isSale ? 'Sale' : 'Purchase'}${t.party_name ? ` · ${t.party_name}` : ''}`,
          sub: t.note ?? '',
          isInflow: isSale,
          nav: { kind: 'transactions', type: isSale ? 'sale' : 'purchase' },
        });
      }
      // An expense posted through a journal voucher was never paid in cash: it is owed to a person.
      if (t.type === 'expense' && !journalOf(t.note)) {
        const partyLabel = t.party_name ?? '';
        add(t.bank_account_id, -t.amount, {
          id: t.id,
          date: t.bill_date ?? t.created_at,
          label: partyLabel ? `Expenses · ${partyLabel}` : 'Expenses',
          sub: t.note ?? '',
          isInflow: false,
          nav: { kind: 'transactions', type: 'expense' },
        });
      }
    }
    for (const e of customerEntries ?? []) {
      // A journal voucher moves no cash: its two halves are not in the account's activity.
      if (journalOf(e.note)) continue;
      const name = nameById.get(e.customer_id) ?? 'Unknown customer';
      if (e.entry_type === 'credit') {
        add(e.bank_account_id, e.amount, {
          id: e.id,
          date: e.entry_date ?? e.created_at,
          label: `Received · ${name}`,
          sub: e.note ?? '',
          isInflow: true,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      } else if (e.entry_type === 'debit' && e.source === 'manual') {
        add(e.bank_account_id, -e.amount, {
          id: e.id,
          date: e.entry_date ?? e.created_at,
          label: `Paid · ${name}`,
          sub: e.note ?? '',
          isInflow: false,
          nav: { kind: 'party', partyId: e.customer_id },
        });
      }
    }
    for (const e of vendorEntries ?? []) {
      if (journalOf(e.note)) continue;
      if (e.entry_type === 'credit') {
        const name = nameById.get(e.vendor_id) ?? 'Unknown vendor';
        add(e.bank_account_id, -e.amount, {
          id: e.id,
          date: e.entry_date ?? e.created_at,
          label: `Paid · ${name}`,
          sub: e.note ?? '',
          isInflow: false,
          nav: { kind: 'party', partyId: e.vendor_id },
        });
      }
    }

    // Moving money between the business's own accounts - doesn't touch
    // Sales/Purchase/Expense or any party's ledger, just leaves one account
    // and enters the other.
    const accountName = (id: string | null) => (id ? accounts.find((a) => a.id === id)?.name ?? 'Unknown account' : 'Cash');
    for (const t of transfers ?? []) {
      add(t.from_account_id, -t.amount, {
        id: t.id,
        date: t.transfer_date ?? t.created_at,
        label: `Transfer to ${accountName(t.to_account_id)}`,
        sub: t.note ?? '',
        isInflow: false,
        nav: { kind: 'transfer', transferId: t.id },
      });
      add(t.to_account_id, t.amount, {
        id: t.id,
        date: t.transfer_date ?? t.created_at,
        label: `Transfer from ${accountName(t.from_account_id)}`,
        sub: t.note ?? '',
        isInflow: true,
        nav: { kind: 'transfer', transferId: t.id },
      });
    }

    for (const items of Object.values(activity)) {
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const cash = byAccount.cash ?? 0;
    const perAccount = accounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      balance: byAccount[acc.id] ?? 0,
      activity: activity[acc.id] ?? [],
    }));
    const total = cash + perAccount.reduce((sum, a) => sum + a.balance, 0);
    // False until every list has arrived, so a screen can wait rather than show zeros.
    const ready = !!transactions && !!customerEntries && !!vendorEntries && !!transfers && !!customers;
    return { cash, cashActivity: activity.cash, perAccount, total, ready };
  }, [transactions, customerEntries, vendorEntries, customers, transfers, accounts]);
}
