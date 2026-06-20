# BI Popularity Backfill & Popular-in-Category Recs — Design

**Date:** 2026-06-17 (rewritten 2026-06-20 — scope changed from sort-dropdown to two-phase)
**Status:** Approved for implementation (Phase 1); Phase 2 specified, gated on taxonomy backfill
**Branch:** feat/wnlq9-catalog

## Scope change notice

An earlier version of this spec framed the work as "wire up the empty
`sort=popular` ordering." That framing is superseded. The real goals, confirmed
with the user:

1. **Fix the degenerate `popularity_score`** (a real distribution bug, below).
2. **Backfill all six `popularity_*` fields** into SQLite → export, verified.
3. **Compute "popular in same category" recommendations** and export them in a
   Magento-consumable shape (rendering is Magento's job, outside this repo).

These split cleanly into two phases by dependency:

- **Phase 1 — Popularity backfill + score fix.** No category dependency.
  **Build now.**
- **Phase 2 — Popular-in-category recs + Magento export.** Groups by
  `category_group` from the canonical SKU taxonomy
  (`docs/superpowers/specs/2026-06-20-canonical-sku-taxonomy-design.md`).
  **Specified now; implementation runs after Phase 1 popularity data AND the
  taxonomy backfill both land.**

## Verified state (2026-06-20, not inferred)

- All six `popularity_*` fields are **0 / 11,436** populated in
  `data/live_products_export.json`, in SQLite `data/db/products.db`, and in
  Supabase. **Nothing has run.**
- `data/sync_popularity_from_bi.py` exists and aggregates clean per-SKU sales
  from the BI DuckDB (`marts.mart_pivot_base`,
  `/Users/admin/Desktop/CLAUDE DATA_WNLQ9 M REPORT ALL/...`). **It writes only to
  Supabase today** — no SQLite write path.
- **Two-store gotcha (Rule 9):** the explore UI reads
  `data/live_products_export.json`, generated from SQLite `products.db` by
  `scripts/refresh_live_export.py`. Running the sync as-is would land popularity
  in Supabase while the UI still shows 0 — the exact silent-drop failure the
  ABSOLUTE RULES exist to prevent.
- The canonical SKU taxonomy is a **committed design spec** (`39daa02`) but its
  `category_group` / `category_type` fields are **not yet written** into the
  export — that spec is itself pre-implementation. Phase 2 depends on those
  fields existing.

## The score bug (root cause, verified in code)

`compute_scores` (sync script, ~lines 89–105) **min-max normalizes raw
qty/orders/revenue**, then blends 0.5·orders + 0.3·qty + 0.2·revenue. The
distribution is degenerate:

- Median `popularity_score` ≈ **0.0007**; ~**92%** of scored rows are < 0.1.
- A single outlier (~673 qty) pins the top of the min-max scale, crushing
  everyone else toward zero.

Two consequences:
- The score's **magnitude** is near-useless (everything is ~0).
- The docstring claims the components are "z-scored." **They are not** — the code
  is min-max. The docstring is wrong and will be corrected.

**Fix (Phase 1):** clip each component at its **~95th percentile** before
min-max-normalizing, then apply the same 0.5/0.3/0.2 blend. This removes the
single-outlier pin and gives a usable spread. The 0.5/0.3/0.2 weights are
inherited (Rule 3) and accepted as-is — the fix is the percentile cap, not a
re-tune of the blend.

---

## Phase 1 — Popularity backfill + score fix (build now)

### Goal
All six `popularity_*` fields populated in SQLite `products.db` → exported to
`live_products_export.json`, with a non-degenerate score, verified end-to-end.
No category dependency.

### Decisions
- **Window:** 365 days (stored in `popularity_window_days`, auditable/re-runnable).
  Coverage at last dry-run: 90d=1,241 · 180d=2,320 · **365d=3,295** · 730d=4,283.
  - **Window-label trap:** the field names are `popularity_orders_90d` etc. but
    will hold **365-day** data. No user-facing label says "90d" (verified), so
    it is an internal-only trap. **Propose renaming** `*_90d` → `*_window` (or
    `*_365d`) at the implementation-plan stage; not blocking.
  - **Window semantics caveat:** the SQL is
    `month_start >= CURRENT_DATE - INTERVAL N DAY`, and `month_start` is
    month-bucketed, so "365 days" snaps to ~11 calendar months. Whether to make
    it a true rolling-day window or rename the decision to "months" is deferred
    to the plan; the backfill ships with the existing month-bucket semantics,
    documented.
- **`popularity_score` is RANK-ONLY across the matched set.** Even after the
  percentile-cap fix, min-max is computed over the matched row set for a given
  window, so a 365d score is not comparable to a 90d score. The only Phase-1
  consumer (`sort=popular`) needs rank, not absolute magnitude. The cap fixes the
  *within-run spread* (so rank is meaningful and the field isn't all-zero), not
  cross-run comparability.
- **Source of truth: SQLite `products.db`.** Sync writes SQLite first; export
  reads SQLite; Supabase kept in step via the existing push (general store
  consistency — the affinity rail does NOT read `popularity_*`).
- **NULL behaviour:** ~8,100 products with no sales in 365 days get
  `popularity_score = NULL` and sort last (matches existing `nullslast`).
- **Re-run semantics (avoids stale ranks):** re-runs only UPDATE the matched set,
  so a SKU that sold last run but not this one would keep its **old** rank. The
  SQLite write MUST, in a single transaction, first reset all 6 `popularity_*`
  columns to NULL for every row, then UPDATE the matched set. First run against
  an all-NULL table is a no-op reset; re-runs are correct.
- **Pre-flight:** full Rule-10 discipline (backup + 5-SKU canary against the real
  write path + full run + UI walkthrough), even though this is a deterministic
  non-LLM aggregation that spends no API money.

### Component 1 — `data/sync_popularity_from_bi.py` (edit)

**Score fix (the one behavioural change to the math):**
- In `compute_scores`, clip each component (qty, orders, revenue) at its ~95th
  percentile **before** `minmax_normalize`, then blend with the existing
  0.5/0.3/0.2 weights.
- Correct the docstring: the components are **min-max normalized** (not z-scored).

**SQLite write path (new):**
- New flag `--sqlite-db PATH` (default `data/db/products.db`).
- New flag `--no-supabase` (SQLite-only runs; Supabase push stays on by default).
- Change `--window-days` default to **365**.
- **Write order: SQLite first, then Supabase** (SQLite is the UI source of truth,
  Rule 9 — it must succeed before touching Supabase).
- **Write all 6 `popularity_*` columns to SQLite** — score, qty, orders, revenue,
  window_days, synced_at — so SQLite is as auditable as Supabase.
- **Single transaction:** `UPDATE products SET popularity_*=NULL` (all rows) then
  `UPDATE products SET popularity_*=? WHERE sku=?` for the matched set, committed
  atomically. Prevents stale ranks on re-run.
- Keyed by `sku` (verified unique, non-null, identical SKU set to products.json).
- WAL mode + busy_timeout/retry (per `canary_must_match_prod` memory — SQLite
  concurrent-write pattern).
- Only update existing rows; never insert.
- Print a **"what shipped" count** after writing: rows where
  `popularity_orders_90d` is non-NULL in SQLite (Rule 4).
- **Partial-failure handling (Rule 4):** `push_supabase` returns `(sent, failed)`.
  If `failed > 0`, print the gap and **exit non-zero**. SQLite (the UI source) is
  already correct, but the Supabase divergence must be surfaced, not silent.

**Not changing:** the aggregation SQL, the 0.5/0.3/0.2 weights. Only the
percentile cap, the SQLite write target, and the reset-then-update transaction.

### Component 2 — `scripts/refresh_live_export.py` (run, no change)
Already projects all 6 `popularity_*` columns. Running it after the SQLite write
carries popularity → `live_products_export.json`.

### Component 3 — Verification (Rules 1, 4, 7)
- **SQLite:** `SELECT COUNT(*) FROM products WHERE popularity_orders_90d IS NOT NULL`
  → expect ~3,295 (low thousands; report actual, sanity-check magnitude — not an
  exact gate; depends on the BI mart at run time).
- **Export JSON:** same count in `live_products_export.json` → must match SQLite
  (proves it reached the UI source).
- **Score spread sanity:** confirm the fixed score is no longer ~all-zero
  (median well off 0.0007; report the new median + a small histogram).
- **Browser (Rule 7):** start dev server, open explore with `sort=popular`,
  confirm ordering by real sales; top SKUs match the sync's top-5 preview.

### Component 4 — Regression guard (Rule 6)
Add `tests/test_popularity_export_invariant.py`, asserting **both directions**:
- SKU populated in SQLite ⇒ populated in export (data shipped).
- SKU NULL in SQLite ⇒ NULL/absent in export (guards the stale-rank class — that
  a reset propagates, not just additions).

Mirrors `tests/test_enrichment_db_invariants.py`.

### Phase 1 implementation order (Rule 10 pre-flight)
1. `cp data/db/products.db data/db/products.db.bak-pre-popularity` — **before**
   the canary, since the canary mutates the real DB.
2. Edit `sync_popularity_from_bi.py` (score cap, SQLite write path,
   reset-then-update txn, 365d default, SQLite-first, partial-failure exit,
   docstring fix).
3. Canary: 5 SKUs against the **real SQLite write path** (WAL/retry, not a
   dry-run) → real export refresh → verify those 5 in export.
4. Full run: ~3,295 SKUs → SQLite (then Supabase).
5. `python scripts/refresh_live_export.py`.
6. Verify: SQLite count, export count, score spread, browser `sort=popular`.
7. Add + run the regression-guard test.

### Phase 1 success criteria
- `popularity_orders_90d` populated for ~3,295 SKUs (low thousands; report
  actual) in **both** SQLite and the export JSON.
- Fixed `popularity_score` has a usable spread (not ~all-zero); report new median.
- `sort=popular` in the live UI orders by real 365-day sales; top SKUs match the
  sync's top-5 preview.
- Supabase push reports `failed == 0` (else surfaced, not silent).
- Bidirectional regression-guard test passes.

---

## Phase 2 — Popular-in-category recs + Magento export (specified; build after deps land)

### Dependency gate
Runs only after BOTH:
- Phase 1 popularity data is live (`popularity_score` populated in the export), AND
- the canonical SKU taxonomy backfill has written `category_group` into the
  export (separate spec: `2026-06-20-canonical-sku-taxonomy-design.md`).

These two are independent of each other, so Phase 1 and the taxonomy
implementation can be built **in parallel** (different scripts, different fields).
Phase 2 is the join point.

### Compute (Python — extends the sync script or a sibling; decided at plan stage)
- For each product, rank candidates **within the same `category_group`** by
  `popularity_score` descending.
- Take **top 10**, **all stock** (no in-stock filter — user decision), excluding
  the product itself.
- **NULL-popularity products** (the ~8,100 with no sales) can't be *ranked into* a
  list, but still *receive* recs (they have a `category_group`). A category with
  fewer than 10 scored products yields a shorter list — **emit what exists, do
  not pad** (no silent cap; `log()` categories that come up short).
- **Grouping field is `category_group`, NEVER `classification`** (the taxonomy
  spec exists precisely because `classification` is unreliable — "Wine product"
  smear).
- Output a per-product artifact mirroring `data/bi-product-affinities.json`:
  `{ source, exported_at, products: { <sku>: { popular_in_category: [sku, …] } } }`.

### Magento export (BOTH options captured — pick at plan stage)
- **(a) Related-products CSV** — `sku → related_skus` (pipe-delimited), matching
  Magento's product-import related/crosssell column format; file-based, mirrors
  the existing `exportToMagentoCSV` convention (which today has NO related/
  crosssell columns — so this is genuinely new output, not an edit).
- **(b) `catalog_product_link` REST API** — live writes; needs creds, rate-limit
  handling, and a dry-run path before it lands in the store.

The plan stage picks one based on the actual Magento import workflow in use.

### Phase 2 verification
- Count of products with a non-empty `popular_in_category` list; report by group.
- Spot-check: a known-popular SKU appears in its category-mates' rec lists.
- Confirm grouping used `category_group` (no product grouped under "Wine product").
- If exporting via API: dry-run / sandbox first, then verify links landed (Rule 1).

---

## Out of scope (YAGNI / Rule 11)
- **Rebuilding affinities** — co-purchase affinities
  (`scripts/export-bi-affinities.py` → `data/bi-product-affinities.json`, 5,351
  bases) are fresh and working; the "Same Order (Basket Affinity)" rail is
  unrelated to popularity.
- **Wiring popularity into `lib/recommendation/wine.ts`** — the attribute scorer
  works and doesn't use popularity; no behaviour change requested.
- **Scheduler/cron** — one-off backfill; revisit if recurring sync is wanted.
- **The taxonomy implementation itself** — separate spec; Phase 2 consumes its
  output, doesn't produce it.

## Parallelization summary
Build order: **{ Phase 1  ∥  taxonomy backfill } → Phase 2**.
Phase 1 and the taxonomy work touch disjoint fields/scripts and can run as
parallel subagents. Phase 2 joins on both.
