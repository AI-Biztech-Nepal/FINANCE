// lib/utils/renameStockItem.ts
import { supabase } from '../supabase';
import type { BillItem } from '../../types/database.types';

const nameKey = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

/**
 * A stock item is known everywhere by its name: its bill lines, the remark of every payment made on it (the Paid
 * and Received pages write the item first), and its rentals. Renaming only the product would cut it off from
 * all of them - its vendor, model, what was paid and what is due would vanish from Stock and Inventory. So the
 * new name is written into each of those too.
 *
 * Call it after the product itself has been saved under the new name. A bill that changes moves stock (the
 * stock trigger counts its lines again), so the product's quantity is set back to `stockLevel` at the end.
 */
export async function renameStockItem(ownerId: string, productId: string, oldName: string, newName: string, stockLevel: number) {
  const from = nameKey(oldName);
  const to = newName.trim();
  if (!from || from === nameKey(to)) return;

  // Bill lines.
  const bills = await allRows<{ id: string; items: BillItem[] | null }>((a, b) =>
    supabase.from('business_transactions').select('id, items').eq('owner_id', ownerId).in('type', ['sale', 'purchase']).range(a, b)
  );
  for (const bill of bills) {
    if (!(bill.items ?? []).some((i) => nameKey(i.description) === from)) continue;
    const items = (bill.items ?? []).map((i) => (nameKey(i.description) === from ? { ...i, description: to } : i));
    const { error } = await supabase.from('business_transactions').update({ items }).eq('id', bill.id);
    if (error) throw error;
  }

  // Payment remarks that start with the item ("<item> · <model> · <remark>"). Only hand-entered ones: a bill's own
  // ledger line carries the bill's remark, not the item.
  for (const table of ['customer_ledger_entries', 'vendor_ledger_entries'] as const) {
    const entries = await allRows<{ id: string; note: string | null }>((a, b) =>
      supabase.from(table).select('id, note').eq('owner_id', ownerId).eq('source', 'manual').ilike('note', `${escapeLike(oldName.trim())}%`).range(a, b)
    );
    for (const e of entries) {
      const parts = (e.note ?? '').split(' · ');
      if (nameKey(parts[0]) !== from) continue;
      const { error } = await supabase.from(table).update({ note: [to, ...parts.slice(1)].join(' · ') }).eq('id', e.id);
      if (error) throw error;
    }
  }

  // Rentals of the car.
  const { error: rentalError } = await supabase.from('rentals').update({ car: to }).eq('owner_id', ownerId).ilike('car', escapeLike(oldName.trim()));
  if (rentalError) throw rentalError;

  // The quantity the owner saved, whatever the bills just did to it.
  const { error: stockError } = await supabase.from('products').update({ stock_level: stockLevel }).eq('id', productId);
  if (stockError) throw stockError;
}
