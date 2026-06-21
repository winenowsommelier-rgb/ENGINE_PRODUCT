/**
 * recommended-rank — PURE ranking primitives for the shop's "Recommended" sort.
 *
 * Operates on RAW export rows (Record<string, unknown>), NOT PublicProduct,
 * because the raw `popularity_score` is DELIBERATELY absent from PublicProduct
 * (margin-leak allowlist). Keeping the score-aware comparator here, fed raw rows
 * at the catalog-data load chokepoint, is the only place the score is in scope
 * without it reaching the browser. No fs, no Next, no React — fully unit-tested.
 *
 * Ranking tuple (single source of truth; earlier = nearer the front of the grid):
 *   1. in stock         (in-stock before out-of-stock; null/absent → out)
 *   2. is scored        (scored before unscored; "scored" === number > 0)
 *   3. popularity score  DESC
 *   4. price (premium)   DESC
 *   5. name              A–Z (locale-aware, case-insensitive)
 */

import { isInStock } from './utils';

type Raw = Record<string, unknown>;

/** A number > 0, else null. Defines "scored" precisely (0.0 and non-numeric → unscored). */
function scoreOf(row: Raw): number | null {
  const s = row.popularity_score;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
}

function priceOf(row: Raw): number {
  const p = row.price;
  return typeof p === 'number' && !Number.isNaN(p) ? p : Number.NEGATIVE_INFINITY;
}

function nameOf(row: Raw): string {
  return typeof row.name === 'string' ? row.name : '';
}

/**
 * p75 cutoff over the SCORED (>0) population — the "top seller" boundary for
 * popularity_tier === 2. Only affects the cosmetic tier, NOT sort order.
 *  - < 4 scored rows  → max scored value (so only the max is tier 2; tiny-data guard)
 *  - 0 scored rows    → Infinity (no row can reach tier 2)
 */
export function popularityCutoffP75(rows: Raw[]): number {
  const scores = rows
    .map(scoreOf)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  if (scores.length === 0) return Infinity;
  if (scores.length < 4) return scores[scores.length - 1];
  const idx = Math.ceil(0.75 * scores.length) - 1;
  return scores[idx];
}

/** Coarse, client-safe popularity bucket. 0 = no sales data, 1 = sells, 2 = top seller. */
export function popularityTier(score: unknown, cutoff: number): 0 | 1 | 2 {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return 0;
  return score >= cutoff ? 2 : 1;
}

/**
 * Comparator implementing the ranking tuple above. Returns <0 if `a` ranks ahead
 * of `b`. Stable & deterministic (name is the final tiebreak).
 */
export function compareRecommended(a: Raw, b: Raw): number {
  const sa = isInStock(a.is_in_stock) ? 0 : 1;
  const sb = isInStock(b.is_in_stock) ? 0 : 1;
  if (sa !== sb) return sa - sb;

  const scA = scoreOf(a);
  const scB = scoreOf(b);
  const hasA = scA !== null ? 0 : 1;
  const hasB = scB !== null ? 0 : 1;
  if (hasA !== hasB) return hasA - hasB;

  if (scA !== null && scB !== null && scA !== scB) return scB - scA;

  const pa = priceOf(a);
  const pb = priceOf(b);
  if (pa !== pb) return pb - pa;

  return nameOf(a).localeCompare(nameOf(b), 'en', { sensitivity: 'base' });
}
