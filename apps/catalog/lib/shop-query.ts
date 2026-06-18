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
 * Filter semantics (all params optional; absent = no constraint):
 *   group     → CategoryGroup; keep products whose groupForClassification === group
 *   price     → PriceTier id; keep products with price in [min, max)
 *   country   → exact (case-insensitive) match on country
 *   inStock=1 → keep only in-stock products (normalized boolean via isInStock)
 *   region    → case-insensitive substring match on region
 *   grape     → case-insensitive substring match on grape_variety
 *   flavor    → keep products whose flavor_tags includes it (case-insensitive)
 *   body      → exact (case-insensitive) match on wine_body
 *   acidity   → exact (case-insensitive) match on wine_acidity
 *   tannin    → exact (case-insensitive) match on wine_tannin
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
import { groupForClassification, type CategoryGroup } from './category-groups';
import { tierById } from './price-tiers';
import { isInStock } from './utils';

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
 * Apply the shop's filter → sort → paginate pipeline.
 *
 * Pure: no Next, no React, no I/O. Does not mutate `products` (sort runs on a
 * shallow copy).
 */
export function applyShopQuery(
  products: PublicProduct[],
  params: ShopParams,
): ShopQueryResult {
  const group = firstParam(params.group);
  const priceId = firstParam(params.price);
  const country = norm(firstParam(params.country));
  const inStockOnly = firstParam(params.inStock) === '1';
  const region = norm(firstParam(params.region));
  const grape = norm(firstParam(params.grape));
  const flavor = norm(firstParam(params.flavor));
  const body = norm(firstParam(params.body));
  const acidity = norm(firstParam(params.acidity));
  const tannin = norm(firstParam(params.tannin));
  const hasScoreOnly = firstParam(params.hasScore) === '1';

  // Resolve the price tier ONCE (unknown id → no price constraint).
  const tier = priceId ? tierById(priceId) : undefined;

  // ---- FILTER ----
  const items = products.filter((p) => {
    if (group && groupForClassification(p.classification) !== (group as CategoryGroup)) {
      return false;
    }
    if (tier) {
      // [min, max). Guard non-numeric/missing prices out of every tier.
      const price = p.price;
      if (typeof price !== 'number' || Number.isNaN(price)) return false;
      if (price < tier.min || price >= tier.max) return false;
    }
    if (country && norm(p.country) !== country) return false;
    if (inStockOnly && !isInStock(p.is_in_stock)) return false;
    if (region && !norm(p.region).includes(region)) return false;
    if (grape && !norm(p.grape_variety).includes(grape)) return false;
    if (flavor) {
      const tags = p.flavor_tags;
      if (!Array.isArray(tags) || !tags.some((t) => norm(t) === flavor)) {
        return false;
      }
    }
    if (body && norm(p.wine_body) !== body) return false;
    if (acidity && norm(p.wine_acidity) !== acidity) return false;
    if (tannin && norm(p.wine_tannin) !== tannin) return false;
    if (hasScoreOnly && !(typeof p.score_summary === 'string' && p.score_summary.trim() !== '')) {
      return false;
    }
    return true;
  });

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
