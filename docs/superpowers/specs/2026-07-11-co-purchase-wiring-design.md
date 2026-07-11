# Wire real co-purchase (BI) data into the recommender — Design

Date: 2026-07-11
Branch/worktree: `.claude/worktrees/recs-engine-v2`
Related file: `apps/catalog/lib/recommender.ts`

## Context

`recommender.ts` is a rule-based additive scorer for "recommended together" /
cross-sell. It has a documented but never-implemented seam
(`coPurchaseStrategy`, see the FUTURE comment on `getRecommendations`) for
real BI co-purchase data. `data/bi-product-affinities.json` exists and — per
investigation below — is fresh and usable, not stale as previously assumed.

This is a continuation of prior recs-engine-v2 work (10 commits ahead of
`main`, including category-specific scoring overrides, tiered price bands,
per-signal score breakdowns via `scoreCandidateDetailed`, and a popularity-tier
signal). This design builds on that state; it does not redo it.

## Investigation findings (verified against real data, not assumed)

- `data/bi-product-affinities.json` was exported **2026-07-11T08:50 UTC**
  (today) — not stale. Source: `BI marts.mart_pivot_base`.
- Structure: `{ source, exported_at, base_count, affinities: { <base_sku>:
  { co_order_affinities: [...], co_customer_affinities: [...] } } }`.
  - `co_order_affinities` — products bought in the *same order* as the
    subject. 158/5,439 subject SKUs have zero entries.
  - `co_customer_affinities` — products bought by the *same customer* over
    time (broader, not necessarily complementary). Every subject SKU has
    ≥1 entry.
  - Each entry: `{ rank, base_product_code, product_name, rate }`. Lists are
    verified sorted descending by `rate` for every SKU (0 counterexamples
    found). `rate` ranges 0.0101–1.0, rank-1 `co_order` rate has median
    ≈0.389, mean ≈0.492 — a real, informative confidence score (not a
    constant/placeholder).
- **SKU format mismatch (the actual blocker the seam never accounted for):**
  BI codes are *base* SKUs (e.g. `WRW6603`). Live catalog SKUs carry a
  trailing variant-lot suffix (e.g. `WRW6603AC`, `WWW5140FP`). Stripping the
  suffix with `^([A-Z]{3}\d{4})` maps **5,235/5,439 (96%)** BI codes to a live
  base code. Fan-out is nearly 1:1 (mean 1.01 live SKUs per base code); a
  small number of base codes resolve to 2 live SKU variants (e.g. `WRW6564`
  → `WRW6564GF`, `WRW6564AA`) — both should be treated as valid candidate
  targets, not arbitrarily disambiguated.
- The remaining 204 unmapped codes are presumed discontinued/delisted
  products no longer in the live export.

## Decisions (confirmed with user)

1. **Continue in the existing worktree** (`recs-engine-v2`), not from `main`.
2. **Blend both `co_order_affinities` and `co_customer_affinities`** rather
   than picking one — take the max rate when a candidate appears in both
   lists for a subject.
3. **Additive bonus into the existing scorer**, not a separate
   override/replace path. Co-purchase becomes one more entry in the
   `scoreCandidateDetailed` breakdown, alongside `region`/`variety`/etc. One
   ranked list, one explainable score, no parallel ranking logic.
4. **Scope: scoring/precompute wiring only.** No BI-file refresh/sync
   pipeline in this phase — `bi-product-affinities.json` is treated as
   already-delivered input, same trust level as any other static data file
   the recommender already reads.
5. **Unmapped BI codes (4%) are silently skipped at runtime** (no per-request
   logging — this runs on every static build / page precompute, so logging
   would spam). Instead, a **test asserts mapped-coverage stays above a
   threshold (>90%)** as a regression guard: if the BI export's SKU format
   changes later and coverage collapses, a test fails loudly instead of the
   signal silently going dead (the same class of bug already caught twice
   this session per the file's own commit history — `regionWeightOverride`
   and `sync_popularity_from_bi.py` column mismatches).

## Design

### New module: `apps/catalog/lib/co-purchase.ts`

Kept separate from `recommender.ts` (currently 577 lines) so BI-data parsing
and SKU mapping is independently testable and doesn't grow the scorer file.

```ts
// Loaded once at module init, same pattern as other static JSON in catalog-data.ts
type AffinityEntry = { rank: number; base_product_code: string; product_name: string; rate: number };
type AffinityRecord = { co_order_affinities: AffinityEntry[]; co_customer_affinities: AffinityEntry[] };

// base_product_code (BI) -> live sku[] (0, 1, or rarely 2 entries)
export function buildBaseSkuMap(all: readonly PublicProduct[]): Map<string, string[]>;

// live sku -> base_product_code, derived via ^([A-Z]{3}\d{4}) prefix match
function baseCodeOf(sku: string): string;

/**
 * Bonus points for candidate given subject, scaled from BI rate.
 * Returns 0 if no affinity data for subject, or candidate isn't a target.
 * K=5 -> max bonus +5 (rate=1.0); typical rank-1 real pair ~= +2 (rate~0.39-0.49 median).
 */
export function getCoPurchaseBonus(
  subjectSku: string,
  candidateSku: string,
  baseSkuMap: Map<string, string[]>,
): number;
```

`getCoPurchaseBonus` resolves `subjectSku` to its base code, looks up
`co_order_affinities` + `co_customer_affinities` for that base code, resolves
each entry's `base_product_code` to live SKU(s) via `baseSkuMap`, and if
`candidateSku` is among them, returns `rate * K` (using the **max** rate
across both lists if the candidate appears in both). `K = 5`.

### `recommender.ts` changes

One new line in `scoreCandidateDetailed`, following the existing pattern of
every other signal in that function:

```ts
const coPurchasePts = getCoPurchaseBonus(product.sku, candidate.sku, baseSkuMap);
if (coPurchasePts > 0) add('co_purchase', coPurchasePts);
```

`baseSkuMap` is built once per `precomputeRecommendations` call (and once per
`getRecommendations` call) and threaded through, not rebuilt per-candidate —
same performance discipline as the existing `productFoods` pre-split.

No changes to `getRecommendationsWithBands`, `precomputeRecommendations`
bucketing, or the FUTURE/BI-SWAP-SEAM docblocks beyond marking the seam as
now-implemented (docblock update, not a code path change).

### Placement in the score hierarchy

Region (+3) still dominates. Co-purchase max (+5) can now exceed region alone
— intentional: two products genuinely bought together repeatedly is stronger
evidence than "happens to share a region." A real bought-together pair that
*also* shares region/variety will simply score very high, which is correct.
Sits above the popularity tiebreaker (+1) — shared purchase behavior between
two *specific* products is stronger evidence than both merely being popular
in general.

### Testing plan

- `co-purchase.test.ts`:
  - `baseCodeOf` / `buildBaseSkuMap`: suffix stripping, fan-out to 2 SKUs,
    codes with no live match excluded from the map.
  - `getCoPurchaseBonus`: correct `rate * K` scaling, max-of-both-lists when
    present in both, 0 when subject has no BI record, 0 when candidate isn't
    a listed target.
  - **Coverage regression guard**: load the real
    `data/bi-product-affinities.json`, build the real base-SKU map against
    the real live export, assert mapped-coverage ratio > 0.90.
- `recommender.test.ts` addition: one integration case asserting a known real
  BI-affinity pair (sampled from the live JSON, not synthetic) ranks above an
  otherwise-equivalent candidate with no co-purchase signal.
- **Rule 1/6/9 verification**: after wiring, run `precomputeRecommendations`
  over the real live export and inspect the output map for a handful of
  sampled real BI pairs to confirm the bonus is reflected in final
  scores/ordering — not just that the loader parses the JSON correctly.

## Out of scope (explicitly deferred, not silently dropped)

- BI file refresh/sync automation (treated as an already-delivered static
  input this phase).
- Offline eval harness for judging overall rec quality (candidate direction
  #2 from the original prompt).
- Click/impression tracking for ground truth (#3).
- Further audit of other scorer constants against live data (#4) — two dead
  signals already found/fixed this session (`regionWeightOverride`,
  `sync_popularity_from_bi.py`); this phase does not attempt a fresh sweep.
- `reputation_tier` remains on hold (documented miscalibration, separate
  review).
