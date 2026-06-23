# Phase B — Paid LLM Attribute Enrichment (Design Spec)

**Date:** 2026-06-23
**Status:** Design — pending spec review + user approval, then writing-plans
**Author:** session continuation (universal-attribute enrichment effort)
**Predecessor:** Phase A (free deterministic backfill) — SHIPPED & MERGED, PR #33 (`592cf11`).
See memory `project_phase_a_enrichment_promotion`, `project_universal_attributes_enrichment`.

---

## 1. Problem & Goal

Phase A filled `smokiness`/`sweetness`/`body` deterministically (free, name-rules). The
remaining gaps in the universal attribute columns can only be filled by an LLM that reads
the product name + existing context. This is **paid work** → governed in full by CLAUDE.md
**Rule 10** (canary → estimate → sign-off → run → verify-shipped) and **Rule 4** (cost report
must include a "what shipped to users" line).

**Outcome chosen by user:** *Finder first, catalog second* — two sequential, independently
Rule-10-gated runs.

- **Run 1 (this spec): sharpen finder + shop for non-wine drinkables.** Fill ONLY attribute
  columns that a live consumer reads (finder scoring and/or shop filter) AND that are
  genuinely empty for non-wine drinkables. Precisely: `body` (finder-scored + shop-filterable)
  and `variety` (shop-filterable for non-wine; see §2 for why it is NOT finder-grapeScored).
- **Run 2 (deferred, separate spec): catalog breadth.** Display-only fields
  (`finish`/`intensity`/`smokiness` on /product detail pages) + wider row coverage.

---

## 2. Critical scoping finding (verified against code — do not skip)

A code review **overturned the initial field choice.** The finder was assumed to read
`finish` and `intensity`; it does NOT.

- `apps/catalog/lib/finder/scoring.ts` reads exactly four product attribute fields:
  **`p.variety`, `p.body`, `p.acidity`, `p.tannin`** (lines ~349–373).
- The word "intensity" in finder code is the **function name** `intensityScore()` (an
  ordinal-ladder matcher applied to acidity/tannin) — NOT the `intensity` column.
- The "finish" matches were **prose** inside `finder/style-profiles.ts` marketing copy —
  NOT field reads.
- `apps/catalog/lib/shop-query.ts` filters on exactly: **`body`, `acidity`, `tannin`,
  `variety`**.

**Consequence:** filling `finish`/`intensity` in Run 1 would populate columns NO code reads
= spend-without-shipping (the exact Rule 1 / Rule 4 failure mode). They are **explicitly
deferred to Run 2** (display value only) and must NOT be added to Run 1 without also adding
finder/shop code that reads them.

**Re-scoped Run 1 fields:** `variety` + `body`.
(`acidity`/`tannin` excluded: wine-centric; low signal for spirits/whisky; not worth the
spend in Run 1.)

**Honest value proposition per field (corrected after review — do not overstate):**
- `body` — **finder-scored** (`scoring.ts` bodyLadder, line 372) AND **shop-filterable**
  (`shop-query.ts:162`). Full value on both consumers.
- `variety` — **shop-filterable** (`shop-query.ts:153`, substring on `p.variety`) and used
  for finder prefilter/display. It is **NOT** scored by the finder's `grapeScore`:
  `GRAPE_FAMILY` (`scoring.ts:170`) is **wine-grape-only** (cabernet/chardonnay/glera…), so
  it returns 0 for every non-wine variety token (Single Malt, Agave, Junmai…). Run 1 variety
  therefore sharpens the **shop grape filter** for non-wine, not the finder grape question.
  This is still a legitimate, user-visible win — but Run 1 is NOT "finder-grape sharpening."

---

## 3. Scope (Run 1)

**Rows:** in-stock AND (has critic score OR has sales signal) AND in a NON-WINE drinkable
category AND missing `variety` OR `body`.

- Non-wine drinkable groups: `Spirits, Whisky, Sake & Asian, Liqueur, Beer & RTD`
  (wine `variety`/`body` are already well-covered — 6,712 / 3,898 — so wine is out of Run 1).
- Stock: `is_in_stock` normalized via the "0"/"1"/null STRING semantics
  (see memory `project_is_in_stock_string_gotcha` — truthiness is backwards; use the
  catalog `isInStock()` convention).
- Signal: `has_recent_sales` truthy OR `sold_orders > 0` OR `sku` present in the
  `critic_scores` table (sku-keyed; 1,631 distinct skus).

**`category_type` is NOT a DB column (review WARNING):** it is derived at export time by
`refresh_live_export.py:133-136` via `sku_taxonomy.resolve()`. The enrichment script must
**derive it in-process per row** by calling `sku_taxonomy.resolve(row)` — exactly as the
refresh script does — NOT select a `category_type` column (it does not exist) and NOT read
`classification` (Rule 12). Pre-flight: assert `resolve()` returns a non-junk group for all
selected rows before spending (a row with no resolvable group has no variety vocab → would
waste a call). Verified 2026-06-23: 0 unresolved groups in the selection.

**Selection logic (the binding query — paste into the plan):**

```python
# pseudocode of the actual selection, verified 2026-06-23
NONWINE = {'Spirits','Whisky','Sake & Asian','Liqueur','Beer & RTD'}
critic_skus = {sku for (sku,) in db.execute('SELECT DISTINCT sku FROM critic_scores')}
for row in db.execute('SELECT sku,name,is_in_stock,variety,body,'
                      'has_recent_sales,sold_orders FROM products'):
    if not isInStock(row.is_in_stock):                 continue   # "0"/"1"/null STRING
    group = sku_taxonomy.resolve(row).get('group')                 # Rule 12: SKU-derived
    if group not in NONWINE:                            continue
    has_signal = truthy(row.has_recent_sales) or int(row.sold_orders or 0) > 0 \
                 or row.sku in critic_skus
    if not has_signal:                                  continue
    if empty(row.variety) or empty(row.body):           yield row  # one call fills both
```

**Measured size (queried 2026-06-23 with the above):** **794 rows** to call (781 need
variety, 505 need body; one call fills both), 0 rows with an unresolved group.

---

## 4. Fields, scales & validation

### 4.1 `body` — 4-step scale the SHOP and FINDER both accept (all categories)

Two consumers read body and they use **different scales** — the model must write a value
in the intersection both accept:
- **Finder** (`scoring.ts:9` `BODY_LADDER`): `[Light, Medium-Light, Medium, Medium-Full, Full]`
  (5-step; Medium-Light is in-scale here).
- **Shop** (`shop-query.ts:162` → `taste-adapter.ts:61-68` `normalizeScale('body')`): only
  `[Light, Medium, Medium-Full, Full]` (4-step). **`Medium-Light` is OUT-of-scale and gets
  remapped to `Medium`**, so a shop `body=Medium-Light` option does not exist.

**Decision (review CRITICAL #1):** write body on the **4-step shop-native scale only:**

```
["Light", "Medium", "Medium-Full", "Full"]   ← Medium-Light NOT used
```

This is a strict subset of the finder ladder (every value is also valid there), so the
finder ranks correctly AND the shop filter buckets correctly with no silent collapse. Do NOT
emit `Medium-Light` (the existing 122 DB rows with it predate this run; the shop already
buckets them as Medium — we don't add more). The category-specific `body_texture`/`body_umami`
axes in `category_axes.py` are for the DISPLAY TasteWheel, a different consumer — do NOT use
them for the flat `body` column. The prompt maps a spirit's weight onto the 4-step scale
(e.g. cask-strength whisky → "Full"; a light blanco tequila → "Light").

### 4.2 `variety` — per-category controlled vocabulary (NOT free-text)

Free-text variety pollutes the finder's `grapeScore` token match. Each non-wine category
gets a small allowlist; the model must return a value from it (or null if unknown):

- **Whisky:** Single Malt, Blended Malt, Blended, Bourbon, Rye, Tennessee, Single Pot Still,
  Single Grain, Corn (style/grain class — mirrors `WHISKY.style_tags`).
- **Spirits (Brandy/Gin/Vodka/Rum/Tequila/etc):** base material — Agave, Cane/Molasses,
  Grain, Grape, Potato, Juniper-Botanical, Other (keyed by sub-type via `category_type`).
- **Sake & Asian:** classification — Junmai, Junmai Ginjo, Junmai Daiginjo, Honjozo, Ginjo,
  Daiginjo, Nigori, Shochu, Other.
- **Liqueur:** base/flavor family — Herbal, Fruit, Cream, Coffee, Nut, Anise, Bitter/Amaro,
  Other.
- **Beer & RTD:** style family — Lager, Ale/IPA, Stout, Wheat, RTD-Cocktail, Hard-Seltzer,
  Cider, Other.

Validation **drops** (writes null, leaves column NULL) any value not in the allowlist rather
than coercing — never write an off-vocab guess.

### 4.3 New code — `data/lib/taste_taxonomy/universal_scales.py`

Holds: the universal body scale (4.1), the per-category variety vocab (4.2), and
`schema_for_type(category_type)` — a **Rule-12-clean** lookup keyed on the SKU-derived
`category_type`, returning the applicable fields + scales for a product. The existing
`schema_for_classification` (which keys on `classification`, a Rule-12 violation) is **left
untouched** for now; Phase B uses only `schema_for_type`.

---

## 5. Architecture & data flow

```
select rows (§3) ── products.db   (select sku,name,variety,body,signal cols)
   │ per row: DERIVE category_type via sku_taxonomy.resolve(row)  ← NOT a DB column
   │ context: name, existing flavor_tags as prompt context
   ▼
scripts/enrich_phase_b.py        (forks phase_d1 HARNESS ONLY — not its write path, §6)
   • schema_for_type(category_type)  → which fields + scales (Rule-12 clean)
   • Haiku 4.5, constrained JSON out  → {variety, body}
   • validate: variety∈allowlist else null; body∈4-step scale else null
   • --limit N / --dry-run canary; threaded
   ▼  writes ONLY to (no DB write in this script):
enrichment_cache (Supabase) + local sidecar     sku → {variety, body, source, model, ts}
   │  SEPARATE script: merge_phase_b_cache.py (NULL-only, backs up DB first)
   ▼
products.db  UPDATE ... WHERE sku=? AND (col IS NULL OR col='')   (never clobbers, Rule 5)
   ▼  refresh_live_export.py  ─►  live_products_export.json
   ▼
VERIFY-SHIPPED (Rule 1): count variety/body in the JSON == DB; spot-check a previously-empty
   whisky now shows body in shop filter + finder ranking
```

**Why cache-first then separate merge:** the $56 May-2026 loss happened because a threshold
gate silently dropped paid output before it reached the DB. Landing paid output in the cache
FIRST means if the merge/validation is wrong, the data is safe and we re-merge WITHOUT
re-paying. The merge is NULL-only (never clobbers existing values — Rule 5).

---

## 6. Reused skeleton (Rule 11) — and what is NET-NEW (review CRITICAL #2)

Fork `scripts/phase_d1_enrich_critic_scored.py` for the **harness only**: `--limit`/`--dry-run`
canary, Haiku 4.5 + per-token cost constants, DB backup on apply, `ThreadPoolExecutor`,
`--skip-done` resume, and the factual-discipline system-prompt structure.

**DO NOT reuse the skeleton's write path.** Verified: `phase_d1` lines ~223-235 do an
**unconditional** `UPDATE products SET … WHERE sku=:sku` straight to `products.db` — it is
**NOT** NULL-only and has **NO** cache-first step (`--dry-run` just skips the write). Reusing
it verbatim would CLOBBER the 6,772 existing `variety` values and existing `body` rows the
spec promises to protect (Rule 5 violation) and lose the cache safety net (Rule 1).

**Net-new code (budget these explicitly — they are the highest-leverage safety controls):**
1. **Constrained-output prompt** + JSON parse → `{variety, body}`.
2. **Validators**: variety against the per-category allowlist (§4.2, drop off-vocab → null);
   body against the 4-step scale (§4.1, drop anything else → null).
3. **`schema_for_type(category_type)`** (§4.3) — Rule-12-clean.
4. **Cache-first write**: enrichment loop writes ONLY to Supabase `enrichment_cache` + local
   sidecar. No DB write in the enrichment script at all.
5. **Separate NULL-only merge** (`merge_phase_b_cache.py`, or extend `backfill_from_cache.py`):
   `UPDATE products SET col=? WHERE sku=? AND (col IS NULL OR col='')` — never overwrites.
   Then `refresh_live_export.py`, then verify-shipped.

Items 4+5 each get a unit test (§9). The skeleton's `_write_row`/UPDATE block is explicitly
forbidden.

---

## 7. Cost (Rule 10 / Rule 4)

**Pre-canary envelope** (measured: 794 rows, avg name 38 chars, flavor_tags 106 chars; Haiku
4.5 $0.80/$4.00 per Mtok; system prompt ~900 tok cached after first call):

| Scenario | Estimate |
|---|---|
| Haiku, prompt-cached (expected) | **~$0.39** |
| High (1.5× buffer, retries/verbose) | ~$0.58 |
| Canary (5 SKUs) | <$0.01 |

**This is a pre-canary estimate. The BINDING number comes from the 5-SKU canary's measured
per-SKU token rate, shown to the user for sign-off BEFORE the full run.** Model choice
(Haiku vs Sonnet escalation for hard rows) is also decided from the canary's accuracy.

**Cost report at the end (Rule 4) must include:** total spend, # API calls, **# rows where
`variety`/`body` are populated IN `live_products_export.json`**, and per-successful-row cost.

---

## 8. Rule-10 execution gate (the run procedure)

1. Backup `data/db/products.db` (the merge step backs up; canary uses cache only, no DB write).
2. **Canary:** `enrich_phase_b.py --limit 5 --dry-run` then `--limit 5` (writes cache only).
   Verify the 5 results are sane (variety in-vocab, body on the Light→Full scale).
3. Confirm success/skip ratio on the canary matches expectation.
4. **Estimate** full-run cost from the canary's measured per-SKU rate; show the user the number.
5. **Get user sign-off on the number.**
6. Full run → cache.
7. Merge cache → DB (NULL-only) → `refresh_live_export.py`.
8. **Verify-shipped:** count `variety`/`body` populated in `live_products_export.json` ==
   DB counts; spot-check that the finder/shop now surface a previously-empty whisky's body.

---

## 9. Testing

- Unit: `schema_for_type` returns correct fields/scales per `category_type` (and is Rule-12
  clean — never reads `classification`); variety validator drops off-vocab → null; body
  validator accepts ONLY the 4-step scale `[Light, Medium, Medium-Full, Full]` and rejects
  `Medium-Light` (the cross-consumer trap from review CRITICAL #1).
- Unit (net-new write path, review CRITICAL #2): the merge is NULL-only — given a row that
  already has `variety='Single Malt'`, merging a cache value MUST NOT overwrite it; given a
  NULL `body`, it MUST fill it. This is the Rule-5 guard.
- Integration (Rule 6 invariant): for a cached row X with `{variety, body}`, after merge the
  products table AND the export JSON have the corresponding columns populated for X.
- Canary acceptance: 5 real SKUs produce in-vocab variety + 4-step body, plausible (eyeball).

---

## 10. Explicitly OUT of scope (Run 1)

- `finish`, `intensity` — no code reads them; Run 2 (display) only, and only if finder/shop
  code is added to read them. Deferred to avoid dead-column spend.
- `smokiness` — Phase A already filled it (Whisky/Spirits); finder does NOT read it (display
  value). Run 2 territory.
- Wine variety/body — already well-covered; not worth re-enriching.
- `acidity`/`tannin` for non-wine — wine-centric, low signal; reconsider in a later run.
- Run 2 (catalog breadth) — its own spec, its own Rule-10 gate, its own canary + sign-off.

---

## 11. Open follow-ups

- `apps/catalog/lib/taste-adapter.ts:108-109` comment is stale post-Phase-A ("sweetness… no
  values" — sweetness now has 279). Fix opportunistically when touching that file.
- Reconcile with the parked `project_finder_data_enhancements` plan rather than duplicating.
