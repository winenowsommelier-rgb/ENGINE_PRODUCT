# New-Product Onboarding — 498 in-stock beverages

**Date:** 2026-06-25
**Status:** Design — under spec review
**Source file:** `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`
**Predecessor:** PR #52 (masterfile enrichment) — merged to main `d332a2f`

## Goal

Insert the 498 in-stock beverage SKUs the masterfile carries but the PIM is missing,
as **complete, sellable** catalog products with prices set inline, so a revenue-facing
gap (in-stock items absent from the catalog) closes now. Images don't exist yet
(verified 404) — products launch with a placeholder and are flagged for a later
image-upload batch. The broad price-import for the ~7,068 existing cost-gap products
is a **separate later run** that reuses the margin-recompute logic established here.

## Verified facts (queried, not assumed)

| Fact | Value |
|---|---|
| In-stock mf-only beverages | **498** (excludes 41 accessories, 49 OOS) |
| Their data completeness | name/brand/country/price/cost/item_type/short_description/manufacturer/bottle_size = 498/498; full_description 465/498; vintage 342/498 |
| Images on Magento server | **0/498 — all HTTP 404** (verified via `/media/catalog/product/{a}/{b}/{sku}.jpg`); masterfile has NO image column |
| Catalog tolerates blank image_url | YES — 66 in-stock products already live imageless; `StorefrontImage.tsx` renders a Maison placeholder |
| `featured.ts:45` requires | `is_in_stock && image_url` → the 498 are sellable/browsable but NOT homepage-featured until images land (acceptable) |
| Catalog visibility gate | `is_in_stock` (+ `image_url` for featured only) — NOT `is_active` |
| `is_active` in catalog | NOT used (BI/internal only; not in EXPORT_COLS) |
| Margin-leak chokepoint | `catalog-data.ts` strips internal fields; `cost` is NOT in EXPORT_COLS (stays internal). A margin leak is a production break (`types.ts`). |
| DB price columns | already exist: cost, price, special_price, sp_discount_pct, b2b_price, b2b_margin_*, margin_thb, margin_pct |
| Type source of truth | `sku_taxonomy.type_for(sku)` (Rule 12) — NOT masterfile item_type |

## What each new product gets

| Field | Source |
|---|---|
| sku, name, brand, country, manufacturer, bottle_size, vintage | masterfile (verbatim) |
| short_description → desc_en_short; description → full_description | masterfile |
| `classification` (Magento TYPE field) | `sku_taxonomy.type_for(sku)` — Rule 12, NOT masterfile item_type |
| cost, price, special_price, b2b_price | masterfile (INPUT — masterfile is source of truth for price inputs) |
| margin_thb, margin_pct, sp_discount_pct, b2b_margin_thb, b2b_margin_pct, b2b_discount_pct | **RECOMPUTED** from cost/price/b2b (never read the file's margin cells) |
| currency | `'THB'` |
| is_in_stock | `'1'` (these are the in-stock set) |
| is_active | `1` |
| image_url | **blank** (404 on server; placeholder renders) |
| enrichment_source | `'masterfile_onboard_2026-06-25'` (queryable set for later image batch) |
| created_at / updated_at | now (UTC) |

Excluded entirely (out of scope): 41 accessories (Riedel/Vinobox — different handling),
49 OOS SKUs (parked), descriptive enrichment beyond what the masterfile carries
(taste/scores can be a later enrichment pass on these SKUs).

## Margin recompute formulas (the numeric-correctness risk)

```
margin_thb      = price − cost
margin_pct      = (price − cost) / price            # guard price > 0
sp_discount_pct = (price − special_price) / price   # only if special_price present & > 0
b2b_margin_thb  = b2b_price − cost                  # only if b2b_price present
b2b_margin_pct  = (b2b_price − cost) / b2b_price    # guard b2b_price > 0
```
All derived from masterfile INPUT columns; the file's own Margin/Discount cells are
ignored. This logic becomes the reusable core for the later price-import run.
Edge cases: cost > price (negative margin) → allowed but flagged in the pre-flight
report for review; cost or price missing/0 → SKU excluded from insert and reported
(can't price it).

## Architecture & data flow

```
masterfile.csv
  → filter: in-stock AND beverage (resolver type ∉ accessory set) AND sku ∉ products
  → PRE-FLIGHT REPORT (read-only): the exact N, price sanity (negative-margin / missing-cost
     list), type distribution, sample rows  ── USER SIGN-OFF GATE (Rule 10) ──
  → backup DB (WAL-checkpoint + copy)
  → INSERT rows (idempotent: skip any sku already in products)
  → VERIFY: COUNT(*) rose by exactly N; every new row has price>0, cost>0,
     classification≠null, currency='THB', is_active=1, margin_thb == price−cost
  → refresh live export → confirm N new SKUs in live_products_export.json
  → Rule 7: browse catalog + open 3 new product pages (render, placeholder, price)
```

## Components (one-off scripts on the existing pattern — Rule 11)

| Script | Responsibility |
|---|---|
| `scripts/onboard_new_products.py` | pre-flight report (`--dry-run`), backup, idempotent INSERT, margin recompute, verify counts |
| reuse `scripts/refresh_live_export.py` | export refresh (Rule 9) |
| `tests/test_onboard_new_products.py` | insert/margin/no-overwrite/reaches-export invariants |

Reuses `scripts/masterfile_lib.py` (load_masterfile, is_empty_cell) and
`data/lib/taxonomy/sku_taxonomy.py` (type_for). Canonical DB `data/db/products.db`.

## Safety rules (CLAUDE.md)

- **Idempotent**: INSERT only where `sku NOT IN products`; re-run inserts 0.
- **Insert-only / no-overwrite**: the run must NOT modify any of the 11,436 existing
  rows. Test asserts existing rows are byte-identical (checksum) before/after.
- **Backup before insert** (WAL-checkpoint + copy), Rule 10 pre-flight: report →
  sign-off → backup → insert → verify in DB AND export AND browser.
- **Run-time N**: computed live (stock changes); reconciled against the pre-flight
  report; NOT hardcoded 498.
- **Margins recomputed**, never read from the file (price model;
  `feedback_price_ownership_bi_writes_db`).
- **Type from resolver**, never masterfile item_type (Rule 12).
- **cost stays internal**: `cost` is not in EXPORT_COLS and the catalog margin-leak
  chokepoint strips it — confirm no new field added to the export leaks cost/margin.
- **EXPORT_COLS**: verify every catalog-facing field a new row needs is in the
  allowlist (else silently dropped — Rule 9).

## Testing (Rule 1/6/7)

- **Insert count**: after run, `COUNT(*)` == before + pre-flight N.
- **Completeness**: every onboarded SKU has price>0, cost>0, classification≠null,
  currency='THB', is_active=1, is_in_stock='1'.
- **Margin correctness**: for all onboarded rows, `margin_thb == round(price − cost, 2)`
  and `margin_pct` matches the formula (payment-path — catches a recompute bug).
- **No-overwrite**: the 11,436 pre-existing rows are unchanged (row checksum).
- **Reaches export**: the N new SKUs appear in `live_products_export.json` with price
  and classification; `cost` does NOT appear (margin-leak guard).
- **Rule 7**: browser walkthrough of 3 new product pages (placeholder + price render).

## Out of scope (separate runs)

- Price-import for the ~7,068 existing cost-gap products (own spec; reuses recompute).
- 41 accessories + 49 OOS SKUs.
- Bottle-shot upload to Magento + the image-sync run that follows (manual upload first).
- Taste/score enrichment of the 498 (a later enrichment pass).

## Open decisions resolved by user (2026-06-25)

- Sequence: onboard new products FIRST (revenue — missing in-stock items), price-import later.
- New-product prices: set inline during insert → immediately sellable.
- Images: launch imageless with placeholder; flag for later upload (all 404 verified).
- Visibility: is_active=1, fully sellable, tagged `masterfile_onboard_2026-06-25`.
- Margins: always recomputed from cost+price, never trust the file's cells.
