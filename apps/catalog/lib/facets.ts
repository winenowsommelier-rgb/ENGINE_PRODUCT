/**
 * facets.ts — context-aware option lists for the shop drill-down.
 *
 * Each function takes a PRE-FILTERED product set (the shop page applies every
 * active filter EXCEPT the strand being enumerated; see design §4.1 input-set
 * table) and returns the available next-level options WITH counts: only options
 * with >=1 product (no dead-ends), sorted. Pure, O(n) per call.
 */

import type { PublicProduct } from './types';
import {
  type CategoryGroup,
  groupForProduct,
  typeForProduct,
  accessoryCategoryForSku,
} from './category-groups';
import { designationForProduct, DESIGNATIONS } from './designation';

export interface FacetOption {
  value: string;
  count: number;
}

/**
 * Tally a key-extractor over products → {value,count}[], dropping empties.
 *
 * Ordering: most-stocked first (count DESC), then alphabetical as a stable
 * tie-break. This puts the regions/sub-regions the shop actually carries depth
 * in at the front of the chip rail, so the longest pill lists lead with the
 * options worth scanning instead of an alphabetical accident.
 */
function tally(
  products: PublicProduct[],
  key: (p: PublicProduct) => string | null | undefined,
): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const raw = key(p);
    const v = (raw ?? '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }),
    );
}

/** Canonical sub-type (category_type), but only for products in `group`. */
export function subCategoriesFor(
  group: CategoryGroup,
  products: PublicProduct[],
): FacetOption[] {
  return tally(
    products.filter((p) => groupForProduct(p) === group),
    (p) => typeForProduct(p),
  );
}

/** Accessory sub-categories (Glassware / Wine Coolers & Fridges / Bar Tools & Gifts). */
export function accessorySubCategoriesFor(products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => accessoryCategoryForSku(p.sku));
}

/** Top-level category groups present, with SKU counts (most-stocked first). */
export function groupsFor(products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => groupForProduct(p));
}

/** Distinct countries present, with SKU counts (most-stocked first). */
export function countriesFor(products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => p.country);
}

/** Distinct regions present (caller passes the country-filtered set). */
export function regionsFor(_country: string, products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => p.region);
}

/** Distinct sub-regions present (caller passes the region-filtered set). */
export function subRegionsFor(_region: string, products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => p.subregion);
}

/** Derived designations present, ordered by canonical specificity (most-specific first). */
export function designationsFor(products: PublicProduct[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const v = designationForProduct(p);
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // Sort by canonical specificity. A value not in DESIGNATIONS (e.g. a persisted
  // designation the TS table doesn't know — parity-guarded but defend anyway) sorts
  // LAST, not first: map indexOf===-1 to Infinity.
  const rank = (v: string) => {
    const i = DESIGNATIONS.indexOf(v);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => rank(a.value) - rank(b.value));
}
