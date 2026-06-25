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
| Type source of truth | `sku_taxonomy.type_for(sku)` (Rule 12) — NOT masterfile item_type. Catalog re-derives `category_type` from SKU prefix at export; `classification` is ignored by the catalog. |
| `id` column | **`TEXT PRIMARY KEY`, NOT autoincrement** — script MUST assign it (`onboard-{sku}`) |
| pct columns | `margin_pct`/`sp_discount_pct`/`b2b_margin_pct`/`b2b_discount_pct` are **TEXT** (not REAL) — write format-matched strings |
| `margin_pct`/`b2b_margin_pct` in export | present in raw export JSON; stripped at catalog `PUBLIC_FIELDS` (`toPublicProduct`) — test the public projection |
| mf-only SKUs resolving to 'Unknown' | 0/588 today (verified) — but pre-flight must still guard (stock churn) |

## What each new product gets

| Field | Source / type | Notes |
|---|---|---|
| **id** | `f"onboard-{sku}"` | **REQUIRED** — `id` is `TEXT PRIMARY KEY`, NOT autoincrement (verified). Existing convention is `row-{seq}-{epoch_ms}`; we use `onboard-{sku}` (collision-proof, distinguishable, idempotent). Verify no NULL/dup id. |
| sku, name, brand, country, manufacturer, bottle_size, vintage | masterfile (verbatim) | `sku` is NOT NULL + UNIQUE index |
| short_description → desc_en_short; description → full_description | masterfile | |
| `classification` | **DO NOT WRITE** (leave NULL) | Rule 12: catalog IGNORES `classification` and re-derives category from the SKU prefix on every export refresh (`refresh_live_export.py` `category_type`). Writing resolver-type here is wrong-vocab (resolver says "Sparkling & Champagne"; classification vocab is "Champagne"/"Sparkling Wine") AND dead. If an internal DB value is ever wanted, write it with `classification_source='resolver_onboard_2026-06-25'` — but default is leave NULL. |
| cost, price, special_price, b2b_price | masterfile (INPUT); REAL cols | parse string→float (strip commas/currency); exclude+report on parse failure |
| margin_thb, b2b_margin_thb | **RECOMPUTED**; REAL cols | rounded to 2 dp |
| margin_pct, sp_discount_pct, b2b_margin_pct, b2b_discount_pct | **RECOMPUTED**; **TEXT cols** (verified) | write as a **bare 2-decimal string** `str(round(ratio*100, 2))` — production stores `'31.43'`, `'30.0'` (verified 11,262/11,298 rows; the 36 `'27%'`-style rows are legacy junk). NOT `'NN%'`, NOT `'0.27'`. Banker's rounding matches production exactly. NULL when input (special_price/b2b_price) absent — never 0/"". |
| currency | `'THB'` | |
| is_in_stock | `'1'` (string, not int — `isInStock()` normalizes) | |
| is_active | `1` | NOT used by catalog (BI/internal); harmless |
| image_url | **blank/NULL** (404 on server; placeholder renders) | |
| enrichment_source | `'masterfile_onboard_2026-06-25'` | queryable set for later image batch |
| created_at / updated_at | now (UTC) | ⚠️ see "no newest-sort" risk below |

Excluded entirely (out of scope): 41 accessories (Riedel/Vinobox — different handling),
49 OOS SKUs (parked), descriptive enrichment beyond what the masterfile carries
(taste/scores can be a later enrichment pass on these SKUs).

## Margin recompute formulas (the numeric-correctness risk)

```
margin_thb      = price − cost
margin_pct      = (price − cost) / price            # guard price > 0; written as f"{round(ratio*100)}%" string
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
  → de-dupe the in-memory set (masterfile has had dup SKUs); last-wins
  → filter: in-stock AND beverage (resolver type ∉ accessory set) AND sku ∉ products
  → PRE-FLIGHT REPORT (read-only) ── USER SIGN-OFF GATE (Rule 10) ──:
       • exact N + dup-SKU collisions removed
       • prefix coverage: any SKU whose resolver type == 'Unknown' (today 0/588, but
         stock churn could add a new prefix — BLOCK + list if any appear; fix
         sku_prefix_map.json first)
       • price-parse failures (cost/price not castable to float) → excluded + listed
       • negative-margin rows (cost > price) → listed for review (allowed but flagged)
       • missing-cost/price rows → excluded (can't price) + listed
       • type distribution, sample rows
  → backup DB (WAL-checkpoint + copy)
  → INSERT all rows in a SINGLE TRANSACTION (BEGIN…COMMIT; rollback on ANY error —
     all-or-nothing, no half-set). Idempotent: skip any sku already in products.
  → VERIFY: COUNT(*) rose by exactly N; every new row has price>0, cost>0,
     currency='THB', is_in_stock='1', non-NULL non-dup id, margin_thb == round(price−cost,2)
  → refresh live export → confirm N new SKUs in live_products_export.json AND their
     category_type is non-'Unknown' in the export
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
- **Completeness**: every onboarded SKU has price>0, cost>0, a non-NULL non-dup `id`,
  currency='THB', is_active=1, is_in_stock='1'. (`classification` is intentionally NULL —
  do NOT assert it; category comes from the resolver at export time.)
- **Margin correctness**: for all onboarded rows, `margin_thb == round(price − cost, 2)`
  and `margin_pct` matches the formula (payment-path — catches a recompute bug).
- **No-overwrite**: the 11,436 pre-existing rows are unchanged (row checksum).
- **Reaches export**: the N new SKUs appear in `live_products_export.json` with price
  and a non-'Unknown' `category_type`.
- **Margin-leak (test the CHOKEPOINT, not just the file)**: `margin_pct` and
  `b2b_margin_pct` ARE present in the raw `live_products_export.json` (verified) and are
  stripped only by the catalog's `PUBLIC_FIELDS` allowlist (`catalog-data.ts`
  `toPublicProduct`). So assert the **public projection** of each new SKU carries NO
  `cost` / `b2b_price` / `margin_pct` / `b2b_margin_pct` — testing cost-absence in the
  raw export alone would pass while margin leaks. (Catches future EXPORT_COLS/PUBLIC_FIELDS drift on exactly these rows.)
- **Rule 7**: browser walkthrough of 3 new product pages (placeholder + price render).

## Risks to hold the line on

- **Do NOT add a "Newest" / created_at sort in this run.** The catalog has no
  created_at sort today; default `/shop` sort is `recommended` (in-stock→sellers→premium),
  so 498 imageless newcomers with no popularity sort LOW, not top. The insert sets
  `created_at = now`, so a future newest-sort would surface 498 placeholder cards at the
  top of /shop and read as a quality drop. Keep it out of scope.
- **Featured surface is image-gated** (`featured.ts`): the 498 can't reach the homepage
  feature row until images land — correct, no action.
- **Placeholder icon is a wine glyph** for all types — fine, but prioritize the
  visually-odd non-wine SKUs (Grappa/Absinthe/Whisky/Gin) in the later image batch.

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
