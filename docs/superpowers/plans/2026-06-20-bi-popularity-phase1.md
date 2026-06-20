# BI Popularity Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the degenerate `popularity_score` and land all six `popularity_*` fields into SQLite `products.db` → `live_products_export.json`, verified end-to-end.

**Architecture:** Extend the existing `data/sync_popularity_from_bi.py` (today Supabase-only) with: a 95th-percentile cap before min-max normalization (the score fix), a new SQLite write path that does a reset-then-update in one transaction (idempotent re-runs, no stale ranks), SQLite-first write ordering (Rule 9 — SQLite is the UI source of truth), and a partial-failure non-zero exit. Then run the unchanged `scripts/refresh_live_export.py` to carry the data into the export the UI reads.

**Tech Stack:** Python 3 (stdlib `sqlite3`, `argparse`, `urllib`), DuckDB (read-only BI source), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-17-bi-popularity-backfill-design.md`

**⚠️ Payment-path / data-integrity work (CLAUDE.md ABSOLUTE RULES).** This writes to `products.db` and the UI export. Rule 10 pre-flight (backup → canary → verify) is MANDATORY and is baked into the task order below. "The script ran" is NOT verification — only a destination count + UI walkthrough is (Rule 1).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `data/sync_popularity_from_bi.py` | BI aggregate → score → write SQLite + Supabase | **Modify** (score cap, SQLite path, 365d default, exit codes, docstring) |
| `tests/test_popularity_score.py` | Unit tests for the percentile-cap score fix (pure, no DB) | **Create** |
| `tests/test_popularity_sqlite_write.py` | Unit/integration tests for the SQLite reset-then-update path (temp DB) | **Create** |
| `tests/test_popularity_export_invariant.py` | Bidirectional live-data invariant (SQLite ⇔ export) + re-run guard | **Create** |
| `scripts/refresh_live_export.py` | SQLite → export JSON | **Run only, no change** (already projects all 6 cols, lines 53–54) |

**Why this split:** the score math is pure and fast to test in isolation (no DB); the SQLite write is tested against a throwaway temp DB so the unit suite never touches the live file; the invariant test runs read-only against the live DB+export after the real run (mirrors `tests/test_enrichment_db_invariants.py`).

---

## Reference: current code (so you don't have to hunt)

`data/sync_popularity_from_bi.py` today:
- `minmax_normalize(values)` — lines ~89–96. Maps to [0,1]; returns all-zeros if `hi≈lo`.
- `compute_scores(rows)` — lines ~99–108. Min-max each of qty/orders/revenue, blend `0.5*orders + 0.3*qty + 0.2*revenue`, round 6. **The docstring at the top of the file wrongly says "z-scored" — it is min-max.**
- `push_supabase(rows, env, synced_at, window_days)` — returns `(sent, failed)`. Upserts `popularity_*` to Supabase `products` on `on_conflict=sku`. **Do not change its behavior.**
- `main()` — arg parse (`--window-days` default **90**, `--dry-run`, `--bi-db`), reads BI, filters to products.json SKUs, `compute_scores`, prints top-5, pushes Supabase, returns `0`/`2`.
- Constants: `W_ORDERS=0.5, W_QTY=0.3, W_REVENUE=0.2`; `PRODUCTS_PATH = data/db/products.json`.

Canonical WAL/retry idiom in this repo (copy it): `scripts/reenrich_with_brand_library.py:353–361`:
```python
conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")
conn.execute("PRAGMA busy_timeout=10000")  # 10s wait before SQLITE_BUSY
```

SQLite `products` table has all 6 columns already (verified): `popularity_score` REAL, `popularity_qty_90d` REAL, `popularity_orders_90d` INTEGER, `popularity_revenue_90d` REAL, `popularity_window_days` INTEGER, `popularity_synced_at` TEXT. `sku` is unique, non-null (11,436 rows).

---

## Task 1: Score fix — percentile cap before normalize

**Files:**
- Modify: `data/sync_popularity_from_bi.py` (`compute_scores`, add `percentile` + `_cap` helpers; fix top-of-file docstring)
- Test: `tests/test_popularity_score.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_popularity_score.py
"""Unit tests for the popularity score fix (95th-percentile cap then min-max).

Regression guard: the pre-fix score was degenerate — a single ~673-qty outlier
pinned the min-max scale, median ≈ 0.0007, ~92% of rows < 0.1. The cap removes
the single-outlier pin so the score has a usable spread. See
docs/superpowers/specs/2026-06-17-bi-popularity-backfill-design.md.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "sync_pop", REPO / "data" / "sync_popularity_from_bi.py"
)
sync_pop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_pop)


def test_outlier_does_not_pin_the_scale():
    # 99 rows at qty=1, one outlier at qty=673 (the real-world shape).
    rows = [{"qty": 1.0, "orders": 1, "revenue": 100.0} for _ in range(99)]
    rows.append({"qty": 673.0, "orders": 50, "revenue": 50000.0})
    sync_pop.compute_scores(rows)
    typical = [r["score"] for r in rows[:99]]
    median = sorted(typical)[len(typical) // 2]
    # Pre-fix this was ~0.0007. Post-fix the cap lifts the typical band well off zero.
    assert median > 0.05, f"score still degenerate (median={median})"


def test_score_in_unit_range():
    rows = [
        {"qty": 5.0, "orders": 2, "revenue": 500.0},
        {"qty": 50.0, "orders": 20, "revenue": 5000.0},
        {"qty": 1.0, "orders": 1, "revenue": 100.0},
    ]
    sync_pop.compute_scores(rows)
    for r in rows:
        assert 0.0 <= r["score"] <= 1.0


def test_empty_rows_no_crash():
    rows = []
    sync_pop.compute_scores(rows)  # must not raise
    assert rows == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_popularity_score.py -v`
Expected: `test_outlier_does_not_pin_the_scale` FAILS (median ≈ 0.0007, well below 0.05). The other two may already pass.

- [ ] **Step 3: Implement the cap**

In `data/sync_popularity_from_bi.py`, add a percentile helper and a cap, and use them in `compute_scores`. Replace the existing `compute_scores` with:

```python
def percentile(values: list[float], pct: float) -> float:
    """Linear-interpolated percentile (matches numpy.percentile default 'linear').
    pct in [0, 100]. Pure stdlib so the script keeps zero deps."""
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    rank = (pct / 100.0) * (len(s) - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return s[lo]
    frac = rank - lo
    return s[lo] + (s[hi] - s[lo]) * frac


def _cap(values: list[float], pct: float = 95.0) -> list[float]:
    """Clip each value at the pct-th percentile so a single outlier can't pin
    the min-max scale (the degenerate-score fix). See spec §'The score bug'."""
    if not values:
        return []
    p = percentile(values, pct)
    return [min(v, p) for v in values]


def compute_scores(rows: list[dict]) -> None:
    """Mutates rows: adds 'score' in [0,1] = weighted blend of MIN-MAX-normalized,
    95th-percentile-CAPPED components (orders/qty/revenue). NOT z-scores.

    The cap removes the single-outlier pin that made the raw min-max score
    degenerate (median ≈ 0.0007). Score is rank-only across the matched set."""
    if not rows:
        return
    qty_n     = minmax_normalize(_cap([r["qty"]     for r in rows]))
    orders_n  = minmax_normalize(_cap([float(r["orders"])  for r in rows]))
    revenue_n = minmax_normalize(_cap([r["revenue"] for r in rows]))
    for i, r in enumerate(rows):
        r["score"] = round(
            W_ORDERS * orders_n[i] + W_QTY * qty_n[i] + W_REVENUE * revenue_n[i],
            6,
        )
```

Also fix the **top-of-file docstring**: change the line describing the score from "z-scored" / "z-scores are min-max normalized" to: `popularity_score = 0.5*orders + 0.3*qty + 0.2*revenue, each component 95th-percentile-capped then min-max normalized to [0,1] (NOT z-scored).`

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_popularity_score.py -v`
Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add data/sync_popularity_from_bi.py tests/test_popularity_score.py
git commit -m "fix(popularity): 95th-pctile cap before min-max so score isn't degenerate"
```

---

## Task 2: SQLite write path — reset-then-update in one transaction

**Files:**
- Modify: `data/sync_popularity_from_bi.py` (add `write_sqlite()`)
- Test: `tests/test_popularity_sqlite_write.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_popularity_sqlite_write.py
"""SQLite reset-then-update write path for popularity.

The reset-then-update transaction is the whole point: a re-run must clear stale
ranks (a SKU that sold last run but not this one goes back to NULL), not leave
them dangling. See spec §'Re-run semantics'.
"""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "sync_pop", REPO / "data" / "sync_popularity_from_bi.py"
)
sync_pop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync_pop)

POP_COLS = [
    "popularity_score", "popularity_qty_90d", "popularity_orders_90d",
    "popularity_revenue_90d", "popularity_window_days", "popularity_synced_at",
]


@pytest.fixture
def temp_db(tmp_path):
    db = tmp_path / "products.db"
    conn = sqlite3.connect(db)
    cols = ", ".join(f"{c}" for c in POP_COLS)
    conn.execute(f"CREATE TABLE products (sku TEXT PRIMARY KEY, {cols})")
    conn.executemany(
        "INSERT INTO products (sku) VALUES (?)",
        [("A1",), ("A2",), ("A3",)],
    )
    conn.commit()
    conn.close()
    return db


def _row(db, sku):
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    r = conn.execute("SELECT * FROM products WHERE sku=?", (sku,)).fetchone()
    conn.close()
    return r


def test_write_populates_matched_skus(temp_db):
    rows = [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}]
    n = sync_pop.write_sqlite(rows, temp_db, synced_at="2026-06-20T00:00:00Z", window_days=365)
    assert n == 1
    a1 = _row(temp_db, "A1")
    assert a1["popularity_orders_90d"] == 5
    assert a1["popularity_window_days"] == 365
    assert a1["popularity_synced_at"] == "2026-06-20T00:00:00Z"


def test_unmatched_skus_are_null(temp_db):
    rows = [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}]
    sync_pop.write_sqlite(rows, temp_db, synced_at="x", window_days=365)
    a2 = _row(temp_db, "A2")
    assert a2["popularity_orders_90d"] is None


def test_rerun_resets_stale_rank(temp_db):
    # Run 1: A1 and A2 both score.
    sync_pop.write_sqlite(
        [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0},
         {"sku": "A2", "score": 0.4, "qty": 2.0, "orders": 1, "revenue": 50.0}],
        temp_db, synced_at="run1", window_days=365)
    assert _row(temp_db, "A2")["popularity_orders_90d"] == 1
    # Run 2: only A1 scores. A2 must be RESET to NULL, not keep its old rank.
    sync_pop.write_sqlite(
        [{"sku": "A1", "score": 0.9, "qty": 10.0, "orders": 5, "revenue": 1000.0}],
        temp_db, synced_at="run2", window_days=365)
    assert _row(temp_db, "A2")["popularity_orders_90d"] is None, "stale rank not reset"
    assert _row(temp_db, "A1")["popularity_synced_at"] == "run2"


def test_never_inserts_orphans(temp_db):
    rows = [{"sku": "ZZZ", "score": 0.5, "qty": 1.0, "orders": 1, "revenue": 1.0}]
    sync_pop.write_sqlite(rows, temp_db, synced_at="x", window_days=365)
    conn = sqlite3.connect(temp_db)
    count = conn.execute("SELECT COUNT(*) FROM products WHERE sku='ZZZ'").fetchone()[0]
    conn.close()
    assert count == 0, "must UPDATE only; never INSERT new SKUs"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_popularity_sqlite_write.py -v`
Expected: all FAIL with `AttributeError: module 'sync_pop' has no attribute 'write_sqlite'`.

- [ ] **Step 3: Implement `write_sqlite`**

Add to `data/sync_popularity_from_bi.py` (after `push_supabase`):

```python
def write_sqlite(rows: list[dict], db_path: Path, synced_at: str, window_days: int) -> int:
    """Reset all popularity_* to NULL, then UPDATE the matched SKUs — atomically.

    Reset-then-update in ONE transaction so a re-run can't leave stale ranks on
    SKUs that scored last run but not this one (spec §'Re-run semantics').
    UPDATE-only: a SKU not already in products is silently skipped (never insert).
    Returns the number of rows actually updated (matched existing SKUs).
    """
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=30)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute("BEGIN")
        # 1. Reset every row (first run vs all-NULL table = harmless no-op).
        conn.execute(
            "UPDATE products SET "
            "popularity_score=NULL, popularity_qty_90d=NULL, popularity_orders_90d=NULL, "
            "popularity_revenue_90d=NULL, popularity_window_days=NULL, popularity_synced_at=NULL"
        )
        # 2. Update the matched set. executemany; rowcount on UPDATE...WHERE sku=?
        #    that matches 0 rows is a no-op (orphan SKU never inserted).
        updated = 0
        cur = conn.cursor()
        for r in rows:
            cur.execute(
                "UPDATE products SET "
                "popularity_score=?, popularity_qty_90d=?, popularity_orders_90d=?, "
                "popularity_revenue_90d=?, popularity_window_days=?, popularity_synced_at=? "
                "WHERE sku=?",
                (r["score"], r["qty"], r["orders"], r["revenue"],
                 window_days, synced_at, r["sku"]),
            )
            updated += cur.rowcount
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

Add `import sqlite3` to the imports at the top of the file (it is not currently imported).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_popularity_sqlite_write.py -v`
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add data/sync_popularity_from_bi.py tests/test_popularity_sqlite_write.py
git commit -m "feat(popularity): SQLite reset-then-update write path (idempotent re-runs)"
```

---

## Task 3: Wire CLI — SQLite-first, 365d default, flags, exit codes, score-spread report

**Files:**
- Modify: `data/sync_popularity_from_bi.py` (`main()`)

- [ ] **Step 1: Update `main()`**

Change the arg parser and run flow. Key changes:
- `--window-days` default **365** (was 90).
- Add `--sqlite-db` (default `data/db/products.db`).
- Add `--no-supabase` (skip the Supabase push; SQLite-only).
- **Write order: SQLite first, then Supabase** (Rule 9).
- Print a **"what shipped" line**: rows updated in SQLite + a re-read count of non-NULL `popularity_orders_90d`.
- Print the **post-fix score spread** (median + a coarse histogram) so the fix is *verified, not assumed* (spec §'Degenerate-after-clip guard').
- Exit non-zero if Supabase `failed > 0` (already the pattern; keep it).

Add near the top (after constants):
```python
DEFAULT_SQLITE_DB = REPO / "data" / "db" / "products.db"
```

Replace the body of `main()` after `compute_scores(rows)` (keep everything up to and including `compute_scores`) with:

```python
    # Score-spread report — the fix is verified here, not assumed (Rule 1).
    scores = sorted(r["score"] for r in rows)
    if scores:
        med = scores[len(scores) // 2]
        buckets = [0] * 10
        for s in scores:
            buckets[min(int(s * 10), 9)] += 1
        print(f"\nScore spread: n={len(scores)}  median={med:.4f}  "
              f"min={scores[0]:.4f}  max={scores[-1]:.4f}")
        print("  histogram (0.0–1.0 in 0.1 bins): " +
              " ".join(f"{b}" for b in buckets))
        if med < 0.01:
            print("  WARNING: median still near zero — score may still be "
                  "degenerate; investigate before trusting this run.", file=sys.stderr)

    rows.sort(key=lambda r: -r["score"])
    print("\nTop 5 by popularity_score:")
    for r in rows[:5]:
        print(f"  {r['sku']:<10}  score={r['score']:.4f}  orders={r['orders']:>3}  "
              f"qty={r['qty']:>5.0f}  revenue={r['revenue']:>10.0f}")

    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    print(f"\nsynced_at = {synced_at}   window_days = {args.window_days}")

    if args.dry_run:
        print(f"[dry-run] would update {len(rows)} SKUs in SQLite "
              f"({'+Supabase' if not args.no_supabase else 'SQLite only'})")
        return 0

    # 1. SQLite first — the UI source of truth (Rule 9).
    print(f"\nWriting {len(rows)} SKUs to SQLite {args.sqlite_db} (reset-then-update)...")
    updated = write_sqlite(rows, args.sqlite_db, synced_at, args.window_days)
    # Verify destination, don't trust the return value alone (Rule 1).
    _vc = sqlite3.connect(str(args.sqlite_db))
    shipped = _vc.execute(
        "SELECT COUNT(*) FROM products WHERE popularity_orders_90d IS NOT NULL"
    ).fetchone()[0]
    _vc.close()
    print(f"  SQLite: updated={updated}  rows with popularity_orders_90d NOT NULL={shipped}")

    if args.no_supabase:
        print("  (--no-supabase) skipping Supabase push.")
        print("\nNEXT: run  python scripts/refresh_live_export.py  to carry this into the export.")
        return 0

    # 2. Supabase second — general store consistency.
    print(f"\nUpserting {len(rows)} rows to Supabase...")
    sent, failed = push_supabase(rows, env, synced_at, args.window_days)
    print(f"  Supabase: sent={sent}, failed={failed}")
    print("\nNEXT: run  python scripts/refresh_live_export.py  to carry this into the export.")
    if failed > 0:
        print(f"ERROR: {failed} Supabase rows failed. SQLite (UI source) is correct, "
              f"but Supabase diverged — re-run to heal.", file=sys.stderr)
        return 2
    return 0
```

And update the arg parser block:
```python
    p.add_argument("--window-days", type=int, default=365)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--bi-db", type=Path, default=DEFAULT_BI_DB)
    p.add_argument("--sqlite-db", type=Path, default=DEFAULT_SQLITE_DB)
    p.add_argument("--no-supabase", action="store_true",
                   help="SQLite-only run; skip the Supabase upsert")
```

Note: the existing `main()` returns early with an error if Supabase env is missing. Move that check so it only blocks when `--no-supabase` is NOT set (so SQLite-only runs work without Supabase creds):
```python
    if not args.no_supabase and (
        not env.get("NEXT_PUBLIC_SUPABASE_URL")
        or not env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")):
        print("ERROR: Supabase env not set in .env.local "
              "(use --no-supabase for a SQLite-only run)", file=sys.stderr)
        return 1
```

- [ ] **Step 2: Smoke-test the CLI wiring with `--dry-run` (no writes)**

Run: `.venv/bin/python data/sync_popularity_from_bi.py --window-days 365 --dry-run`
Expected: prints SKU count, **score spread + histogram with median well above 0.01**, top-5, and `[dry-run] would update N SKUs in SQLite +Supabase`. No DB writes.

- [ ] **Step 3: Commit**

```bash
git add data/sync_popularity_from_bi.py
git commit -m "feat(popularity): SQLite-first CLI, 365d default, score-spread report, exit codes"
```

---

## Task 4: Rule-10 pre-flight — backup + 5-SKU canary against the REAL write path

**Files:** none created. This is the mandatory canary before the full run. The canary MUST hit the real SQLite write path (WAL/retry, real export refresh), not a dry-run — a dry-run is not a canary (see `feedback_canary_must_match_prod`).

- [ ] **Step 1: Back up the live DB (BEFORE any write)**

```bash
cp data/db/products.db data/db/products.db.bak-pre-popularity
ls -la data/db/products.db.bak-pre-popularity
```

- [ ] **Step 2: Canary — write only 5 real SKUs via the real path**

There is no `--limit` flag; add a tiny canary by limiting the matched rows. Run an inline canary that reuses the module so it exercises `write_sqlite` + the real export exactly:

```bash
.venv/bin/python - <<'PY'
import importlib.util, sqlite3
from pathlib import Path
from datetime import datetime, timezone
REPO = Path.cwd()
spec = importlib.util.spec_from_file_location("sp", REPO/"data/sync_popularity_from_bi.py")
sp = importlib.util.module_from_spec(spec); spec.loader.exec_module(sp)
rows = sp.fetch_bi_aggregates(sp.DEFAULT_BI_DB, 365)
rows = sp.filter_to_supabase_skus(rows)
sp.compute_scores(rows)
rows.sort(key=lambda r: -r["score"])
canary = rows[:5]
print("Canary SKUs:", [r["sku"] for r in canary])
synced = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
n = sp.write_sqlite(canary, REPO/"data/db/products.db", synced, 365)
print("updated:", n)
PY
.venv/bin/python scripts/refresh_live_export.py
```

- [ ] **Step 3: Verify the 5 canary SKUs in BOTH stores**

```bash
.venv/bin/python - <<'PY'
import json, sqlite3
from pathlib import Path
db = sqlite3.connect("data/db/products.db"); db.row_factory = sqlite3.Row
skus = [r["sku"] for r in db.execute(
    "SELECT sku FROM products WHERE popularity_orders_90d IS NOT NULL").fetchall()]
print("SQLite non-null popularity:", len(skus), skus[:5])
exp = json.load(open("data/live_products_export.json"))
hit = [p["sku"] for p in exp if p.get("popularity_orders_90d") not in (None, 0, "0")]
print("Export non-null popularity:", len(hit), hit[:5])
assert set(skus) <= set(hit) or len(skus) == 0, "canary SKUs in SQLite missing from export!"
print("OK: canary landed in both SQLite and export")
PY
```
Expected: ~5 SKUs in both, identical set. If the export count is 0 while SQLite has rows → **STOP**, the two-store flow is broken (Rule 9). Do not proceed to the full run.

- [ ] **Step 4: (Rule 7) Eyeball the canary in the UI**

Start the dev server, open the explore page with `sort=popular`, confirm the 5 canary SKUs surface at the top and the page doesn't crash. (Server start command per the catalog README; if unknown, note it and ask.)

- [ ] **Step 5: Restore from backup so the full run starts clean**

```bash
cp data/db/products.db.bak-pre-popularity data/db/products.db
```
(The canary proved the path works; the full run is the real write. Keeping the backup as-is.)

---

## Task 5: Full run + verification (Rule 1 — destination counts, not "it ran")

**Files:** none. This is the real backfill.

- [ ] **Step 1: Full run — SQLite then Supabase**

```bash
.venv/bin/python data/sync_popularity_from_bi.py --window-days 365
```
Expected: score spread median well above 0.01; "SQLite: updated=~3,295 rows with popularity_orders_90d NOT NULL=~3,295"; Supabase sent=~N, failed=0. **If `failed > 0` or exit code 2 → STOP and surface the gap (Rule 4); do not call it done.**

- [ ] **Step 2: Refresh the export (the UI source)**

```bash
.venv/bin/python scripts/refresh_live_export.py
```

- [ ] **Step 3: Verify destination counts in BOTH stores match**

```bash
.venv/bin/python - <<'PY'
import json, sqlite3
db = sqlite3.connect("data/db/products.db")
sq = db.execute("SELECT COUNT(*) FROM products WHERE popularity_orders_90d IS NOT NULL").fetchone()[0]
exp = json.load(open("data/live_products_export.json"))
ex = sum(1 for p in exp if p.get("popularity_orders_90d") not in (None, 0, "0"))
print(f"SQLite non-null: {sq}   Export non-null: {ex}")
assert sq == ex, f"MISMATCH — SQLite {sq} != export {ex}; export did not pick up the write"
print("OK: counts match; popularity shipped to the UI source")
PY
```
Expected: counts equal, low thousands (~3,295 — report the actual number; sanity-check the magnitude, it is not an exact gate).

- [ ] **Step 4: (Rule 7) UI walkthrough**

Dev server → explore `sort=popular` → confirm ordering reflects real sales and the top SKUs match the run's printed top-5. Screenshot/confirm no crash.

- [ ] **Step 5: Commit the refreshed export**

```bash
git add data/live_products_export.json
git commit -m "data(popularity): backfill popularity_* for ~3,295 SKUs (365d), shipped to export"
```

---

## Task 6: Regression-guard invariant test (Rule 6)

**Files:**
- Test: `tests/test_popularity_export_invariant.py` (create)

- [ ] **Step 1: Write the test**

```python
# tests/test_popularity_export_invariant.py
"""Production-data invariant: SQLite popularity ⇔ export popularity.

Runs read-only against the live data/db/products.db and the live export. Guards
the silent-drop class (paid/computed data that never reaches the UI source) and
the stale-rank class (a reset in SQLite that doesn't propagate). Mirrors
tests/test_enrichment_db_invariants.py. DO NOT skip without a replacement.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "db" / "products.db"
EXPORT = REPO / "data" / "live_products_export.json"


@pytest.fixture(scope="module")
def stores():
    if not DB.exists() or not EXPORT.exists():
        pytest.skip("live DB or export not present")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    sqlite_pop = {
        r["sku"] for r in conn.execute(
            "SELECT sku FROM products WHERE popularity_orders_90d IS NOT NULL")
    }
    conn.close()
    exp = json.load(open(EXPORT))
    export_pop = {
        p["sku"] for p in exp
        if p.get("popularity_orders_90d") not in (None, 0, "0")
    }
    return sqlite_pop, export_pop


def test_sqlite_popularity_present_in_export(stores):
    """Forward: every SKU populated in SQLite is populated in the export."""
    sqlite_pop, export_pop = stores
    missing = sqlite_pop - export_pop
    assert not missing, (
        f"{len(missing)} SKUs have popularity in SQLite but NOT in the export — "
        f"run scripts/refresh_live_export.py. Sample: {sorted(missing)[:10]}")


def test_export_popularity_backed_by_sqlite(stores):
    """Reverse (stale-rank guard): the export has no popularity SKU that SQLite
    doesn't — i.e. a SQLite reset propagated, not just additions."""
    sqlite_pop, export_pop = stores
    orphan = export_pop - sqlite_pop
    assert not orphan, (
        f"{len(orphan)} SKUs have popularity in the export but NULL in SQLite — "
        f"stale export; re-refresh. Sample: {sorted(orphan)[:10]}")
```

- [ ] **Step 2: Run it against the live (post-backfill) data**

Run: `.venv/bin/python -m pytest tests/test_popularity_export_invariant.py -v`
Expected: both PASS (proves the full run + refresh landed consistently in both stores).

- [ ] **Step 3: Run the whole new suite once**

Run: `.venv/bin/python -m pytest tests/test_popularity_score.py tests/test_popularity_sqlite_write.py tests/test_popularity_export_invariant.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_popularity_export_invariant.py
git commit -m "test(popularity): bidirectional SQLite⇔export invariant (Rule 6)"
```

---

## Done criteria (Phase 1)

- [ ] `popularity_orders_90d` non-NULL for low-thousands SKUs (~3,295, report actual) in **both** SQLite and `live_products_export.json`, counts equal.
- [ ] Post-fix `popularity_score` median well above the old 0.0007 (histogram printed; no degenerate warning).
- [ ] `sort=popular` in the live UI orders by real 365-day sales; top SKUs match the run's top-5.
- [ ] Supabase `failed == 0` (or surfaced + non-zero exit, not silent).
- [ ] All 3 test files pass, including the re-run stale-rank guard and the bidirectional invariant.
- [ ] A code comment at the SQLite write site notes the legacy `*_90d` name vs. the real 365-day window (window-label trap); the rename is logged in the spec's Follow-ups.

## NOT in this plan (Phase 2 / follow-ups — see spec)
- Popular-in-category recs + Magento export (gated on the taxonomy backfill landing `category_group`).
- The `*_90d` → window-accurate field rename (tracked follow-up; cross-cutting migration across 6 files).
- Window-semantics (month-bucket vs true rolling-day) — ships with existing month-bucket SQL, documented.
