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
import {
  canonicalRegionForCountry,
  isRegionLevelValueForCountry,
  normGeo,
  regionAncestors,
} from './geo-aliases';

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

/**
 * Distinct regions present (caller passes the country-filtered set).
 *
 * A product is counted under its canonical region AND under each ANCESTOR of that
 * region, because `regionMatchesFilter` resolves `?region=X` via the same ancestor
 * walk. Counting only the exact value made the California chip read 603 while the
 * grid it opened returned 604 (the one row stored at region='Napa Valley').
 *
 * Two constraints shape this:
 *  - A product is never counted twice under the same region name (dedupe per product).
 *  - An ancestor only gains a count if it is ALREADY a region in this set. We never
 *    invent a chip for a region holding no products of its own — that would show a
 *    chip the un-filtered facet rail would not otherwise offer.
 */
export function regionsFor(_country: string, products: PublicProduct[]): FacetOption[] {
  const canonical = (p: PublicProduct) =>
    canonicalRegionForCountry(p.country ?? _country, p.region);

  // Pass 1: which region names exist in their own right? Only these may be chips.
  // `display` fixes one properly-cased label per normalized key, so case-variant
  // source values (California / california) collapse into ONE chip. Keying the
  // tally by the raw value instead would emit two chips whose URLs each return the
  // combined total — the chip-vs-grid divergence again, by another route.
  const own = new Set<string>();
  const display = new Map<string, string>();
  for (const p of products) {
    const v = canonical(p).trim();
    if (!v) continue;
    const key = normGeo(v);
    own.add(key);
    if (!display.has(key)) display.set(key, v); // first-seen wins, deterministically
  }

  // Pass 2: tally each product into its own region plus any ancestor already present.
  // Everything is keyed by normGeo; the display label is re-attached at the end.
  const counts = new Map<string, number>();
  for (const p of products) {
    const v = canonical(p).trim();
    if (!v) continue;
    const buckets = new Set<string>([normGeo(v)]);
    for (const ancestor of regionAncestors(p.country ?? _country, p.region)) {
      const key = normGeo(ancestor);
      // Skip ancestors with no products of their own — do not invent chips.
      if (!own.has(key)) continue;
      buckets.add(key); // Set dedupes: never count one product twice under one region
      if (!display.has(key)) display.set(key, ancestor);
    }
    for (const key of buckets) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ value: display.get(key) ?? key, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }),
    );
}

/** Distinct sub-regions present (caller passes the region-filtered set). */
export function subRegionsFor(_region: string, products: PublicProduct[]): FacetOption[] {
  return tally(products, (p) => {
    const subregion = (p.subregion ?? '').trim();
    if (!subregion) return '';
    if (isRegionLevelValueForCountry(p.country, subregion)) return '';
    return subregion;
  });
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
