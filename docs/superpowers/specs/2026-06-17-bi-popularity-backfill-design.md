# BI Popularity Backfill — Design

**Date:** 2026-06-17
**Status:** Approved for implementation
**Branch:** feat/critic-score-harvester (or new branch)

## Problem

The explore UI's `sort=popular` ordering produces no meaningful result because
all six `popularity_*` fields are empty. Verified against the real sources
(not inferred):

| Store | popularity_orders_90d populated |
|-------|--------------------------------|
| `data/live_products_export.json` (UI source) | 0 / 11,436 |
| `data/db/products.db` (SQLite, export source) | 0 / 11,436 |

A prior session framed this as "wire up BI before launching co-purchase
recommendations." That framing was wrong on investigation:

- **Co-purchase ("bought together") recommendations already ship.**
  `scripts/export-bi-affinities.py` computes real co-order + co-customer
  affinities from BI order data → `data/bi-product-affinities.json`
  (5,351 base products, exported 2026-06-12). Served by
  `app/api/products/[id]/route.ts` and rendered as the "Same Order (Basket
  Affinity)" rail in `components/product/ProductDetailPanel.tsx`.
- **Attribute-based recommendations already ship** and do not use popularity
  (`lib/recommendation/wine.ts` scores category/grape/origin/structure/
  flavor/price/quality).
- **Popularity is the only genuinely-empty BI feed**, and it powers only the
  `sort=popular` ordering in `app/api/explore/products/route.ts`, not the
  recommendation engine.

**Goal (per user):** make all BI-derived data flow end-to-end into the UI and
verify it, with SQLite `products.db` as the source of truth for popularity.

## Root-cause: two-store mismatch (Rule 9)

`data/sync_popularity_from_bi.py` exists and works — a dry-run aggregates
clean data from the BI DuckDB. **But it writes only to Supabase.** The explore
UI reads `data/live_products_export.json`, which is generated from SQLite
`products.db` by `scripts/refresh_live_export.py`. So running the sync as-is
would land popularity in Supabase while the UI still shows 0 — the exact
silent-drop failure mode the project's ABSOLUTE RULES exist to prevent.

The fix routes popularity into SQLite (new source of truth), refreshes the
export, and keeps Supabase in step.

## Decisions

- **Window:** 365 days. Coverage by window (dry-run, matched to products.json):
  90d=1,241 · 180d=2,320 · **365d=3,295** · 730d=4,283. 365d is the sweet spot
  before diminishing returns; "popular" still means recent-ish. The window is
  stored in `popularity_window_days`, so it's auditable and re-runnable.
- **Source of truth:** SQLite `products.db`. Sync writes SQLite; export reads
  SQLite; Supabase kept in step via the existing push.
- **NULL behaviour:** ~8,100 products with no sales in 365 days get
  `popularity_score = NULL` and sort last (matches existing `nullslast`).
- **Pre-flight:** full Rule-10 discipline (backup + 5-SKU canary + full run +
  UI walkthrough), even though this is a deterministic non-LLM aggregation
  that spends no API money.

## Components

### 1. `data/sync_popularity_from_bi.py` — add SQLite write path
Add a SQLite write target alongside the existing Supabase push.

- New flag: `--sqlite-db PATH` (default `data/db/products.db`).
- New flag: `--no-supabase` / keep Supabase push on by default so both stores
  stay consistent (the affinity route's `sbGet` lookups depend on Supabase).
- Change `--window-days` default to **365**.
- Write the 6 `popularity_*` columns keyed by `sku`, via
  `UPDATE products SET popularity_* = ? WHERE sku = ?`.
- Use WAL mode + busy_timeout/retry (per `canary_must_match_prod` memory —
  SQLite concurrent-write pattern).
- Only update existing rows; never insert (mirrors the Supabase
  `merge-duplicates`-on-existing behaviour).
- Print a destination count after writing: rows where `popularity_orders_90d`
  is non-NULL in SQLite (Rule 4 — "what shipped" line).

**Not changing:** the aggregation SQL or the scoring math (`compute_scores`,
weights 0.5/0.3/0.2). Only adding a write target.

### 2. `scripts/refresh_live_export.py` — run, no change
Already projects all 6 `popularity_*` columns (lines 39–40). Running it after
the SQLite write carries popularity → `live_products_export.json`.

### 3. Verification (Rules 1, 4, 6, 7)
Verification is destination queries, not "the script ran":

- **SQLite:** `SELECT COUNT(*) FROM products WHERE popularity_orders_90d IS NOT NULL`
  → expect ~3,295.
- **Export JSON:** same count in `live_products_export.json` → expect ~3,295
  (proves it reached the UI source).
- **Browser (Rule 7):** start dev server, open explore with `sort=popular`,
  confirm ordering by real sales; confirm top SKUs match the sync's top-5
  preview.
- **Affinity rail re-check (the "all BI flows" check):** open a product detail
  page, confirm "Same Order (Basket Affinity)" renders rows. (Depends on
  Supabase `sku_base` lookups, not the export — confirm that path resolves.)

### 4. Regression guard (Rule 6)
Add `tests/test_popularity_export_invariant.py`: if SQLite has popularity for
SKU X, the export has it for X. Mirrors `tests/test_enrichment_db_invariants.py`.

## Out of scope (YAGNI / Rule 11)

- **Rebuilding affinities** — fresh (2026-06-12) and working.
- **Wiring popularity into `lib/recommendation/wine.ts`** — user asked for data
  flow, not a ranking-behaviour change to a working scorer.
- **Scheduler/cron** — one-off backfill; revisit if recurring sync is wanted.

## Implementation order (Rule 10 pre-flight)

1. `cp data/db/products.db data/db/products.db.bak-pre-popularity`
2. Edit `sync_popularity_from_bi.py` (SQLite write path, 365d default).
3. Canary: run on 5 SKUs → SQLite → refresh export → verify those 5 in export.
4. Full run: ~3,295 SKUs → SQLite + Supabase.
5. `python scripts/refresh_live_export.py`.
6. Verify: SQLite count, export count, browser `sort=popular`, affinity rail.
7. Add + run the regression-guard test.

## Success criteria

- `popularity_orders_90d` populated for ~3,295 SKUs in **both** SQLite and the
  export JSON (count shown to user).
- `sort=popular` in the live UI orders products by real 365-day sales.
- "Same Order (Basket Affinity)" rail confirmed still rendering.
- Regression-guard test passes.
