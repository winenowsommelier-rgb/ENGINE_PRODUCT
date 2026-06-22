/**
 * chip-emoji — emoji icons for shop filter chips, mirroring the finder's
 * category cards (app/finder/page.tsx) so /shop and /finder read consistently.
 *
 * PURE module, NO Node deps (no fs/path): Filters.tsx is a 'use client'
 * component, so anything it imports lands in the browser bundle. Same constraint
 * as lib/category-constants.ts — keep this free of `fs` or the webpack build
 * fails ("Module not found: Can't resolve 'fs'").
 *
 * Lookups are case-insensitive and tolerant of unknown values (return ''), so a
 * new category group or country in the data never crashes a chip — it just
 * renders without an icon.
 */

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

/**
 * Country → flag emoji. Covers every distinct `country` value currently in
 * live_products_export.json (68 as of 2026-06). Unknown countries fall through
 * to '' (no flag) rather than a wrong one.
 */
const COUNTRY_EMOJI: Record<string, string> = {
  'France': '🇫🇷',
  'Italy': '🇮🇹',
  'USA': '🇺🇸',
  'Australia': '🇦🇺',
  'Japan': '🇯🇵',
  'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Chile': '🇨🇱',
  'Spain': '🇪🇸',
  'Germany': '🇩🇪',
  'Mexico': '🇲🇽',
  'China': '🇨🇳',
  'Austria': '🇦🇹',
  'Thailand': '🇹🇭',
  'Argentina': '🇦🇷',
  'New Zealand': '🇳🇿',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Cuba': '🇨🇺',
  'South Africa': '🇿🇦',
  'Malaysia': '🇲🇾',
  'Netherlands': '🇳🇱',
  'Belgium': '🇧🇪',
  'Ireland': '🇮🇪',
  'Sweden': '🇸🇪',
  'Portugal': '🇵🇹',
  'Russia': '🇷🇺',
  'Norway': '🇳🇴',
  'Poland': '🇵🇱',
  'Taiwan': '🇹🇼',
  'Canada': '🇨🇦',
  'Uruguay': '🇺🇾',
  'Barbados': '🇧🇧',
  'South Korea': '🇰🇷',
  'Jamaica': '🇯🇲',
  'Nicaragua': '🇳🇮',
  'Dominican Republic': '🇩🇴',
  'Brazil': '🇧🇷',
  'India': '🇮🇳',
  'Vietnam': '🇻🇳',
  'Czech Republic': '🇨🇿',
  'Georgia': '🇬🇪',
  'Denmark': '🇩🇰',
  'Peru': '🇵🇪',
  'Greece': '🇬🇷',
  'Philippines': '🇵🇭',
  'Iceland': '🇮🇸',
  'Singapore': '🇸🇬',
  'Finland': '🇫🇮',
  'Venezuela': '🇻🇪',
  'Colombia': '🇨🇴',
  'Trinidad & Tobago': '🇹🇹',
  'Latvia': '🇱🇻',
  'Panama': '🇵🇦',
  'Slovenia': '🇸🇮',
  'Lebanon': '🇱🇧',
  'Honduras': '🇭🇳',
  'Martinique': '🇲🇶',
  'Hungary': '🇭🇺',
  'Guyana': '🇬🇾',
  'Anguilla': '🇦🇮',
  'Slovakia': '🇸🇰',
  'Fiji': '🇫🇯',
  'Cambodia': '🇰🇭',
  'Guatemala': '🇬🇹',
  'Indonesia': '🇮🇩',
  'Bermuda': '🇧🇲',
  'Grenada': '🇬🇩',
  'Monaco': '🇲🇨',
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

/** Flag emoji for a country, or '' if unmapped. Case-insensitive. */
export function countryEmoji(country: string | null | undefined): string {
  if (!country) return '';
  return (
    COUNTRY_EMOJI[country] ??
    COUNTRY_EMOJI[
      Object.keys(COUNTRY_EMOJI).find(
        (k) => k.toLowerCase() === country.toLowerCase(),
      ) ?? ''
    ] ??
    ''
  );
}
