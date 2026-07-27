/**
 * recommender.ts — rule-based "recommended together" engine (Task 5).
 *
 * Scores other products against a given product and returns the best matches.
 *
 * BI CO-PURCHASE SIGNAL (implemented 2026-07-13)
 * ------------------------------------------------
 * Real BI "bought in the same order" data (data/bi-product-affinities.json,
 * co_order_affinities only — see lib/co-purchase.ts) is wired in as one more
 * additive signal inside scoreCandidateDetailed, not a separate
 * override/replace path. See
 * docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md for the full
 * design and the decisions behind it (esp. why co_customer_affinities is
 * deliberately unused, and the known feedback-loop risk that is not yet
 * mitigated).
 *
 * PERFORMANCE
 * -----------
 * The static build renders ~11,436 product pages. Naive per-page scoring against
 * the full pool is O(n) per page => O(n^2) ~= 130M comparisons, which can stall
 * the build. `precomputeRecommendations` does the scoring ONCE, bucketing
 * candidates by region (then category_type / country) so each product only
 * scores against a small bucket instead of the whole catalog. See its docblock.
 */

import type { PublicProduct, Band, RecommendationResult } from '@/lib/types';
import { isInStock, parseFoodMatching } from '@/lib/utils';
import { typeForProduct, groupForProduct, type CategoryGroup } from '@/lib/category-groups';
import { categorySignalPoints, regionWeightOverride } from '@/lib/category-scorer';
import { getCoPurchaseBonus, buildBaseSkuMap } from '@/lib/co-purchase';

const MAX_RECS = 4;
const MAX_RECS_EXTENDED = 8;

// The 4 canonical wine colors/styles (mirrors lib/finder/category-map.ts's
// CATEGORY_MAP) — mutually exclusive for recommendation purposes, same as the
// Finder's hard category filter. Niche wine types outside this set (Wine Set,
// Orange Wine, Sweet/Dessert, Fortified — too little catalog depth for their
// own strict bucket) are intentionally excluded from the gate so their pools
// don't starve.
const WINE_COLOR_TYPES = new Set([
  'red wine', 'white wine', 'rosé wine', 'sparkling & champagne',
]);

// The smokiness EXTREMES that must never be recommended against each other
// within Whisky. peat_level (the intended dominant +3 whisky signal — see
// categorySignalPoints in category-scorer.ts) is 0% populated in the live
// catalog, so whisky peat/smoke matching falls entirely to the generic
// smokiness +0.5 within-1-band nudge (SMOKINESS_BANDS/withinOneBand below) —
// proven to leak in 17/17 (100%) heavy-smokiness whisky subjects, e.g.
// Laphroaig 10 Years (LWH0024AA, heavy) recommending Old Pulteney 18 Year
// (LWH0473ES, none), and Bowmore 15 Years (heavy) recommending Bruichladdich
// "Unpeated" Islay Single Malt (none) — the candidate's own name says
// "Unpeated". Only the extremes are gated (mirrors WINE_COLOR_TYPES): a soft
// nudge is fine for mild/medium adjacency, but heavy-vs-none/light is a
// genuine, proven mismatch a shopper would notice.
const SMOKINESS_EXTREME_HEAVY = 'heavy';
const SMOKINESS_EXTREME_NONE_OR_LIGHT = new Set(['none', 'light']);

// The 4 real category_type values within Sake & Asian (mirrors WINE_COLOR_TYPES —
// mutually exclusive for recommendation purposes). Sake & Asian has no
// category-scorer.ts override, so these mixed freely on shared region/country/
// price/food alone — proven to leak in 145/419 (34.6%) in-stock Sake & Asian
// subjects, e.g. a dry Sake/Shochu product recommending a sweet Umeshu plum
// liqueur (~10-15% ABV) — a substitute-confusion mismatch, same class as the
// red<->white wine leak WINE_COLOR_TYPES fixes. Lowercased, matching this
// file's typeForProduct(...).trim().toLowerCase() convention.
const SAKE_ASIAN_TYPES = new Set([
  'sake / shochu', 'umeshu', 'shochu', 'makgeolli',
]);

// The 2 real category_type values within Beer & RTD (mirrors SAKE_ASIAN_TYPES —
// mutually exclusive for recommendation purposes). Beer & RTD has no
// category-scorer.ts override and no generic disambiguating signal, so these
// mixed freely on shared region/country/price/food alone — proven to leak in
// 8/16 (50%) in-stock Beer & RTD subjects, 100% systematic (every Beer
// subject recommended all 5 Ready-to-Drink cocktails and vice versa, given
// the tiny pool), e.g. LBE0995CH Moose Indie Summer Cider (Beer)
// recommending LRD0016DG Signature Cocktail The Lychee Martini, LRD0017DG
// Sunset Aperitivo, LRD0018DG Raspberry Espresso Martini, LRD0019DG Rose &
// White Pepper Negroni, and LRD0020DG Coconut & Pineapple Daiquiri
// (Ready-to-Drink) — cider and pre-mixed cocktails are not substitutes a
// shopper would consider interchangeable. Lowercased, matching this file's
// typeForProduct(...).trim().toLowerCase() convention.
const BEER_RTD_TYPES = new Set([
  'beer', 'ready-to-drink',
]);

/**
 * True if a sake/shochu variety string denotes the Junmai brewing class
 * (pure rice/koji, no added distilled alcohol) — i.e. contains "Junmai"
 * case-insensitively, regardless of the fuller variety string ("Junmai
 * Daiginjo" still counts as Junmai class: Junmai describes the brewing
 * method, Daiginjo/Ginjo describe the rice-polish ratio — not mutually
 * exclusive dimensions). A bare "Daiginjo"/"Ginjo" with NO "Junmai" token is
 * a DIFFERENT (non-Junmai, alcohol-added) class. Returns false for
 * undefined/null/empty — callers must check populated-on-both-sides
 * separately before gating (see isEligible), since "not Junmai-class" and
 * "no data" are different states and must not be conflated for gating.
 */
function isJunmaiClass(variety: string | undefined | null): boolean {
  return typeof variety === 'string' && /junmai/i.test(variety);
}

// Minimum SWEETNESS_BANDS index distance that counts as an "extreme" mismatch
// (see gate below, mirrors the WINE_COLOR_TYPES/SMOKINESS_EXTREME pattern):
// 2+ bands apart on ['dry','off-dry','medium-sweet','sweet'] catches dry<->
// medium-sweet, dry<->sweet, and off-dry<->sweet — the true extremes — while
// leaving adjacent pairs (dry<->off-dry, off-dry<->medium-sweet,
// medium-sweet<->sweet) as a soft nudge, same "extremes only" philosophy as
// the whisky smokiness fix.
const SWEETNESS_EXTREME_MIN_DISTANCE = 2;

// Variety alias clusters — exact-match on variety misses obvious affinities like
// Syrah/Shiraz or Pinot Noir/Burgundy. Two varieties in the same cluster score
// the same +2 as an exact match. Normalise to lowercase for comparison.
const VARIETY_ALIASES: string[][] = [
  ['syrah', 'shiraz'],
  ['pinot noir', 'burgundy', 'bourgogne rouge'],
  ['chardonnay', 'bourgogne blanc', 'chablis'],
  ['grenache', 'garnacha'],
  ['tempranillo', 'tinta roriz', 'tinto fino', 'cencibel'],
  ['malbec', 'côt', 'auxerrois'],
  ['mourvèdre', 'monastrell', 'mataro'],
  ['sauvignon blanc', 'fumé blanc'],
  ['cabernet sauvignon', 'cabernet'],
];

// Build a fast lookup: lowercase variety → cluster index
const _varietyCluster = new Map<string, number>();
for (let i = 0; i < VARIETY_ALIASES.length; i++) {
  for (const v of VARIETY_ALIASES[i]) {
    _varietyCluster.set(v, i);
  }
}

/** Tiered price band — returns lo/hi inclusive range considered "similar". */
function similarRange(price: number): { lo: number; hi: number } {
  if (price < 1000)  return { lo: Math.max(0, price - 250), hi: price + 250 };
  if (price < 5000)  return { lo: price * 0.80,             hi: price * 1.20 };
  if (price < 15000) return { lo: price * 0.85,             hi: price * 1.15 };
  return                    { lo: price * 0.90,             hi: price * 1.10 };
}

// Step-up is a deliberate, meaningfully-higher price tier — NOT "just above the
// similar band". A candidate must be at least 50% pricier than the subject to
// read as a genuine upsell, capped at 60% so it doesn't feel like an unrelated
// jump. Candidates priced between the similar band's `hi` and this floor (e.g.
// +16% to +49%) are intentionally excluded from price-band display (see
// priceBand) rather than folded into either band — a deliberate gap, not a bug.
const STEP_UP_MIN_RATIO = 1.5;
const STEP_UP_MAX_RATIO = 1.6;

/**
 * Assign an intent band to a candidate relative to the subject's price.
 * Returns 'similar' when either price is missing/zero — safest default for display.
 * Returns 'step-up' only when the candidate is priced within an explicit tier
 * above the subject: [subjectPrice * STEP_UP_MIN_RATIO, subjectPrice * STEP_UP_MAX_RATIO].
 * Returns null (excluded from price-band display, not mislabeled) in TWO cases:
 * candidate is above the similar band's `hi` but below the step-up floor (a
 * deliberate dead zone — see STEP_UP_MIN_RATIO), or candidate is above the
 * step-up ceiling (too big a jump to read as a natural upsell).
 */
export function priceBand(
  subjectPrice: number | undefined | null,
  candidatePrice: number | undefined | null,
): Band | null {
  if (
    typeof subjectPrice !== 'number' || subjectPrice <= 0 ||
    typeof candidatePrice !== 'number' || candidatePrice <= 0
  ) return 'similar';
  const { lo, hi } = similarRange(subjectPrice);
  if (candidatePrice >= lo && candidatePrice <= hi) return 'similar';
  if (candidatePrice < lo) return 'great-alternative';
  const stepUpFloor = subjectPrice * STEP_UP_MIN_RATIO;
  const stepUpCeiling = subjectPrice * STEP_UP_MAX_RATIO;
  if (candidatePrice >= stepUpFloor && candidatePrice <= stepUpCeiling) return 'step-up';
  return null;
}

function varietiesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al === bl) return true;
  const ci = _varietyCluster.get(al);
  return ci !== undefined && ci === _varietyCluster.get(bl);
}

/**
 * Lowercased, trimmed set of food_matching items, using the shared
 * pipe-first / paren-aware parser (see parseFoodMatching in lib/utils).
 */
function foodSet(food: string | undefined | null): Set<string> {
  return new Set(parseFoodMatching(food).map((s) => s.toLowerCase()));
}

// Sweetness/smokiness band ordering for "within 1 step" matching.
// VOCAB VERIFIED against products.db 2026-07-09 (Rule 3 — don't trust assumed
// constants): sweetness = Dry(1254)/Sweet(321)/Off-Dry(120)/Medium-Sweet(80).
// There is NO 'Semi-Sweet' in the data. smokiness = none(1899)/heavy(71) and is
// stored LOWERCASE — compare case-insensitively or the signal silently never
// fires ('light'/'medium' kept in the scale for future enrichment).
const SWEETNESS_BANDS = ['dry', 'off-dry', 'medium-sweet', 'sweet'];
const SMOKINESS_BANDS = ['none', 'light', 'medium', 'heavy'];

function withinOneBand(bands: string[], a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ai = bands.indexOf(a.toLowerCase()), bi = bands.indexOf(b.toLowerCase());
  return ai !== -1 && bi !== -1 && Math.abs(ai - bi) <= 1;
}

/**
 * Complementary check to withinOneBand: true when both values resolve to a
 * known band AND are at least `minDistance` indices apart. Used by the White
 * Wine sweetness extremes gate in isEligible() below — same case-insensitive
 * comparison convention as withinOneBand.
 */
function bandDistanceAtLeast(
  bands: string[],
  a: string | undefined | null,
  b: string | undefined | null,
  minDistance: number,
): boolean {
  if (!a || !b) return false;
  const ai = bands.indexOf(a.toLowerCase()), bi = bands.indexOf(b.toLowerCase());
  return ai !== -1 && bi !== -1 && Math.abs(ai - bi) >= minDistance;
}

/**
 * Score a candidate against the current product, returning both the numeric
 * score and a per-signal breakdown (used by staff API and getRecommendationsWithBands).
 *
 * Pre-split food set for `product` can be passed to avoid re-splitting it on
 * every candidate (hot path during precompute).
 */
export function scoreCandidateDetailed(
  product: PublicProduct,
  candidate: PublicProduct,
  productFoods?: Set<string>,
  baseSkuMap?: Map<string, string[]>,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  const add = (key: string, pts: number) => { if (pts > 0) breakdown[key] = (breakdown[key] ?? 0) + pts; };

  // Region — check for category-specific override (e.g. gin suppresses region:
  // "London Dry" gin is made in many countries, so region is a weak/misleading
  // signal for gin specifically). Falls back to the default weight (+3).
  const regionWeight = regionWeightOverride(product) ?? 3;
  if (regionWeight > 0 && product.region && candidate.region && product.region === candidate.region) {
    add('region', regionWeight);
  }
  if (product.subregion && candidate.subregion && product.subregion === candidate.subregion) add('subregion', 2);
  if (varietiesMatch(product.variety, candidate.variety)) add('variety', 2);
  if (product.country && candidate.country && product.country === candidate.country) add('country', 1);

  const a = productFoods ?? foodSet(product.food_matching);
  const b = foodSet(candidate.food_matching);
  let foodPts = 0;
  for (const item of b) { if (a.has(item)) foodPts += 1; }
  if (foodPts > 0) add('food', foodPts);

  // Same canonical TYPE (category_type), not raw classification: a whisky mislabeled
  // "Wine product" must score with other whiskies, not with wine. typeForProduct prefers
  // the backfilled category_type, else resolves from the SKU.
  const pt = typeForProduct(product);
  const ct = typeForProduct(candidate);
  if (pt && ct && pt !== 'Unknown' && pt === ct) add('category_type', 1);

  if (typeof product.price === 'number' && product.price > 0 &&
      typeof candidate.price === 'number' && candidate.price > 0) {
    const { lo, hi } = similarRange(product.price);
    if (candidate.price >= lo && candidate.price <= hi) add('price', 1);
  }

  // Taste tiebreakers — body/acidity/tannin always; sweetness/smokiness conditional.
  if (product.body && candidate.body && product.body === candidate.body) add('body', 1.5);
  if (product.acidity && candidate.acidity && product.acidity === candidate.acidity) add('acidity', 1.5);
  if (product.tannin && candidate.tannin && product.tannin === candidate.tannin) add('tannin', 1.5);

  const grp = groupForProduct(product);
  if (grp === 'Wine' || grp === 'Liqueur') {
    if (withinOneBand(SWEETNESS_BANDS, product.sweetness, candidate.sweetness)) add('sweetness', 0.5);
  }
  if (grp === 'Whisky' || grp === 'Spirits' || grp === 'Sake & Asian') {
    if (withinOneBand(SMOKINESS_BANDS, product.smokiness, candidate.smokiness)) add('smokiness', 0.5);
  }

  // Category-specific signals (Phase 2: gin_style, agave_aging, rum_style,
  // peat_level, production_method) — see category-scorer.ts. Attributed to
  // the specific field it matched on (e.g. 'gin_style', 'peat_level') so the
  // breakdown stays explainable, matching every other signal in this function.
  const catSignal = categorySignalPoints(product, candidate);
  if (catSignal) add(catSignal.field, catSignal.points);

  // Popularity tiebreaker — the FIRST real behavioral (non-attribute) signal
  // in this scorer. popularity_tier (0|1|2) is a p75-cutoff bucket derived at
  // load time (catalog-data.ts) from popularity_score, which is itself a
  // 365-day sales-velocity blend synced from BI order data
  // (data/sync_popularity_from_bi.py). +1 when BOTH sides are tier 2 (top
  // quartile by demand) — a small, bounded nudge, not a dominant signal:
  // two demonstrably popular products are a LIGHTLY better mutual
  // recommendation than two arbitrary ones, but shared demand alone doesn't
  // make two products "alike" the way shared region/variety/taste do, so this
  // sits below every attribute signal (region +3 down to sweetness +0.5).
  // Only tier 2 counts (not >=1) to avoid rewarding the median product.
  //
  // DELIBERATELY NOT using reputation_tier here: a 2026-07-09 3-lens review
  // (see memory project_reputation_v1_expert_review) found the 'iconic' tier
  // materially miscalibrated — 181/199 iconic products have no real acclaim
  // signal backing them, driven by a percentile tie-breaking bug affecting
  // the 91% of SKUs with zero/near-zero demand. Scoring on reputation_tier
  // would let the recommender confidently amplify a known-wrong "iconic"
  // label. Revisit once that data fix lands (tracked, not yet shipped).
  if (product.popularity_tier === 2 && candidate.popularity_tier === 2) {
    add('popularity', 1);
  }

  // Co-purchase (real BI "bought in the same order" data) — see
  // docs/superpowers/specs/2026-07-11-co-purchase-wiring-design.md. Only
  // active when a baseSkuMap is provided (both call chains build one; tests
  // that omit it simply get 0 co-purchase bonus, same as a subject with no
  // BI record). Placed above popularity: two SPECIFIC products bought
  // together is stronger evidence than both merely being popular in general.
  if (baseSkuMap) {
    const coPurchasePts = getCoPurchaseBonus(product.sku, candidate.sku, baseSkuMap);
    if (coPurchasePts > 0) add('co_purchase', coPurchasePts);
  }

  const score = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { score, breakdown };
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
  baseSkuMap?: Map<string, string[]>,
): number {
  return scoreCandidateDetailed(product, candidate, productFoods, baseSkuMap).score;
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
  if (candidate.custom_stock_status === 'CATALOG') return false; // archived/discontinued — never recommend

  // Suppress cross-category group recommendations (Wine ↔ Spirits, etc.): no amount
  // of shared region/food/price signal makes a Wine->Whisky "you might also like"
  // sensible. Skipped entirely (not suppressed) when either side resolves to
  // 'Unknown' so synthetic/malformed fixtures without real SKUs/category_group
  // aren't wrongly suppressed.
  const subjectGroup = groupForProduct(product);
  const candidateGroup = groupForProduct(candidate);
  if (
    subjectGroup !== 'Unknown' &&
    candidateGroup !== 'Unknown' &&
    subjectGroup !== candidateGroup
  ) return false;

  // Suppress cross-color/style recommendations WITHIN Wine (Red <-> White <->
  // Rosé <-> Sparkling & Champagne): shared region/country/price/food isn't
  // enough to make a Sauvignon Blanc a sensible "you might also like" for a
  // Cabernet shopper. Mirrors the Finder's own hard category filter
  // (finderPrefilter/CATEGORY_MAP) so the whole site is consistent about what
  // counts as "the same kind of wine". Gate only applies when BOTH sides fall
  // in the 4 canonical color buckets — niche types (Wine Set, Orange Wine,
  // Sweet/Dessert, Fortified) stay ungated, same as before.
  if (subjectGroup === 'Wine' && candidateGroup === 'Wine') {
    const subjectType = typeForProduct(product).trim().toLowerCase();
    const candidateType = typeForProduct(candidate).trim().toLowerCase();
    if (
      WINE_COLOR_TYPES.has(subjectType) &&
      WINE_COLOR_TYPES.has(candidateType) &&
      subjectType !== candidateType
    ) return false;
  }

  // Suppress heavy <-> none/light smokiness recommendations WITHIN Whisky: see
  // SMOKINESS_EXTREME_HEAVY/SMOKINESS_EXTREME_NONE_OR_LIGHT above for the
  // proof (17/17 heavy-smokiness whisky subjects leaked a none/light
  // candidate). Case-insensitive, matching this file's existing smokiness
  // comparison convention (withinOneBand/SMOKINESS_BANDS). Only the extremes
  // are gated — mild/medium pairs are intentionally left as a soft nudge.
  if (subjectGroup === 'Whisky' && candidateGroup === 'Whisky') {
    const subjectSmoke = (product.smokiness ?? '').toLowerCase();
    const candidateSmoke = (candidate.smokiness ?? '').toLowerCase();
    const isExtremeMismatch =
      (subjectSmoke === SMOKINESS_EXTREME_HEAVY && SMOKINESS_EXTREME_NONE_OR_LIGHT.has(candidateSmoke)) ||
      (candidateSmoke === SMOKINESS_EXTREME_HEAVY && SMOKINESS_EXTREME_NONE_OR_LIGHT.has(subjectSmoke));
    if (isExtremeMismatch) return false;
  }

  // Suppress dry <-> sweet sweetness EXTREMES WITHIN White Wine specifically:
  // sweetness is severely underpopulated for Red Wine (0.2%) and Rosé Wine
  // (0%) — a pure data-coverage gap, NOT gated here since there's no data to
  // gate on — but reasonably well-populated for White Wine (65.4%), where the
  // generic +0.5 within-1-band nudge (SWEETNESS_BANDS/withinOneBand above)
  // proved too weak: 12/467 (2.6%) in-stock Dry White Wine subjects leaked
  // >=1 Sweet White Wine candidate into their rail, e.g. WWW2006AB Nik Weis
  // Urban Riesling (Dry) recommending WWW5371AB Nollen Erben Mosel Riesling
  // Spätlese (Sweet). WWW1974DJ Chateau Reynon Blanc Cadillac (a sweet
  // Bordeaux dessert wine) was a repeat offender in 6/12 leaked slots. Only
  // the extremes (2+ bands apart — see SWEETNESS_EXTREME_MIN_DISTANCE) are
  // gated, and only when BOTH sides have sweetness populated, mirroring the
  // "extremes only, safe on missing data" convention of the other two gates.
  if (
    subjectGroup === 'Wine' && candidateGroup === 'Wine' &&
    typeForProduct(product).trim().toLowerCase() === 'white wine' &&
    typeForProduct(candidate).trim().toLowerCase() === 'white wine'
  ) {
    if (bandDistanceAtLeast(SWEETNESS_BANDS, product.sweetness, candidate.sweetness, SWEETNESS_EXTREME_MIN_DISTANCE)) {
      return false;
    }
  }

  // Suppress cross-category_type recommendations WITHIN Sake & Asian (Sake /
  // Shochu <-> Umeshu <-> Shochu <-> Makgeolli): see SAKE_ASIAN_TYPES above for
  // the proof (145/419, 34.6% of in-stock Sake & Asian subjects leaked a
  // cross-type candidate — e.g. sweet Umeshu plum liqueur recommended
  // alongside dry Sake/Shochu). Sake & Asian has no category-scorer.ts
  // override, so nothing else in the scorer disambiguates these. Mirrors
  // WINE_COLOR_TYPES: gate only applies when BOTH sides fall in the 4 real
  // category_type values for this group.
  if (subjectGroup === 'Sake & Asian' && candidateGroup === 'Sake & Asian') {
    const subjectType = typeForProduct(product).trim().toLowerCase();
    const candidateType = typeForProduct(candidate).trim().toLowerCase();
    if (
      SAKE_ASIAN_TYPES.has(subjectType) &&
      SAKE_ASIAN_TYPES.has(candidateType) &&
      subjectType !== candidateType
    ) return false;
  }

  // Suppress Junmai <-> non-Junmai (Daiginjo/Ginjo with no "Junmai" token)
  // recommendations WITHIN Sake & Asian: see isJunmaiClass above for the class
  // definition and SAKE_ASIAN_TYPES block above for the proof context. Sake
  // brewing class is only readable from the structured `variety` field (NEVER
  // free-text `name` matching — CLAUDE.md Rule 12 convention), and smokiness
  // (this group's only generic taste signal) is 0% populated for Sake &
  // Asian, so there's no working disambiguation without this gate. Proven:
  // 8/39 (20.5%) in-stock Junmai-variety subjects leaked a non-Junmai
  // Daiginjo/Ginjo candidate, e.g. LSK0119AB Dassai Junmai Daiginjou
  // recommending LSK0008AR Kamotsuru Tokusei Gold Daiginjo (variety=
  // "Daiginjo", no "Junmai"). Fires ONLY when variety is populated on BOTH
  // sides (mirrors the "extremes only, safe on missing data" convention of
  // the other gates) — a missing variety must fall through, not be assumed
  // non-Junmai. Naturally scoped to Sake / Shochu in practice: the
  // SAKE_ASIAN_TYPES gate above already separates Umeshu/Shochu/Makgeolli
  // out, and those types don't carry Junmai/Daiginjo variety values in the
  // live catalog, so this is a no-op for them either way.
  if (subjectGroup === 'Sake & Asian' && candidateGroup === 'Sake & Asian') {
    const subjectVariety = product.variety;
    const candidateVariety = candidate.variety;
    if (
      typeof subjectVariety === 'string' && subjectVariety.trim() !== '' &&
      typeof candidateVariety === 'string' && candidateVariety.trim() !== '' &&
      isJunmaiClass(subjectVariety) !== isJunmaiClass(candidateVariety)
    ) return false;
  }

  // Suppress cross-category_type recommendations WITHIN Beer & RTD (Beer <->
  // Ready-to-Drink): see BEER_RTD_TYPES above for the proof (8/16, 50% of
  // in-stock Beer & RTD subjects leaked a cross-type candidate, 100%
  // systematic given the tiny pool). Beer & RTD has no category-scorer.ts
  // override, so nothing else in the scorer disambiguates these. Mirrors
  // SAKE_ASIAN_TYPES: gate only applies when BOTH sides fall in the 2 real
  // category_type values for this group.
  if (subjectGroup === 'Beer & RTD' && candidateGroup === 'Beer & RTD') {
    const subjectType = typeForProduct(product).trim().toLowerCase();
    const candidateType = typeForProduct(candidate).trim().toLowerCase();
    if (
      BEER_RTD_TYPES.has(subjectType) &&
      BEER_RTD_TYPES.has(candidateType) &&
      subjectType !== candidateType
    ) return false;
  }

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
  baseSkuMap?: Map<string, string[]>,
): PublicProduct[] {
  const scored: Array<{ p: PublicProduct; score: number }> = [];
  for (const c of candidates) {
    if (!isEligible(product, c)) continue;
    const score = scoreCandidate(product, c, productFoods, baseSkuMap);
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
  const baseSkuMap = buildBaseSkuMap(all);
  return rankAgainst(product, candidates, foodSet(product.food_matching), baseSkuMap);
}

/**
 * Canonical slot preference order for 8 positions.
 * Odd positions (1,3,5,7 = index 0,2,4,6) → 'similar'
 * Even positions (2,4,6,8 = index 1,3,5,7) → 'step-up'
 */
const SLOT_PREFERENCE: Band[] = [
  'similar', 'step-up', 'similar', 'step-up',
  'similar', 'step-up', 'similar', 'step-up',
];

/**
 * Return up to 8 products "recommended together" with `product`, each tagged
 * with an intent band ('similar' / 'step-up' / 'great-alternative') relative to
 * the subject's price. Slots follow a canonical alternating preference order
 * (odd slots prefer 'similar', even slots prefer 'step-up'); when a preferred
 * band's pool is empty, the slot falls back to whatever band has candidates left
 * (adjacency of the same band across slots is allowed in that case — see tests).
 *
 * 'great-alternative' (>20%+ cheaper) is EXCLUDED from slot-filling unless
 * `opts.includeGreatAlternative` is true — the default in-stock product page only
 * shows 'similar' and 'step-up'; a future OOS-alternative or B2B view can opt in.
 *
 * Excludes self and out-of-stock, dedupes by sku, cross-category suppressed via
 * isEligible (same as getRecommendations), and only returns positive-scored
 * matches — no zero-score padding, so fewer than 8 results is expected and correct
 * when the pool doesn't have enough eligible candidates.
 */
export function getRecommendationsWithBands(
  product: PublicProduct,
  all: readonly PublicProduct[],
  // B2B: PublicProduct has NO b2b_price — it is deliberately excluded from
  // live_products_export.json ("must never leave the server", see
  // refresh_live_export.py). Callers that want B2B banding INJECT a sku→price
  // map (staff API loads it from data/b2b_products_export.json server-side).
  // A `b2bMode` flag reading (product as any).b2b_price would silently no-op.
  opts: {
    includeGreatAlternative?: boolean;
    b2bPrices?: ReadonlyMap<string, number>;
    baseSkuMap?: Map<string, string[]>;
  } = {},
): RecommendationResult[] {
  const { includeGreatAlternative = false, b2bPrices } = opts;

  // Dedupe candidates.
  const seen = new Set<string>();
  const candidates: PublicProduct[] = [];
  for (const p of all) {
    if (seen.has(p.sku)) continue;
    seen.add(p.sku);
    candidates.push(p);
  }

  const productFoods = foodSet(product.food_matching);
  // Callers with a hot-path Map<sku, sku[]> already built (e.g.
  // precomputeRecommendations, which builds it ONCE against the full pool
  // instead of rebuilding it per-product) can pass it in directly; standalone
  // callers fall back to building it from `all` as before.
  const baseSkuMap = opts.baseSkuMap ?? buildBaseSkuMap(all);

  // Score all eligible candidates and assign bands.
  type Scored = { result: RecommendationResult };
  const similar: Scored[] = [], stepUp: Scored[] = [], greatAlt: Scored[] = [];

  // Band prices: injected B2B price when available for that SKU, else retail.
  const priceOf = (p: PublicProduct) => b2bPrices?.get(p.sku) ?? p.price;
  const subjectPrice = priceOf(product);

  for (const c of candidates) {
    if (!isEligible(product, c)) continue;
    const { score, breakdown } = scoreCandidateDetailed(product, c, productFoods, baseSkuMap);
    if (score <= 0) continue;

    const band = priceBand(subjectPrice, priceOf(c));
    if (band === null) continue; // priced too far above the step-up ceiling — exclude, don't mislabel

    const result: RecommendationResult = { product: c, band, score, scoreBreakdown: breakdown };
    if (band === 'similar') similar.push({ result });
    else if (band === 'step-up') stepUp.push({ result });
    else if (includeGreatAlternative) greatAlt.push({ result });
  }

  // Sort each pool by score desc, SKU asc for determinism.
  const sort = (arr: Scored[]) =>
    arr.sort((a, b) =>
      (b.result.score - a.result.score) ||
      (a.result.product.sku < b.result.product.sku ? -1 : 1)
    );
  sort(similar); sort(stepUp); sort(greatAlt);

  // Fill slots using canonical slot preference. When preferred band exhausts,
  // fall back to any remaining candidates.
  const pools: Record<Band, Scored[]> = {
    'similar': similar,
    'step-up': stepUp,
    'great-alternative': greatAlt,
  };
  const pop = (band: Band): RecommendationResult | null => {
    const arr = pools[band];
    return arr.length > 0 ? arr.shift()!.result : null;
  };
  const popAny = (): RecommendationResult | null => {
    for (const band of ['similar', 'step-up', 'great-alternative'] as Band[]) {
      const r = pop(band);
      if (r) return r;
    }
    return null;
  };

  const output: RecommendationResult[] = [];
  for (let i = 0; i < MAX_RECS_EXTENDED; i++) {
    const preferred = SLOT_PREFERENCE[i];
    const result = pop(preferred) ?? popAny();
    if (!result) break;
    output.push(result);
  }

  return output;
}

/**
 * Precompute recommendations for EVERY product (in-stock OR out-of-stock),
 * returning a lightweight Map<sku, {sku,band}[]> (<=8 rec entries each). Pages
 * resolve skus via getProductBySku, so we store skus (+ band tag) only — not full
 * product objects.
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
 * ~11,436-page static build fast (avoids O(n^2)). It may return a DIFFERENT top-N
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
 * to yield MAX_RECS_EXTENDED results, we widen with a
 * fallback chain so a product in a tiny/unique region still gets neighbours:
 *   1. region bucket
 *   2. + category_type bucket  (e.g. "Red Wine", "Gin")
 *   3. + country bucket
 *   4. + a bounded global slice, SAME category_group as the subject when known
 *      (last resort; capped so we never re-scan all n)
 * Buckets are merged and de-duplicated per product, then ranked with the same
 * scoring used by getRecommendationsWithBands, so precomputed results agree with
 * the single-product path within each bucket.
 *
 * GROUP-AWARE WIDENING (interaction with the cross-category suppression gate)
 * -----------------------------------------------------------------------
 * The `byCountry`/global buckets mix category groups (e.g. France = wines +
 * cognacs + gins), but isEligible() suppresses cross-group candidates entirely.
 * If widening only checked RAW pool size, a subject in a small group could "fill"
 * its pool with candidates that ALL get suppressed later, yielding far fewer recs
 * than the catalog actually has available for it. So each widening check counts
 * only SAME-GROUP candidates (what suppression will actually keep) via
 * `eligibleCount()`, and the last-resort global fallback is built PER GROUP
 * (`globalFallbackByGroup`) so it still contains group-relevant candidates.
 *
 * Complexity: ~O(n * b) where b is the average bucket size, plus a small bounded
 * global fallback — far below O(n^2) for a catalog with many regions/categories.
 * Iterating `all` (not just `inStock`) for the outer SUBJECT loop only adds the
 * OOS products as extra keys; each still scores against its own small bucket, so
 * complexity stays ~O(n * b). The same-group count used by the widening checks
 * (`eligibleCount()`) is tracked INCREMENTALLY inside `merge()` — each candidate
 * is classified by `groupForProduct()` exactly ONCE, when it is first added to the
 * pool — rather than by re-filtering the accumulated pool from scratch on every
 * widening decision. (An earlier version re-filtered the full pool up to 3x per
 * subject via `pool.filter(...)`; at real-catalog bucket sizes — e.g. France
 * 1,411 in-stock, Wine group 3,896 in-stock — that re-filter made the build hang
 * and time out. Do NOT reintroduce a full re-filter here.)
 */
export function precomputeRecommendations(
  all: readonly PublicProduct[],
): Map<string, { sku: string; band: Band }[]> {
  // In-stock CANDIDATES only (these are the only things we ever recommend). The
  // SUBJECT loop below iterates `all`, so OOS products still get recs computed FOR
  // them — just never recommended themselves. is_in_stock is a normalized boolean
  // post-load; isInStock() also handles a raw "0"/"1"/null product defensively
  // (see isEligible docblock).
  const inStock = all.filter((p) => isInStock(p.is_in_stock) && p.custom_stock_status !== 'CATALOG');

  // Built once against the FULL pool (in-stock + out-of-stock), same
  // convention as buildBaseSkuMap's own contract — matches how byRegion/
  // byType/byCountry are pre-split once here rather than per-subject.
  const baseSkuMap = buildBaseSkuMap(all);

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
  const GLOBAL_FALLBACK_CAP = 100;
  const globalFallback = inStock.slice(0, GLOBAL_FALLBACK_CAP);

  // First GLOBAL_FALLBACK_CAP in-stock products PER GROUP, so the last-resort
  // slice always contains candidates the suppression gate will actually keep.
  const globalFallbackByGroup = new Map<CategoryGroup, PublicProduct[]>();
  for (const p of inStock) {
    const g = groupForProduct(p);
    const arr = globalFallbackByGroup.get(g) ?? [];
    if (arr.length < GLOBAL_FALLBACK_CAP) { arr.push(p); globalFallbackByGroup.set(g, arr); }
  }

  // We want at least enough raw candidates to reliably surface MAX_RECS_EXTENDED
  // after eligibility/scoring filters; widen the bucket until we have a
  // comfortable pool.
  const MIN_POOL = MAX_RECS_EXTENDED + 1;

  const result = new Map<string, { sku: string; band: Band }[]>();

  // SUBJECTS: iterate ALL products (in-stock OR out-of-stock) so every product
  // page gets recommendations. Candidates remain in-stock-only (buckets above are
  // built from `inStock`); an OOS subject is self-excluded by isEligible (sku).
  for (const product of all) {
    const pool: PublicProduct[] = [];
    const poolSeen = new Set<string>();

    // Widening counts only same-group candidates (what suppression will keep).
    // Tracked INCREMENTALLY as items are merged, rather than re-derived via a
    // full re-filter of `pool` on every widening check (that re-filter is what
    // caused the O(n * pool^2)-ish build timeout — see PERFORMANCE note below).
    // Each item is checked against subjectGroup exactly ONCE, at merge time.
    const subjectGroup = groupForProduct(product);
    let sameGroupCount = 0;
    const merge = (arr: PublicProduct[] | undefined) => {
      if (!arr) return;
      for (const p of arr) {
        if (poolSeen.has(p.sku)) continue;
        poolSeen.add(p.sku);
        pool.push(p);
        if (subjectGroup === 'Unknown' || groupForProduct(p) === subjectGroup) sameGroupCount++;
      }
    };
    const eligibleCount = () => (subjectGroup === 'Unknown' ? pool.length : sameGroupCount);

    // Gin & co.: region carries no signal (regionWeightOverride === 0), so
    // region-bucket candidates are noise — pull from the TYPE bucket (all gins,
    // any country) first instead, so the gin_style signal can actually surface
    // cross-country matches. This check is O(1) per subject (no re-filter).
    if (regionWeightOverride(product) !== 0) {
      merge(byRegion.get(product.region ?? ''));
    }
    if (eligibleCount() < MIN_POOL) merge(byType.get(typeForProduct(product)));
    if (eligibleCount() < MIN_POOL) merge(byCountry.get(product.country ?? ''));
    if (eligibleCount() < MIN_POOL) merge(globalFallbackByGroup.get(subjectGroup) ?? globalFallback);

    let recs = getRecommendationsWithBands(product, pool, {
      includeGreatAlternative: !isInStock(product.is_in_stock),
      baseSkuMap,
    });

    // POST-BAND WIDENING (fixes a real regression — see recommender.test.ts
    // "widens further when price-band exclusions hollow out an early-exhausted
    // bucket"): eligibleCount() above only counts RAW same-group candidates,
    // before getRecommendationsWithBands' priceBand ceiling can exclude a
    // candidate entirely (priced too far above the subject to read as a
    // natural "step up" — see priceBand's `return null` case). A region
    // bucket can satisfy MIN_POOL on raw count alone while every one of those
    // candidates is priced outside the ceiling, silently starving the rail
    // even though the type/country/global tiers below contain valid in-range
    // matches. If banding actually produced fewer than MAX_RECS_EXTENDED
    // results, merge the remaining widening tiers (each a no-op if already
    // merged/exhausted) and re-band once more — bounded to the same 4 fixed
    // tiers as above, so this cannot regress the O(n * b) build-time
    // guarantee those tiers exist to preserve.
    //
    // MUST compare against MAX_RECS_EXTENDED (8), NOT MIN_POOL (9):
    // getRecommendationsWithBands never returns more than MAX_RECS_EXTENDED
    // results by construction (see its docblock), so `recs.length < MIN_POOL`
    // is true for virtually every subject regardless of pool quality — that
    // off-by-one turned this into an unconditional second pass over the whole
    // catalog (7s -> 82s measured locally, an 11x slowdown). Comparing against
    // MAX_RECS_EXTENDED only retries subjects that are ACTUALLY short.
    if (recs.length < MAX_RECS_EXTENDED) {
      merge(byRegion.get(product.region ?? ''));
      merge(byType.get(typeForProduct(product)));
      merge(byCountry.get(product.country ?? ''));
      merge(globalFallbackByGroup.get(subjectGroup) ?? globalFallback);
      recs = getRecommendationsWithBands(product, pool, {
        includeGreatAlternative: !isInStock(product.is_in_stock),
        baseSkuMap,
      });
    }

    result.set(product.sku, recs.map((r) => ({ sku: r.product.sku, band: r.band })));
  }

  return result;
}
