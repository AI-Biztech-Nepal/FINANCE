// lib/utils/financeVoiceActions.ts
import type { VoiceAction } from '../hooks/useVoiceCommand';

/** Where each of the five Finance voice/chat actions routes to - the exact
 * same routes the Finance dashboard's own Shortcuts use, so a spoken or
 * typed command lands on the identical add-flow a manual tap would. Shared
 * by FloatingAssistantChat (Sagar AI Assistant) and QuickPaymentScreen so
 * every entry point lands on the identical route shape. */
export const FINANCE_ACTION_META: Record<VoiceAction, { label: string; route: (basePath: string) => string }> = {
  add_sale: { label: 'Sale', route: (basePath) => `${basePath}/transactions?type=sale&add=1` },
  add_purchase: { label: 'Purchase', route: (basePath) => `${basePath}/transactions?type=purchase&add=1` },
  add_expense: { label: 'Expenses', route: (basePath) => `${basePath}/transactions?type=expense&add=1` },
  payment_in: { label: 'Received', route: (basePath) => `${basePath}/quick-payment?type=in` },
  payment_out: { label: 'Paid', route: (basePath) => `${basePath}/quick-payment?type=out` },
};

/** Builds the full route (base path + query string) for a resolved action,
 * carrying whatever fields were understood as `voice*` params for the
 * target form to pick up on mount (see TransactionForm/QuickPaymentScreen). */
export function buildFinancePrefillRoute(
  basePath: string,
  action: VoiceAction,
  fields: { amount?: number | null; party_name?: string | null; date?: string | null; note?: string | null }
): string {
  const meta = FINANCE_ACTION_META[action];
  const extra: string[] = [];
  if (fields.amount != null) extra.push(`voiceAmount=${encodeURIComponent(String(fields.amount))}`);
  if (fields.party_name) extra.push(`voiceParty=${encodeURIComponent(fields.party_name)}`);
  if (fields.date) extra.push(`voiceDate=${encodeURIComponent(fields.date)}`);
  if (fields.note) extra.push(`voiceNote=${encodeURIComponent(fields.note)}`);
  return `${meta.route(basePath)}${extra.length ? `&${extra.join('&')}` : ''}`;
}
