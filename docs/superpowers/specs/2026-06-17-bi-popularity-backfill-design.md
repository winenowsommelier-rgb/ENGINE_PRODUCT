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
- **`popularity_score` is RANK-ONLY, not an absolute/comparable value.**
  `compute_scores` min-max-normalizes across the *matched row set*
  (sync script lines 89–99), so the score depends on the window and the set of
  SKUs in the run. A score from a 365d run is NOT comparable to one from a 90d
  run, and any window change recomputes all scores. This is fine because the
  only consumer (`sort=popular`) needs rank, not magnitude. The 365d window is
  therefore a **recorded decision** (stored in `popularity_window_days`); the
  0.5/0.3/0.2 weights and min-max approach are inherited from the 90d era and
  are accepted as-is for rank purposes (Rule 3 — noted, not re-tuned, because
  rank is insensitive to the exact blend within reason).
- **Source of truth:** SQLite `products.db`. Sync writes SQLite; export reads
  SQLite; Supabase kept in step via the existing push (for general store
  consistency — NOT because the affinity rail needs it; the affinity route
  reads `co_order_affinities` + Supabase `sku_base`, never `popularity_*`).
- **NULL behaviour:** ~8,100 products with no sales in 365 days get
  `popularity_score = NULL` and sort last (matches existing `nullslast`).
- **Re-run semantics (avoids stale ranks):** because re-runs only UPDATE the
  matched set, a SKU that sold last run but not this one would keep its **old**
  rank. So the SQLite write MUST, in a single transaction, first reset all 6
  `popularity_*` columns to NULL for every row, then UPDATE the matched set.
  First run against an all-NULL table is a no-op reset; re-runs are correct.
- **Pre-flight:** full Rule-10 discipline (backup + 5-SKU canary + full run +
  UI walkthrough), even though this is a deterministic non-LLM aggregation
  that spends no API money.

## Components

### 1. `data/sync_popularity_from_bi.py` — add SQLite write path
Add a SQLite write target alongside the existing Supabase push.

- New flag: `--sqlite-db PATH` (default `data/db/products.db`).
- New flag: `--no-supabase` to allow SQLite-only runs; Supabase push stays on
  by default for general store consistency.
- Change `--window-days` default to **365**.
- **Write order: SQLite first, then Supabase.** SQLite is the UI source of
  truth (Rule 9), so it must succeed before we touch Supabase.
- **Write all 6 `popularity_*` columns to SQLite** — score, qty_90d,
  orders_90d, revenue_90d, **window_days, synced_at** — so SQLite is as
  auditable as Supabase (re-run provenance lives in both).
- **Single transaction:** `UPDATE products SET popularity_*=NULL` (reset all
  rows) then `UPDATE products SET popularity_*=? WHERE sku=?` for the matched
  set, committed atomically. This prevents stale ranks on re-run (see Decisions).
- Keyed by `sku` (verified unique, non-null, identical SKU set to products.json).
- Use WAL mode + busy_timeout/retry (per `canary_must_match_prod` memory —
  SQLite concurrent-write pattern).
- Only update existing rows; never insert.
- Print a destination count after writing: rows where `popularity_orders_90d`
  is non-NULL in SQLite (Rule 4 — "what shipped" line).
- **Partial-failure handling (Rule 4):** `push_supabase` returns
  `(sent, failed)`. If `failed > 0`, the run is NOT "done" — print the gap and
  exit non-zero. SQLite (the UI source) is already correct in that case, but
  the Supabase divergence must be surfaced, not silent.

**Not changing:** the aggregation SQL or the scoring math (`compute_scores`,
weights 0.5/0.3/0.2). Only adding a write target + the reset-then-update
transaction.

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
- **Affinity rail smoke test (unrelated to popularity, kept for the
  "all BI flows" goal):** open a product detail page, confirm "Same Order
  (Basket Affinity)" renders rows. NOTE: this proves nothing about popularity
  — the affinity route reads `co_order_affinities` + Supabase `sku_base`
  enrichment, never `popularity_*`. It does NOT gate this change; it's a
  smoke test confirming the already-shipping BI affinity feed still works.

### 4. Regression guard (Rule 6)
Add `tests/test_popularity_export_invariant.py`, asserting **both directions**:

- SKU populated in SQLite ⇒ populated in export (data shipped).
- SKU NULL in SQLite ⇒ NULL/absent in export (catches the stale-rank class —
  guards that a reset in SQLite propagates, not just additions).

Mirrors `tests/test_enrichment_db_invariants.py`.

## Out of scope (YAGNI / Rule 11)

- **Rebuilding affinities** — fresh (2026-06-12) and working.
- **Wiring popularity into `lib/recommendation/wine.ts`** — user asked for data
  flow, not a ranking-behaviour change to a working scorer.
- **Scheduler/cron** — one-off backfill; revisit if recurring sync is wanted.

## Implementation order (Rule 10 pre-flight)

1. `cp data/db/products.db data/db/products.db.bak-pre-popularity` — **before**
   the canary, since the canary mutates the real DB.
2. Edit `sync_popularity_from_bi.py` (SQLite write path, reset-then-update
   transaction, 365d default, SQLite-first ordering, partial-failure exit).
3. Canary: run on 5 SKUs against the **real SQLite write path** (WAL/retry, not
   a dry-run) → real export refresh → verify those 5 in export. The canary must
   exercise the exact prod write path (`canary_must_match_prod` memory).
4. Full run: ~3,295 SKUs → SQLite (then Supabase).
5. `python scripts/refresh_live_export.py`.
6. Verify: SQLite count, export count, browser `sort=popular`, affinity smoke.
7. Add + run the regression-guard test.

## Success criteria

- `popularity_orders_90d` populated for **~3,295 SKUs (low thousands; report the
  actual number, sanity-check the magnitude — not an exact-match gate)** in
  **both** SQLite and the export JSON. The live count depends on the BI mart at
  run time.
- `sort=popular` in the live UI orders products by real 365-day sales; top SKUs
  match the sync's top-5 preview.
- Supabase push reports `failed == 0` (else surfaced, not silent).
- "Same Order (Basket Affinity)" rail confirmed still rendering (smoke test).
- Bidirectional regression-guard test passes.
