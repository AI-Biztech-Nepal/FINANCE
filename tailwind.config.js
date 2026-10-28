/** @type {import('tailwindcss').Config} */

// The app's accent colour is read from CSS variables (--accent-50 ... --accent-950: global.css has the blue ones,
// lib/theme/accent.ts changes them for an account with its own colour), so every `blue-*`, `orange-*` and
// `brand-*` class follows the account's colour without touching a screen.
const accent = (shade) => `rgb(var(--accent-${shade}) / <alpha-value>)`;
const accentScale = Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [shade, accent(shade)]));

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Jageer's "professional blues and grays" theme.
        brand: {
          50: accent(50),
          100: accent(100),
          500: accent(500),
          700: accent(700),
          900: accent(900),
        },
        // App-wide brand accent lives on Tailwind's "orange" scale (every
        // `bg-orange-500` / `text-orange-600` / etc across the app resolves
        // through this one override), so a rebrand is one edit here instead
        // of touching every screen. It is blue (the company's blue-and-white
        // color theme) unless the account has its own accent - and `blue`
        // follows it too.
        orange: accentScale,
        blue: accentScale,
      },
    },
  },
  plugins: [],
};
