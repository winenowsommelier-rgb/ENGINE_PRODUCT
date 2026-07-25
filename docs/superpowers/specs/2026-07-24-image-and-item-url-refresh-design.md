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
  `project_export_cols_allowlist` memory). **Pre-existing gap, out of
  scope for this design:** the two lists are already out of sync today —
  the Supabase variant is missing several columns the SQLite export has
  (`gin_style`, `reputation_*`, `curation_dossier`, etc). This design adds
  the two new columns to both lists but does not reconcile the
  pre-existing drift. Flagging so it isn't mistaken for something this
  change introduced.
- **New CSV completeness, checked directly:** 0 of 17,682 rows have a
  blank `base_image_url` (vs. 22/12,146 blank in the old masterfile CSV).
  The new CSV does not carry the same "blank means intentionally no
  image" convention the old one did.
- **Coverage gap:** 141 SKUs currently in `products.db` are absent from
  the new CSV entirely (not just blank — not present as a row at all).
  48 of those 141 currently have a populated `image_url`. Under the
  existing "SKU absent from masterfile → leave untouched" rule, these 141
  stay on whatever `image_url`/etc. they have today. So this is **not a
  strict replacement** of the old source for every SKU — it's the
  primary source, with a ~141-SKU residual gap. Worth surfacing to the
  user before implementation, not silently absorbed.
- 154 SKU values in the new CSV carry suffixes (case-pack markers like
  `-24P`/`-12P`/`-6`, size variants like `-200ml`) that won't match any
  `products.db.sku` directly — harmless (they just fall into "SKU not in
  DB" and get skipped, same bucket as any other unmatched CSV row), but
  noted so the count isn't mistaken for a bug during implementation.

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
- Keep the existing `image_url` blank-out code path (SKU present in CSV
  with an empty `base_image_url` → blank the DB value) **guarded but
  effectively dormant for this CSV**: 0/17,682 rows have a blank
  `base_image_url` today, so this path won't fire on the current data.
  It stays in the code (not deleted) because a future refresh of this
  same CSV could legitimately carry a blank for a delisted SKU, and Rule
  3 says don't assume a threshold/behavior is right without checking —
  here it's kept because it's directly analogous to the existing
  masterfile behavior, not because it's proven necessary for this file.
  Add a one-line log call-out if the blank-out path fires 0 times on a
  given run, so a future maintainer doesn't mistake "dormant" for
  "broken."
- SKUs present in `products.db` but absent from the new CSV (141 today,
  48 with a currently-populated `image_url`) are left untouched, same as
  today's "no_master" behavior — logged distinctly from "reconciled" and
  "blanked" counts so the ~141-SKU residual gap is visible on every run,
  not just discovered once during spec review.
- Add `magento_item_url` reconciliation: for a SKU present in the CSV,
  set `magento_item_url` to the CSV's `item_url` value if different from
  the current DB value — including setting it to `''`/NULL if the CSV
  value is blank for that SKU (unlike `image_url`, there is no prior
  "known-good" value being protected here, so mirror the CSV exactly).
  SKU not present in the CSV at all → leave the DB value untouched (same
  no-master rule as image_url).
- Add `websites` reconciliation: identical semantics to
  `magento_item_url` above (mirror CSV value including blanks; leave
  untouched if SKU absent from CSV).
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
   change counts (reconciled / blanked / left-untouched-no-master) and a
   sample of diffs for each of the three fields.
3. Run with `--apply`; script's own post-write verification loop confirms
   the write landed for a sample of changed rows, across all three
   fields.
4. Direct SQL count queries against `products.db` (not just log lines —
   Rule 1):
   - `SELECT COUNT(*) FROM products WHERE magento_item_url IS NOT NULL
     AND magento_item_url != ''`
   - `SELECT COUNT(*) FROM products WHERE websites IS NOT NULL AND
     websites != ''`
   - `SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND
     image_url != ''` (before/after comparison)
   - These three counts must be reported to the user alongside the
     dry-run diff counts — the two should be consistent (e.g. populated
     count ≈ CSV rows matched minus blanks minus left-untouched).
5. Run `scripts/refresh_live_export.py` AND
   `scripts/refresh_live_export_supabase.py` (both consume EXPORT_COLS,
   both must be updated). For each, run a **count query against the
   output**, not a spot-check of one sample SKU:
   - `jq '[.[] | select(.magento_item_url != null and .magento_item_url
     != "")] | length' data/live_products_export.json`
   - Same for `websites`.
   - Compare these counts against the Step 4 DB counts — they must match
     (modulo any products filtered out of the export for unrelated
     reasons, e.g. out-of-stock exclusions already documented for other
     fields). A mismatch here is exactly the Rule 1/Rule 9 failure mode
     this project has hit before (category_group missing entirely,
     flavor_tags_canonical empty for days) and must be investigated
     before declaring the run complete.

## Testing

- Extend `tests/test_image_url_invariants.py` in place (do not repoint it
  away from its current purpose — it guards the cross-SKU borrowed-image
  regression) to additionally cover the new CSV path:
  - Positive case: if the reconcile source CSV has a non-blank
    `magento_item_url`/`websites` for a SKU, the DB row has it populated
    after reconciliation (Rule 6 end-to-end invariant).
  - Negative/regression case for the carried-over blank-out path: since
    this behavior is dormant on the real CSV (0 blanks today) but still
    load-bearing code, add a small synthetic-CSV-fixture test that feeds
    a row with a blank `base_image_url` for a SKU that currently has a
    populated `image_url`, and asserts the DB value gets blanked. This is
    the only way to prove the carried-over logic still works, since the
    real data never exercises it.
  - Explicitly assert the "SKU not in CSV → left untouched" behavior for
    all three fields (image_url, magento_item_url, websites) with a
    fixture SKU absent from the CSV.

## Open questions / risks

- The new CSV contains SKUs not present in `products.db` (new products not
  yet onboarded) — these CSV-only rows are ignored; this design only
  updates existing `products.db` rows, it does not insert new products.
  Onboarding new products is a separate pipeline
  (`project_new_product_onboarding` memory) and out of scope here.
- Conversely, 141 `products.db` SKUs are absent from the new CSV (48 with
  a currently-populated `image_url`) — confirmed by direct inspection.
  These are left untouched by this reconciliation, meaning the new CSV
  functions as the *primary* source of truth going forward, not a
  complete drop-in replacement for every existing SKU. Surface this
  count to the user as part of the dry-run report so it's a visible,
  known gap rather than a silent one.
- The new CSV's blank-out convention for `image_url` doesn't fire on
  current data (0/17,682 blanks) — see Reconciliation Script section for
  why the code path is kept anyway and how it's tested despite being
  dormant.
