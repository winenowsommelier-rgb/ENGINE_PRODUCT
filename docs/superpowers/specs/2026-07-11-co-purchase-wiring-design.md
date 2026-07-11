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
2. **Use `co_order_affinities` only — do not blend in `co_customer_affinities`.**
   Reversed from an earlier max-blend decision after two independent expert
   reviews (recommender-systems + e-commerce merchandising lens) converged
   unprompted on the same objection: `co_order_affinities` (bought in the
   *same order*) is genuine basket complementarity — the actual claim a
   "recommended together" widget makes. `co_customer_affinities` (bought by
   the *same customer* over an unbounded time window) is a loyalty/repeat-
   purchase signal, explicitly "not necessarily complementary" per this
   spec's own investigation notes above — a customer who separately restocks
   an unrelated wine and an unrelated spirit every few months will show a
   high `co_customer` affinity between them with zero cross-sell logic behind
   it. Taking `max()` across both lists meant the noisier, non-complementary
   signal could silently win a pair's bonus whenever it happened to report a
   higher rate — and since `co_customer_affinities` has 100% subject coverage
   vs. `co_order_affinities`' partial coverage (158/5,439 subjects have zero
   entries), it would disproportionately win on exactly the SKUs where the
   real complementary signal is thin. `co_customer_affinities` is left
   entirely unused by this phase — a candidate future feature (loyalty/
   reorder nudge), not part of "recommended together." This also simplifies
   the damping design (see below): with one list, there's no "whichever list
   produced the max" ambiguity to reason about.
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
6. **Dampen the bonus by `co_order_affinities` list length as a support
   proxy.** A spec-review pass found `rate` carries no volume/support
   backing — the BI export has no `count`/`n_orders` field, so a product
   bought together with another SKU in its one and only recorded order reads
   as `rate = 1.0`, identical to a pair with hundreds of corroborating
   orders. Verified empirically: 1,264/5,439 subjects (23.2%) hit
   `rate = 1.0` at `co_order_affinities` rank 1, and those subjects have
   materially shorter `co_order_affinities` lists on average (4.63 entries)
   than subjects whose rank-1 rate is <1.0 (8.77 entries) — list length is a
   real, if imperfect, proxy for "how much order history backs this
   subject's co-purchase affinities." Flagged by the recommender-systems
   review as a proxy for a proxy (list length approximates order volume, not
   support for a *specific pair*) — the principled fix is a real
   `n_orders`/support count from BI, which the export doesn't currently
   carry. Documented here as a stopgap, not a permanent design: see the
   `TODO` in the code sketch below. `SUPPORT_FULL_AT = 5` is chosen to
   roughly match the observed 4.63-vs-8.77 gap, not derived from a
   calibrated confidence model — named honestly as such in the code comment
   so a future engineer doesn't treat it as more rigorous than it is. The
   bonus formula (below) multiplies by this damping factor so thin-data
   subjects can't reach the full +5 ceiling on a single coincidental order.
7. **Add cheap sanity/diff checks before wiring at full scale**, per both
   expert reviews: (a) a manual spot-check of the top candidates by raw
   `co_order` breadth (how many subjects list a given SKU as a co-order
   partner) to confirm the signal is driven by genuine cross-sell activity
   and not a handful of generic low-value accessories dominating via sheer
   co-occurrence volume; (b) a before/after top-4 diff for a sample of
   high-traffic SKUs, so a human looks at whether the new recommendations
   are plausible before this ships to every product page. Both are one-time
   manual checks run during implementation, not new runtime code — see
   Testing plan below. This is *not* the deferred eval harness (candidate
   direction #2) — it's a 30-60 minute gut check proportional to the size of
   this change, not a measurement system.
   - **Spot-check already run once against the current export** (2026-07-11,
     ad hoc, to unblock this decision — the implementation should still
     re-run it formally as part of the plan): the top 15 SKUs by co-order
     breadth are well-known, high-turnover retail SKUs (e.g. Robert Mondavi
     Private Selection Cabernet, Whispering Angel Rosé, Bombay Sapphire Gin,
     Aperol, Baileys, Hendrick's) — not generic low-value accessories. Two
     breadth-leading codes (`ABA0859`, `ABA0860`) had blank product names in
     the BI export and turned out to not map to any live SKU at all (already
     covered by the unmapped-code skip in decision #5) — a non-issue, but
     worth the implementer re-confirming this hasn't changed if the BI file
     is re-exported before this ships.

## Design

### New module: `apps/catalog/lib/co-purchase.ts`

Kept separate from `recommender.ts` (currently 577 lines) so BI-data parsing
and SKU mapping is independently testable and doesn't grow the scorer file.

```ts
// Loaded once at module init, same pattern as other static JSON in catalog-data.ts
type AffinityEntry = { rank: number; base_product_code: string; product_name: string; rate: number };
// Only co_order_affinities is read by this module — co_customer_affinities is
// parsed as part of the file's shape but deliberately unused (decision #2).
type AffinityRecord = { co_order_affinities: AffinityEntry[]; co_customer_affinities: AffinityEntry[] };

// base_product_code (BI) -> live sku[] (0, 1, or rarely 2 entries).
// `all` = the full product pool (in-stock AND out-of-stock), matching the
// existing `all` parameter convention on precomputeRecommendations/
// getRecommendations — stock filtering is NOT this function's job, it
// happens later via isEligible, same as every other candidate-pool step in
// this file.
export function buildBaseSkuMap(all: readonly PublicProduct[]): Map<string, string[]>;

// live sku -> base_product_code, derived via ^([A-Z]{3}\d{4}) prefix match
function baseCodeOf(sku: string): string;

/**
 * Bonus points for candidate given subject, scaled from BI co_order rate and
 * damped by how much order history backs the subject's co_order list (see
 * DAMPING below). Returns 0 if no co_order data for subject, or candidate
 * isn't a listed co_order target.
 * K=5 -> ceiling bonus +5, only reachable at rate=1.0 AND full support.
 * Typical well-supported rank-1 real pair ~= +2 (rate~0.39-0.49 median, undamped).
 */
export function getCoPurchaseBonus(
  subjectSku: string,
  candidateSku: string,
  baseSkuMap: Map<string, string[]>,
): number;
```

`getCoPurchaseBonus` resolves `subjectSku` to its base code, looks up
**`co_order_affinities` only** for that base code, resolves each entry's
`base_product_code` to live SKU(s) via `baseSkuMap`, and if `candidateSku` is
among them, computes `rate * K * damping`. `K = 5`. `co_customer_affinities`
is not consulted anywhere in this function (decision #2) — no blend, no
fallback to it when `co_order` is empty. A subject with zero `co_order`
entries (158/5,439) simply gets 0 co-purchase bonus for all candidates and
falls back to pure rule-based scoring, same as a subject with no BI record at
all.

**DAMPING (support-proxy fix from spec review; stopgap, see decision #6):**
the BI export has no order-count/support field, so `rate` alone can't
distinguish "100% of 200 orders" from "100% of 1 order." `co_order_affinities`
list length is the only available proxy for how much order history backs a
subject's co-purchase affinities — empirically, subjects whose rank-1
`co_order` rate is 1.0 average 4.63 total entries vs. 8.77 for subjects whose
rank-1 rate is <1.0. Damping factor:

```ts
// SUPPORT_FULL_AT is curve-fit to the observed 4.63-vs-8.77 gap in
// exploratory stats, not a calibrated confidence threshold — see decision
// #6. TODO: replace with a real order-count-based Wilson/Bayesian shrinkage
// once/if the BI export adds a support (n_orders) field per pair.
const SUPPORT_FULL_AT = 5; // list length at which damping saturates to 1.0
function supportDamping(listLength: number): number {
  return Math.min(1, listLength / SUPPORT_FULL_AT);
}
```

Applied using the subject's `co_order_affinities` list length (the only list
in play now that `co_customer_affinities` is unused) — a subject with a
2-entry `co_order` list gets `damping = 0.4` even at `rate = 1.0`, while a
subject with an 8-entry list gets full weight (`damping = 1.0`, capped).
Dropping the `co_customer` blend removes the "whichever list produced the
max" ambiguity the prior version of this design had — damping now always
refers to one unambiguous list.

### `recommender.ts` changes

**Correction from spec re-review: this is NOT a one-line change.** The
scoring line itself is one new line in `scoreCandidateDetailed`, following the
existing pattern of every other signal in that function:

```ts
const coPurchasePts = getCoPurchaseBonus(product.sku, candidate.sku, baseSkuMap);
if (coPurchasePts > 0) add('co_purchase', coPurchasePts);
```

...but `baseSkuMap` does not exist in `scoreCandidateDetailed`'s scope today
and has to be threaded down to it, same as `productFoods` already is. Verified
against the real call chains in `recommender.ts`:

- `getRecommendations(product, all)` → `rankAgainst(product, candidates,
  productFoods)` → `scoreCandidate(product, c, productFoods)` →
  `scoreCandidateDetailed(...)`.
- `precomputeRecommendations(all)` → `getRecommendationsWithBands(product,
  pool, opts)` → `scoreCandidateDetailed(...)` directly.

`baseSkuMap` needs a new parameter threaded through **every function in both
chains**: `scoreCandidateDetailed`, `scoreCandidate`, `rankAgainst`,
`getRecommendations`, `getRecommendationsWithBands`, and built once inside
`precomputeRecommendations` (same place `inStock`/the region/type/country
buckets are already built once) rather than per-subject or per-candidate —
same performance discipline as the existing `productFoods` pre-split, just
touching more call sites than a single new line implies. This is a mechanical,
low-risk threading change (an added parameter, not a behavior change to any
existing function), but the implementation plan should size it as touching
~6 functions across the file, not 1.

No changes to bucketing logic in `precomputeRecommendations`, or to the
FUTURE/BI-SWAP-SEAM docblocks beyond marking the seam as now-implemented
(docblock update, not a code path change).

### Error handling: missing/malformed BI file

`catalog-data.ts`'s loader for `live_products_export.json` fails the build
loudly if that file is missing or unparseable — an established, deliberate
pattern (the main product export is load-bearing; a broken build is
preferable to silently serving stale/empty data). `bi-product-affinities.json`
does **not** get the same treatment: it is an optional enrichment signal, not
core catalog data. If the file is missing or fails to parse at module init,
`co-purchase.ts` catches it, logs a single build-time warning (not per-request
— this is a one-time module-init event, not the per-candidate skip case
covered by the coverage guard), and `getCoPurchaseBonus` returns 0
unconditionally thereafter. The scorer degrades to exactly today's
rule-based-only behavior rather than failing the entire static build over an
optional signal.

### Placement in the score hierarchy

Region (+3) still dominates. Co-purchase max (+5) can now exceed region alone
— intentional: two products genuinely bought *in the same order* repeatedly
is stronger evidence than "happens to share a region." A real bought-together
pair that *also* shares region/variety will simply score very high, which is
correct. Sits above the popularity tiebreaker (+1) — shared same-order
purchase behavior between two *specific* products is stronger evidence than
both merely being popular in general.

**Known risk, not mitigated in this phase (from the recommender-systems
review):** co-purchase data is downstream of past merchandising and past
recommendations — if pair (A, B) gets recommended together, some resulting
purchases feed back into the next BI export, inflating (A, B)'s `co_order`
rate for the next cycle. This is a standard self-reinforcing feedback loop
with no built-in decay or exploration mechanism. The blast radius is bounded
here (co-purchase only ever *adds* points on top of stable attribute signals,
never overrides them), so this is not a blocker, but worth watching across
successive BI exports — if the same small set of pairs keeps gaining bonus
points release over release, that is this loop in action, not a sign of a
"real" strengthening affinity.

### Testing plan

- `co-purchase.test.ts`:
  - `baseCodeOf` / `buildBaseSkuMap`: suffix stripping, fan-out to 2 SKUs,
    codes with no live match excluded from the map.
  - `getCoPurchaseBonus`: correct `rate * K * damping` scaling from
    `co_order_affinities`, 0 when subject has no `co_order` data, 0 when
    candidate isn't a listed `co_order` target, and — as a regression guard
    against reintroducing the dropped blend — 0 (not a bonus) when a
    candidate appears ONLY in a subject's `co_customer_affinities` and not in
    `co_order_affinities`.
  - **Damping**: a short list (length 1-2) at rate=1.0 produces a bonus well
    below the +5 ceiling; a list at/above `SUPPORT_FULL_AT` (5) reaches full
    `rate * K`; damping never produces a negative or >K result.
  - **Missing/malformed file**: module init with a missing or unparseable BI
    file logs once and does not throw; `getCoPurchaseBonus` returns 0 for any
    input afterward (scorer degrades to today's behavior, doesn't fail the
    build).
  - **Coverage regression guard**: load the real
    `data/bi-product-affinities.json`, build the real base-SKU map against
    the real live export, assert mapped-coverage ratio > 0.90. Note:
    `buildBaseSkuMap` maps BASE CODES to live SKUs from the live catalog
    export via regex — this mapping is a property of SKU string formats
    only, not of which BI list (`co_order` vs `co_customer`) a code came
    from, so there is one base-SKU map, not a `co_order`-specific one.
    (Confirmed by spec re-review: subject-key-level coverage is 96.25%
    regardless of list; if measured at entry-level instead, `co_order`
    entries individually map at ~96.0% and `co_customer` entries at ~89.9% —
    a different, not-currently-used number. The 0.90 threshold applies to
    the one real base-SKU map this module builds.)
- `recommender.test.ts` addition: one integration case asserting a known real
  `co_order` BI-affinity pair (sampled from the live JSON, not synthetic)
  ranks above an otherwise-equivalent candidate with no co-purchase signal.
- **Rule 1/6/9 verification**: after wiring, run `precomputeRecommendations`
  over the real live export and inspect the output map for a handful of
  sampled real BI pairs to confirm the bonus is reflected in final
  scores/ordering — not just that the loader parses the JSON correctly.
- **Sanity check — signal composition (decision #7a)**: query the real BI
  file for the top 15-20 SKUs by `co_order` breadth (how many subjects list
  it as a co-order partner) and manually confirm they read as genuine
  cross-sell activity (well-known, high-turnover products), not a handful of
  low-value generic accessories dominating via sheer co-occurrence volume.
  Record the result in the PR/implementation notes, not just run silently.
- **Sanity check — before/after diff (decision #7b)**: for a sample of
  ~50-100 high-traffic (high `popularity_tier`) SKUs, generate the top-4
  recommendations before and after this change and manually review the diff
  for plausibility — does the new #1 rec make sense, does co-purchase change
  the top-4 for a reasonable fraction of sampled products (not near-zero,
  not near-100%)? Not an automated test — a one-time manual review during
  implementation, reported in the PR description.

## Out of scope (explicitly deferred, not silently dropped)

- BI file refresh/sync automation (treated as an already-delivered static
  input this phase).
- Offline eval harness for judging overall rec quality (candidate direction
  #2 from the original prompt). The two sanity checks in decision #7 are a
  cheap substitute proportional to this change's size, not a replacement for
  a real harness.
- Click/impression tracking for ground truth (#3).
- Further audit of other scorer constants against live data (#4) — two dead
  signals already found/fixed this session (`regionWeightOverride`,
  `sync_popularity_from_bi.py`); this phase does not attempt a fresh sweep.
- `reputation_tier` remains on hold (documented miscalibration, separate
  review).
- `co_customer_affinities` as a feature (loyalty/reorder nudge) — explicitly
  a candidate for a future, separate feature, not part of this phase (see
  decision #2). Not deleted or ignored as a data source, just unused here.
- **Merchandiser control levers** (from the e-commerce merchandising expert
  review): an explicit stock-status gate specific to the co-purchase bonus
  (beyond whatever stock filtering `isEligible`/candidate selection already
  applies upstream — the implementer should confirm this is already covered
  rather than assume it), a manual denylist/override escape hatch for a
  merchandiser to suppress an individual awkward pairing, and splitting
  "recommended together" into visually distinct attribute-based vs.
  behavioral-based UI sections (the common e-commerce pattern) instead of one
  blended ranked list. None of these are built in this phase — the additive
  blended-score approach (decision #3) is treated as a reasonable v1, but
  should be understood as provisional, not final, and revisited if the
  before/after sanity check (#7b) or post-launch signal suggests a need for
  merchandiser-level control.
