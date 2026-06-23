# Spec — Re-enrich descriptions for country-corrected SKUs (Rule-10 paid)

**Status:** DRAFT — awaiting cost sign-off (Rule 10 step 5)
**Date:** 2026-06-23
**Branch:** continue on `fix/kai-country-vietnam-misclassification` (PR #48) or a follow-up.

## Problem

The country-data fixes in PR #48 corrected the structured `country`/`category`
fields, but the **AI-generated prose descriptions** (`desc_en_short` /
`full_description` / `desc_en_full`) were written off the OLD wrong country and
are now factually false. Browser check on the Vercel preview (Rule 7) caught:

- `LSJ0024DG` Kai → *"Vietnamese spirit… draws from Vietnamese grain
  production… Vietnamese cuisine"* (it's New Zealand)
- `WSP5672-74GE` → *"Australian Prosecco"* — **impossible**, Prosecco is Italian
  by DOC law
- `LGN0125-0134ER`, `LVK0652ER` Buss → *"Belgian gin from Buss 509"* (English)
- `LLQ0304/0309/0311BU` Hiram Walker → *"Peoria-distilled… Illinois facility"*
  (Canadian)
- `LGN0340-0342DJ` Sikkim → enricher **refusals**: *"STOP: contradictory
  metadata", "UNABLE TO CURATE — conflicting product data"*

## Scope

**Exact target SKU list:** `data/_desc_reenrich_skus.json` (regenerate before
running — see Acceptance). As of 2026-06-23 it is ~22 genuine cases. Two
false-positive classes to EXCLUDE (these are correct as written):

- "American white oak" / "American oak" = cask material, not origin
  (`LRM0163AD`, `LRM0164AD` Angostura — "Trinidad… aged in American white oak"
  is fine; only re-enrich if other Trinidad/Caribbean facts are wrong).
- "Champagne-region white wine base" on an English gin (`LGN0130ER`) = the
  *base wine* genuinely is from Champagne; the gin is still English. Keep unless
  the description also calls the gin itself Belgian.

Net: ~19–22 SKUs. Confirm the final count in the canary step.

## Approach (Rule 11 — build on existing skeleton)

Do NOT write a new enricher. Two existing scripts already do this with Rule-10
safety baked in (`--dry-run`, `--limit`, `--db`, auto-backup):

| Script | Model | Cost/SKU | Style |
|---|---|---|---|
| `scripts/phase_d3_enrich_no_signal.py` | Haiku 4.5 | ~$0.0003 | concise |
| `scripts/reenrich_with_brand_library.py` | Sonnet 4.6 | ~$0.013 | storytelling ~1500ch |

**Recommendation: `phase_d3` (Haiku).** These 22 are mostly mainstream
spirits/accessories needing a short correct description, not premium
storytelling. Haiku is ~40× cheaper and the failure here was *wrong facts*, not
*thin prose*. Total est: **22 × $0.0003 ≈ $0.007** (under one cent). If you want
richer copy for any premium SKU (e.g. Kavalan-tier), cherry-pick those few
through `reenrich_with_brand_library` afterward.

**One required code change:** neither script accepts an explicit SKU list. Add a
`--skus path.json` arg (read a JSON array, filter the query `WHERE sku IN (...)`).
~10 lines; mirrors the existing `--limit` plumbing. This makes the enricher
reusable for any targeted re-enrich (Rule 11 reuse).

## Rule-10 checklist (MANDATORY before full run)

1. `cp data/db/products.db data/db/products.db.bak-pre-descfix-<ts>` (script's
   auto-backup also covers this; keep both).
2. Regenerate `data/_desc_reenrich_skus.json` against the CURRENT (corrected) DB
   so it reflects post-PR-#48 country values.
3. **Canary:** `--skus … --limit 3 --dry-run` → eyeball the 3 generated
   descriptions; confirm they state the CORRECT country and no "STOP/UNABLE".
4. Estimate full cost from canary token counts; show the user the number.
5. **Get user sign-off on the estimate** (this gate is why the spec exists).
6. Full run: `--skus data/_desc_reenrich_skus.json`.
7. **Verify at destination (Rule 1/9):** query the export, confirm 0 SKUs in the
   list still mention any wrong-country demonym; spot-check the Kai page on the
   Vercel preview renders "New Zealand" prose. `refresh_live_export.py`.

## Acceptance criteria

- All target SKUs have `desc_en_short` + full description that name the CORRECT
  country (or no country) and contain no "STOP/UNABLE TO CURATE/contradictory".
- `data/live_products_export.json` refreshed; destination query shows 0 stale
  demonyms among the target SKUs.
- Browser check: Kai product page prose no longer says "Vietnamese".
- Cost report (Rule 4): total spend, # API calls, # rows where `desc_en_short`
  is populated & country-correct, per-row cost.

## Cost summary (estimate, pre-run)

- ~22 SKUs × Haiku ~$0.0003 ≈ **< $0.01 total.** Trivial, but Rule 10 still
  applies because it's a paid LLM write to the user-facing table.
