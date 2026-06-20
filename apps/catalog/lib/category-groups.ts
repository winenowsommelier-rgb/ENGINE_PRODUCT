/**
 * Category grouping — shopper-facing nav/filter groups.
 *
 * SOURCE OF TRUTH: the canonical taxonomy now lives in
 * data/taxonomy/sku_prefix_map.json, loaded by ./sku-taxonomy.ts. SKU is the
 * authoritative signal (the raw `classification` field is unreliable: 1,509 rows
 * were dumped into "Wine product" and ~570 accessories were mislabeled as
 * beverages). This module is now a thin shim over sku-taxonomy + the backfilled
 * `category_group`/`category_type` fields that the export already carries.
 *
 * CATEGORY_GROUPS / CategoryGroup are RE-EXPORTED from sku-taxonomy so the whole
 * app (nav, filters, footer, finder) gets the one 10-group model from one place:
 *   Wine, Whisky, Spirits, Sake & Asian, Liqueur, Beer & RTD, Non-Alcoholic,
 *   Cigars, Events, Accessories  (+ 'Unknown' in the type union).
 */

import { resolve, typeFor, type CategoryGroup } from './sku-taxonomy';

export { CATEGORY_GROUPS, type CategoryGroup } from './sku-taxonomy';

/**
 * Resolve a product to its shopper-facing group.
 *
 * Prefers the product's backfilled `category_group` (the canonical, SKU-derived
 * value carried on every export row); falls back to resolving from the SKU via
 * sku-taxonomy when the field is absent (e.g. synthetic test products). Both
 * paths agree — the field is just the precomputed form of resolve().group.
 */
export function groupForProduct(
  p: { sku?: string | null; name?: string | null; category_group?: string | null },
): CategoryGroup {
  if (p.category_group) return p.category_group as CategoryGroup;
  return resolve(p).group;
}

/**
 * Resolve a product to its canonical sub-type (e.g. "Red Wine", "Glassware").
 * Prefers the backfilled `category_type`; falls back to resolve().type by SKU.
 */
export function typeForProduct(
  p: { sku?: string | null; name?: string | null; category_type?: string | null },
): string {
  if (p.category_type) return p.category_type;
  return resolve(p).type;
}

/**
 * Accessory sub-category for the Accessories drill-down. Returns null for any
 * non-accessory SKU. The sub-category values come from the ONE canonical source
 * (sku-taxonomy's typeFor) so the drill-down values always match `category_type`:
 *   Bar Tools & Gifts, Glassware, Wine Coolers & Fridges, Cigars, Events.
 *
 * (Historically this had its own ACCESSORY_SUBCATEGORY map with a 'LOT' entry;
 * LOT is now Sake & Asian / Umeshu, not an accessory, and the strings drifted
 * from the canonical type values — both fixed by delegating to typeFor.)
 */
export function accessoryCategoryForSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const { group } = resolve({ sku });
  if (group !== 'Accessories') return null;
  return typeFor(sku);
}
