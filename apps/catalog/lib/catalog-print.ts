import type { PublicProduct } from './types';
import { isInStock } from './utils';

/**
 * Shared shape the print-catalog UI renders from, regardless of edition
 * (B2C reads PublicProduct via getAllProducts(); B2B reads its own
 * server-only loader — see catalog-b2b-data.ts). Keeping this row shape
 * separate from both source types means the print components never need to
 * know which edition they're rendering.
 */
export interface CatalogRow {
  sku: string;
  name: string;
  brand?: string;
  vintage?: string;
  bottleSize?: string;
  variety?: string;
  imageUrl?: string;
  price: number;
  specialPrice?: number;
  b2bPrice?: number;
  b2bDiscountPct?: string;
  scoreSummary?: string;
  scoreMax?: number;
  // Geography/category used to place the row in the tree. Kept on the row
  // itself (rather than requiring a side lookup keyed by sku) so
  // buildCatalogTree() has everything it needs from the row alone.
  categoryGroup: string;
  country?: string;
  region?: string;
  subregion?: string;
}

export interface CatalogSubregion {
  name: string | null; // null = "no sub-region on file" bucket
  rows: CatalogRow[];
}

export interface CatalogRegion {
  name: string;
  subregions: CatalogSubregion[];
  count: number;
}

export interface CatalogCountry {
  name: string;
  regions: CatalogRegion[];
  count: number;
}

export interface CatalogGroup {
  name: string; // category_group
  countries: CatalogCountry[];
  count: number;
}

const UNKNOWN_COUNTRY = 'Other';
const UNKNOWN_REGION = 'Other';

/**
 * Sort key for countries/groups: by descending SKU count, so the biggest
 * assortments lead the catalog (matches how a buyer scans a price list).
 */
function byCountDesc<T extends { count: number }>(a: T, b: T) {
  return b.count - a.count;
}

/**
 * Build the Category > Country > Region > Sub-region tree from a flat row
 * list. Rows missing country/region fall into an "Other" bucket per level
 * rather than being silently dropped — Rule 6 (no silent data loss).
 */
export function buildCatalogTree(rows: CatalogRow[]): CatalogGroup[] {
  const groups = new Map<string, Map<string, Map<string, Map<string, CatalogRow[]>>>>();

  for (const row of rows) {
    const g = row.categoryGroup || 'Other';
    const c = row.country?.trim() || UNKNOWN_COUNTRY;
    const r = row.region?.trim() || UNKNOWN_REGION;
    const s = row.subregion?.trim() || '';

    if (!groups.has(g)) groups.set(g, new Map());
    const countries = groups.get(g)!;
    if (!countries.has(c)) countries.set(c, new Map());
    const regions = countries.get(c)!;
    if (!regions.has(r)) regions.set(r, new Map());
    const subs = regions.get(r)!;
    if (!subs.has(s)) subs.set(s, []);
    subs.get(s)!.push(row);
  }

  const out: CatalogGroup[] = [];
  for (const [gName, countries] of groups) {
    const countryList: CatalogCountry[] = [];
    for (const [cName, regions] of countries) {
      const regionList: CatalogRegion[] = [];
      for (const [rName, subs] of regions) {
        const subList: CatalogSubregion[] = [];
        for (const [sName, subRows] of subs) {
          subRows.sort((a, b) => a.name.localeCompare(b.name));
          subList.push({ name: sName || null, rows: subRows });
        }
        // named sub-regions first (alpha), "no sub-region" bucket last
        subList.sort((a, b) => {
          if (a.name === null) return 1;
          if (b.name === null) return -1;
          return a.name.localeCompare(b.name);
        });
        const count = subList.reduce((n, s) => n + s.rows.length, 0);
        regionList.push({ name: rName, subregions: subList, count });
      }
      regionList.sort(byCountDesc);
      const count = regionList.reduce((n, r) => n + r.count, 0);
      countryList.push({ name: cName, regions: regionList, count });
    }
    countryList.sort(byCountDesc);
    const count = countryList.reduce((n, c) => n + c.count, 0);
    out.push({ name: gName, countries: countryList, count });
  }
  out.sort(byCountDesc);
  return out;
}

/** Map a PublicProduct (B2C, margin-safe) onto the shared CatalogRow shape. */
export function rowFromPublicProduct(p: PublicProduct): CatalogRow | null {
  if (!p.sku || !p.name || !p.price) return null;
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    vintage: p.vintage,
    bottleSize: p.bottle_size,
    variety: p.variety,
    imageUrl: p.image_url,
    price: p.price,
    specialPrice: p.special_price,
    scoreSummary: p.score_summary,
    scoreMax: p.score_max,
    categoryGroup: p.category_group || 'Other',
    country: p.country,
    region: p.region,
    subregion: p.subregion,
  };
}

export function publicProductInScope(p: PublicProduct): boolean {
  return isInStock(p.is_in_stock) && p.custom_stock_status !== 'CATALOG';
}

/**
 * Pre-print narrowing options — lets a user cut a long category down to a
 * printable size instead of always getting every in-stock row. All fields
 * are optional/additive (AND'd together); omitting all of them reproduces
 * the previous unfiltered behavior.
 */
export interface CatalogFilterOptions {
  categoryGroup?: string;
  countries?: string[];
  minPrice?: number;
  maxPrice?: number;
  hasScoreOnly?: boolean;
}

function rowMatchesFilters(row: CatalogRow, opts: CatalogFilterOptions): boolean {
  if (opts.categoryGroup && row.categoryGroup !== opts.categoryGroup) return false;
  if (opts.countries?.length && !opts.countries.includes(row.country || UNKNOWN_COUNTRY)) return false;
  if (opts.minPrice !== undefined && row.price < opts.minPrice) return false;
  if (opts.maxPrice !== undefined && row.price > opts.maxPrice) return false;
  if (opts.hasScoreOnly && !row.scoreSummary) return false;
  return true;
}

/**
 * All B2C catalog rows (margin-safe), optionally narrowed by
 * CatalogFilterOptions — shared by the full catalog route and the
 * per-category print routes so both build from the same source of truth.
 */
export function getB2CCatalogRows(
  products: PublicProduct[],
  opts: CatalogFilterOptions = {},
): CatalogRow[] {
  return products
    .filter(publicProductInScope)
    .map(rowFromPublicProduct)
    .filter((r): r is CatalogRow => r !== null)
    .filter((r) => rowMatchesFilters(r, opts));
}

/** Distinct countries present in a row set, sorted by count desc — the
 * candidate list for the pre-print country filter (scoped to whatever
 * category/search the user is already looking at). */
export function countriesInRows(rows: CatalogRow[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = r.country?.trim() || UNKNOWN_COUNTRY;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
