/**
 * shop-query — PURE filter/sort/paginate engine for the shop page.
 *
 * The shop page (app/shop/page.tsx) is a server component that reads URL
 * searchParams and renders a grid. ALL of its data logic — which products
 * survive the active filters, in what order, and which 24-item slice belongs to
 * the current page — lives here as a single pure function so it is exhaustively
 * unit-testable WITHOUT Next.js or React.
 *
 * No imports from next/* or react. Takes products + a plain params record,
 * returns the page slice plus pagination metadata.
 *
 * `matchesFilters(p, params)` is the SINGLE per-product filter predicate. Both
 * `applyShopQuery` (the grid) and the context-aware facet counters call it, so the
 * grid and the facet counts can never diverge.
 *
 * Filter semantics (all params optional; absent = no constraint):
 *   group     → CategoryGroup; keep products whose groupForProduct === group
 *   class     → (a) when groupForProduct === 'Accessories': exact (ci) on the
 *               accessory sub-category (accessoryCategoryForSku);
 *               (b) otherwise: exact (ci) on the first classification segment
 *               (split('|')[0], trimmed)
 *   price     → PriceTier id; keep products with price in [min, max)
 *   country   → exact (case-insensitive) match on country
 *   inStock=1 → keep only in-stock products (normalized boolean via isInStock)
 *   region    → exact (case-insensitive) match on region. EXACT (not substring)
 *               because the drill-down chips are the only writer of region/subregion
 *               and they always emit exact canonical values; the free-text region input
 *               was removed. Exact match makes the chip count == grid total everywhere.
 *   subregion → exact (case-insensitive) match on subregion (same rationale as region)
 *   grape     → case-insensitive substring match on grape_variety
 *   flavor    → keep products whose flavor_tags includes it (case-insensitive)
 *   body      → match the product's wine_body NORMALIZED via normalizeScale('body')
 *               to the 4-step component scale (so the dropdown option matches the
 *               same value the taste gauges render; off-scale tokens → null → drop)
 *   acidity   → same, normalizeScale('acidity', wine_acidity)
 *   tannin    → same, normalizeScale('tannin', wine_tannin)
 *   hasScore=1→ keep only products with a non-empty score_summary
 *
 * Sort (param `sort`):
 *   name (default) → A–Z by name (locale-aware, case-insensitive)
 *   price-asc      → cheapest first
 *   price-desc     → most expensive first
 *
 * Pagination: fixed 24 per page. `page` param is 1-based; out-of-range values
 * are clamped into [1, totalPages]. An empty result set still reports page 1 /
 * totalPages 1 (never 0) so the UI never shows "page 0 of 0".
 */

import type { PublicProduct } from './types';
import { groupForProduct, accessoryCategoryForSku, type CategoryGroup } from './category-groups';
import { tierById } from './price-tiers';
import { isInStock } from './utils';
import { normalizeScale } from './taste-adapter';

export const SHOP_PAGE_SIZE = 24;

export type SortKey = 'name' | 'price-asc' | 'price-desc';

/** Raw, untrusted params. Values may be string | string[] | undefined (Next's shape). */
export type ShopParams = Record<string, string | string[] | undefined>;

export interface ShopQueryResult {
  /** Full filtered+sorted set (all pages). */
  items: PublicProduct[];
  /** Total count after filtering (pre-pagination). */
  total: number;
  /** Clamped current page (1-based). */
  page: number;
  /** Page size (constant 24). */
  pageSize: number;
  /** Total number of pages (>= 1, even when total === 0). */
  totalPages: number;
  /** The slice for `page` only. */
  pageItems: PublicProduct[];
}

/** First value of a param that may arrive as string | string[] | undefined. */
function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Trimmed lower-case form, or '' for nullish. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

const SORTS: Record<string, SortKey> = {
  name: 'name',
  'price-asc': 'price-asc',
  'price-desc': 'price-desc',
};

/**
 * The SINGLE per-product filter predicate. AND across all params; every param is
 * optional and an absent param imposes no constraint.
 *
 * Pure: no Next, no React, no I/O, no allocation of shared state. Both the grid
 * (`applyShopQuery`) and the context-aware facet counters call THIS so they can
 * never disagree about which products match the active filters.
 *
 * Note on `class`: it is interpreted relative to the product's resolved group.
 * For Accessories it means the accessory sub-category (accessoryCategoryForSku);
 * for every other group it means the first segment of `classification`.
 */
export function matchesFilters(p: PublicProduct, params: ShopParams): boolean {
  const productGroup = groupForProduct(p); // resolve once — also drives the class branch

  const group = firstParam(params.group);
  if (group && productGroup !== (group as CategoryGroup)) return false;

  const klass = norm(firstParam(params.class));
  if (klass) {
    if (productGroup === 'Accessories') {
      if (norm(accessoryCategoryForSku(p.sku)) !== klass) return false;
    } else {
      const first = norm((p.classification ?? '').split('|')[0]);
      if (first !== klass) return false;
    }
  }

  const priceId = firstParam(params.price);
  const tier = priceId ? tierById(priceId) : undefined;
  if (tier) {
    // [min, max). Guard non-numeric/missing prices out of every tier.
    const price = p.price;
    if (typeof price !== 'number' || Number.isNaN(price)) return false;
    if (price < tier.min || price >= tier.max) return false;
  }

  const country = norm(firstParam(params.country));
  if (country && norm(p.country) !== country) return false;

  const region = norm(firstParam(params.region));
  if (region && norm(p.region) !== region) return false;

  const subregion = norm(firstParam(params.subregion));
  if (subregion && norm(p.subregion) !== subregion) return false;

  const grape = norm(firstParam(params.grape));
  if (grape && !norm(p.grape_variety).includes(grape)) return false;

  const flavor = norm(firstParam(params.flavor));
  if (flavor) {
    const tags = p.flavor_tags;
    if (!Array.isArray(tags) || !tags.some((t) => norm(t) === flavor)) return false;
  }

  const body = norm(firstParam(params.body));
  if (body && norm(normalizeScale('body', p.wine_body)) !== body) return false;
  const acidity = norm(firstParam(params.acidity));
  if (acidity && norm(normalizeScale('acidity', p.wine_acidity)) !== acidity) return false;
  const tannin = norm(firstParam(params.tannin));
  if (tannin && norm(normalizeScale('tannin', p.wine_tannin)) !== tannin) return false;

  if (firstParam(params.inStock) === '1' && !isInStock(p.is_in_stock)) return false;
  if (firstParam(params.hasScore) === '1' &&
      !(typeof p.score_summary === 'string' && p.score_summary.trim() !== '')) return false;

  return true;
}

/**
 * Apply the shop's filter → sort → paginate pipeline.
 *
 * Pure: no Next, no React, no I/O. Does not mutate `products` (sort runs on a
 * shallow copy).
 */
export function applyShopQuery(
  products: PublicProduct[],
  params: ShopParams,
): ShopQueryResult {
  // ---- FILTER (shared predicate — same one the facet counters use) ----
  const items = products.filter((p) => matchesFilters(p, params));

  // ---- SORT (on a copy; do not mutate the caller's array) ----
  const sortKey: SortKey = SORTS[firstParam(params.sort) ?? ''] ?? 'name';
  const sorted = [...items];
  if (sortKey === 'name') {
    sorted.sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }),
    );
  } else if (sortKey === 'price-asc') {
    sorted.sort((a, b) => priceOf(a) - priceOf(b));
  } else {
    sorted.sort((a, b) => priceOf(b) - priceOf(a));
  }

  // ---- PAGINATE ----
  const total = sorted.length;
  const pageSize = SHOP_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clampPage(firstParam(params.page), totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);

  return { items: sorted, total, page, pageSize, totalPages, pageItems };
}

/** Numeric price for sorting; non-numeric/missing sorts as Infinity-ish (last). */
function priceOf(p: PublicProduct): number {
  return typeof p.price === 'number' && !Number.isNaN(p.price)
    ? p.price
    : Number.POSITIVE_INFINITY;
}

/** Parse + clamp the `page` param into [1, totalPages]. Garbage → 1. */
function clampPage(raw: string | undefined, totalPages: number): number {
  const n = Number.parseInt(raw ?? '1', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > totalPages) return totalPages;
  return n;
}
