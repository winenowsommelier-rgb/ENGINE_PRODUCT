/**
 * Category grouping — collapses the catalog's 44 messy `classification` values
 * into ~7 calm, shopper-facing groups for the top nav and the "Type" filter.
 *
 * Design goal: the target shoppers are 40+ with eyesight challenges; 44 tabs
 * would overwhelm them. ~7 ordered groups read as a calm, scannable nav.
 *
 * Ordering matters: CATEGORY_GROUPS drives nav order. Wine is first because it
 * is the bulk of inventory (~8,500 products).
 */

export const CATEGORY_GROUPS = [
  'Wine',
  'Whisky',
  'Spirits',
  'Sake & Asian',
  'Beer & RTD',
  'Accessories',
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

/**
 * Maps every one of the 44 verified raw `classification` values to a group.
 *
 * Pipe-delimited values (e.g. "Red Wine|Fruit Wine") are NOT listed here as
 * compound keys — `groupForClassification` splits on '|' and looks up the first
 * segment. So "Red Wine|Fruit Wine" resolves via the "Red Wine" entry below.
 *
 * Anything not present here falls through to the 'Accessories' catch-all, so
 * nothing is ever uncategorized.
 */
export const CLASSIFICATION_TO_GROUP: Record<string, CategoryGroup> = {
  // --- Wine ---
  'Red Wine': 'Wine',
  'White Wine': 'Wine',
  'Rose Wine': 'Wine',
  'Sparkling Wine': 'Wine',
  Champagne: 'Wine',
  'Dessert Wine': 'Wine',
  'Orange Wine': 'Wine',
  'Port Wine': 'Wine',
  'Fruit Wine': 'Wine',
  'Korean Wine': 'Wine',
  Wine: 'Wine',
  'Wine product': 'Wine',

  // --- Whisky ---
  Whisky: 'Whisky',
  Whiskey: 'Whisky',

  // --- Spirits ---
  Gin: 'Spirits',
  Vodka: 'Spirits',
  Rum: 'Spirits',
  Tequila: 'Spirits',
  Brandy: 'Spirits',
  Mezcal: 'Spirits',
  Cognac: 'Spirits',
  Pisco: 'Spirits',
  Absinthe: 'Spirits',
  Baijiu: 'Spirits',
  Cachaça: 'Spirits',
  Calvados: 'Spirits',
  Liqueur: 'Spirits',
  Spirit: 'Spirits',
  'White Spirits': 'Spirits',
  'Thai White Spirits': 'Spirits',

  // --- Sake & Asian ---
  Sake: 'Sake & Asian',
  'Sake/Shochu': 'Sake & Asian',
  Umeshu: 'Sake & Asian',

  // --- Beer & RTD ---
  Beer: 'Beer & RTD',
  'Ready to Drink': 'Beer & RTD',
  'Non-Alcoholic': 'Beer & RTD',
  'Mineral Water': 'Beer & RTD',

  // --- Accessories (and catch-all targets) ---
  Glassware: 'Accessories',
  Cigar: 'Accessories',
  Events: 'Accessories',
  Others: 'Accessories',
  Accessories: 'Accessories',
};

const DEFAULT_GROUP: CategoryGroup = 'Accessories';

/**
 * Resolve a raw classification value to one of the ~7 shopper-facing groups.
 *
 * - null / undefined / empty / whitespace → 'Accessories'
 * - pipe-delimited ("Red Wine|Fruit Wine") → split on '|', use first segment
 * - unknown values → 'Accessories' (catch-all, nothing is ever uncategorized)
 */
export function groupForClassification(
  classification: string | null | undefined,
): CategoryGroup {
  if (!classification) return DEFAULT_GROUP;

  const firstSegment = classification.split('|')[0]?.trim();
  if (!firstSegment) return DEFAULT_GROUP;

  return CLASSIFICATION_TO_GROUP[firstSegment] ?? DEFAULT_GROUP;
}

/**
 * Return all raw classification values that map to a given group.
 *
 * Used by the "Type" filter (Tasks 9/10) so the shop can filter the catalog by
 * group: pick a group, get its raw classifications, match products on those.
 *
 * Note: this lists the explicit map entries. Pipe-delimited and genuinely
 * unknown values that resolve to 'Accessories' via the catch-all are not
 * enumerated here (they aren't keys in the map).
 */
export function classificationsInGroup(group: CategoryGroup): string[] {
  return Object.keys(CLASSIFICATION_TO_GROUP).filter(
    (raw) => CLASSIFICATION_TO_GROUP[raw] === group,
  );
}
