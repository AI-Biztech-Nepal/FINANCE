// lib/utils/money.ts

/** Rounds to paise (two decimals), so 0.1 + 0.2 is 0.3 and 1.005 is 1.01 - for anything saved or compared. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** An amount for the screen: thousands separators, and paise only when there are some
 * ("1,570", "445,134.29"). Use this instead of Math.round(n).toLocaleString(), which hides the paise. */
export function formatMoney(n: number): string {
  const v = round2(n);
  return v.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}
