// lib/utils/nameCaps.ts

/** A party's name the way the app writes it: the first letter of every word in capitals,
 * the rest small ("Ram Sharma"), so names typed or imported as "ram sharma", "Ram Sharma"
 * and "RAM SHARMA" read the same. Used both to show a name (so entries saved earlier look
 * right too) and to save new ones. Names in scripts without letter case, like Devanagari,
 * are unchanged. */
export function nameCaps(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/(^|[\s(\-/.])(\p{L})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** A name as it should be shown, or saved on a bill: one written in ALL CAPITALS
 * ("ELECTRONICS CONCERN & RESEARCH CENTRE PVT LTD") becomes "Electronics Concern & Research Centre Pvt Ltd".
 * Anything else is left exactly as typed ("iPhone Repair", "McDonald", "ram sharma") - the same rule as
 * migration 0087, so a mixed-case name is never reworded. The text style already puts a capital on the
 * first letter of each word; what it cannot do is make the rest small, which is what this is for. */
export function tidyName(name: string | null | undefined): string {
  const s = name ?? '';
  const hasCase = /\p{L}/u.test(s) && s !== s.toLowerCase();
  return hasCase && s === s.toUpperCase() ? nameCaps(s) : s;
}

/** Capitalises the first letter of every word while typing, and leaves everything else alone (no
 * lower-casing, same length) so the caret can stay where the person is typing. The full
 * `nameCaps` still runs when the name is saved. */
export function capWords(text: string): string {
  return text.replace(/(^|[\s(\-/.])(\p{L})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}
