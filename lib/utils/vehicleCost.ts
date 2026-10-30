// lib/utils/vehicleCost.ts
import type { BusinessTransaction, Product } from '../../types/database.types';

/** The vehicle an entry names: a bill's item, or the start of a payment's remark ("<vehicle> · <rest>"). */
export const vehicleKey = (name: string | null | undefined) => (name ?? '').split(' · ')[0].trim().replace(/\s+/g, ' ').toLowerCase();

/** Each vehicle's purchase price by vehicleKey: its purchase bill's rate (the latest bill), else its stock item's cost price. */
export function vehicleCosts(products: Product[], bills: BusinessTransaction[]): Map<string, number> {
  const costs = new Map<string, number>();
  for (const p of products) if (p.purchase_price != null) costs.set(vehicleKey(p.name), Number(p.purchase_price));
  const purchases = bills.filter((t) => t.type === 'purchase').sort((a, b) => (a.bill_date ?? a.created_at).localeCompare(b.bill_date ?? b.created_at));
  for (const t of purchases) for (const i of t.items ?? []) if (Number(i.rate) > 0) costs.set(vehicleKey(i.description), Number(i.rate));
  return costs;
}
