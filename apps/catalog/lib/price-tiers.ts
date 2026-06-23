/**
 * THB price formatting + tiered price brackets for the shop filter.
 *
 * The catalog price range is huge (฿40 to ฿2,460,999), so a linear slider is
 * useless. Instead we bucket prices into 5 preset brackets. All prices are THB
 * and are displayed with the ฿ symbol and thousands separators.
 */

export interface PriceTier {
  /** Stable id, used in the shop filter's URL query string. */
  id: string;
  /** Human-readable bracket label (en-dash in ranges). */
  label: string;
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound. Convention: [min, max). Last tier is open-ended (Infinity). */
  max: number;
}

/**
 * Formats a THB price for display.
 *
 * @param price - amount in baht; null/undefined yields a safe placeholder
 * @returns e.g. `'฿1,600'`; `'—'` for null/undefined
 *
 * Rounds to whole baht (no decimals): 1599.5 -> '฿1,600'. en-US locale gives
 * comma thousands separators regardless of the user's machine locale.
 */
export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) return '—';
  return '฿' + Math.round(price).toLocaleString('en-US');
}

/**
 * Resolves the active sale, if any, for a product.
 *
 * A sale is only valid when there is a real special_price that is strictly LESS
 * than the regular price (guards against bad/equal/higher source data — we never
 * render a "discount" that isn't one). Returns null when there is no genuine sale,
 * so callers can branch on a single truthy check.
 *
 * @param price        regular price (baht)
 * @param specialPrice discounted price from source (may be null/undefined/equal)
 * @returns `{ special, percentOff, saveAmount }` when on sale, else `null`
 */
export function resolveSale(
  price: number | null | undefined,
  specialPrice: number | null | undefined,
): { special: number; percentOff: number; saveAmount: number } | null {
  if (
    price === null || price === undefined || Number.isNaN(price) ||
    specialPrice === null || specialPrice === undefined || Number.isNaN(specialPrice)
  ) {
    return null;
  }
  if (specialPrice <= 0 || specialPrice >= price) return null; // not a genuine discount
  const saveAmount = price - specialPrice;
  const percentOff = Math.round((saveAmount / price) * 100);
  if (percentOff < 1) return null; // sub-1% rounds to nothing worth a badge
  return { special: specialPrice, percentOff, saveAmount };
}

/**
 * The 5 price brackets. Upper bound is EXCLUSIVE ([min, max)); the last tier is
 * open-ended (max = Infinity). Range labels use an en-dash (U+2013).
 */
export const PRICE_TIERS: PriceTier[] = [
  { id: 'under-1000', label: 'Under ฿1,000', min: 0, max: 1000 },
  { id: '1000-3000', label: '฿1,000–3,000', min: 1000, max: 3000 },
  { id: '3000-7000', label: '฿3,000–7,000', min: 3000, max: 7000 },
  { id: '7000-15000', label: '฿7,000–15,000', min: 7000, max: 15000 },
  { id: '15000-plus', label: '฿15,000+', min: 15000, max: Infinity },
];

/**
 * Returns the tier a price falls into, using [min, max) (upper bound exclusive).
 *
 * Guards: price below 0, null, undefined, or NaN -> first tier; price at/above
 * the highest min -> last (open-ended) tier.
 */
export function tierForPrice(price: number): PriceTier {
  if (price === null || price === undefined || Number.isNaN(price) || price < 0) {
    return PRICE_TIERS[0];
  }
  const match = PRICE_TIERS.find((t) => price >= t.min && price < t.max);
  return match ?? PRICE_TIERS[PRICE_TIERS.length - 1];
}

/**
 * Looks up a tier by its stable id (the shop filter reads this from the URL).
 *
 * @returns the matching tier, or undefined if the id is unknown
 */
export function tierById(id: string): PriceTier | undefined {
  return PRICE_TIERS.find((t) => t.id === id);
}
