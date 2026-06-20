#!/usr/bin/env python3
"""Compute windowed popularity per SKU from BI DuckDB and upsert into Supabase.

Window: default 365 days (was 90). Column names are window-agnostic
(`popularity_*_window`); the actual window in days is recorded in
popularity_window_days. (These columns were renamed from a misleading `*_90d`
suffix that no longer matched the 365-day data they hold.)

Pipeline:
  1. Read marts.mart_pivot_base from the local BI DuckDB.
  2. Aggregate closed orders in the last N days (default 365) per SKU:
        - popularity_qty_window       = SUM(qty_ordered)
        - popularity_orders_window    = COUNT(DISTINCT order_id)
        - popularity_revenue_window   = SUM(item_revenue_thb)
  3. Compute popularity_score = weighted blend of components:
        0.5 * orders + 0.3 * qty + 0.2 * revenue
     Each component is 95th-percentile-CAPPED then min-max normalized to
     [0, 1] (NOT z-scored). The cap stops a single outlier from pinning the
     min-max scale (the pre-fix score was degenerate: median ≈ 0.0007), so
     popularity_score is in [0, 1] with usable spread.
  4. Upsert {sku, popularity_*, popularity_synced_at} to Supabase via PostgREST
     in chunks of 500. Only SKUs that already exist in Supabase are updated.

CLI:
    --window-days N    (default 365; was 90)
    --dry-run          print summary, don't push
    --bi-db PATH       override DuckDB path
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import duckdb  # type: ignore

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env.local"
DEFAULT_BI_DB = Path("/Users/admin/Desktop/CLAUDE DATA_WNLQ9 M REPORT ALL/data/processed/ecommerce_bi.duckdb")
PRODUCTS_PATH = REPO / "data" / "db" / "products.json"
DEFAULT_SQLITE_DB = REPO / "data" / "db" / "products.db"

# Score weights — tunable. Sum should be 1.0.
W_ORDERS = 0.5
W_QTY = 0.3
W_REVENUE = 0.2


def load_env(p: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def fetch_bi_aggregates(db_path: Path, window_days: int) -> list[dict]:
    """Aggregate per SKU over the last N days of closed orders."""
    con = duckdb.connect(str(db_path), read_only=True)
    try:
        sql = f"""
            SELECT
                sku,
                SUM(qty_ordered)              AS qty,
                COUNT(DISTINCT order_id)      AS orders,
                SUM(item_revenue_thb)         AS revenue
            FROM marts.mart_pivot_base
            WHERE is_closed = 1
              AND month_start >= CURRENT_DATE - INTERVAL {int(window_days)} DAY
              AND sku IS NOT NULL
              AND sku <> ''
            GROUP BY sku
        """
        df = con.execute(sql).fetchdf()
    finally:
        con.close()
    # NOTE: `x or 0` does NOT catch NaN (NaN is truthy), so SUM() over rows with
    # NULL revenue/qty leaks a NaN that poisons min-max normalization for EVERY
    # SKU (one NaN -> all scores NaN). Coalesce NaN explicitly. (Surfaced by the
    # score-spread report during the Phase-1 dry-run smoke test.)
    def _num(v) -> float:
        f = float(v or 0)
        return 0.0 if (math.isnan(f) or math.isinf(f)) else f

    rows: list[dict] = []
    for _, r in df.iterrows():
        rows.append({
            "sku": str(r["sku"]).strip(),
            "qty": _num(r["qty"]),
            "orders": int(r["orders"] or 0),
            "revenue": _num(r["revenue"]),
        })
    return rows


def minmax_normalize(values: list[float]) -> list[float]:
    if not values:
        return []
    lo = min(values)
    hi = max(values)
    if math.isclose(hi, lo):
        return [0.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


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


def filter_to_supabase_skus(rows: list[dict]) -> list[dict]:
    """Drop rows whose SKU isn't in products.json (so we don't insert orphans)."""
    if not PRODUCTS_PATH.exists():
        return rows
    products = json.loads(PRODUCTS_PATH.read_text())
    valid = {p.get("sku") for p in products if p.get("sku")}
    return [r for r in rows if r["sku"] in valid]


def push_supabase(rows: list[dict], env: dict[str, str], synced_at: str, window_days: int) -> tuple[int, int]:
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        print("ERROR: missing Supabase env", file=sys.stderr)
        return 0, len(rows)

    # Build sku -> id map from products.json (Supabase needs id on upsert)
    products = json.loads(PRODUCTS_PATH.read_text())
    sku_to_id = {p["sku"]: str(p["id"]) for p in products if p.get("sku") and p.get("id")}

    payload = []
    for r in rows:
        rid = sku_to_id.get(r["sku"])
        if not rid:
            continue
        payload.append({
            "id": rid,
            "sku": r["sku"],
            "popularity_score":       r["score"],
            "popularity_qty_window":     r["qty"],
            "popularity_orders_window":  r["orders"],
            "popularity_revenue_window": r["revenue"],
            "popularity_window_days": window_days,
            "popularity_synced_at":   synced_at,
        })

    sent, failed = 0, 0
    CHUNK = 500
    total_chunks = (len(payload) + CHUNK - 1) // CHUNK
    for i in range(0, len(payload), CHUNK):
        chunk = payload[i:i+CHUNK]
        body = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(
            f"{url}/rest/v1/products?on_conflict=sku",
            data=body, method="POST",
            headers={
                "apikey": key, "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        chunk_idx = i // CHUNK + 1
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if 200 <= resp.status < 300:
                    sent += len(chunk)
                    print(f"  [{chunk_idx}/{total_chunks}] OK ({len(chunk)} rows)")
                else:
                    failed += len(chunk)
                    print(f"  [{chunk_idx}/{total_chunks}] HTTP {resp.status}", file=sys.stderr)
        except urllib.error.HTTPError as e:
            failed += len(chunk)
            print(f"  [{chunk_idx}/{total_chunks}] FAIL {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}", file=sys.stderr)
        except urllib.error.URLError as e:
            failed += len(chunk)
            print(f"  [{chunk_idx}/{total_chunks}] URLError: {e}", file=sys.stderr)
    return sent, failed


def write_sqlite(rows: list[dict], db_path: Path, synced_at: str, window_days: int) -> int:
    """Reset all popularity_* to NULL, then UPDATE the matched SKUs — atomically.

    Reset-then-update in ONE transaction so a re-run can't leave stale ranks on
    SKUs that scored last run but not this one (spec §'Re-run semantics').
    UPDATE-only: a SKU not already in products is silently skipped (never insert).
    Column names are window-agnostic (popularity_*_window); the actual window
    in days is recorded in popularity_window_days (365). See
    docs/superpowers/specs/2026-06-17-bi-popularity-backfill-design.md.
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
            "popularity_score=NULL, popularity_qty_window=NULL, popularity_orders_window=NULL, "
            "popularity_revenue_window=NULL, popularity_window_days=NULL, popularity_synced_at=NULL"
        )
        # 2. Update the matched set. An UPDATE...WHERE sku=? that matches 0 rows
        #    is a no-op (orphan SKU never inserted).
        updated = 0
        cur = conn.cursor()
        for r in rows:
            cur.execute(
                "UPDATE products SET "
                "popularity_score=?, popularity_qty_window=?, popularity_orders_window=?, "
                "popularity_revenue_window=?, popularity_window_days=?, popularity_synced_at=? "
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


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--window-days", type=int, default=365)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--bi-db", type=Path, default=DEFAULT_BI_DB)
    p.add_argument("--sqlite-db", type=Path, default=DEFAULT_SQLITE_DB)
    p.add_argument("--no-supabase", action="store_true",
                   help="SQLite-only run; skip the Supabase upsert")
    args = p.parse_args()

    if not args.bi_db.exists():
        print(f"ERROR: BI DuckDB not found at {args.bi_db}", file=sys.stderr)
        return 1

    env = load_env(ENV)
    if not args.no_supabase and (
        not env.get("NEXT_PUBLIC_SUPABASE_URL")
        or not env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")):
        print("ERROR: Supabase env not set in .env.local "
              "(use --no-supabase for a SQLite-only run)", file=sys.stderr)
        return 1

    started = time.time()
    print(f"Reading {args.bi_db.name} (window={args.window_days} days)...")
    rows = fetch_bi_aggregates(args.bi_db, args.window_days)
    print(f"  {len(rows)} SKUs with sales in window")

    rows = filter_to_supabase_skus(rows)
    print(f"  {len(rows)} match products.json (rest dropped — orphaned SKUs)")

    compute_scores(rows)

    # Score-spread report — the fix is verified here, not assumed (Rule 1).
    scores = sorted(r["score"] for r in rows)
    if scores:
        med = scores[len(scores) // 2]
        buckets = [0] * 10
        for s in scores:
            buckets[min(int(s * 10), 9)] += 1
        print(f"\nScore spread: n={len(scores)}  median={med:.4f}  "
              f"min={scores[0]:.4f}  max={scores[-1]:.4f}")
        print("  histogram (0.0-1.0 in 0.1 bins): " +
              " ".join(f"{b}" for b in buckets))
        if med < 0.01:
            print("  WARNING: median still near zero - score may still be "
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
              f"({'SQLite only' if args.no_supabase else '+Supabase'})")
        return 0

    # 1. SQLite first - the UI source of truth (Rule 9).
    print(f"\nWriting {len(rows)} SKUs to SQLite {args.sqlite_db} (reset-then-update)...")
    updated = write_sqlite(rows, args.sqlite_db, synced_at, args.window_days)
    # Verify destination (Rule 1). Count by THIS run's synced_at so a prior
    # partial run can't inflate the number, AND report total non-NULL. Because
    # write_sqlite resets every row first, the two should match - if not, a
    # concurrent writer touched the table and the run is suspect.
    _vc = sqlite3.connect(str(args.sqlite_db))
    this_run = _vc.execute(
        "SELECT COUNT(*) FROM products WHERE popularity_synced_at = ?", (synced_at,)
    ).fetchone()[0]
    total_nonnull = _vc.execute(
        "SELECT COUNT(*) FROM products WHERE popularity_orders_window IS NOT NULL"
    ).fetchone()[0]
    _vc.close()
    print(f"  SQLite: updated={updated}  this-run(synced_at)={this_run}  "
          f"total non-NULL={total_nonnull}")
    if this_run != total_nonnull:
        print("  WARNING: this-run count != total non-NULL - unexpected rows in "
              "the table (concurrent writer?); investigate before trusting.", file=sys.stderr)

    if args.no_supabase:
        print("  (--no-supabase) skipping Supabase push.")
        print("\nNEXT: run  python scripts/refresh_live_export.py  to carry this into the export.")
        return 0

    # 2. Supabase second - general store consistency.
    print(f"\nUpserting {len(rows)} rows to Supabase...")
    sent, failed = push_supabase(rows, env, synced_at, args.window_days)
    print(f"  Supabase: sent={sent}, failed={failed}")
    print("\nNEXT: run  python scripts/refresh_live_export.py  to carry this into the export.")
    if failed > 0:
        print(f"ERROR: {failed} Supabase rows failed. SQLite (UI source) is correct, "
              f"but Supabase diverged - re-run to heal.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
