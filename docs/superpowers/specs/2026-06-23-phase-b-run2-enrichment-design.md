# Phase B Run 2 — Paid LLM Taste-Field Enrichment (Design Spec)

**Date:** 2026-06-23
**Status:** Design — pending spec review + user approval, then writing-plans
**Author:** session continuation (universal-attribute enrichment effort)
**Predecessor:** Phase B Run 1 — variety+body for non-wine drinkables, SHIPPED (PR #37, `6383610`;
reuse-safety fix `a5046ab` on branch `fix/phase-b-reuse-safety`).
**Work branch:** `feat/phase-b-run2` (worktree `.worktrees/phase-b-run2`, based on `a5046ab`).
See memory `project_phase_a_enrichment_promotion`, `project_universal_attributes_enrichment`,
`project_is_in_stock_string_gotcha`, `feedback_catalog_worktree_isolation`.

---

## 1. Problem & Goal

Phase A (free deterministic) and Phase B Run 1 (paid, non-wine variety+body) left the
finder-scoring / shop-filterable taste columns partially filled. Run 2 fills the remaining
gaps in **`variety`, `body`, `acidity`, `tannin`** for **all in-stock drinkable** products,
completing the wine fields Run 1 deliberately excluded and widening non-wine coverage.

This is **paid work** → governed in full by CLAUDE.md **Rule 10** (canary → estimate →
sign-off → run → verify-shipped) and **Rule 4** (cost report must include a "what shipped to
users" line). No spend occurs during planning or build — only after the canary + your sign-off.

### Honest value framing (do NOT overstate — Rule 1 / Rule 4)

Verified against finder + shop code on 2026-06-23:

- **Finder** (`apps/catalog/lib/finder/scoring.ts`) scores on exactly four product attribute
  fields: `variety` (wine grapes only, `GRAPE_FAMILY`), `body` (wine body ladder), `acidity`,
  `tannin` (acidity/tannin ladder). The non-wine finder flows (whisky/spirits/sake) score on
  **origin/style axes (`axis1`/`axis2`)**, NOT on these universal fields.
- **Shop** (`apps/catalog/lib/shop-query.ts` + `Filters.tsx`) filters on `body`, `acidity`,
  `tannin`, `variety` for **all** products — the "Taste & more" filter chips are shown
  regardless of category (fixed scales in `app/shop/page.tsx`), so filling these fields IS
  user-visible for non-wine via the shop filter.

**Therefore Run 2 delivers:** (a) **wine finder sharpening** (the four fields all score for
wine), and (b) **shop-filter breadth across all drinkables**. It does **NOT** sharpen the
non-wine *finder* — that needs a separate scoring-code change (see §11 follow-up). The spec,
plan, and final cost report must use this framing, not "whole-finder sharpening."

---

## 2. Scope (the binding selection)

**Rows:** `is_in_stock == "1"` AND group ∈ {Wine, Spirits, Whisky, Sake & Asian, Liqueur}
AND missing **any** of {variety, body, acidity, tannin}. **No buying-signal gate** (unlike
Run 1) — the shop filter surfaces all in-stock products, so all are worth filling.

**Measured size (root canonical DB, 2026-06-23): 1,972 rows.** Per-category, with the count
of rows missing each field (one LLM call per row fills every field that row lacks):

| group | rows | need variety | need body | need acidity | need tannin |
|---|---|---|---|---|---|
| Wine | 655 | 72 | 564 | 566 | 611 |
| Spirits | 455 | 238 | 220 | 404 | 404 |
| Sake & Asian | 381 | 349 | 328 | 329 | 330 |
| Whisky | 317 | 158 | 189 | 289 | 289 |
| Liqueur | 164 | 69 | 57 | 144 | 144 |
| **Total** | **1,972** | | | | |

**Stock semantics (memory `project_is_in_stock_string_gotcha`):** `is_in_stock` is the STRING
`"0"`/`"1"`/null — truthiness is backwards. Use the Run-1 `_instock()` helper (only
`"1"`/`"True"`/`"true"` = in stock).

**Category derivation (Rule 12):** group comes from `sku_taxonomy.resolve(row)["group"]`,
NEVER from `classification`. `schema_for_group()` is GROUP-keyed (group and type DIVERGE for
non-wine; Run 1's Task-1 fix). Pre-flight: assert `resolve()` returns a group in the drinkable
set for every selected row before spending (0 unresolved verified 2026-06-23).

**Beer & RTD excluded** (in Run 1's NONWINE but dropped here): only ~4% have body/variety and
acidity/tannin are not meaningful axes for beer/seltzer — defer to avoid low-signal spend.

---

## 3. The canonical DB lives at the ROOT, not the worktree (Rule 1 / Rule 9 trap)

The 88 MB canonical `data/db/products.db` is a data artifact, **not** committed to git; git
tracks a 0-byte placeholder. In this worktree `data/db/products.db` is **empty**. The
enrichment + merge + refresh MUST target the root DB by **absolute path**:

```
/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.db
```

Always pass `--db <absolute root path>`. This mirrors the Phase A trap
(`project_phase_a_enrichment_promotion`: "DEFAULT_DB points at a STALE worktree DB"). The
plan's pre-flight asserts the target DB is non-empty (`SELECT COUNT(*) FROM products > 0`)
before any spend.

**Shared-checkout hazard (memory `feedback_catalog_worktree_isolation`):** the root checkout
is being branch-flipped by a parallel process this session. All Run 2 work stays in this
worktree; verify `git branch --show-current == feat/phase-b-run2` before every commit.

---

## 4. Fields, scales, validation & category-aware applicability

### 4.1 `body` — 4-step scale (all drinkable categories)
Write on the **4-step shop-native scale** (Run-1 decision, review CRITICAL #1):
```
["Light", "Medium", "Medium-Full", "Full"]      ← Medium-Light NOT used
```
Strict subset of the finder's 5-step ladder, so finder ranks AND shop buckets correctly with
no silent collapse. Reuse Run-1 `validate_body`.

### 4.2 `variety` — per-category controlled vocabulary (reuse Run-1 vocab)
Wine adds a grape allowlist (NEW for Run 2; Run 1 was non-wine only). The non-wine vocab is
unchanged from Run 1 §4.2 (Whisky: Single Malt/Blended/Bourbon/…; Spirits: base material;
Sake: Junmai/Ginjo/…; Liqueur: Herbal/Fruit/…). Validation **drops** off-vocab → null (never
coerce; Rule 5 / Rule 1). Wine grape vocab derives from the live `variety` distribution +
finder `GRAPE_FAMILY` tokens so written values match what the finder's grapeScore reads.
The plan MUST generate this wine grape allowlist as an explicit frozen artifact (committed,
not regenerated per run) and eyeball it in the canary: too-narrow silently drops valid grapes
to NULL (safe per Rule 5 but lowers yield); too-broad pollutes `grapeScore`. Canary acceptance
includes verifying produced wine varieties land inside `GRAPE_FAMILY` tokens.

### 4.3 `acidity` / `tannin` — 4-step scale, CATEGORY-AWARE applicability (NEW for Run 2)
Scale: `["Low", "Medium", "Medium-High", "High"]` (matches `ACIDITY_SCALE`/`TANNIN_SCALE` in
`app/shop/page.tsx`). The model is asked for these fields **only where the axis is meaningful**,
to avoid fabricating values (Rule 1 / Rule 3):

| field | REQUESTED for | NOT requested for (left NULL) |
|---|---|---|
| `acidity` | Wine, Sake & Asian, (Liqueur if fruit/citrus) | Spirits, Whisky |
| `tannin` | **Red/structured Wine only** | White/sparkling Wine, Spirits, Whisky, Sake, Liqueur |

Applicability is decided by `schema_for_group()` (extended) keyed on the SKU-derived group —
and for tannin, refined by wine sub-type/colour. A field not requested is never sent to the
model, never validated, never written. The validator drops any returned value outside the
4-step scale → null.

**Tannin red/white determination (highest-ambiguity decision — the plan MUST pin this down,
do NOT hand-wave):** request tannin ONLY when the wine is determinably red/structured. Source
of truth, in order: (1) the SKU-derived `category_type` (`sku_taxonomy.resolve(row)["type"]`,
e.g. "Red Wine" → request; "White Wine"/"Sparkling"/"Rosé" → skip); (2) if type is ambiguous
(generic "Wine"), a name-regex for red varietals/keywords. **Fallback when colour is NOT
resolvable: do NOT request tannin (leave NULL).** Never request tannin for a wine we can't
confirm is red — a NULL is correct; a fabricated tannin on a white is a Rule-1 failure.

**Applicability-gated request counts (these SUPERSEDE the §2 raw-missingness totals for cost
purposes):** §2's per-field "need" column is raw column-missingness; the model is asked for a
field only where it `applies`, so the operative paid surface is smaller. Approximate gated
request counts: tannin ≈ red-wine rows only (far fewer than the 611 Wine rows missing it);
acidity ≈ Wine + Sake (+fruit Liqueur), excluding Spirits/Whisky. The plan computes the exact
gated counts; the binding cost number comes from the canary regardless (§6). No fabricated
tannin is ever written for a vodka or a white wine.

### 4.4 New code — extend `data/lib/taste_taxonomy/universal_scales.py`
Extend (do NOT rewrite) `schema_for_group()` to return, per group: `variety_vocab`,
`body_scale` (existing), plus **`acidity_scale`**, **`tannin_scale`**, and an **`applies`** set
naming which of {variety, body, acidity, tannin} to request for that group (the §4.3 table).
Add `validate_acidity` / `validate_tannin` (4-step scale, drop-else-null) mirroring
`validate_body`. The Rule-12-violating `schema_for_classification` (if present) stays untouched
and unused.

---

## 5. Architecture & data flow (reuses Run-1 skeleton — Rule 11)

```
select 1,972 rows (§2) from ROOT products.db   (absolute --db path, §3)
   │ per row: group = sku_taxonomy.resolve(row)["group"]      ← NOT classification (Rule 12)
   │ schema_for_group(group) → which of {variety,body,acidity,tannin} to ASK (§4.3 applies set)
   │ context: name (+ existing flavor_tags)
   ▼
scripts/enrich_phase_b.py  (EXTENDED, not forked: add Wine to selection, add acidity/tannin
   │                         to prompt+validation, --run2 mode/flag; harness reused verbatim)
   • Haiku 4.5, constrained JSON out → only the requested fields
   • validate: variety∈vocab else null; body/acidity/tannin∈4-step scale else null
   ▼ writes ONLY to (no DB write in this script):
enrichment_cache (Supabase) + local sidecar    sku → {fields, source, model, ts}
   │   source tag: "phase_b_run2_haiku_taste"
   ▼
scripts/merge_phase_b_cache.py  (EXTENDED for the 4 fields; NULL-only, backs up DB first)
   • UPDATE products SET col=? WHERE sku=? AND (col IS NULL OR col='')   ← never clobbers (Rule 5)
   ▼  refresh_live_export.py  ─►  live_products_export.json   (4 cols already in EXPORT_COLS ✓)
   ▼
VERIFY-SHIPPED (Rule 1): for the EXACT merged-SKU set, confirm fields populated in the JSON;
   spot-check a previously-empty whisky now shows body in the shop "Taste & more" filter,
   and a previously-empty red wine now ranks on tannin in the wine finder deep-dive.
```

**Two non-negotiable safety controls (carried from Run-1 review):**
1. **Enrichment script makes ZERO DB writes** — paid output lands in the cache first. A bad
   merge never loses paid data and never re-pays (the $56 May-2026 lesson).
2. **`--dry-run` means NO API call** (free preview of prompt + selected rows). The forbidden
   pattern is the original phase_d1 dry-run that still spends. Run 1 already fixed this; Run 2
   inherits the fixed behavior — re-verify it in the canary.

**Do NOT reuse any unconditional-UPDATE write path** (`phase_d1` ~223-235;
`backfill_from_cache.py` ~143-148). The merge is NULL-only via `merge_phase_b_cache.py` only.

---

## 6. Cost (Rule 10 / Rule 4)

**Pre-canary envelope** (1,972 rows, Haiku 4.5 @ $0.80/$4.00 per Mtok, ~900-tok system prompt
cached after first call, Run-1 measured ~$0.00024/row; Run-2 prompt slightly larger due to
acidity/tannin scales):

| Scenario | Estimate |
|---|---|
| Haiku, prompt-cached (expected) | **~$0.47** |
| High (1.5× buffer, retries/verbose) | ~$0.70 |
| Canary (5 SKUs) | <$0.01 |

**This is a PRE-CANARY estimate. The BINDING number comes from the 5-SKU canary's measured
per-SKU token rate, shown to the user for sign-off BEFORE the full run.** Canary also decides
model (Haiku vs Sonnet escalation if accuracy is poor on hard rows).

**Cost report at end (Rule 4) must include:** total spend, # API calls, **# rows where each of
variety/body/acidity/tannin is populated IN `live_products_export.json`** (not the cache, not
the DB gross count), and per-successful-row cost.

---

## 7. Rule-10 execution gate (the run procedure)

1. Pre-flight: assert root DB non-empty; assert all selected rows resolve to a drinkable group;
   back up the root DB (`cp products.db products.db.bak-pre-run2`).
2. **Canary:** `--limit 5 --dry-run` (FREE — show prompt + rows, zero API calls), then
   `--limit 5` (paid, <$0.01, cache only). Eyeball: variety in-vocab, body/acidity/tannin on
   the 4-step scale, tannin absent for non-applicable rows.
3. Confirm success/skip ratio matches expectation.
4. **Estimate** full-run cost from the canary's measured per-SKU rate; show the user the number.
5. **Get user sign-off on the number.** ← no full-run spend before this.
6. Full run → cache.
7. Merge cache → ROOT DB (NULL-only) → `refresh_live_export.py`.
8. **Verify-shipped:** for the EXACT merged-SKU set, confirm each field populated in
   `live_products_export.json` (compare the merged-SKU set, NOT gross column totals —
   pre-existing values inflate the gross and read as false mismatch). Spot-check finder + shop.

---

## 8. Testing

- Unit: extended `schema_for_group` returns correct fields/scales/`applies` per group (Rule-12
  clean — never reads `classification`); `validate_acidity`/`validate_tannin` accept ONLY the
  4-step scale and drop anything else → null; **tannin is NOT in `applies` for non-red groups**
  (the §4.3 applicability guard).
- Unit (NULL-only merge, Rule-5 guard): a row with `acidity='High'` is NOT overwritten; a NULL
  `tannin` on a red wine IS filled.
- Integration (Rule 6 invariant): for a cached row X with fields, after merge the products
  table AND the export JSON have the corresponding columns populated for X.
- Canary acceptance: 5 real SKUs (mixed wine + spirit) produce in-vocab variety + 4-step
  body/acidity/tannin, tannin only on the red wine, plausible on eyeball.

---

## 9. Reused vs net-new (Rule 11)

**Reused verbatim:** `enrich_phase_b.py` harness (`--limit`/`--dry-run` canary, Haiku client,
cost constants, `ThreadPoolExecutor`, `--skip-done` resume, factual-discipline system prompt,
`_instock`/`_empty`/`group_for`/`select_rows` shape); `merge_phase_b_cache.py` NULL-only merge;
`refresh_live_export.py`; the Run-1 test patterns.

**Net-new (budget these — highest-leverage):**
1. Add Wine to the selection set + a wine grape vocab (§4.2).
2. Extend `schema_for_group` with acidity/tannin scales + `applies` applicability (§4.4).
3. `validate_acidity` / `validate_tannin` (§4.4).
4. Extend the prompt to request only applicable fields + parse them (§4.3/§5).
5. Extend `merge_phase_b_cache.py` to merge all four fields NULL-only.
6. The §8 tests.

---

## 10. Explicitly OUT of scope (Run 2)

- `finish`, `intensity`, `color`, `smokiness`, `blend_type`, `production_style` — NO code reads
  them for scoring; display-only and deferred (would be dead-column spend without UI work).
- Out-of-stock rows — not surfaced in finder/shop; defer until restocked.
- Beer & RTD — low signal for these axes (§2).
- Teaching the non-wine FINDER to score on body/acidity/tannin — a scoring-code change, not a
  data run (§11). Run 2 is data-only.

---

## 11. Open follow-ups

- **Non-wine finder scoring:** `scoring.ts` ranks whisky/spirits/sake on `axis1`/`axis2`, not on
  the universal fields. A future code change could make the non-wine finder score on `body`
  (and a non-wine-aware variety match) so Run-2's non-wine data sharpens the finder, not only
  the shop. Track separately; do not bundle into Run 2.
- Reconcile with the parked `project_finder_data_enhancements` plan rather than duplicating.
- `apps/catalog/lib/taste-adapter.ts` stale sweetness comment (noted in Run-1 spec §11).
