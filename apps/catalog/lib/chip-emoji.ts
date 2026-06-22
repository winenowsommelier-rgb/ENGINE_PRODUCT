/**
 * chip-emoji — emoji icons for shop filter chips, mirroring the finder's
 * category cards (app/finder/page.tsx) so /shop and /finder read consistently.
 *
 * PURE module, NO Node deps (no fs/path): Filters.tsx is a 'use client'
 * component, so anything it imports lands in the browser bundle. Same constraint
 * as lib/category-constants.ts — keep this free of `fs` or the webpack build
 * fails ("Module not found: Can't resolve 'fs'").
 *
 * Country flags are NOT redefined here — they come from the single source of
 * truth, lib/explore/flags.ts (flagEmoji), which derives flags from ISO codes
 * rather than hardcoding glyphs and is shared with the explore map.
 *
 * Lookups are case-insensitive and tolerant of unknown values (return ''), so a
 * new category group or country in the data never crashes a chip — it just
 * renders without an icon.
 */

import { flagEmoji } from '@/lib/explore/flags';

/**
 * Category group → emoji. Keys are the 10 CATEGORY_GROUPS values. Wine maps to
 * 🍷 to match the finder's Red Wine card; the finer red/white/sparkling split
 * doesn't exist at the group level on /shop.
 */
const CATEGORY_EMOJI: Record<string, string> = {
  'Wine': '🍷',
  'Whisky': '🥃',
  'Spirits': '✨',
  'Sake & Asian': '🍶',
  'Liqueur': '🍯',
  'Beer & RTD': '🍺',
  'Non-Alcoholic': '🚫',
  'Cigars': '🚬',
  'Events': '🎟️',
  'Accessories': '🧰',
};

/** Emoji for a category group, or '' if unmapped. Case-insensitive. */
export function categoryEmoji(group: string | null | undefined): string {
  if (!group) return '';
  return (
    CATEGORY_EMOJI[group] ??
    CATEGORY_EMOJI[
      Object.keys(CATEGORY_EMOJI).find(
        (k) => k.toLowerCase() === group.toLowerCase(),
      ) ?? ''
    ] ??
    ''
  );
}

/**
 * Flag emoji for a country, or '' if unmapped. Delegates to the shared
 * flagEmoji() so flags live in exactly one place (lib/explore/flags.ts).
 */
export function countryEmoji(country: string | null | undefined): string {
  return flagEmoji(country);
}
