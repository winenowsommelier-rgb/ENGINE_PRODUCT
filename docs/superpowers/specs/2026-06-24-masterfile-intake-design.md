# Masterfile Intake → Validate → Enrich PIM → Export

**Date:** 2026-06-24
**Status:** Design approved by user; spec under review
**Branch:** `feat/masterfile-intake-2026-06-24`
**Source file:** `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`

## Goal

Intake the new MReport masterfile (11,855 distinct SKUs), validate it against the
authoritative `products.db`, fill only the gaps the DB is missing, ingest the score
data into the PIM, and export an enriched CSV in the **same 43-column shape** as the
input. Prices/cost are explicitly out of scope (user handles those in the BI app).

**Non-negotiable spine:** the DB is the source of truth. The masterfile is a stale/
newer upstream report. On any conflict the DB wins; we only FILL where the DB is
NULL/empty. (See `feedback_db_is_source_of_truth_not_masterfile`.) Country is treated
as fully settled — fill-null-only, never re-litigated — reinforced by the PR #48→#50
reversal where masterfile-driven country inference was 19/24 WRONG
(`feedback_dont_infer_country_from_brand`).

## Verified facts (queried, not assumed)

| Fact | Value |
|---|---|
| Masterfile distinct SKUs | 11,855 (62,987 raw lines due to multiline HTML desc) |
| products.db rows | 11,436 |
| SKU overlap (exact) | 11,262 |
| Masterfile-only SKUs | 588 (539 in-stock, 49 OOS; all resolve in SKU taxonomy → real current products) |
| DB-only SKUs | 174 (must still be exported) |
| Duplicate SKUs in masterfile | 5 (no value conflicts; dedupe on intake) |
| Reconciliation arithmetic | 11,855 distinct − 11,262 overlap = 593 mf-only raw; minus 5 dup-row artifacts = 588 unique mf-only. Gap report MUST assert these totals reconcile. |
| `designation` column in DB | ALREADY EXISTS, 2,711/11,436 populated (gap-fill, do not create) |
| `grape_class` column meaning | grape variety category (Blended/Chardonnay…), NOT designation |
| Designation tokens in `name` | DOC×481, DOCG×348, Brut×339, Grand Cru×256, Single Malt×161, Reserva×158… |
| Score columns | `wine_score_1..4` = bare numbers, no critic; 4 named cols (wineenthusiast/wineadvocate/winespectator/jamessuckling) = HTML w/ embedded points |
| Rows with any score | ~1,719 |
| Bare-only score rows | 839 (no critic attribution) |
| critic_scores existing rows | 3,144 (dedupe target) |
| SKU taxonomy resolver coverage | 11,436/11,436, no nulls, no "Wine product" junk (healthier than stored liquor_main_type, 89% null) |
| item_type resolver-vs-mf | 8,322 agree; 1,942 "disagree" = ~1,800 cosmetic + ~140 real signal |
| Descriptions containing HTML | 7,357/11,855 (CSV round-trip hazard) |

## Architecture & data flow

```
masterfile.csv (11,855 SKUs)
  [1] INTAKE   — dedupe 5 dup SKUs, normalize, strip HTML → staging (NO writes)
  [2] GAP REPORT (FREE) ── user reviews BEFORE any write ──┐ SIGN-OFF GATE
  [3] FREE-FILL (NULL-only, DB WINS) → products.db
  [4] SCORES → critic_scores (4 named, deduped) + score_summary/score_max (bare)
  [5] item_type → SKU-taxonomy resolver (NOT mf input) + sub-type refine tier
  [6] NEW PRODUCTS (separate sign-off) → insert 539 in-stock mf-only; park 49 OOS
  [7] PAID LLM (OPTIONAL, separate Rule-10 sign-off + cost estimate)
  [8] EXPORT → enriched 43-col CSV (QUOTE_ALL + re-parse verify) + refresh live export
  [9] VERIFY → count queries + export diff + UI spot-check
```

Steps 1–2 spend nothing and write nothing. All writes are behind the report + sign-off.

## Components (one-off scripts, on the existing repo pattern — Rule 11)

| Step | Script | Writes | Cost |
|---|---|---|---|
| 1 | `scripts/masterfile_intake.py` | staging table only | free |
| 2 | `scripts/masterfile_gap_report.py` | report JSON + MD | free |
| 3 | `scripts/masterfile_free_fill.py` | products.db | free |
| 4 | `scripts/masterfile_ingest_scores.py` | critic_scores + products | free |
| 5 | folded into free_fill + gap_report | products.db / report | free |

> Step-5 fold caution: the item_type cross-tab (bucket A/B + ~140 override
> candidates) MUST land as its own section in the gap report — verify it is not lost
> when folded into the other scripts.
| 6 | `scripts/masterfile_insert_new.py` | products.db (gated) | free |
| 7 | (deferred — not built until signed off) | — | paid |
| 8 | `scripts/masterfile_export.py` | enriched CSV + live export | free |

Canonical DB path: `data/db/products.db` (NOT root). Always pass `--db` explicitly
(prior scripts default to a stale worktree DB — `project_phase_a_enrichment_promotion`).

## Field mapping (masterfile → DB)

| Masterfile col | DB field | Rule |
|---|---|---|
| country | country | SETTLED — fill-null-only, never re-litigate |
| region | region | DB wins; fill if null |
| sub_region | subregion | DB wins; fill if null |
| item_type | (validate vs resolver `type_for`) | SKU taxonomy wins; export filled from resolver |
| grape_variety, grape_class | variety | NULL-only; PRECEDENCE: detailed `grape_variety` first, fall back to `grape_class`. Normalize "100% X"/"X 100%"/"100%X"/"X (100%)"→X; preserve blends ("60% X / 40% Y") verbatim. grape_class is grape, NOT designation |
| wine_body/acidity/tanin | body/acidity/tannin | NULL-only + flag unreliable (taste audit memory) |
| food_matching | food_matching | pipe-delimited; DB wins |
| wine_score_{4 named} | critic_scores + score_summary/score_max | parse points from HTML prose; keep prose as notes |
| wine_score_1..4 (bare) | critic_scores (attributed BY POSITION) + summary | 1=Wine Enthusiast, 2=Wine Advocate, 3=Wine Spectator, 4=James Suckling — see Score ingest rules |
| name (regex) | `designation` column ONLY | item_type-gated; REPORT before write. NEVER write the raw `classification` column (Rule 12); export ships both as distinct cols |
| short_description/description | desc_en_short/full_description | DB wins HARD (had paid enrichment); fill if null |
| price/cost/special_price/margins | SKIP | user handles in BI |

## Score ingest rules (critic_scores has NO unique index — dedupe is the script's job)

- **Dedupe key:** `(sku, critic, vintage)`. The DB has no UNIQUE constraint on
  critic_scores (verified — only non-unique indexes), so the script MUST check
  existence on this key before insert.
- **DB-wins applies to critic_scores too:** if a row already exists for
  `(sku, critic, vintage)`, the EXISTING curated row wins — skip the masterfile row,
  do not update. Set `source='masterfile'` only on genuinely new inserts.
- **Empty vs unparseable:** cells that are empty / `-` / `N/A` / dash-placeholder are
  NO-DATA → skip silently (not a parse failure). Only a non-empty cell where the
  point-regex fails is logged as unparseable (Rule 2). Define both sets explicitly in
  the parser.
- **Point regex:** match `\d{2,3}` followed by `points`/`point`/`pts` OR by a critic
  name token (handles the "91 James Suckling" no-"points" form). Strip HTML first.
- **Bare scores → score_summary/score_max are NULL-only fill** (DB wins): if the DB
  already has a curated `score_max`/`score_summary` for the SKU, do not overwrite.
  Do NOT recompute a rollup that could change a curated value.

## item_type two-bucket handling (user "teach the taxonomy more")

- Resolver `sku_taxonomy.type_for(sku)` is the source of truth; export `item_type`
  is filled from it, never copied from masterfile input (Rule 12).
- **Bucket A (~1,800, cosmetic):** Sparkling&Champagne vs Champagne/Sparkling Wine,
  Sake/Shochu spacing, Rosé vs Rose, Cachaça vs Cachaca. Resolver is more correct.
  A normalization map only.
- **Bucket B (~140, real signal):** masterfile distinguishes Champagne(478) from
  Sparkling(443); Shochu/Umeshu/Yuzushu/Soju granularity; Port/Dessert/Orange/Fruit
  Wine. Plus true mismatch override-candidates (resolver=Tequila|mf=Liqueur ×4,
  resolver=Rum|mf=Thai White Spirits ×7). Surface as a sub-type refinement tier +
  an override-candidate list for `sku_overrides.json` review — NOT an override of the
  resolver.

## Safety rules baked in (CLAUDE.md)

- **DB wins** on every conflict; free-fill writes only where DB field is NULL/empty.
- **Backup before any write** (Rule 10): `cp data/db/products.db data/db/products.db.bak-pre-masterfile-intake-<ts>`.
- **Idempotent** (`feedback_shared_db_reverts_between_turns`): re-running yields same
  result; score ingest dedupes vs existing critic_scores; re-query PRAGMA before
  trusting prior state.
- **HTML CSV round-trip:** `csv.QUOTE_ALL`; after export, re-parse the output and
  assert row count + a checksum on ≥10 sample SKUs before declaring done.
- **Designation regex:** word-boundaries, item_type-gated (Brut appears on Kriek
  BEER), and reported for spot-check before commit.
- **Score parse:** broaden beyond `\d+ points` ("91 James Suckling" form fails);
  log every unparseable non-empty cell (Rule 2 — no silent skips).
- **EXPORT_COLS trap:** any field added to the live export must be in the
  `EXPORT_COLS` allowlist or it is silently dropped (`project_export_cols_allowlist`).
  (Verified: `classification`, `designation`, `score_summary`, `score_max` are already
  in the allowlist — `classification` and `designation` are DISTINCT columns.)
- **174 DB-only SKUs** are explicitly carried into the export.
- **Rollback:** if any step's verification fails (count mismatch, round-trip mismatch,
  invariant break), STOP and restore the canonical DB from the pre-run `.bak`; do not
  leave a partial write in `data/db/products.db`. Report the failure, do not proceed.

## Gap report contents (the sign-off artifact, step 2)

1. **SKU reconciliation:** 11,262 matched / 588 mf-only (539 in-stock vs 49 OOS) / 174 DB-only / 5 dupes.
2. Per-field fill-candidates (DB-null + mf-has) counts and conflict counts (DB kept, listed).
3. item_type cross-tab: bucket A vs bucket B with the ~140 override candidates.
4. Score ingest preview — keep masterfile-incoming vs existing-DB populations
   separate so the dedupe delta is legible: masterfile rows with any score (~1,719),
   of which named-critic (→critic_scores) vs bare-only 839 (→summary only); existing
   critic_scores 3,144; NEW rows after dedupe on `(sku,critic,vintage)`; SKUs gaining
   score_summary; empty cells skipped vs unparseable cells logged.
5. Designation gap: how many null-designation rows the gated regex fills, with samples.
6. Paid-enrichment recommendation + cost estimate (if any field warrants it).

## Testing & verification (Rule 1/6)

- Integration invariant (free-fill): if staging has a value for field F on SKU X and
  DB.F was NULL, then after free-fill DB.F is populated for X (and non-null DB values
  are unchanged). Pattern: `tests/test_enrichment_db_invariants.py`.
- Integration invariant (scores → user-facing): every SKU that gained a
  `score_summary`/`score_max` in the DB has the same value in
  `live_products_export.json`. Confirm whether the catalog/finder reads critic_scores
  from the DB at build or from a separate export — if separate, that export refresh
  MUST be added to step 8 (verify before assuming it surfaces).
- Integration invariant (designation → user-facing): SKUs gaining `designation` in
  the DB show it in the export; the raw `classification` column is byte-identical
  before/after (proves Rule 12 not violated).
- Score dedupe test: re-running ingest on key `(sku, critic, vintage)` adds 0 new
  critic_scores rows and updates 0 existing rows.
- Export round-trip test: re-parse exported CSV → row count == DB export count;
  10-SKU field checksum matches.
- Final verification = count query on each populated field in the DB AND the live
  export + a UI spot-check on 3 enriched SKUs (Rule 1, Rule 7, Rule 9).

## Out of scope

- Prices, cost, special_price, B2B, margins (BI app).
- Paid LLM enrichment (step 7) — deferred behind its own estimate + sign-off.
- New-product insert of the 49 OOS mf-only SKUs (parked for review).
- A true Magento *import*-format CSV (this is the report shape, enriched).

## Open decisions resolved by user (2026-06-24)

- Export shape: same 43 columns, enriched.
- Scores: BOTH critic_scores + rolled-up score_summary/score_max.
- Fill policy: free gap report first; user signs off on any paid step.
- item_type: filled from resolver; learn bucket-B refinements + override candidates.
- designation: gap-fill the existing `designation` column only; it is exported as the
  user-facing designation/classification chip. The raw Magento `classification` column
  is a separate, distinct export column and is NEVER written by this run (Rule 12).
- 588 mf-only: investigated → insert 539 in-stock in a separate gated step, park 49 OOS.
- Bare scores: score_summary only, not critic_scores.
- Country: settled, DB final, fill-null-only.
