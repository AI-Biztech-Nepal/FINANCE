// lib/hooks/useAvailableAmounts.ts
import { useMemo } from 'react';
import { useAccountBalances } from './useAccountBalances';
import { formatMoney, round2 } from '../utils/money';

export interface AvailableAmounts {
  /** Money available to spend in each bank / wallet, by bank account id - never below 0.
   * Cash in hand isn't here: it has no amount shown, only the bank and wallet accounts do. */
  byId: Record<string, number>;
}

/** How much money is in each bank account / wallet right now - the same figures
 * as the Bank Balances page - for a payment form's "Payment method" dropdown to
 * show beside each choice, so it is clear where the money is before picking
 * what to pay from.
 *
 * "Available" is money you can actually spend, so it is never negative: an
 * account whose books have gone below zero (more recorded going out than coming
 * in) reads 0 here. The books themselves - the Day Book, Bank Balances and the
 * dashboard - still show the true figure.
 *
 * Pass the user id only where the amounts are wanted; with `undefined` nothing
 * is read at all. Returns null until the books have loaded, so a dropdown never
 * shows zeros that look like real balances. */
export function useAvailableAmounts(userId: string | undefined): AvailableAmounts | null {
  const balances = useAccountBalances(userId);
  return useMemo(
    () =>
      balances.ready
        ? { byId: Object.fromEntries(balances.perAccount.map((a) => [a.id, spendable(a.balance)])) }
        : null,
    [balances]
  );
}

/** What can be spent: a balance below zero is 0 (also keeps a rounded "-0" from showing). */
function spendable(balance: number): number {
  return round2(Math.max(0, balance));
}

/** "Esewa — NPR 0"; just the name while the amount isn't known. */
export function optionLabel(name: string, amount: number | undefined): string {
  return amount === undefined ? name : `${name}  —  NPR ${formatMoney(amount)}`;
}
