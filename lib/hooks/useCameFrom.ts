// lib/hooks/useCameFrom.ts
import { router, useLocalSearchParams } from 'expo-router';

/** The pages that open others and want to be returned to: a line on the Balance Sheet or the Profit & Loss (or a card
 * on the Ledger) opens its report with `?from=...`, and that report shows a back button to it - on a wide screen too, where report pages
 * otherwise have none (the sidebar is the way around). */
const PLACES = {
  'balance-sheet': { label: 'Balance Sheet', path: '/finance' },
  'profit-loss': { label: 'Profit & Loss', path: '/report' },
  ledger: { label: 'Ledger', path: '/customers' },
} as const;
export type CameFromPlace = keyof typeof PLACES;

/** `path` marked as opened from `place`. */
export function withFrom(path: string, place: CameFromPlace): string {
  return `${path}${path.includes('?') ? '&' : '?'}from=${place}`;
}

/** Where this page was opened from, and the way back to it; null when it was opened any other way. */
export function useCameFrom(basePath: string): { label: string; back: () => void } | null {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const place = from && from in PLACES ? PLACES[from as CameFromPlace] : null;
  if (!place) return null;
  return {
    label: place.label,
    back: () => {
      if (router.canGoBack()) router.back();
      else router.replace(`${basePath}${place.path}` as never);
    },
  };
}
