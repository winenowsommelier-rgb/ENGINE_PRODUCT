# Recommendation Engine v2 — "You Might Also Like" Expansion

**Date:** 2026-07-08  
**Status:** Draft  
**Scope:** Expand from 4 → 8 recommendation slots; add taste tiebreakers; category-aware scoring; tiered price bands; upsell/downsell intent badges; staff tool compatibility.

---

## 1. Problem

The current "You might also like" section shows 4 products scored by a geo-first rule engine. It has three gaps:

1. **Too few slots** — 4 items limits discovery and leaves upsell/downsell intent unexpressed.
2. **Geo-only for spirits** — region dominates scoring for all categories, but for gin, tequila/mezcal, and rum the relevant signal is style/aging/production method, not geography.
3. **No price intent** — the engine scores similarity only; there is no mechanism to surface a cheaper alternative or a step-up premium product with explicit intent.

---

## 2. Goals

- Expand to 8 recommendation slots per product page.
- Surface up to 3 intent bands: **Similar style**, **Step up**, **Great alternative** (OOS pages only).
- Add category-aware taste tiebreakers so spirits are matched by style, not geography.
- Power the same engine for staff sales use (internal query API, no UI change in Phase 1).
- Ship in two phases: Phase 1 (wine improvements + 8 slots + bands + cross-category suppression) and Phase 2 (spirits-specific fields + category-aware scoring overrides).

---

## 3. Non-Goals

- No AI enrichment — new spirits fields are manually assignable from product names.
- No external co-purchase / BI data integration (that seam already exists as a future hook).
- No staff UI in Phase 1 — staff use the internal API route; a table UI is Phase 3.
- No cross-category recommendations (wine → spirits suppressed regardless of taste score).

---

## 4. Architecture Overview

The engine stays in `apps/catalog/lib/recommender.ts`. No new files for Phase 1. Phase 2 adds `apps/catalog/lib/category-scorer.ts` to keep `recommender.ts` under 500 lines.

```
scoreCandidate()               ← Phase 1: add taste tiebreakers + cross-category guard
isEligible()                   ← Phase 1: add cross-category group suppression
priceBand() / similarRange()   ← Phase 1: NEW utility functions
getRecommendationsWithBands()  ← Phase 1: NEW export (8 slots, band-tagged results)
getRecommendations()           ← signature unchanged; output changes because scoreCandidate changes
precomputeRecommendations()    ← Phase 1: updated return type + MIN_POOL/CAP constants
categoryScoreOverrides()       ← Phase 2: NEW in category-scorer.ts
```

### Callsite audit for `precomputeRecommendations()`

Two consumers exist — both must be updated when the return type changes:

1. **`apps/catalog/app/product/[sku]/page.tsx` lines 62–64** — `getRecsForSku()` wrapper reads the map and returns `string[]`. Must change to return `{ sku: string; band: Band }[]`.
2. **`apps/catalog/lib/__tests__/recommender.test.ts`** — multiple tests read the map directly (lines 50, 82, 109, 138, 154). All assertions against `map.get(sku)` must be updated to the new shape.

No other consumers exist (grep confirmed across all `.ts`/`.tsx` files in `apps/`).

### Note on `getRecommendations()` output change

`getRecommendations()` and `precomputeRecommendations()` both call `scoreCandidate()`, which is being updated. Their **signatures** are unchanged but their **output** will differ for products with taste fields populated — taste tiebreakers may surface different top-N results. Existing tests that pin specific output SKUs must be reviewed and updated to reflect correct v2 behaviour, not preserved to match v1 output.

---

## 5. Scoring Changes (Phase 1)

### 5a. Taste tiebreakers added to `scoreCandidate()`

Current geo signals — **unchanged**:

| Signal | Points |
|---|---|
| Same region | +3 |
| Same subregion | +2 |
| Same variety (with aliases) | +2 |
| Same country | +1 |
| Each shared food pairing | +1 |
| Same category type | +1 |
| Within price band (see §6) | +1 |

New taste tiebreakers — only fire when **both** products have the field populated; absent field contributes 0, never penalises:

| Signal | Points | Condition |
|---|---|---|
| `body` exact match | +1.5 | Always (when populated) |
| `acidity` exact match | +1.5 | Always (when populated) |
| `tannin` exact match | +1.5 | Always (when populated) |
| `sweetness` within 1 band | +0.5 | Only when subject `category_group` is `'Wine'` or `'Liqueur'` |
| `smokiness` within 1 band | +0.5 | Only when subject `category_group` is `'Whisky'` or `'Spirits'` or `'Sake & Asian'` |

**Category group values** come from `groupForProduct()` (imported from `@/lib/category-groups`), which returns a `CategoryGroup` from the canonical set: `'Wine'`, `'Whisky'`, `'Spirits'`, `'Sake & Asian'`, `'Liqueur'`, `'Beer & RTD'`, `'Non-Alcoholic'`, `'Cigars'`, `'Events'`, `'Accessories'`, `'Unknown'`. Conditional signals use this exact set — not `typeForProduct()` strings, not `classification`.

**Rationale for +1.5 (not +1.0):** At +1.0, three taste signals (+3 total) tie but never exceed a single region match (+3). At +1.5, three matching taste signals (+4.5) can surface a cross-region style twin — enabling e.g. a Marlborough Pinot Noir on a Burgundy page when body/acidity/tannin all align. This is the intended cross-region style behaviour.

**Sweetness and smokiness "within 1 band":** Bands are ordered sequences. Adjacent = within 1 step:
- Sweetness: `Dry → Off-Dry → Semi-Sweet → Sweet` (Dry↔Off-Dry scores; Dry↔Sweet does not)
- Smokiness: `None → Light → Medium → Heavy` (adjacent pairs score)

### 5b. Cross-category suppression in `isEligible()`

Add a group-level suppression gate. If subject and candidate belong to **different** `CategoryGroup` values AND neither group is `'Unknown'`, the candidate is ineligible. Same-group recommendations are always allowed (e.g. Gin → Vodka, Red Wine → Rosé).

> **AMENDED 2026-07-22:** "Same-group recommendations are always allowed" is
> superseded for wine color/style. Proven against live data that Red↔White↔
> Rosé↔Sparkling crossovers are NOT desired despite sharing
> `category_group === 'Wine'` — 92/2,439 in-stock Red Wines had a non-red
> item leak into their "you might also like" rail (e.g. a Penfolds Pinot
> Noir recommending a Grosset Riesling), because region/country/price/food
> signals routinely outweighed the +1 `category_type` nudge. `isEligible()`
> now additionally hard-gates the 4 canonical wine colors (Red/White/Rosé/
> Sparkling & Champagne) as mutually exclusive, mirroring the Finder's own
> `CATEGORY_MAP`. Niche wine types (Wine Set, Orange Wine, Sweet/Dessert,
> Fortified) remain ungated. See `project_recommender_wine_color_leak_fix.md`
> memory and `apps/catalog/lib/recommender.ts`'s `WINE_COLOR_TYPES` gate.

```ts
// In isEligible():
const subjectGroup = groupForProduct(product);
const candidateGroup = groupForProduct(candidate);
if (
  subjectGroup !== 'Unknown' &&
  candidateGroup !== 'Unknown' &&
  subjectGroup !== candidateGroup
) return false;
```

**`'Wine product'` (catch-all) mapping:** `groupForProduct()` resolves `Wine product` types via SKU prefix, which correctly maps them to `'Wine'` via the SKU taxonomy. No special case needed — the existing resolver handles it.

**Phase scope:** Cross-category suppression ships in Phase 1. It is safe for spirits in Phase 1 because it only suppresses cross-group results (Wine → Spirits). Within-group spirits matching (Gin → Gin, Rum → Rum) remains unchanged until Phase 2 adds category-aware scoring overrides.

---

## 6. Price Bands (Phase 1)

### `similarRange()` — tiered thresholds

Prices are in THB (catalog: p10=฿670, p25=฿905, p50=฿1,619, p75=฿3,225, p90=฿7,000).

```ts
function similarRange(price: number): { lo: number; hi: number } {
  if (price < 1000)  return { lo: Math.max(0, price - 250), hi: price + 250 };
  if (price < 5000)  return { lo: price * 0.80,             hi: price * 1.20 };
  if (price < 15000) return { lo: price * 0.85,             hi: price * 1.15 };
  return                    { lo: price * 0.90,             hi: price * 1.10 };
}
```

`lo` is clamped to 0 to prevent negative lower bounds for budget products (e.g. ฿200 product → lo = max(0, -50) = 0).

### `priceBand()` — null safety

```ts
type Band = 'similar' | 'step-up' | 'great-alternative';

function priceBand(
  subjectPrice: number | undefined | null,
  candidatePrice: number | undefined | null,
): Band {
  if (
    typeof subjectPrice !== 'number' || subjectPrice <= 0 ||
    typeof candidatePrice !== 'number' || candidatePrice <= 0
  ) return 'similar'; // safe default: no price data → treat as similar
  const { lo, hi } = similarRange(subjectPrice);
  if (candidatePrice >= lo && candidatePrice <= hi) return 'similar';
  if (candidatePrice > hi) return 'step-up';
  return 'great-alternative';
}
```

**Null/zero price fallback:** returns `'similar'` — no band comparison is possible without price, and `'similar'` is the safest default for display (no misleading step-up or great-alternative badge).

### Price similarity point (existing +1 in `scoreCandidate`)

The `+1` for being within the price band now uses `similarRange()` instead of the flat ±40% band.

---

## 7. New Export: `getRecommendationsWithBands()`

```ts
export type Band = 'similar' | 'step-up' | 'great-alternative';

export type RecommendationResult = {
  product: PublicProduct;
  band: Band;
  score: number;
  scoreBreakdown: Record<string, number>; // signal → points contributed
};

export function getRecommendationsWithBands(
  product: PublicProduct,
  all: readonly PublicProduct[],
  opts?: { includeGreatAlternative?: boolean },
): RecommendationResult[]
```

`includeGreatAlternative` defaults to `false`. The product page passes `true` only when `!isInStock(product.is_in_stock)`. The internal staff API always passes `true` (staff want the full picture).

### Slot-fill algorithm

Canonical slot order for 8 positions (same in both 2-band and 3-band cases):

| Slot | Preferred band |
|---|---|
| 1 | `similar` |
| 2 | `step-up` |
| 3 | `similar` |
| 4 | `step-up` |
| 5 | `similar` |
| 6 | `step-up` |
| 7 | `similar` |
| 8 | `step-up` |

On OOS pages (3-band mode), `great-alternative` candidates are inserted into `similar` slots after `similar` band exhausts (i.e. `similar` slots fill from `similar` pool first, then fall back to `great-alternative`). `step-up` slots always fill from the `step-up` pool, falling back to `similar` if exhausted.

**Fewer than 8 candidates:** If fewer than 8 positive-scoring eligible candidates exist after all band pools exhaust, the function returns however many are available (1–7). No zero-score padding. The carousel must handle a short array without crashing.

**Zero candidates:** Returns `[]`. The product page already has a `recs.length > 0` guard — this case is already handled.

### `scoreBreakdown` — single-pass

`scoreCandidate()` is updated to return `{ score: number; breakdown: Record<string, number> }` (or `scoreCandidate` gains a sibling `scoreCandidateDetailed()` to avoid breaking its current callers). `getRecommendationsWithBands()` calls the detailed version and carries `breakdown` through into `RecommendationResult`. The staff API exposes it; the product page UI ignores it. No second pass needed.

### Precompute map type change

```ts
// Before
Map<string, string[]>                          // sku → sku[]

// After
Map<string, { sku: string; band: Band }[]>     // sku → {sku, band}[]
```

`precomputeRecommendations()` calls `getRecommendationsWithBands()` per product and stores `{ sku, band }` pairs. The product page wrapper `getRecsForSku()` returns `{ sku: string; band: Band }[]` instead of `string[]`. Both callsites (page.tsx and recommender.test.ts) must be updated.

### Bucketing constants updated for 8 slots

`MIN_POOL` changes from `MAX_RECS + 1 = 5` to `MAX_RECS_EXTENDED + 1 = 9`.  
`GLOBAL_FALLBACK_CAP` increases from `50` to `100` to ensure niche categories have enough candidates to fill 8 slots after eligibility filtering.

---

## 8. UI Changes (Phase 1)

### Carousel layout

Replace the static grid with a horizontal scroll carousel:
- Desktop: 4 cards visible, scroll reveals remaining
- Mobile: 1.5 cards visible (half-card signals scrollability)
- Continuous scroll, no pagination

### Section header

| Page state | Header text |
|---|---|
| Product in stock | "You might also like" |
| Product out of stock | "Available now — similar style" |

OOS detection: `!isInStock(product.is_in_stock)` — same helper used everywhere else.

### Badge per card

| Band | Standard (in-stock) page | OOS page |
|---|---|---|
| `similar` | "Similar style" | "In stock now" |
| `step-up` | "Step up ↑" | "Step up ↑" |
| `great-alternative` | *(never shown — not in pool)* | "Great alternative" |

Badge is a small pill above the product name. No badge if `band` is absent (defensive).

### Card order rule

Slot 1 is always `similar` (builds trust before any upsell). Slots 2, 4, 6, 8 prefer `step-up`. Slots 3, 5, 7 prefer `similar`. Two `step-up` cards are never adjacent. (See §7 canonical slot table.)

---

## 9. Internal Staff API (Phase 1)

```
GET /api/internal/recommendations?sku=WRW5601AD&limit=8
```

Response includes `scoreBreakdown` — lets staff explain the recommendation to a customer over phone/email:

```json
[
  {
    "sku": "WRW1234AB",
    "name": "...",
    "price": 1890,
    "band": "similar",
    "score": 8.5,
    "scoreBreakdown": {
      "region": 3,
      "variety": 2,
      "body": 1.5,
      "tannin": 1.5,
      "price": 0
    }
  }
]
```

Always passes `includeGreatAlternative: true` — staff want the full picture including cheaper alternatives.

Phase 3 (future): table-view staff UI with margin flag, stock quantity, "why excluded" list.

---

## 10. Phase 2 — Category-Aware Spirits Scoring

Phase 2 adds new DB fields and a category-aware scoring dispatch. No UI changes needed. New fields are manually assignable from product names — no AI cost.

### New DB fields

| Field | Values | Categories | Assignment |
|---|---|---|---|
| `gin_style` | `juniper_forward`, `contemporary_citrus`, `contemporary_floral`, `contemporary_fruit`, `spiced`, `aged_barrel` | Gin | From product name/descriptor |
| `agave_aging` | `blanco`, `reposado`, `anejo`, `extra_anejo` | Tequila, Mezcal | From product name |
| `rum_style` | `white_unaged`, `gold_light`, `dark_aged`, `spiced`, `overproof`, `pot_still_funk` | Rum | From product name/colour |
| `peat_level` | `none`, `light`, `medium`, `heavy` | Whisky | From product name/distillery |
| `production_method` | `traditional_method`, `tank_method`, `ancestral_method` | Sparkling, Champagne, Crémant, Prosecco, Cava | From appellation/producer |

### Category-aware scoring weights (Phase 2)

`categoryScoreOverrides(categoryGroup: CategoryGroup, product: PublicProduct)` returns signal overrides applied **on top of** the base score. Overrides add points; they do not reduce existing geo points (except gin where region is explicitly zeroed).

| Category group | Dominant new signal (+3) | Secondary new signal (+2) | Region weight override |
|---|---|---|---|
| Gin (`'Spirits'`, type=Gin) | `gin_style` match | — | Region → 0 (meaningless for gin) |
| Tequila/Mezcal (`'Spirits'`, type=Tequila or Mezcal) | `agave_aging` match | — | Unchanged |
| Rum (`'Spirits'`, type=Rum) | `rum_style` match | — | Unchanged |
| Whisky (`'Whisky'`) | `peat_level` match | — | Unchanged |
| Sparkling/Champagne (`'Wine'`, type=Champagne/Sparkling) | `production_method` match | — | Unchanged |

**Whisky `peat_level` scores +3** (dominant). The Phase 1 smokiness-within-1-band (+0.5) remains active as a supplementary signal for products without `peat_level` populated.

**Sparkling/Champagne `production_method` scores +3** (dominant). The Phase 1 sweetness-within-1-band (+0.5) remains active as a supplementary signal and is **not** overridden by Phase 2 — both signals coexist.

### `category-scorer.ts` module (Phase 2)

Extracted from `recommender.ts` to keep file size manageable. Exports:
- `categorySignalPoints(product: PublicProduct, candidate: PublicProduct): number` — additional points from category-specific fields
- `regionWeightOverride(product: PublicProduct): number | null` — returns 0 for gin (suppress region), null for all others (use default +3)

`scoreCandidate()` calls both and applies overrides. Existing tests remain green when new fields are absent (overrides return 0 when fields are missing).

---

## 11. Testing

### Phase 1 unit tests (extend `recommender.test.ts`)

All existing tests must be reviewed — `scoreCandidate()` output changes for products with taste fields, so tests that pin specific SKU output may need updating to reflect correct v2 behaviour.

New tests to add:

**Taste tiebreakers:**
- Body match (+1.5) fires when both products have `body` populated
- Body match scores 0 when either product is missing `body` (no null penalty)
- Three taste signals matching (body+acidity+tannin) surfaces a cross-region candidate over a same-region candidate with no taste match (validates +4.5 > +3 intent)
- Sweetness tiebreaker fires for subject with `category_group = 'Wine'`; does NOT fire for subject with `category_group = 'Whisky'`
- Smokiness tiebreaker fires for subject with `category_group = 'Whisky'`; does NOT fire for subject with `category_group = 'Wine'`

**Cross-category suppression:**
- Red Wine subject never returns Whisky candidate (Wine group ≠ Whisky group)
- Red Wine subject returns Rosé candidate (both Wine group)
- Gin subject returns Vodka candidate (both Spirits group)
- Gin subject never returns Red Wine candidate

**`getRecommendationsWithBands()`:**
- Returns max 8 results
- Returns fewer than 8 without padding when fewer eligible candidates exist (e.g. 3-product catalog → returns ≤ 2)
- Returns `[]` when no positive-scoring candidates exist
- Slot 1 is always `band: 'similar'`; slots 2,4,6,8 are `step-up` when available
- No two adjacent `step-up` slots
- `great-alternative` absent when `includeGreatAlternative: false` (default)
- `great-alternative` present when `includeGreatAlternative: true`
- On OOS page with zero `similar` candidates: `step-up` and `great-alternative` fill all slots

**`priceBand()`:**
- `null` subject price → returns `'similar'`
- `0` subject price → returns `'similar'`
- `null` candidate price → returns `'similar'`
- Product at ฿200 (below ฿1,000 tier): lo clamped to 0, not negative
- Product at ฿1,619 → candidate ฿1,900 → `'similar'` (within 20%)
- Product at ฿1,619 → candidate ฿3,500 → `'step-up'`
- Product at ฿1,619 → candidate ฿800 → `'great-alternative'`
- Product at ฿20,000 → candidate ฿18,500 → `'similar'` (within 10%)
- Product at ฿20,000 → candidate ฿17,000 → `'great-alternative'` (>10% cheaper)

**Precompute map shape:**
- Each entry has `{ sku: string; band: Band }` shape (not `string`)
- Map still contains entries for OOS subject products

**`scoreBreakdown`:**
- `scoreBreakdown` values sum to `score`
- `scoreBreakdown` present in `getRecommendationsWithBands()` result

### Phase 1 integration check

For a sample of 20 products from different category groups, assert that `getRecommendationsWithBands()` returns ≥ 1 result with `band: 'similar'` and `score > 0`.

### Phase 2 unit tests (new `category-scorer.test.ts`)

- Gin subject with `gin_style = 'contemporary_citrus'`: same-`gin_style` candidate scores +3; region match scores 0 regardless
- Tequila subject with `agave_aging = 'blanco'`: same-aging candidate scores +3; `'anejo'` candidate scores 0 on aging
- Rum subject with `rum_style = 'spiced'`: same-style candidate scores +3 from category override
- Whisky subject with `peat_level = 'heavy'`: same-peat candidate scores +3; cross-distillery heavy peat match surfaces despite region mismatch
- Sparkling subject with `production_method = 'traditional_method'`: same-method candidate scores +3; `'tank_method'` candidate scores 0 on method
- Phase 2 overrides score 0 when new fields are absent (no null penalty; base scoring still applies)

---

## 12. Implementation Phases

### Phase 1 (ships first)
1. Update `scoreCandidate()` — taste tiebreakers at +1.5, conditional sweetness/smokiness at +0.5, `similarRange()` for price band point
2. Add `priceBand()` / `similarRange()` utilities with null safety
3. Update `isEligible()` — cross-category group suppression via `groupForProduct()`
4. Add `getRecommendationsWithBands()` export with `includeGreatAlternative` option
5. Update `precomputeRecommendations()` — new return type, updated `MIN_POOL=9`, `GLOBAL_FALLBACK_CAP=100`
6. Update `getRecsForSku()` in `page.tsx` — new return type `{ sku, band }[]`
7. Update product page — carousel layout, OOS-aware section header, band-aware badges
8. Add internal API route `/api/internal/recommendations`
9. Update `recommender.test.ts` — review existing tests for output changes; add all Phase 1 tests above

### Phase 2 (ships second)
1. Add DB migration: 5 new columns (`gin_style`, `agave_aging`, `rum_style`, `peat_level`, `production_method`)
2. Add columns to `EXPORT_COLS` allowlist in `refresh_live_export.py`
3. Add to `PublicProduct` type in `types.ts`
4. Write assignment script — iterate spirits SKUs, assign values from product name patterns
5. Run on 10-SKU canary per category; verify in UI before full run
6. Extract `apps/catalog/lib/category-scorer.ts` module
7. Wire `categorySignalPoints()` and `regionWeightOverride()` into `scoreCandidate()`
8. Add `category-scorer.test.ts`

---

## 13. Open Questions (deferred)

- **Vintage signal (wine):** Recommending a poor vintage within the same appellation is a failure mode. No vintage field in the catalog. Deferred to Phase 3 backlog.
- **`Wine product` catch-all (1,509 SKUs):** Low taste coverage (14–28%). SKU taxonomy correctly maps these to the `'Wine'` group so cross-category suppression works correctly, but taste tiebreakers will rarely fire. Taxonomy cleanup (reclassifying into proper wine types) is the fix but is out of scope here.
- **Staff UI table view:** Deferred to Phase 3. Phase 1 API route is sufficient for staff to query.
- **Phase 2 sweetness/production_method interaction:** When Phase 2 activates `production_method` at +3 for Sparkling/Champagne, the Phase 1 sweetness +0.5 remains. Both coexist — no conflict, but the combined scoring for Sparkling should be re-validated in Phase 2 integration testing.
