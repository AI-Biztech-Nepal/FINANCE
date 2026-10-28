// lib/utils/accountFeatures.ts
import type { BillItem } from '../../types/database.types';

/** Deeva Auto Enterprises sells vehicles, so its Purchase Report and its Paid page name the vehicle (the
 * bill's item) beside the vendor. There is no per-account setting, so the account is picked out by the
 * business name saved on its profile - written "Deeva" or "Deva", in any case. */
export function sellsVehicles(businessName: string | null | undefined): boolean {
  return /\bdee?va\s+auto\b/i.test(businessName ?? '');
}

/** A logo kept with the app for an account that has not uploaded one of its own (Company Details): Hamro G&G
 * Auto Enterprises, picked out by its business name - "G&G", "G & G" or "GnG", in any case - and Deeva Auto
 * Enterprises. Both are made for a light background (no background of their own). */
export function builtInLogo(businessName: string | null | undefined): number | null {
  if (/\bg\s*(&|n|and)\s*g\b/i.test(businessName ?? '')) return require('../../assets/logos/gng.png');
  return sellsVehicles(businessName) ? require('../../assets/logos/deeva.png') : null;
}

/** The same built-in logo at full size, for showing it large (the small one is made for the little icon square). */
export function builtInLogoLarge(businessName: string | null | undefined): number | null {
  return sellsVehicles(businessName) ? require('../../assets/logos/deeva-large.png') : builtInLogo(businessName);
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

/** The model numbers entered on a bill's items, each once, as one line: "2015, 2016". Empty when none was entered. */
export function modelNamesOf(items: BillItem[] | null | undefined): string {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of items ?? []) {
    const model = item.model?.trim();
    if (model && !seen.has(model.toLowerCase())) {
      seen.add(model.toLowerCase());
      models.push(model);
    }
  }
  return models.join(', ');
}

/** The same, as one line: "Honda Shine, Bajaj Pulsar". */
export function itemNamesOf(items: BillItem[] | null | undefined): string {
  return itemListOf(items).join(', ');
}
