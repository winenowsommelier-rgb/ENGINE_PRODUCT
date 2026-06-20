# WNLQ9 BI-Powered Recommendations — Design Spec

**Date:** 2026-06-20
**Status:** Draft (design), pending spec review + implementation plan
**Goal:** Lift the catalog from content-based (attribute/taste) recommendations to
**best-in-class hybrid** recommendations by adding real **behavioral** signals
(co-purchase affinities + sales performance) from the WNLQ9 BI Marketing Engine.

**Depends on:**
- The built catalog (`apps/catalog/`) — reuses `recommender.ts` (the `coPurchaseStrategy`
  seam already stubbed at its `FUTURE:` comment), `finder/scoring.ts`, `toPublicProduct`.
- The **BI Marketing Engine** repo `WNLQ9_MKT_ENGINE` and its BI API
  (`https://wnlq9-bi-api.vercel.app`) — auth-gated (`X-API-Key`, 30-day rotation),
  per-SKU endpoints, 24h server cache. We reuse its `biClient` (auth/retry/contract).

---

## 1. Why (the gap this closes)

Today's recommender is purely **content-based** — it matches product *attributes*
(region, grape, body, food, price). That is the correct v1 with no behavioral data, but
it is not best-in-class: it cannot know *what people actually buy together*. Verified:
`popularity_*`, `co_purchase`, ratings, views are **all 0** in the catalog export.

The data we were missing **already exists** in the BI Marketing Engine:
- **`GET /products/{sku}/affinities`** → JSON `{ pairs: [ { sku, lift, co_count }, ... ] }`
  — "customers who bought this SKU also bought these." (NOTE: the `sku_a/sku_b` names are
  SQL *view* aliases in `v_bundle_affinity_pairs`; the API **payload** nests the list under
  `pairs` and inner items use key `sku` + `lift` + `co_count`. Verified against
  `migrations/003_semantic_views.sql` `json_extract(payload,'$.pairs')` + `'$.sku'`.)
- **`GET /products/{sku}/performance`** → monthly rows of `{ month_start, sales_thb,
  qty_ordered, ... }` (NOT a single "velocity" scalar). The fetch script DERIVES a velocity
  measure from these — see §3/§6.

This spec wires those into BOTH recommendation surfaces (product rail + finder) as a
**behavioral-first, content-fallback hybrid** — the Amazon "customers also bought" pattern.

---

## 2. Architecture & data flow (build-time bake, SSG-native)

The catalog stays pure SSG. BI data is **baked at build time** into a committed artifact;
the catalog never holds the BI key and makes zero runtime API calls.

```
WHERE THE KEY LIVES — never the catalog / Vercel
  scripts/fetch_bi_signals.*  ── reads BI_API_KEY from LOCAL env ──┐
     │  reuses WNLQ9_MKT_ENGINE biClient (auth / retry / contract)  │
     │  for each sellable SKU: GET /affinities  + GET /performance   │
     ▼                                                              │
  data/bi_signals.json   ◄── committed to git (Rule 9 flow) ────────┘
     │   {
     │     "generated_at": "...",
     │     "affinities":  { "<sku>": [ {sku, lift, co_count}, ... ] },
     │     "performance": { "<sku>": { velocity } }
     │   }
     ▼
  apps/catalog/lib/bi-signals.ts   (build-time loader + support-floor filter)
     ├──► lib/recommender.ts        (coPurchaseStrategy seam) → product rail
     └──► lib/finder/scoring.ts     (performance booster)      → finder results
```

**Properties**
- **No secret in catalog/Vercel.** The fetch script runs where the BI key already lives
  (the env that holds `BI_API_KEY`); the catalog only reads a committed JSON, exactly like
  `live_products_export.json`. The key is read via `process.env.BI_API_KEY`, never logged,
  never committed.
- **One shared BI layer, two consumers** — no duplicated logic.
- **SSG-native** — no runtime API calls, no cold-start risk (respects the catalog's
  deliberate SSG decision). BI data is as fresh as the last rebuild — fine for co-purchase
  (slow-moving).
- **Reuse over rebuild (Rule 11):** the fetch script borrows `MKT_ENGINE`'s `biClient`
  rather than re-implementing auth/retry/the affinities contract.
- **Refresh model (Q3 = manual, Rule 9):** run `fetch_bi_signals` alongside the existing
  `refresh_live_export.py` → commit `bi_signals.json` → push → Vercel rebuilds. No new
  infra or secret locations. (A scheduled job is a clean later upgrade with no catalog
  code change — just automate the script.)

---

## 3. The shared BI layer — `apps/catalog/lib/bi-signals.ts`

Small, pure, unit-testable. Loads `data/bi_signals.json` once and exposes accessors with
the noise guard built in.

```ts
interface Affinity { sku: string; lift: number; co_count: number; }

// SUPPORT FLOOR (Q5). A co-purchase seen only once has misleading lift. Require
// enough real co-occurrences before a pair can be recommended. MIN_CO_COUNT is a
// TUNABLE calibrated against the real co_count distribution once BI access exists —
// flagged as such (Rule 3), NOT a blind constant. Start ~3; adjust after a data peek.
const MIN_CO_COUNT = 3;

/** Affinities for a SKU clearing the support floor, ranked by lift desc. [] when the
 *  SKU has no BI data or nothing clears the floor → caller falls back to content (§4). */
export function getAffinities(sku: string): Affinity[];

/** Sales-velocity signal for a SKU, or undefined. `velocity` is a DERIVED scalar the
 *  fetch script computes from the monthly /performance rows (§6) — there is NO velocity
 *  field in the BI API. Definition: velocity = trailing_12m_qty = SUM(qty_ordered) over
 *  the last 12 months (mirrors v_product_catalog_enriched.trailing_12m_qty). Finder
 *  booster only (§5). */
export function getPerformance(sku: string): { velocity: number } | undefined;

/** True if the BI artifact loaded at all. Lets callers no-op cleanly when absent. */
export function hasBiData(): boolean;
```

**Two non-negotiables**
1. **Support floor:** `getAffinities` filters `co_count >= MIN_CO_COUNT` *before* ranking
   by `lift`. A single fluke co-purchase can never reach a rail.
2. **Graceful absence:** missing artifact / missing SKU / malformed row → empty/undefined.
   **BI is purely additive — its absence never breaks a build or a page.** The catalog
   behaves exactly as today with no `bi_signals.json` present.

---

## 4. Product-rail integration — behavioral-first + content fallback

**The rail is served by `precomputeRecommendations`, NOT `getRecommendations`.** Verified:
`app/product/[sku]/page.tsx` consumes `precomputeRecommendations` → `Map<string, string[]>`
(sku → up-to-4 rec skus). `getRecommendations` is exported but **not called by any page**.
So the function that must learn BI is `precomputeRecommendations`; `getRecommendations`
(the exact, full-pool ranker) gets the same behavioral-first logic for consistency and its
own unit tests, but wiring BI ONLY into it would ship zero UI change. Both are updated; the
rail's behavior comes from `precomputeRecommendations`.

```
For each subject product (build-time, all ~11,436 — in-stock AND out-of-stock subjects):
  bi = getAffinities(product.sku)                     // floor-filtered, lift-ranked (§3)
  lead = resolve bi skus → PublicProduct (getProductBySku); apply existing isEligible
         (in-stock candidate, not self, dedupe); keep lift order
  if lead.length > 0:
     source = 'behavioral'
     if lead.length < MAX_RECS(4):
        fill remaining from the existing rule-based ranking (excluding already-picked)
  else:
     lead   = today's rule-based ranking
     source = 'content'
  store recsBySku[sku] = lead.map(sku)   AND   sourceBySku[sku] = source
```

**Carrying the source label (resolves the signature contradiction).** A `Map<string,
string[]>` cannot carry the behavioral|content channel. Two acceptable options — the plan
picks one; the spec mandates that the choice is explicit, not a silent signature break:
- **(Recommended) parallel map:** `precomputeRecommendations` returns
  `{ recs: Map<sku, sku[]>, source: Map<sku, 'behavioral'|'content'> }`. Update the one
  caller (`product/[sku]/page.tsx`) to read both. Smallest blast radius; keeps rec values
  as lightweight sku arrays.
- **OR richer value:** `Map<sku, { skus: string[]; source: 'behavioral'|'content' }>`.
  Also fine; same one-caller update.
Either way the public *names* stay (`precomputeRecommendations`), but its RETURN TYPE
changes by design — and the single caller is updated in the same task. `getRecommendations`
similarly returns `{ products, source }` (or keeps `PublicProduct[]` plus a sibling
`getRecommendationSource(product, all)` — plan's call).

- **Same eligibility for BI candidates:** affinity skus are resolved via `getProductBySku`
  and run through the existing `isEligible` (in-stock, not self). A co-purchased bottle now
  out of stock is skipped; slots backfill from content. BI candidates are NOT assumed to be
  in any pre-built in-stock bucket — they are resolved + checked explicitly.
- **Honest labels per source (Q4):** UI shows "Customers also bought" only when
  `source==='behavioral'`; "You might also like" for content. Never imply purchase data we
  don't have.
- Performance: affinity lookups are O(1) map reads from the baked artifact — no per-page
  API calls; the build stays fast.

---

## 5. Finder integration — performance as a booster (not a tier that dominates)

In `finder/scoring.ts`, add ONE behavioral term to the existing tiered score. It is a
**tie-breaker/booster**, intentionally weaker than the taste tiers, so the user's stated
preference still leads.

**CRITICAL — the booster MUST NOT feed the `degraded` computation.** Current
`scoring.ts`: `degraded = ranked.length > 0 && wellMatched === 0`, where
`wellMatched = ranked.filter(r => r.s >= QUALITY_MIN).length`. If the booster were added to
the same `s` used there, a +0..+2 velocity bump could push a row from `s=1` (below
QUALITY_MIN=2) to `s≥2`, flipping an honest "Closest matches" (degraded) pool to "Your
matches" — a real correctness regression. So scoring keeps TWO numbers per product:

```
tasteScore   = TIER1 + TIER2 + TIER3                 // exactly today's score
biBump       = hasBiData() ? normalize(getPerformance(sku)?.velocity) : 0   // +0..~2
rankScore    = tasteScore + biBump                   // used ONLY for sort order
degraded     = computed from tasteScore (wellMatched = count of tasteScore >= QUALITY_MIN)
```

- **`degraded` is computed from `tasteScore`, NOT `rankScore`** — the booster only re-orders
  within the matched set, it can never change whether the pool is honestly "degraded."
- Preference leads: "bold Scotch" → bold Scotch ranks first; among **equally good taste
  matches**, proven sellers rise. That is the best-in-class nuance.
- Absent BI data → `biBump = 0` → finder ranking AND `degraded` are byte-for-byte today.
- The `normalize` mapping is a tunable (Rule 3), calibrated on the real velocity
  distribution; documented, not hardcoded blindly.

---

## 6. The fetch script — `scripts/fetch_bi_signals.*`

- Reuses `WNLQ9_MKT_ENGINE`'s `biClient` (auth/retry/contract). Reads `BI_API_KEY` from
  local env; **never logs or commits the key.** `biClient.getSkuDetail` returns `unknown` —
  the script OWNS parsing/validating each payload (the BI repo models no response schema).
- Iterates sellable SKUs (the catalog's own SKU list / export), calls `/affinities` +
  `/performance`, writes `data/bi_signals.json`. Exact mapping (verified payload shapes):
  - **affinities:** read `payload.pairs` (array); for each item keep `{ sku, lift, co_count }`
    (inner key is `sku`, NOT `sku_b`); store as `affinities[subjectSku] = [...]`. Drop items
    with non-numeric `lift`/`co_count`. (Support-floor filtering happens at READ time in
    `bi-signals.ts`, not here — keep the artifact raw so the floor is tunable without a re-fetch.)
  - **performance:** the payload is monthly rows (`{month_start, sales_thb, qty_ordered}`).
    Derive `velocity = SUM(qty_ordered)` over the trailing 12 months (drop rows older than
    12 months). Store `performance[sku] = { velocity }`. (Matches
    `v_product_catalog_enriched.trailing_12m_qty`.) If a SKU has no perf rows → omit it.
- **Fail-safe (Rule 1 + Rule 2):** on BI API failure it does NOT overwrite a good
  `bi_signals.json` with partial/garbage data — fail loud, keep last-good. Prints a
  **coverage summary** ("affinities for N/total SKUs, performance for M/total") so we
  VERIFY the real data actually landed in the artifact, not just that calls ran.
- Respects the BI API's 24h cache / rate behavior (the client already handles retry).
- Lives at repo root `scripts/` (Python or Node — implementer's call at plan time; Node
  reuses `biClient` directly, Python would re-call the HTTP contract). **Recommendation:
  Node, to reuse `biClient` verbatim.**

---

## 7. Error handling

- Catalog build with NO `bi_signals.json` → every accessor no-ops → identical to today.
- Malformed artifact / missing SKU / non-numeric lift|co_count → skipped defensively.
- BI candidate out of stock at build → excluded, slot backfills from content.
- A SKU with affinities but none clearing the support floor → treated as no-BI → content.

---

## 8. Testing (per project rules)

- **Unit — `bi-signals.ts`:** support floor excludes `co_count < MIN_CO_COUNT`; survivors
  ranked by `lift` desc; missing artifact/SKU → empty/undefined; `hasBiData` correct.
- **Unit — `recommender.ts`:** behavioral-first when affinities present; fills from content
  to MAX_RECS; OOS affinity candidate skipped + backfilled; absent BI → byte-for-byte
  today's ranking; correct source label returned.
- **Unit — `finder/scoring.ts`:** velocity booster orders within an equal-taste set;
  contributes 0 when BI absent; **`degraded` computed from `tasteScore` is identical with and
  without the booster** (regression guard: a high-velocity row with `tasteScore=1` must NOT
  flip a degraded pool to non-degraded — the exact bug the two-score split prevents).
- **Data invariant (Rule 6):** every recommended product still passes `toPublicProduct` —
  **no margin/B2B/internal field ever leaks** via the BI path (BI signals are sku+lift+
  co_count+velocity only; product objects still come from the allowlist projection).
- **Fetch script:** coverage-summary assertion; fail-safe keeps last-good on API error.
- **Browser (Rule 7):** a SKU with known affinities shows "Customers also bought"; one
  without shows "You might also like"; finder still returns all 7 categories; live
  margin-leak grep = 0 on rail + finder result.

---

## 9. Calibration (needs BI access — one-time, before/at implementation)

Two numbers are deliberately left as **tunables calibrated on real data** (Rule 3), not
guessed:
1. `MIN_CO_COUNT` (support floor) — from the real `co_count` distribution.
2. The finder velocity-booster normalization — from the real velocity distribution.
A short read-only data peek (`/affinities` for a sample of top SKUs, `/performance`
distribution) sets both. Until BI access is provided, the spec/plan proceed against the
known API contract; these two constants are finalized at the calibration step.

---

## 10. Out of scope / later
- Personalization per user (no accounts yet) — affinities are per-product, not per-user.
- Real-time/runtime BI calls (deliberately deferred — SSG bake instead).
- A learning feedback loop (log finder→click→buy, tune weights) — the natural NEXT step
  after behavioral data is in; needs event logging + a store. Biggest follow-on lever.
- RFM/segment-aware ranking, GA4/GSC demand signals — available in BI, not used here yet.
```
