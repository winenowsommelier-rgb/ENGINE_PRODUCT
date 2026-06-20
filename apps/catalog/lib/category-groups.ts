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

/**
 * SKU-prefix → group. The `classification` field is UNRELIABLE: 1,509 rows are
 * dumped into "Wine product" (only ~84 are real wine) and ~570 accessories are
 * mislabeled as beverages. The SKU prefix is the reliable signal, so it OVERRIDES
 * classification in `groupForProduct`. Verified against data/live_products_export.json.
 *
 * Prefix scheme (longest-prefix wins — 3-char keys are checked before 1-char):
 *   Accessories: A* (AWC fridges, ABA bar tools), G* (glassware), CIG (cigars), WEV (events)
 *   Beverages:   W* wine, LWH whisky, LSK/LSJ sake/shochu, LBE beer, N* non-alcoholic,
 *                other L* spirits
 */
const SKU_PREFIX_TO_GROUP: Array<[string, CategoryGroup]> = [
  // 3-char beverage prefixes (checked before the 1-char "L"/"W" rules)
  ['LWH', 'Whisky'],
  ['LSK', 'Sake & Asian'],
  ['LSJ', 'Sake & Asian'],
  ['LBE', 'Beer & RTD'],
  // 3-char accessory prefix that starts with W (overrides the "W = Wine" rule)
  ['WEV', 'Accessories'], // wine-dinner/tasting events — start with W but are NOT wine
  // 1-char rules
  ['A', 'Accessories'], // AWC coolers, ABA bar tools, etc.
  ['G', 'Accessories'], // GWN/GLQ/GBE/GDC glassware
  ['C', 'Accessories'], // CIG cigars
  ['N', 'Beer & RTD'],  // NNA non-alcoholic (mixers, syrups, n/a drinks)
  ['W', 'Wine'],        // all other W* are wine
  ['L', 'Spirits'],     // all other L* are spirits (gin/vodka/rum/tequila/brandy/liqueur…)
];

function groupForSku(sku: string | null | undefined): CategoryGroup | null {
  if (!sku) return null;
  const s = sku.toUpperCase();
  for (const [prefix, group] of SKU_PREFIX_TO_GROUP) {
    if (s.startsWith(prefix)) return group;
  }
  return null;
}

/**
 * Accessory sub-category for the Accessories drill-down. Returns null for any
 * non-accessory SKU. Sub-categories per project memory (accessory SKU prefixes).
 */
const ACCESSORY_SUBCATEGORY: Array<[string, string]> = [
  ['AWC', 'Wine Fridges & Coolers'],
  ['GWN', 'Glassware'], ['GDC', 'Glassware'], ['GLQ', 'Glassware'],
  ['GWA', 'Glassware'], ['GBE', 'Glassware'],
  ['CIG', 'Cigars'],
  ['WEV', 'Events'],
  ['ABA', 'Bar Tools & Gifts'], ['LOT', 'Bar Tools & Gifts'],
];

export function accessoryCategoryForSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const s = sku.toUpperCase();
  for (const [prefix, sub] of ACCESSORY_SUBCATEGORY) {
    if (s.startsWith(prefix)) return sub;
  }
  return null;
}

/**
 * Resolve a product to its shopper-facing group. SKU prefix is authoritative and
 * overrides the unreliable `classification` field; when the prefix is unknown,
 * fall back to `groupForClassification`. THIS is what the shop filter / nav must
 * use — not `groupForClassification` alone, which trusts the bad classification.
 */
export function groupForProduct(
  p: { sku?: string | null; classification?: string | null },
): CategoryGroup {
  return groupForSku(p.sku) ?? groupForClassification(p.classification);
}
