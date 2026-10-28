// lib/components/finance/entryTheme.ts
import { accentAlpha, themeColors } from '../../theme/accent';

/** The one accent colour every web finance entry form uses (Received,
 * Payment Out, Sale, Purchase, Expense), so they all read as one family -
 * the same colour as the sidebar highlight and the Scan Bill button. It is the
 * account's own accent (blue; green for Deeva), so these are read where they are
 * drawn, not kept in a constant. History lists and charts keep their own
 * per-type colours. */
export const entryAccent = (): string => themeColors.c600;
export const entryShadow = (): string => accentAlpha(600, 0.35);
