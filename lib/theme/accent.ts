// lib/theme/accent.ts
import { Platform } from 'react-native';
import { sellsVehicles } from '../utils/accountFeatures';

/** The app's main colour. Every account is blue, except one whose main colour is its own (Deeva Auto Enterprises:
 * green). Two things follow it:
 *  - the Tailwind classes `blue-*`, `orange-*` and `brand-*` (tailwind.config.js points them at the CSS variables
 *    `--accent-50 ... --accent-950`, set here on the page), and
 *  - `themeColors`, for a colour written in code (an icon, a border, a gradient). Read it where it is drawn - inside
 *    the component - not in a constant at the top of a file: that would be read once, before the account is known. */
export type AccentName = 'blue' | 'green';

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];

const SCALES: Record<AccentName, Record<Shade, string>> = {
  blue: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
    950: '#172554',
  },
  // 600 is the deeper green (white text on it stays easy to read), so the whole scale sits a step darker than Tailwind's.
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#22C55E',
    500: '#16A34A',
    600: '#15803D',
    700: '#166534',
    800: '#14532D',
    900: '#0F3D22',
    950: '#052E16',
  },
};

/** The near-black the dashboard's blue gradient starts from. */
const INK: Record<AccentName, string> = { blue: '#0F172A', green: '#052E16' };

type Colors = Record<`c${Shade}`, string> & { ink: string };

function colorsOf(name: AccentName): Colors {
  const out = { ink: INK[name] } as Colors;
  for (const shade of SHADES) out[`c${shade}`] = SCALES[name][shade];
  return out;
}

/** The current accent as hex, by shade: `themeColors.c600` is what was `#2563EB`. Changed in place by applyAccent. */
export const themeColors: Colors = colorsOf('blue');

let current: AccentName = 'blue';

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba(...)` of an accent shade, for a shadow or a focus ring. */
export function accentAlpha(shade: Shade, alpha: number): string {
  const [r, g, b] = rgbOf(SCALES[current][shade]);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** The CSS variables the Tailwind accent classes read ("37 99 235" - space separated so Tailwind can add opacity). */
export function accentVars(name: AccentName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const shade of SHADES) out[`--accent-${shade}`] = rgbOf(SCALES[name][shade]).join(' ');
  return out;
}

/** The accent for an account, picked out by its business name. */
export function accentFor(businessName: string | null | undefined): AccentName {
  return sellsVehicles(businessName) ? 'green' : 'blue';
}

export function currentAccent(): AccentName {
  return current;
}

/** Makes `name` the app's accent: `themeColors` and, on the web, the page's CSS variables (set on <html>, so a popup
 * - which the browser draws outside the app's own tree - follows it too). Safe to call on every render. */
export function applyAccent(name: AccentName): void {
  if (name === current) return;
  current = name;
  Object.assign(themeColors, colorsOf(name));
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    for (const [key, value] of Object.entries(accentVars(name))) document.documentElement.style.setProperty(key, value);
  }
}
