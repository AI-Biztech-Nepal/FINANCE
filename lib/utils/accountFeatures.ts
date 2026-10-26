// lib/utils/accountFeatures.ts
import type { BillItem } from '../../types/database.types';

/** Deeva Auto Enterprises sells vehicles, so its Purchase Report and its Paid page name the vehicle (the
 * bill's item) beside the vendor. There is no per-account setting, so the account is picked out by the
 * business name saved on its profile - written "Deeva" or "Deva", in any case. */
export function sellsVehicles(businessName: string | null | undefined): boolean {
  return /\bdee?va\s+auto\b/i.test(businessName ?? '');
}

/** The names of a bill's items, each once, in the order they are on the bill. */
export function itemListOf(items: BillItem[] | null | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items ?? []) {
    const name = item.description?.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }
  return names;
}

/** The same, as one line: "Honda Shine, Bajaj Pulsar". */
export function itemNamesOf(items: BillItem[] | null | undefined): string {
  return itemListOf(items).join(', ');
}
