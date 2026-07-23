# Spirits Sub-Style Enrichment — Close the Gin/Rum/Tequila Gap, Add Vodka/Brandy/Cognac/Grappa

**Date:** 2026-07-23
**Status:** Draft
**Scope:** `scripts/assign_spirits_fields.py`, `scripts/migrate_spirits_fields.py`, `data/db/products.db`, `apps/catalog/lib/category-scorer.ts` — the category-specific structured fields that feed the recommender's `categorySignalPoints()` override.

---

## 1. Background

The user asked to enrich non-wine categories further, for use in matching/suggestion. A prior session's analysis flagged low fill rates for `gin_style` (1%), `rum_style` (1%), `agave_aging` (1%) — but that figure was measured across the whole DB, not the categories those fields actually apply to. Verified against the live `products.db` (6,206 in-stock SKUs, segmented via `data/lib/taxonomy/sku_taxonomy.py resolve()` per Rule 12):

| Type | In-stock rows | Has style today | Missing, but has `desc_en_short`/`full_description` | Missing, no description |
|---|---|---|---|---|
| Gin | 182 | 72 (40%) | 110 | 0 |
| Rum | 123 | 73 (59%) | 50 | 0 |
| Tequila | 115 | 86 (75%) | 29 | 0 |
| Vodka | 78 | 0 (no column) | — | — |
| Brandy | 70 | 0 (no column) | — | — |
| Cognac | 16 | 0 (no column) | — | — |
| Grappa | 20 | 0 (no column) | — | — |

**Root cause of the Gin/Rum/Tequila gap:** `scripts/assign_spirits_fields.py` already populated the existing columns, but it classifies from **product `name` only** — it deliberately never reads `desc_en_short`/`full_description`. This was a considered choice, not an oversight: the script's own header documents two prior incidents where a *brand-name* fallback guessed a style and got it wrong (Hendrick's/Tanqueray No. TEN defaulting to `juniper_forward`; Don Julio 1942 defaulting to `blanco`), which is the same failure class as the reverted country-from-brand PR (`feedback_dont_infer_country_from_brand`). The fix at the time was: match on **explicit keywords in the name only**, and write `NULL` — never a guessed value — when nothing matches.

Sampling the 189 gap rows shows **100% of them have a populated `desc_en_short` or `full_description`** with clear category language the name lacks (e.g. "juniper-forward", "column-still", "triple-distilled", cask/aging detail). This is a different, safer signal than brand-name inference: it's the product's own stated description, not an assumption about what a brand "usually" makes. Extending the proven regex+honest-NULL pattern to also search the description should close most of this gap at zero marginal API cost.

**Separately**, Vodka/Brandy/Cognac/Grappa (184 rows) have no style column at all, despite descriptions containing clear signal (VS/VSOP/XO age class for Brandy/Cognac; column-still/pot-still/filtration language for Vodka). These feed no category-specific recommender signal today — `category-scorer.ts`'s `categorySignalPoints()` has no bucket for them, so they fall back to the generic (weaker) signal set.

A related audit spec (`2026-07-22-recommender-quality-audit-design.md`, §7 Open Questions) explicitly deferred "no new category-specific fields" as future work and named several groups as candidates. This spec is that follow-up, scoped to Spirits sub-types.

---

## 2. Goals

1. **Close the Gin/Rum/Tequila gap** (189 rows) by extending `assign_spirits_fields.py` to fall back to `desc_en_short`/`full_description` when `name` doesn't match, using the *same* rule patterns already proven correct on `name`.
2. **Add structured style fields for Vodka, Brandy, Cognac, and Grappa** (184 rows) — new DB columns, populated by the same regex-first, honest-NULL approach.
3. **Wire the new/filled fields into `category-scorer.ts`** so `categorySignalPoints()` gives Vodka/Brandy/Cognac/Grappa the same category-specific scoring boost Gin/Rum/Tequila/Whisky already get, directly improving "you might also like" match quality for these categories.
4. **LLM (Haiku) fallback**, scoped only to rows where both name and description regex miss, for whichever categories still have meaningful NULL residue after step 1-2. Real cost estimate from canary data, per Rule 10 — expected to be small given 100% description coverage on the known gap rows.

## 3. Non-Goals

- **No brand-name inference / guessing.** The `None` fallback stays `None`. This is non-negotiable given the two prior incidents documented in the existing script.
- **Sake, wine fridges, and other categories flagged in the original broader analysis are out of scope.** User confirmed Spirits sub-styles as the first pass; those are candidates for a future spec.
- **No changes to `derive_spirit_style.py`'s `spirit_style` list field.** That script was written but never shipped (0/11,934 rows in the live export have `spirit_style` populated) — it targets a different field than the one actually wired into `category-scorer.ts`. This spec does not resurrect it; the LLM-fallback scaffolding it contains (controlled vocabulary validation, cost tracking) is reused as a pattern, not as a dependency.
- **No re-weighting of existing scoring points.** New categories get the same `+3` `matchField()` treatment Gin/Rum/Tequila/Whisky already have — consistent with the existing pattern, not a fresh calibration exercise.
- **No UI changes.**

---

## 4. Design

### 4.1 Migration — new columns

Extend the `migrate_spirits_fields.py` pattern (same idempotent `PRAGMA table_info` check, same worktree/empty-DB guard) to add:

| Column | Type | Applies to |
|---|---|---|
| `vodka_style` | TEXT | Vodka |
| `brandy_class` | TEXT | Brandy (non-Cognac) |
| `cognac_class` | TEXT | Cognac, Armagnac |
| `grappa_style` | TEXT | Grappa |

Brandy and Cognac get separate columns rather than one shared field because Cognac's VS/VSOP/XO age-class vocabulary is a formal AOC designation, while general Brandy's is not always labeled the same way — keeping them distinct avoids conflating a regulated term with an informal one, matching the project's existing distinction between `wine_classification` and free-text designation elsewhere in the schema.

### 4.2 Regex classifier — extend `assign_spirits_fields.py`

For each existing rule set (`GIN_RULES`, `AGAVE_RULES`, `RUM_RULES`, `PEAT_RULES`) and each new rule set (Vodka, Brandy, Cognac, Grappa):

1. Try matching against `name` first — **unchanged behavior**, byte-for-byte the same as today, so no regression risk to the 231 rows already correctly classified.
2. If no match, retry the same rule list against `desc_en_short`, then `full_description` if `desc_en_short` is empty.
3. Fallback is still `None` (no write) if neither name nor description match anything.

New rule sets follow the same explicit-keyword, no-brand-guessing style as the existing ones:

- **Vodka**: `flavoured` (fruit/flavor keywords in name or description) vs `plain`; optionally `column_still` / `pot_still` if the description states distillation method explicitly (mirrors the `_vodka_styles` draft already sketched in `derive_spirit_style.py`, but sourced from description text rather than assumed).
- **Brandy / Cognac**: `vs` / `vsop` / `xo` / `extra_old` from explicit age-class tokens (`VS`, `V.S.`, `VSOP`, `XO`, `X.O.`) in name or description — same word-boundary care as the existing Rum `XO` fix (`\bx\.?o\.?\b`).
- **Grappa**: `aged` (barrique/oak/riserva language) vs `young` (bianca/clear) if stated; likely to have a smaller match rate than other categories — an honest low fill rate is an acceptable outcome per Rule 5's "no bug preserved as a green test" principle applied in reverse: absence of signal should render as absence of data, not a forced classification.

**Canary discipline** (Rule 10, matching the existing script's proven pattern): canary run writes to the real DB against a real row sample across all affected categories, not a dry-run simulation — same rationale as the existing script's canary-writes-too design (`feedback_canary_must_match_prod`). Pre-run backup via `cp products.db products.db.bak-pre-substyle-<date>`.

**Data-quality review step:** before the full run, cross-reference any category whose fallback pattern list is thin (Grappa, Vodka distillation-method) against a sample of its actual description text — the same manual review the `peat_level` PEAT_RULES got in the 2026-07-09 canary review (Task 10), to catch regex gaps before they silently render as NULL en masse (acceptable) vs. silently mis-match on an unintended keyword (not acceptable).

### 4.3 LLM (Haiku) fallback — scoped, cost-bounded

After the regex pass (name + description) runs, whatever rows remain NULL in a style-bearing category get one Haiku call each, following the `derive_spirit_style.py` scaffolding:
- Controlled vocabulary per category (same enum lists already defined in that script for Gin/Rum/Tequila/Brandy/Vodka — extend with Cognac/Grappa).
- JSON response validated against the enum; anything else is dropped (never trust unvalidated LLM output as a DB write).
- Canary (small N) run first, cost extrapolated to the full residual set, estimate shown to user for sign-off before the full run — Rule 10 steps 3-5.
- Target is the **DB columns** directly (not the unshipped `spirit_style` list field) — one Haiku call writes directly to `vodka_style`/`gin_style`/etc. via the same `UPDATE ... WHERE col IS NULL` pattern the regex pass uses, so re-runs stay idempotent.

Given 100% of the known 189-row gap has description text, this residual is expected to be small (likely under 20-30 rows total) but the real number comes from running the regex pass first and counting what's left — no cost estimate is asserted here without that count.

### 4.4 Recommender wiring — `category-scorer.ts`

Confirmed against the live export: `typeForProduct()` already distinguishes Cognac and Armagnac from general Brandy as separate `category_type` values on real data (`LBD`-prefix rows: `Brandy`=142, `Cognac`=37, `Armagnac`=4) — this is not a hypothetical, it's backfilled today. Add `VODKA_TYPES = {'Vodka'}`, `BRANDY_TYPES = {'Brandy'}`, `COGNAC_TYPES = {'Cognac', 'Armagnac'}`, `GRAPPA_TYPES = {'Grappa'}` sets, each routed through `categorySignalPoints()` to `matchField(product, candidate, '<field>', 3)` — identical pattern to the existing Gin/Rum/Agave/Whisky buckets. No change to `matchField()` itself, no change to point values, no change to `isEligible()` (this is an additive signal, not a gate — consistent with how the existing category overrides work, and gating is explicitly out of scope per the audit spec's non-goals).

---

## 5. Rollout sequence

1. Migration: add 4 new columns (instant, zero cost).
2. Regex pass, dry-run/coverage report first (mirrors existing script's non-canary dry behavior): show match counts per category, per source (name vs. description), before writing anything.
3. Regex pass, canary (writes to real DB, small sample across all 7 categories) → verify via SQL count query + spot-check in `refresh_live_export.py` output + UI product page, per Rule 9/Rule 10.
4. Regex pass, full run → same verification, full count.
5. Count residual NULLs in style-bearing categories → decide if LLM fallback is even needed at meaningful scale; if the residual is near-zero, skip step 6 entirely.
6. LLM fallback (only if step 5 shows a non-trivial residual): canary → cost estimate → user sign-off → full run → verify per Rule 1/Rule 4 (query the DB column directly, not cache/log counts).
7. `refresh_live_export.py` (Rule 9 — live export is the UI source).
8. `category-scorer.ts` changes + tests.
9. Full `apps/catalog` test suite + `npm run build` + browser walkthrough of one product page per newly-scored category (Vodka, Brandy, Cognac, Grappa, plus a re-check of Gin/Rum/Tequila now that more rows are classified), per Rule 7.

---

## 6. Testing

- Unit tests in the existing `tests/test_assign_spirits_fields.py` — cover: name-match (unchanged existing cases), description-fallback-match (new), no-match-stays-null (new), and the specific brand-inference traps already documented in the script's comments (Hendrick's, Tanqueray No. TEN, Don Julio 1942) to guard against regression.
- `category-scorer.test.ts`: new cases for Vodka/Brandy/Cognac/Grappa mirroring the existing Gin/Rum/Agave/Whisky test cases.
- End-to-end DB invariant check per Rule 6: if a row's regex/LLM pass produced a value, the DB column is non-NULL for that SKU (direct SQL query, not cache/log count).
- Cost report (if LLM fallback runs) includes all 4 lines required by Rule 4: total spend, API call count, rows with the field populated, per-row cost.

---

## 7. Open Questions

- Grappa's expected fill rate is genuinely unknown until the description-mining pass runs — this spec accepts a low/zero fill rate as a valid outcome rather than pre-committing to a target.
