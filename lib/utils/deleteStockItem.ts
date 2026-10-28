// lib/utils/deleteStockItem.ts
import { supabase } from '../supabase';
import { round2 } from './money';
import type { BillItem } from '../../types/database.types';

const nameKey = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const lineAmount = (i: BillItem) => Number(i.amount) || (Number(i.qty) || 0) * (Number(i.rate) || 0);

/**
 * Takes an item off the books: the bill lines that bought or sold it, then the stock item itself.
 *
 * A bill with nothing else on it goes; a bill with other items loses this line and its total comes down by it.
 * Each bill's own ledger line follows it (the posting triggers), so a vendor's payable drops by what this item
 * was billed. Payments that name the item are left: that money really moved, and stays on the ledger to be put
 * right by hand if it was meant for something else.
 */
export async function deleteStockItem(ownerId: string, name: string, productId: string | null) {
  const key = nameKey(name);
  if (!key) return;

  // Every bill first, then the changes: deleting while paging would shift the pages and skip bills.
  const bills: { id: string; amount: number; items: BillItem[] | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('business_transactions')
      .select('id, amount, items')
      .eq('owner_id', ownerId)
      .in('type', ['sale', 'purchase'])
      .range(from, from + 999);
    if (error) throw error;
    bills.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  for (const bill of bills) {
    const items = bill.items ?? [];
    const mine = items.filter((i) => nameKey(i.description) === key);
    if (!mine.length) continue;
    const rest = items.filter((i) => nameKey(i.description) !== key);
    const amount = round2(Number(bill.amount) - mine.reduce((s, i) => s + lineAmount(i), 0));
    const { error } =
      rest.length && amount > 0
        ? await (supabase.from('business_transactions') as any).update({ items: rest, amount }).eq('id', bill.id)
        : await supabase.from('business_transactions').delete().eq('id', bill.id);
    if (error) throw error;
  }

  if (productId) {
    const { error } = await supabase.from('products').delete().eq('id', productId);
    if (error) throw error;
  }
  // The name the bill form remembered for it, so it is not offered (or listed as a bills-only item) again.
  await supabase.from('finance_items').delete().eq('owner_id', ownerId).ilike('name', escapeLike(name.trim()));
}
