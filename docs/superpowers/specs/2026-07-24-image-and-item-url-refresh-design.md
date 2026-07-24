# Image URL Refresh + magento_item_url / websites Fields — Design

Date: 2026-07-24
Status: Approved (design), pending implementation

## Background

A new CSV was provided by the user:
`/Users/admin/Downloads/winenow-base-images-20260724-f3f2d67e3e2662f9cffc80069e5290a4.csv`

Columns: `sku, item_name, websites, base_image_url, item_url` — 17,682 rows.

This overlaps with an existing reconciliation pipeline
(`scripts/reconcile_image_urls.py`, `scripts/reconcile_seed_image_urls.py`)
that currently treats
`data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB -  image url .csv`
(12,147 rows, columns `sku, is_in_stock, status, brand, name, vintage,
bottle_size, thumbnail, image, small_image`) as the source of truth for
`products.db.image_url`. See `project_cross_sku_image_bug` memory for why
this pipeline exists (cross-SKU borrowed-image bug, recurring regression).

The new CSV is larger and includes two fields that don't exist anywhere in
the schema today: the live storefront product-page URL (`item_url`) and
which site(s) each SKU is listed on (`websites`, e.g. "Wine-now & Liq9",
"Liq9 B2B", "Admin", "Wine-now.asia").

Confirmed via direct inspection (2026-07-24):
- No `item_url`/`magento_item_url`/`websites`-equivalent column exists in
  `products.db` today.
- `brand` exists but is manufacturer brand, not storefront placement.
- Both `refresh_live_export.py` and `refresh_live_export_supabase.py`
  maintain independent `EXPORT_COLS` allowlists that must be kept in sync
  (comment in the Supabase variant says so explicitly) — a column missing
  from `EXPORT_COLS` is silently dropped from the export (see
  `project_export_cols_allowlist` memory).

## Goals

1. Use the new CSV as the (replacing) source of truth for `image_url`,
   since it is fresher/larger than the current masterfile image CSV.
2. Add a new field `magento_item_url` (live storefront product page URL)
   populated from the CSV's `item_url` column.
3. Add a new field `websites` (raw string, e.g. "Wine-now & Liq9, Wine-now.asia")
   populated from the CSV's `websites` column.
4. Both new fields land in `products.db` AND flow through to
   `data/live_products_export.json` (both EXPORT_COLS lists), so future UI
   or tooling work doesn't need another migration.

## Non-goals

- No parsing/normalizing `websites` into a structured enum/array in this
  pass — store the raw string as-is. Structuring it (e.g. into per-site
  boolean flags) is a follow-up if a consumer actually needs it.
- No UI changes. Nothing currently reads `magento_item_url` or `websites`;
  this pass only makes the data available.
- No changes to `reconcile_seed_image_urls.py` / `products.json` seed file
  reconciliation — that seed-sync pattern is for the JSON re-seed source
  and is out of scope unless the user asks for it later.
- Not touching the old masterfile image CSV file itself — it stays on disk
  for history, just no longer read by the reconcile script.

## Design

### 1. Source file placement

Copy the user's CSV into the repo so the pipeline is reproducible and not
dependent on a path under `~/Downloads`:

`data/data mastefile WNLQ9/winenow-base-images-20260724.csv`

(Follows the existing convention of masterfile CSVs living under
`data/data mastefile WNLQ9/`.)

### 2. Schema migration

Add two nullable TEXT columns to `products.db`:

```sql
ALTER TABLE products ADD COLUMN magento_item_url TEXT;
ALTER TABLE products ADD COLUMN websites TEXT;
```

Written as a small idempotent migration script (check
`PRAGMA table_info` before adding, so re-running is a no-op) — consistent
with how other one-off column additions in this repo are handled.

### 3. Reconciliation script

Extend `scripts/reconcile_image_urls.py` in place (not a new script) since
it already has the dry-run/--apply/verify-after-write skeleton Rule 10
wants, and this is the same "reconcile products.db against a masterfile
CSV" shape:

- Point `IMGCSV` at the new file, update column names read
  (`base_image_url`, `item_url`, `websites` instead of `image`).
- Keep existing `image_url` reconciliation behavior: if the new CSV has no
  image for a SKU, blank it in the DB (per established behavior, same as
  today) — this CSV also has a blank-image convention to preserve.
- Add `magento_item_url` reconciliation: set if different from CSV value
  (no special blank-out semantics needed beyond "match the CSV", since
  this is a new field, not a bug fix for a known-bad prior value).
- Add `websites` reconciliation: same "set if different" logic.
- Extend the printed dry-run summary to report per-field change counts
  (image_url changed / magento_item_url changed / websites changed) so a
  dry-run clearly shows the blast radius of each field before `--apply`.
- Keep the existing post-write verification loop (re-query and assert the
  write landed) — extend it to check all three fields, not just image_url.

### 4. Export wiring

Add `magento_item_url` and `websites` to `EXPORT_COLS` in:
- `scripts/refresh_live_export.py`
- `scripts/refresh_live_export_supabase.py`

Both already silently drop unknown-missing columns with a `WARN`, so no
existing behavior breaks if the migration hasn't been applied when this
runs — but the migration step above must run first for the values to
actually populate.

### 5. Verification plan (Rule 1 / Rule 6)

1. Run migration, then `PRAGMA table_info(products)` to confirm both new
   columns exist.
2. Run reconcile script in dry-run mode; inspect the printed per-field
   change counts and a sample of diffs.
3. Run with `--apply`; script's own post-write verification loop confirms
   the write landed for a sample of changed rows.
4. Direct SQL count query: `SELECT COUNT(*) FROM products WHERE
   magento_item_url IS NOT NULL AND magento_item_url != ''` (and same for
   `websites`, and for how many `image_url` values changed) — this is the
   "verify paid work landed" muscle even though this run is free, because
   it's still a bulk write to the payment-path table.
5. Run `scripts/refresh_live_export.py`, then `jq` / grep
   `data/live_products_export.json` to confirm a sample SKU shows the new
   fields populated in the actual UI-facing file — not just in the DB.

## Testing

- Extend or add a small test alongside
  `tests/test_image_url_invariants.py` (existing guard for the image bug)
  to also assert: if the reconcile source CSV has a non-blank
  `magento_item_url`/`websites` for a SKU, the DB row has it populated
  after reconciliation. This is the Rule 6 end-to-end invariant test,
  scoped to this new pipeline.

## Open questions / risks

- The new CSV may contain SKUs not present in `products.db` (new products
  not yet onboarded) — these are skipped (left alone), consistent with
  existing `reconcile_image_urls.py` behavior for CSV-only rows in the
  other direction is not symmetric; only DB→CSV matching for update is in
  scope, not inserting new products from this CSV. Confirm this is
  acceptable before implementation (expectation: yes, since onboarding new
  products is an entirely separate pipeline per
  `project_new_product_onboarding` memory).
