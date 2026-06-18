/**
 * recommender.ts — rule-based "recommended together" engine (Task 5).
 *
 * Scores other products against a given product and returns the best matches.
 *
 * BI-SWAP SEAM
 * ------------
 * This is a *rule-based* placeholder for real co-purchase intelligence. When BI
 * co-purchase data becomes available, it plugs in via the `coPurchaseStrategy`
 * seam in `getRecommendations` (see the FUTURE comment there) WITHOUT any change
 * to the UI: callers keep calling getRecommendations / precomputeRecommendations
 * and keep receiving PublicProduct[] / Map<sku, sku[]>.
 *
 * PERFORMANCE
 * -----------
 * The static build renders ~11,436 product pages. Naive per-page scoring against
 * the full pool is O(n) per page => O(n^2) ~= 130M comparisons, which can stall
 * the build. `precomputeRecommendations` does the scoring ONCE, bucketing
 * candidates by region (then classification / country) so each product only
 * scores against a small bucket instead of the whole catalog. See its docblock.
 */

import type { PublicProduct } from '@/lib/types';
import { isInStock } from '@/lib/utils';

const MAX_RECS = 4;
const PRICE_BAND = 0.4; // +/-40%

/** Split a comma-separated food_matching string into a lowercased, trimmed set. */
function foodSet(food: string | undefined | null): Set<string> {
  if (!food) return new Set();
  return new Set(
    food
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Score a candidate against the current product per spec §6.
 * Higher = more similar. Returns 0 for "nothing in common".
 *
 * Pre-split food set for `product` can be passed to avoid re-splitting it on
 * every candidate (hot path during precompute).
 */
export function scoreCandidate(
  product: PublicProduct,
  candidate: PublicProduct,
  productFoods?: Set<string>,
): number {
  let score = 0;

  if (product.region && candidate.region && product.region === candidate.region) score += 3;
  if (product.grape_variety && candidate.grape_variety && product.grape_variety === candidate.grape_variety) score += 2;
  if (product.country && candidate.country && product.country === candidate.country) score += 1;

  const a = productFoods ?? foodSet(product.food_matching);
  const b = foodSet(candidate.food_matching);
  for (const item of b) {
    if (a.has(item)) score += 1; // +1 per shared food item
  }

  if (product.classification && candidate.classification && product.classification === candidate.classification) score += 1;

  if (typeof product.price === 'number' && typeof candidate.price === 'number' && product.price > 0) {
    const lo = product.price * (1 - PRICE_BAND);
    const hi = product.price * (1 + PRICE_BAND);
    if (candidate.price >= lo && candidate.price <= hi) score += 1;
  }

  return score;
}

/**
 * True if a candidate is eligible to be recommended for `product`.
 *
 * STOCK FILTER (intentional, applies in BOTH directions)
 * ------------------------------------------------------
 * Out-of-stock products are excluded from recommendations in BOTH directions:
 * they are never recommended TO anyone (this check), and in
 * `precomputeRecommendations` they are filtered out of `inStock` up front so they
 * never get recs computed FOR them either.
 *
 * STOCK VALUE SHAPE: is_in_stock is NORMALIZED to a real boolean at load time by
 * toPublicProduct() (catalog-data.ts) — the raw live export stores it as a STRING
 * "0"/"1" or null. Of 11,436 real products, 5,683 are out ("0"), 5,655 in ("1"),
 * and 98 null (treated as out). We use isInStock() here rather than a plain
 * truthiness check so this stays correct DEFENSIVELY even if a caller ever passes
 * a raw (un-normalized) product: the helper maps "0"/0/""/null/undefined/false ->
 * out, and "1"/1/true -> in. (Plain `!candidate.is_in_stock` would wrongly read the
 * string "0" as in-stock — that was the original bug this fix closes.)
 */
function isEligible(product: PublicProduct, candidate: PublicProduct): boolean {
  if (candidate.sku === product.sku) return false; // not self
  if (!isInStock(candidate.is_in_stock)) return false; // out-of-stock excluded (handles raw "0" too)
  return true;
}

/**
 * Rank `candidates` against `product` and return the top MAX_RECS with score > 0.
 * Stable tie-break by sku (ascending) so the build is deterministic.
 */
function rankAgainst(
  product: PublicProduct,
  candidates: readonly PublicProduct[],
  productFoods: Set<string>,
): PublicProduct[] {
  const scored: Array<{ p: PublicProduct; score: number }> = [];
  for (const c of candidates) {
    if (!isEligible(product, c)) continue;
    const score = scoreCandidate(product, c, productFoods);
    if (score > 0) scored.push({ p: c, score });
  }
  scored.sort((x, y) => (y.score - x.score) || (x.p.sku < y.p.sku ? -1 : x.p.sku > y.p.sku ? 1 : 0));
  return scored.slice(0, MAX_RECS).map((s) => s.p);
}

/**
 * Return up to 4 products "recommended together" with `product`, ranked by the
 * §6 similarity score. Excludes self and out-of-stock, dedupes by sku, and only
 * returns positive-scored matches (no zero-score padding).
 *
 * EXACT RANKING: this scores `product` against the FULL `all` pool — every other
 * product is a candidate. This is the authoritative, exact rule-based ranking.
 * `precomputeRecommendations` is a region-bucketed APPROXIMATION of this function
 * (see its docblock) and may return a different top-4 for the same product.
 *
 * FUTURE: if a coPurchaseStrategy provides real BI data for product.sku, use it
 * first; fall back to the rule-based scoring below.
 */
export function getRecommendations(
  product: PublicProduct,
  all: readonly PublicProduct[],
): PublicProduct[] {
  // Dedupe candidates by sku (defensive: a pool could contain repeats).
  const seen = new Set<string>();
  const candidates: PublicProduct[] = [];
  for (const p of all) {
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    candidates.push(p);
  }
  return rankAgainst(product, candidates, foodSet(product.food_matching));
}

/**
 * Precompute recommendations for EVERY in-stock product, returning a lightweight
 * Map<sku, sku[]> (<=4 rec skus each). Pages resolve skus via getProductBySku, so
 * we store skus only — not full product objects.
 *
 * APPROXIMATION OF getRecommendations (accepted tradeoff — DO NOT "fix" to parity)
 * -------------------------------------------------------------------------------
 * This is a region-bucketed APPROXIMATION of getRecommendations, used to keep the
 * ~11,436-page static build fast (avoids O(n^2)). It may return a DIFFERENT top-4
 * than getRecommendations when a product's highest-scoring match lies OUTSIDE its
 * region bucket (and the in-region bucket is already large enough that the
 * widening chain below never reaches that better cross-region candidate). This is
 * an ACCEPTED tradeoff: region (+3) is the dominant affinity signal, so the
 * bucketed result is a close approximation in practice. Do NOT "fix" this into a
 * full scan to force exact parity without re-evaluating the build cost — a full
 * scan reinstates the O(n^2) build we deliberately avoid here. The accepted
 * divergence is pinned by a regression test in recommender.test.ts.
 *
 * BUCKETING STRATEGY (avoids O(n^2) over ~11,436 products)
 * --------------------------------------------------------
 * The dominant scoring signal is `region` (+3). We bucket all in-stock products
 * by region once. For each product we score it only against its own region
 * bucket. If that bucket is too small to yield MAX_RECS results, we widen with a
 * fallback chain so a product in a tiny/unique region still gets neighbours:
 *   1. region bucket
 *   2. + classification bucket  (e.g. "Red Wine", "Gin")
 *   3. + country bucket
 *   4. + a bounded global slice  (last resort; capped so we never re-scan all n)
 * Buckets are merged and de-duplicated per product, then ranked with the same
 * §6 scoring used by getRecommendations, so precomputed results agree with the
 * single-product path within each bucket.
 *
 * Complexity: ~O(n * b) where b is the average bucket size, plus a small bounded
 * global fallback — far below O(n^2) for a catalog with many regions/categories.
 */
export function precomputeRecommendations(
  all: readonly PublicProduct[],
): Map<string, string[]> {
  // In-stock candidates only (these are the only things we ever recommend).
  // is_in_stock is a normalized boolean post-load; isInStock() also handles a raw
  // "0"/"1"/null product defensively (see isEligible docblock).
  const inStock = all.filter((p) => isInStock(p.is_in_stock));

  const byRegion = new Map<string, PublicProduct[]>();
  const byClassification = new Map<string, PublicProduct[]>();
  const byCountry = new Map<string, PublicProduct[]>();
  const addTo = (m: Map<string, PublicProduct[]>, key: string | undefined | null, p: PublicProduct) => {
    if (!key) return;
    const arr = m.get(key);
    if (arr) arr.push(p);
    else m.set(key, [p]);
  };
  for (const p of inStock) {
    addTo(byRegion, p.region, p);
    addTo(byClassification, p.classification, p);
    addTo(byCountry, p.country, p);
  }

  // Bounded global fallback: a small fixed slice of in-stock products. Capped so
  // the fallback never degrades to a full O(n) scan per product.
  const GLOBAL_FALLBACK_CAP = 50;
  const globalFallback = inStock.slice(0, GLOBAL_FALLBACK_CAP);

  // We want at least enough raw candidates to reliably surface MAX_RECS after
  // eligibility/scoring filters; widen the bucket until we have a comfortable pool.
  const MIN_POOL = MAX_RECS + 1;

  const result = new Map<string, string[]>();

  for (const product of inStock) {
    const pool: PublicProduct[] = [];
    const poolSeen = new Set<string>();
    const merge = (arr: PublicProduct[] | undefined) => {
      if (!arr) return;
      for (const p of arr) {
        if (poolSeen.has(p.sku)) continue;
        poolSeen.add(p.sku);
        pool.push(p);
      }
    };

    merge(byRegion.get(product.region ?? ''));
    if (pool.length < MIN_POOL) merge(byClassification.get(product.classification ?? ''));
    if (pool.length < MIN_POOL) merge(byCountry.get(product.country ?? ''));
    if (pool.length < MIN_POOL) merge(globalFallback);

    const recs = rankAgainst(product, pool, foodSet(product.food_matching));
    result.set(product.sku, recs.map((r) => r.sku));
  }

  return result;
}
