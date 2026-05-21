#!/usr/bin/env python3
"""Push local SQLite changes to Supabase. Idempotent.

Strategy:
- For `products`: SELECT rows where updated_at > sync_state.last_synced_at,
  PATCH each row to Supabase by id, advance sync_state.
- For `enrichment_cache`: SELECT rows where created_at > sync_state.last_synced_at,
  UPSERT to Supabase, advance sync_state.

Failures are non-fatal per-row; the script keeps going and reports a count.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

PRODUCT_SYNC_COLUMNS = [
    "wine_body", "wine_acidity", "wine_tannin",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "flavor_tags", "food_matching",
    "desc_en_short", "full_description",
    "score_max", "score_summary",
    "enrichment_confidence", "enrichment_source", "enrichment_note",
    "enriched_at", "enriched_by", "updated_at",
]


def _get_sync_state(conn: sqlite3.Connection, table: str) -> str | None:
    row = conn.execute(
        "SELECT last_synced_at FROM sync_state WHERE table_name=?", (table,)
    ).fetchone()
    return row[0] if row else None


def _set_sync_state(conn: sqlite3.Connection, table: str, ts: str) -> None:
    conn.execute(
        "INSERT INTO sync_state (table_name, last_synced_at) VALUES (?,?) "
        "ON CONFLICT(table_name) DO UPDATE SET last_synced_at=excluded.last_synced_at",
        (table, ts),
    )
    conn.commit()


def plan_product_deltas(db_path: Path, since: str | None) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "WHERE enrichment_confidence IS NOT NULL"
    params: list = []
    if since:
        where += " AND updated_at > ?"
        params.append(since)
    rows = conn.execute(
        f"SELECT id, sku, {', '.join(PRODUCT_SYNC_COLUMNS)} FROM products {where} ORDER BY updated_at ASC",
        params,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("wine_production_style"):
            d["wine_production_style"] = json.loads(d["wine_production_style"])
        out.append(d)
    return out


def plan_cache_deltas(db_path: Path, since: str | None) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    where = "WHERE 1=1"
    params: list = []
    if since:
        where += " AND created_at > ?"
        params.append(since)
    rows = conn.execute(
        f"SELECT * FROM enrichment_cache {where} ORDER BY created_at ASC", params
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _patch_product(supabase_url: str, api_key: str, row: dict) -> None:
    pid = row.pop("id")
    row.pop("sku", None)
    url = f"{supabase_url.rstrip('/')}/rest/v1/products?id=eq.{urllib.parse.quote(pid)}"
    body = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": api_key, "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json", "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30):
        pass


def _upsert_cache(supabase_url: str, api_key: str, row: dict) -> None:
    url = f"{supabase_url.rstrip('/')}/rest/v1/enrichment_cache"
    if isinstance(row.get("response_json"), str):
        row["response_json"] = json.loads(row["response_json"])
    if isinstance(row.get("validation_issues"), str):
        row["validation_issues"] = json.loads(row["validation_issues"])
    body = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": api_key, "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30):
        pass


def sync_products(db_path: Path, supabase_url: str, api_key: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path)
    since = _get_sync_state(conn, "products")
    conn.close()
    deltas = plan_product_deltas(db_path, since=since)
    if dry_run:
        print(f"[dry-run] {len(deltas)} product deltas")
        return len(deltas)
    count = 0
    latest_ts = since
    had_failure = False
    for d in deltas:
        ts = d.get("updated_at")
        try:
            _patch_product(supabase_url, api_key, dict(d))
            count += 1
            if not had_failure and ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
        except Exception as e:
            had_failure = True
            print(f"WARN: product {d.get('sku')} sync failed: {e}", file=sys.stderr)
    if latest_ts:
        conn = sqlite3.connect(db_path)
        _set_sync_state(conn, "products", latest_ts)
        conn.close()
    return count


def sync_cache(db_path: Path, supabase_url: str, api_key: str, dry_run: bool = False) -> int:
    conn = sqlite3.connect(db_path)
    since = _get_sync_state(conn, "enrichment_cache")
    conn.close()
    deltas = plan_cache_deltas(db_path, since=since)
    if dry_run:
        print(f"[dry-run] {len(deltas)} cache deltas")
        return len(deltas)
    count = 0
    latest_ts = since
    had_failure = False
    for d in deltas:
        ts = d.get("created_at")
        try:
            _upsert_cache(supabase_url, api_key, dict(d))
            count += 1
            if not had_failure and ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
        except Exception as e:
            had_failure = True
            print(f"WARN: cache {d.get('id')} sync failed: {e}", file=sys.stderr)
    if latest_ts:
        conn = sqlite3.connect(db_path)
        _set_sync_state(conn, "enrichment_cache", latest_ts)
        conn.close()
    return count


def _load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Push local SQLite changes to Supabase.")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--products-only", action="store_true")
    p.add_argument("--cache-only", action="store_true")
    args = p.parse_args(argv)

    env = _load_env(REPO_ROOT / ".env.local")
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    api_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase_url or not api_key:
        print("ERROR: Supabase env missing.", file=sys.stderr)
        return 1

    n_prod = n_cache = 0
    if not args.cache_only:
        n_prod = sync_products(args.db, supabase_url, api_key, dry_run=args.dry_run)
    if not args.products_only:
        n_cache = sync_cache(args.db, supabase_url, api_key, dry_run=args.dry_run)
    print(f"products synced: {n_prod}  cache synced: {n_cache}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
