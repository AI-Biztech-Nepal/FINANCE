// lib/utils/partyBalance.ts
import { round2 } from './money';

/** One party's two ledgers, each signed the way the entries add up:
 * `receivable` is the customer ledger (positive = they owe you) and `payable`
 * the vendor ledger (positive = you owe them). */
export type PartyLedgers = { receivable: number; payable: number };

export type PartyPosition = {
  /** Rupees and paise, both ledgers netted: positive = they owe you, negative = you owe them. */
  net: number;
  /** |net|, what the list shows as the amount. */
  amount: number;
  state: 'receive' | 'pay' | 'settled';
  /** Both ledgers carry a balance, so `net` is a sum of two different things. */
  bothLedgers: boolean;
};

/** The single number that says where a party stands. A person can be both a
 * customer and a vendor, and either ledger can even run backwards (a customer
 * who paid ahead, a vendor you paid ahead), so the two are netted into one
 * signed figure instead of being shown as separate columns that each hide
 * half the story. Each side is rounded to paise first so the result always agrees with
 * the figures on screen. */
export function partyPosition(ledgers: PartyLedgers | undefined): PartyPosition {
  const receivable = round2(ledgers?.receivable ?? 0);
  const payable = round2(ledgers?.payable ?? 0);
  const net = round2(receivable - payable);
  return {
    net,
    amount: Math.abs(net),
    state: net > 0 ? 'receive' : net < 0 ? 'pay' : 'settled',
    bothLedgers: receivable !== 0 && payable !== 0,
  };
}
