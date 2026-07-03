# Reputation Signals — Design Spec
**Date:** 2026-07-03  
**Status:** Draft  
**Scope:** Per-SKU multi-axis reputation model for substitution logic and marketing copy

---

## Problem

We have 6,388 active SKUs with no structured way to express how prestigious, acclaimed, or
authoritative each product is. This creates two gaps:

1. **Substitution** — when a product is out of stock, we have no principled way to find a
   comparable replacement at the same market positioning level.
2. **Marketing copy** — we cannot automatically benchmark or describe a product's standing
   (e.g. "award-winning Premier Cru", "cult producer", "popular everyday bottle").

---

## Goals

- Define a per-SKU **reputation tier** (`iconic` / `premium` / `established` / `everyday` /
  `unrated`) usable in substitution queries and UI merchandising.
- Store a **multi-axis breakdown** (acclaim, prestige, popularity, producer) so each tier
  decision is explainable and overridable.
- Generate a **reputation summary** sentence per SKU for marketing copy — no LLM required in v1.
- Keep the computation entirely **free** (no paid API calls) — derived from data already in DB.

---

## Out of Scope (v1)

- LLM-generated reputation copy (v2)
- Real-time re-scoring on critic score ingest (v2)
- B2B-specific trade press signals (v2)
- A dedicated `brands` table / brand-level reputation UI (v2)

---

## Data Model

### New table: `reputation_signals`

One row per SKU per axis. Upserted on each compute run.

```sql
CREATE TABLE IF NOT EXISTS reputation_signals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL,
  axis         TEXT NOT NULL,       -- acclaim | prestige | popularity | producer
  score        REAL NOT NULL,       -- 0–100 normalized
  confidence   REAL NOT NULL,       -- 0.0–1.0
  method       TEXT NOT NULL,       -- description of computation method used
  source_note  TEXT,                -- human-readable "why" for marketing copy
  computed_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sku, axis) ON CONFLICT REPLACE
);
CREATE INDEX IF NOT EXISTS idx_rep_sig_sku ON reputation_signals(sku);
-- Note: ON CONFLICT REPLACE deletes + re-inserts, so `id` increments on every re-run.
-- No FK references to reputation_signals.id exist, so this is safe. Do not rely on id
-- stability across runs. If needed in future, switch to INSERT OR REPLACE with explicit UPDATE.
```

### New columns on `products`

```sql
ALTER TABLE products ADD COLUMN reputation_tier       TEXT;
-- iconic | premium | established | everyday | unrated

ALTER TABLE products ADD COLUMN reputation_composite  REAL;
-- 0–100 weighted rollup of all four axes

ALTER TABLE products ADD COLUMN reputation_confidence REAL;
-- 0.0–1.0 weighted average of per-axis confidences

ALTER TABLE products ADD COLUMN reputation_summary    TEXT;
-- one-sentence marketing copy, template-generated

ALTER TABLE products ADD COLUMN reputation_override   TEXT;
-- if set, bypasses computed tier; same pattern as taste_profile_override
-- Implementation must validate against enum {'iconic','premium','established','everyday','unrated'}
-- before writing to reputation_tier; log a WARNING and ignore invalid values rather than
-- writing a typo (e.g. 'icnoic') into the tier column.

ALTER TABLE products ADD COLUMN reputation_computed_at TEXT;
```

---

## Four Axes

### Axis 1 — Acclaim (35% of composite)

**Source:** `critic_scores` table  
**Method:** Percentile rank within critic (not raw score) to correct for score inflation
(current data: 1,049 of 3,205 score rows are ≥95 (33%); 541 of 1,641 scored SKUs have at
least one score ≥95). Steps:

1. Filter to `WHERE sku IS NOT NULL` — scraper writes NULL-sku rows for unmatched products;
   include only SKU-bound rows in percentile computation so the rank reflects matched inventory.
2. **Aggregate per (sku, critic) pair first** — take `MAX(score)` where a critic has scored
   the same SKU more than once (17 such pairs exist, e.g. different vintages). This prevents
   a critic scoring a SKU twice from being double-weighted in step 4.
3. For each critic, rank all their (sku, critic) aggregated scores as a percentile (0–100).
4. **v1 treats all rows as equal weight — do NOT filter or branch on `signal_tier`.**
   All 3,205 current rows have `signal_tier = 1`; a tier filter would be a silent no-op now
   but could drop rows if tier-2 data arrives before v2 ships. Tier weighting deferred to v2.
5. Average the percentile scores across critics for the SKU.
6. Multiply by 100 → acclaim score 0–100.

**Confidence:** `min(1.0, num_critics / 3)` — saturates at 3 distinct critics per SKU.  
**No scores:** score = NULL, confidence = 0.  
**Source note example:** *"Rated 96/100 by Wine Spectator (top 14% of their reviews)."*
(Percentile is computed from actual data at runtime — the template inserts the real value.)

---

### Axis 2 — Prestige (35% of composite)

**Source:** `designation`, `appellation`, `price` (THB)  
**Method:** Rule-based additive lookup, capped at 100.

**Designation base scores:**

| Designation | Base score | Notes |
|---|---|---|
| Grand Cru | 95 | Legally protected quality classification |
| Premier Cru | 88 | |
| 1er Cru | 88 | Alias for Premier Cru (0 rows in DB today; included for forward-compat) |
| Gran Reserva (Spain/Argentina still wine) | 82 | Legally regulated ageing — Rioja, Ribera del Duero, Mendoza; excludes Cava (see below) |
| Cru Classé | 82 | 1855 Bordeaux classification; equal to Rioja GR, arguably above |
| Gran Reserva (spirits / New World wine / Cava) | 75 | Marketing or lighter legal term; above Reserva but below regulated tier |
| Reserva Especial / Reserva Privada | 74 | Producer-defined premium above Reserva; 0 rows in DB today, included for forward-compat |
| Reserva | 70 | |
| XO | 75 | Legally min 10yr cognac (BNIC 2018) |
| Single Malt | 68 | Price bonus carries remaining differentiation |
| VSOP | 62 | Legally min 4yr cognac |
| Blanc de Blancs | 60 | Specialist Champagne category (all-Chardonnay); 0 rows today |
| Blanc de Noirs | 58 | Specialist Champagne category (all-Pinot); 0 rows today |
| Villages | 52 | |
| (no designation) | 20 (floor) | Price bonus is primary differentiator |

**Multiple-designation rule:** If a product matches more than one row (e.g. a wine tagged as
both `Premier Cru` and `Villages`), take the **highest** base score. Never sum or average.
Implementation must iterate all rows and pick the max.

**Cava Gran Reserva note:** Cava Gran Reserva (min 30 months) is legally distinct from and
significantly lower-bar than Rioja Gran Reserva (min 5 years total ageing). Cava SKUs in the
DB resolve to `tax['type'] == 'Sparkling & Champagne'`. The regulated path (base 82) applies
only to still wine from Spain/Argentina.

**Removed from table:** `Brut` and `Extra Brut` — these are *dosage levels* (residual sugar
classification), not prestige designations. They span the full quality range from ฿249
(Freixenet Cava) to ฿41,100 (Champagne Chavost). Assigning a flat prestige base to these
terms would cause cheap Cava to score the same as a trophy Champagne on the prestige axis.
Products whose only designation is Brut/Extra Brut fall to the `(no designation)` floor (20)
and rely on price bonus and appellation for prestige scoring.

**Gran Reserva split — implementation:** `category_group` is NOT a DB column and must not be
used as a SQL predicate. Resolve via `sku_taxonomy.resolve(sku)` in Python, then branch:

```python
tax = sku_taxonomy.resolve({'sku': sku})
STILL_WINE_TYPES = {'Red Wine', 'White Wine', 'Rosé'}   # excludes Cava / Sparkling
is_regulated_gran_reserva = (
    tax['group'] == 'Wine'                      # note: capital W
    and tax.get('type') in STILL_WINE_TYPES     # Cava → 'Sparkling & Champagne' → excluded
    and country in ('Spain', 'Argentina')
)
gran_reserva_base = 82 if is_regulated_gran_reserva else 75
# 75 for: spirits (Bacardi GR), New World wine (Chilean GR), Cava GR
# — above Reserva (70) to preserve naming hierarchy, below regulated Rioja GR (82)
```

Implementation note: match `designation IN ('Premier Cru', '1er Cru')` and
`designation IN ('Reserva Especial', 'Reserva Privada')` — do not use slash-delimited strings.

**DOCG / DOC note:** Zero rows currently have `designation = 'DOCG'` or `designation = 'DOC'`
in the DB. The `origin_system` field holds certification bodies (DOC, DOCG, AOC, IGT) but is
a separate signal not used in v1 prestige scoring. Add DOCG (82) and DOC (70) to the lookup
table for future data, but do not read from `origin_system`. Treat as v2 appellation enrichment.

**Appellation bonus:** +5 if `appellation` is populated.

**Price bonus (secondary signal — steepened to prevent no-designation luxury items from scoring same as cheap Brut):**

| Price (THB) | Bonus |
|---|---|
| < 500 | 0 |
| 500–1,999 | +8 |
| 2,000–9,999 | +22 |
| 10,000–49,999 | +38 |
| ≥ 50,000 | +52 |

**Rationale for steeper curve:** With Brut/Extra Brut removed from the designation table,
no-designation products (base 20) now reach a maximum of 72 (20 + 52) without appellation,
or 77 (20 + 52 + 5) with an appellation populated — both land in `premium` territory (65–84).
This correctly positions products like Château Pétrus (฿195,200, appellation = Pomerol → 77)
and Remy Martin Louis XIII (฿188,999, no appellation → 72) above a cheap Cava while still
below any formally designated product. Previously the cap was 55, putting trophy
no-designation bottles in the same bucket as entry-level sparkling wines.

**Final:** `MIN(100, designation_base + appellation_bonus + price_bonus)`  
**Confidence:** 0.9 if designation present; 0.6 if only appellation; 0.4 if price-only.  
**Source note example:** *"Grand Cru designation, Burgundy appellation."*

---

### Axis 3 — Popularity (20% of composite)

**Source:** `sold_qty`, `sold_orders` (NOT `popularity_score` until BI backfill completes)  
**Method:** Percentile rank within SKU prefix group (WRW ranks against WRW, LSK against LSK, etc.)
to prevent fast-moving commodity wines from outscoring niche premium categories.

Steps:
1. Group active SKUs by 3-char SKU prefix.
2. Compute `sold_qty + (sold_orders * 2)` as a demand proxy.
3. Percentile rank within group → popularity score 0–100.
4. **Singleton / thin-group fallback:** For prefix groups with fewer than 3 active SKUs,
   fall back to 1-char prefix family percentile (e.g. all `W*` prefixes together for wines,
   all `L*` for spirits). This prevents singleton groups returning 0 or 100 arbitrarily.

**Confidence:** 0.8 if `sold_qty > 0`; 0.3 if both are zero or NULL.  
**NULL guard (critical):** In the DB, ~5,804 active SKUs have `sold_qty = NULL` and
`sold_orders = NULL` (not 0). Implementation must use `COALESCE`:
```python
demand = (sold_qty or 0) + ((sold_orders or 0) * 2)
confidence = 0.8 if (sold_qty or 0) > 0 else 0.3
```
A bare `sold_qty == 0` check evaluates `False` for `None` in Python, silently assigning 0.8
confidence to ~5,804 products with no recorded sales.  
**Source note example:** *"Top 15% by sales volume in its category."*

**Note:** Once BI popularity backfill is complete, swap to `popularity_score` percentile and
re-run. No schema change needed.

---

### Axis 4 — Producer Authority (10% of composite)

**Source:** `brand`, aggregated acclaim + prestige scores across all beverage SKUs for that brand.  
**Method:**

1. **Exclude non-beverage SKUs** before any aggregation. Do NOT use a hard-coded prefix list
   (it drifts as new prefixes are added). Instead, resolve each SKU via `sku_taxonomy.resolve()`
   and include only SKUs where `group IN ('Wine', 'Spirits', 'Beer & Cider')`. Known non-beverage
   groups excluded: Accessories (ABA, GWN, GLQ, GDC, GBE, GWA, AWC, CIG) and
   Non-Alcoholic (NNA, MNA, WNA, WEV). Brands like Riedel (glassware), Jiggers (bar tools),
   The 4 Barmen, and Monin (syrups) must not enter the producer axis.
2. Group remaining active SKUs by `brand`.
3. For each brand: average the `acclaim` and `prestige` axis scores across their SKUs,
   **excluding NULL acclaim scores** (i.e. SKUs with no critic coverage). Only include a SKU
   in the acclaim average if `acclaim_score IS NOT NULL`. This prevents brands like Antinori
   (45 SKUs, most unscored) from having their acclaim average dragged toward zero by the
   unscored majority. A brand with zero scored SKUs gets producer_acclaim = NULL (not 0) and
   the producer score falls back to the prestige average only.
4. Assign to each SKU of that brand.

**Confidence scales with brand SKU count:**

| SKUs in brand | Confidence |
|---|---|
| 1 | 0.3 |
| 2–4 | 0.5 |
| 5–9 | 0.7 |
| ≥ 10 | 0.9 |

**Source note example:** *"Antinori: acclaimed producer with 45 SKUs, avg prestige 78."*

---

## Composite Rollup

```
composite = (
  acclaim_score    * 0.35 * acclaim_confidence +
  prestige_score   * 0.35 * prestige_confidence +
  popularity_score * 0.20 * popularity_confidence +
  producer_score   * 0.10 * producer_confidence
) / (
  0.35 * acclaim_confidence +
  0.35 * prestige_confidence +
  0.20 * popularity_confidence +
  0.10 * producer_confidence
)
```

This reweights remaining axes when one is NULL or has zero confidence, so a SKU with no
critic scores still gets a meaningful composite from the other three axes.

**Division-by-zero guard:** If the denominator equals zero (all four confidences are 0.0),
set `composite = NULL` and `reputation_tier = 'unrated'`. This cannot happen with current data
(prestige confidence floors at 0.4 via price signal) but must be guarded in code.

**Overall confidence:**
```
reputation_confidence = weighted average of per-axis confidences (same weights as above)
```

---

## Tier Thresholds

| Tier | Composite score | Meaning |
|---|---|---|
| `iconic` | ≥ 85 | Trophy bottles, cult producers, top-awarded wines |
| `premium` | 65–84 | Well-regarded, designation-backed, consistent critics |
| `established` | 40–64 | Solid brands, known in category, regular sellers |
| `everyday` | 1–39 | Entry-level, no designation, no critic coverage |
| `unrated` | composite NULL or confidence < 0.3 | Insufficient data |

**Override:** If `reputation_override` is set on the product, use that tier directly. Log a
warning if the computed tier differs by more than one level.

**Expected tier distribution at launch (sanity check):**
Based on current data (677 designations, 889 critic-scored SKUs, 584 with `sold_qty > 0` or
`sold_orders > 0`). Note: the 3,210 figure cited in earlier analysis referred to
`popularity_score > 0` — the BI-backfilled field not used in v1. v1 uses only `sold_qty` /
`sold_orders`, which have genuine data for ~584 SKUs. Popularity confidence will be 0.3 for
~5,804 SKUs, meaning the actual `unrated` count at launch may be toward the high end of the
range below or above it:

| Tier | Estimated SKU count |
|---|---|
| `iconic` | ~150–300 |
| `premium` | ~600–900 |
| `established` | ~1,000–1,500 |
| `everyday` | ~400–600 |
| `unrated` | ~3,000–4,200 |

**~60–65% of active SKUs will be `unrated` at launch** — this is expected and correct. Most
SKUs are unknown products with no designation, no sales history, and no critic scores. The
`unrated` tier is not "bad quality"; it means "we don't have enough signal yet." If the
verification output shows fewer than 500 `unrated` or more than 5,000, investigate before
proceeding. Note: a product with only a price signal gets prestige confidence 0.4 + popularity
confidence 0.3 → weighted confidence ~0.23, which falls below the 0.3 `unrated` threshold.
This is intentional — price alone is insufficient to tier a product.

---

## Substitution Logic

Tier + adjacent (direction-aware):

1. Find products in the **same tier**, same SKU prefix group (resolved via
   `sku_taxonomy.resolve(sku)` — `category_type` is NOT a DB column and must not be used
   as a SQL predicate), compatible style.
2. If fewer than N results (default N=5): expand to **adjacent tiers** (±1).
3. **Direction-aware messaging:**
   - Substituting down: add flag `substitute_direction = 'value'` → UI shows
     *"A fantastic value alternative."*
   - Substituting up: only when price delta ≤ 30% → UI shows
     *"A step up — similar style, slightly higher prestige."*
4. `unrated` products are **never** used as substitutes. They fall back to style/category
   match only, with no reputation-based messaging.

---

## Marketing Copy (reputation_summary)

Template-generated in v1 from axis source notes. Priority:

1. If acclaim score ≥ 70 AND acclaim confidence ≥ 0.5:
   → lead with critic signal: *"Rated in the top X% by [critic]."*
2. Else if prestige designation present:
   → lead with designation: *"[Designation], [appellation]."*
3. Else if popularity score ≥ 70:
   → lead with demand: *"One of our top sellers in [category]."*
4. Else if producer confidence ≥ 0.7:
   → lead with producer: *"From [brand], a well-regarded producer."*
5. Fallback: store `NULL` in `reputation_summary` (not empty string `""`). UI code should
   use a standard null-check (`if (product.reputation_summary)`) to suppress display.

---

## Computation Script: `scripts/compute_reputation.py`

**Runs:** After masterfile intake, after critic score ingest (batch), manually on demand.  
**Cost:** $0 — no external API calls.

```
Phase 0 — Backup (REQUIRED before any DDL or bulk write)
  cp data/db/products.db data/db/products.db.backup-reputation-$(date +%Y%m%d-%H%M%S).db
  CREATE TABLE IF NOT EXISTS reputation_signals ...  ← DDL runs after backup only
  ALTER TABLE products ADD COLUMN reputation_tier ...  ← all 6 columns added here

Phase 1 — Per-axis scores
  For each active beverage SKU:
    1. Compute acclaim score + confidence + source_note
    2. Compute prestige score + confidence + source_note
    3. Compute popularity score + confidence + source_note (uses pre-built prefix percentiles)
  For each brand group:
    4. Compute producer score + confidence + source_note
  Upsert all rows into reputation_signals

Phase 2 — Rollup
  For each active SKU:
    5. Pull 4 axis rows from reputation_signals
    6. Compute composite + overall confidence
    7. Map composite → tier (respect reputation_override)
    8. Generate reputation_summary from template
    9. Write reputation_tier, reputation_composite, reputation_confidence,
       reputation_summary, reputation_computed_at to products

Phase 3 — Verify + export
  10. Print tier distribution (count per tier, % of active SKUs)
  11. Print avg composite per SKU prefix group
  12. Print unrated count and top reasons (no scores, no designation, no sales)
  13. **Cross-check top 20 most expensive SKUs** — print sku, name, price, designation,
      appellation, reputation_tier for the 20 highest-price active SKUs. If any trophy product
      (e.g. DRC, Pétrus, Glenfiddich 50yr) shows NULL designation and NULL appellation, flag
      it explicitly: "X SKUs in the top-20 by price have no designation/appellation — prestige
      is price-only; consider enrichment before publishing reputation copy."
      Rationale: ultra-premium SKUs with missing designation silently underperform; this
      catches data gaps before they reach marketing copy.
  14. **Cross-check top 20 most expensive spirits SKUs** — same output as step 13 but filtered
      to spirits prefix group, to catch ultra-premium whiskies/cognacs with missing designation.
  15. Run refresh_live_export.py
  16. Confirm ALL FOUR reputation columns are in EXPORT_COLS allowlist:
      reputation_tier, reputation_composite, reputation_confidence, reputation_summary
      Assert at runtime: if any of these keys is absent from a spot-checked export row, abort
      and print "EXPORT_COLS missing: <column> — add to refresh_live_export.py"
      (a missing entry causes silent drop — column exists in DB but never reaches the UI)
```

**Verification output (required before declaring run complete — Rule 1):**
```
Tier distribution:
  iconic:      XXX SKUs  (X.X%)
  premium:     XXX SKUs  (X.X%)
  established: XXX SKUs  (X.X%)
  everyday:    XXX SKUs  (X.X%)
  unrated:     XXX SKUs  (X.X%)

Avg composite by prefix group:
  WRW (red wine): XX.X
  WWW (white wine): XX.X
  ...

Live export updated: data/live_products_export.json
Spot-check: SELECT sku, reputation_tier, reputation_composite FROM products
            WHERE reputation_tier IS NOT NULL LIMIT 5;
```

---

## Export Allowlist

Add to `EXPORT_COLS` in `scripts/refresh_live_export.py`:

```python
'reputation_tier',
'reputation_composite',
'reputation_confidence',
'reputation_summary',
# NOT reputation_override (internal only)
# NOT reputation_computed_at (internal only)
```

---

## Re-run Triggers

| Event | Action |
|---|---|
| Masterfile intake (new products) | Full re-run |
| Critic scores batch ingest | Re-run acclaim axis for affected SKUs, then rollup |
| BI popularity backfill completes | Re-run popularity axis (swap to popularity_score), then rollup |
| Manual override set | Re-run rollup phase only for that SKU |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Critic score inflation compresses acclaim | Percentile rank within critic, not raw score |
| NULL-sku rows in critic_scores skew per-critic percentile | Filter `WHERE sku IS NOT NULL` before ranking |
| signal_tier branching drops rows when tier-2 data arrives | v1 ignores signal_tier entirely; all rows equal weight |
| Non-beverage brands (Riedel, Monin, etc.) polluting producer axis | Exclude by resolved taxonomy group, not prefix list; include only Wine/Spirits/Beer & Cider |
| popularity_score degenerate until BI backfill | Use sold_qty/sold_orders percentile in v1; swap after backfill |
| Singleton/tiny SKU prefix groups → extreme popularity scores | Fall back to 1-char prefix family for groups < 3 SKUs |
| category_type not a DB column — silent empty query result | Resolve via sku_taxonomy.resolve() in app code; never use as SQL predicate |
| Composite denominator = 0 → ZeroDivisionError | Guard: if denominator == 0, set composite = NULL, tier = unrated |
| ~60–65% of SKUs will be unrated at launch | Expected and documented; sanity-check range: 500–5,000 unrated |
| `unrated` misread as low-quality | Distinct tier; never used as substitution source |
| Irreversible ALTER TABLE on wrong DB | Phase 0 backup required before any DDL |
| DOCG/DOC designation entries find no rows | Add to lookup for future data; do not read from origin_system in v1 |
| Computed tiers conflicting with manual knowledge | reputation_override respected by rollup |
| Brut/Extra Brut as style term inflating cheap sparkling prestige | Removed from designation table; falls to price-only floor |
| Gran Reserva overstating prestige for spirits, Cava, and New World wine | Split: Spain/Argentina still wine = 82, all others (spirits/Cava/Chilean wine) = 75 |
| No-designation luxury bottles (Pétrus, Louis XIII) scoring same as cheap Brut | Steeper price bonus curve; no-designation max now 72 vs 55 previously |

---

## What Ships in v1 vs v2

| Feature | v1 | v2 |
|---|---|---|
| `reputation_signals` table (4 axes) | ✅ | |
| `reputation_tier` + `reputation_composite` on products | ✅ | |
| `reputation_confidence` on products | ✅ | |
| `reputation_summary` (template-based) | ✅ | |
| `reputation_override` column | ✅ | |
| Substitution query with tier + adjacent logic | ✅ | |
| Accessor brand exclusion | ✅ | |
| Percentile-based acclaim (per-critic) | ✅ | |
| LLM-generated marketing copy | | ✅ |
| Real-time re-score on critic ingest | | ✅ |
| B2B trade press signals | | ✅ |
| Brand-level reputation UI | | ✅ |
| Swap popularity_score after BI backfill | | ✅ (trigger: backfill done) |
