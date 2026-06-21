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
 * candidates by region (then category_type / country) so each product only
 * scores against a small bucket instead of the whole catalog. See its docblock.
 */

import type { PublicProduct } from '@/lib/types';
import { isInStock, parseFoodMatching } from '@/lib/utils';
import { typeForProduct } from '@/lib/category-groups';

const MAX_RECS = 4;
const PRICE_BAND = 0.4; // +/-40%

/**
 * Lowercased, trimmed set of food_matching items, using the shared
 * pipe-first / paren-aware parser (see parseFoodMatching in lib/utils).
 */
function foodSet(food: string | undefined | null): Set<string> {
  return new Set(parseFoodMatching(food).map((s) => s.toLowerCase()));
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

  // Same canonical TYPE (category_type), not raw classification: a whisky mislabeled
  // "Wine product" must score with other whiskies, not with wine. typeForProduct prefers
  // the backfilled category_type, else resolves from the SKU.
  const pt = typeForProduct(product);
  const ct = typeForProduct(candidate);
  if (pt && ct && pt !== 'Unknown' && pt === ct) score += 1;

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
 * STOCK FILTER (intentional — CANDIDATE side only)
 * ------------------------------------------------
 * Out-of-stock products are excluded as CANDIDATES: they are never recommended TO
 * anyone (this check). They are NOT excluded as SUBJECTS — an out-of-stock product
 * page still receives recommendations (of other, in-stock products), because that
 * is exactly when "you might also like" matters most: the item the shopper wanted
 * is unavailable, so we surface in-stock alternatives. See the `for (const product
 * of all)` loop in `precomputeRecommendations`.
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
 * Precompute recommendations for EVERY product (in-stock OR out-of-stock),
 * returning a lightweight Map<sku, sku[]> (<=4 rec skus each). Pages resolve skus
 * via getProductBySku, so we store skus only — not full product objects.
 *
 * SUBJECTS vs CANDIDATES (the two invariants — keep them straight)
 * ---------------------------------------------------------------
 * - SUBJECTS (map KEYS): every product gets an entry, including out-of-stock ones.
 *   An OOS product page must still show "you might also like" (in-stock alts) — its
 *   own region/category_type/country buckets contain in-stock neighbours, so it
 *   gets sensible recs. The outer loop below iterates `all`, not `inStock`.
 * - CANDIDATES (rec VALUES): only IN-STOCK products are ever recommended — the
 *   buckets/pool are built solely from `inStock`, and isEligible() drops anything
 *   out-of-stock defensively. We never surface a product we cannot sell, and a
 *   subject never recommends itself (self-exclusion by sku in isEligible).
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
 * The dominant scoring signal is `region` (+3). We bucket the in-stock CANDIDATES
 * by region once. For each SUBJECT product (in-stock or not) we score it only
 * against its own region bucket of in-stock candidates. If that bucket is too small
 * to yield MAX_RECS results, we widen with a
 * fallback chain so a product in a tiny/unique region still gets neighbours:
 *   1. region bucket
 *   2. + category_type bucket  (e.g. "Red Wine", "Gin")
 *   3. + country bucket
 *   4. + a bounded global slice  (last resort; capped so we never re-scan all n)
 * Buckets are merged and de-duplicated per product, then ranked with the same
 * §6 scoring used by getRecommendations, so precomputed results agree with the
 * single-product path within each bucket.
 *
 * Complexity: ~O(n * b) where b is the average bucket size, plus a small bounded
 * global fallback — far below O(n^2) for a catalog with many regions/categories.
 * Iterating `all` (not just `inStock`) for the outer SUBJECT loop only adds the
 * OOS products as extra keys; each still scores against its own small bucket, so
 * complexity stays ~O(n * b).
 */
export function precomputeRecommendations(
  all: readonly PublicProduct[],
): Map<string, string[]> {
  // In-stock CANDIDATES only (these are the only things we ever recommend). The
  // SUBJECT loop below iterates `all`, so OOS products still get recs computed FOR
  // them — just never recommended themselves. is_in_stock is a normalized boolean
  // post-load; isInStock() also handles a raw "0"/"1"/null product defensively
  // (see isEligible docblock).
  const inStock = all.filter((p) => isInStock(p.is_in_stock));

  const byRegion = new Map<string, PublicProduct[]>();
  const byType = new Map<string, PublicProduct[]>();
  const byCountry = new Map<string, PublicProduct[]>();
  const addTo = (m: Map<string, PublicProduct[]>, key: string | undefined | null, p: PublicProduct) => {
    if (!key || key === 'Unknown') return;
    const arr = m.get(key);
    if (arr) arr.push(p);
    else m.set(key, [p]);
  };
  // Bucket by canonical category_type (via typeForProduct), NOT raw classification:
  // classification is unreliable, so a whisky dumped into "Wine product" would otherwise
  // bucket with wines. category_type buckets it with whiskies (correct same-type scoring).
  for (const p of inStock) {
    addTo(byRegion, p.region, p);
    addTo(byType, typeForProduct(p), p);
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

  // SUBJECTS: iterate ALL products (in-stock OR out-of-stock) so every product
  // page gets recommendations. Candidates remain in-stock-only (buckets above are
  // built from `inStock`); an OOS subject is self-excluded by isEligible (sku).
  for (const product of all) {
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
    if (pool.length < MIN_POOL) merge(byType.get(typeForProduct(product)));
    if (pool.length < MIN_POOL) merge(byCountry.get(product.country ?? ''));
    if (pool.length < MIN_POOL) merge(globalFallback);

    const recs = rankAgainst(product, pool, foodSet(product.food_matching));
    result.set(product.sku, recs.map((r) => r.sku));
  }

  return result;
}
