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
    # Core identity / catalog
    "sku", "sku_base", "name", "brand", "vintage", "bottle_size", "alcohol",
    "price", "cost", "currency",
    "is_in_stock", "quantity_in_stock", "wn_stock",
    # Taxonomy
    "country", "region", "subregion", "appellation",
    "classification", "wine_classification", "wine_type",
    "liquor_main_type", "other_type", "wine_color",
    # Enrichment — wine profile
    "wine_body", "wine_acidity", "wine_tannin",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "flavor_tags", "food_matching",
    # Enrichment — descriptions
    "desc_en_short", "full_description",
    "score_max", "score_summary",
    # Image
    "image_url", "image_alt_text",
    # Enrichment metadata
    "enrichment_confidence", "enrichment_source", "enrichment_note",
    "enriched_at", "enriched_by", "updated_at",
    "overall_confidence", "validation_status",
    "taste_profile", "taste_profile_override",
    # Popularity / BI
    "popularity_score", "popularity_orders_90d", "popularity_revenue_90d",
    "popularity_qty_90d",
    # Stock/active flags (synced from BI via scripts/sync_stock_from_bi.py).
    # Requires Supabase columns is_active INT, has_recent_sales INT, bi_synced_at TEXT
    # (added in migration add_is_active_to_products).
    "is_active", "has_recent_sales", "bi_synced_at",
]

# Columns that may exist in local SQLite but are NOT yet in the Supabase schema.
# Adding a column here prevents 400 errors when pushing to Supabase.
# Remove the column from this list once the Supabase migration has been applied.
_SUPABASE_SCHEMA_EXCLUDES = {
    "enrichment_quality_grade",
}

_JSON_COLUMNS = {
    "wine_production_style", "taste_profile", "taste_profile_override",
    # These are stored as JSON-encoded arrays in SQLite but Supabase expects
    # parsed arrays (PostgreSQL array columns).
    "flavor_tags", "food_matching",
}

# Columns that are numeric in Supabase (NUMERIC / FLOAT / INT).
# Empty strings must be coerced to None before sending or Postgres rejects them.
_NUMERIC_COLUMNS = {
    "price", "cost", "special_price", "promotion_price", "promotion_tier_price",
    "b2b_price", "b2b_margin_thb", "b2b_margin_pct", "b2b_discount_pct",
    "margin_thb", "margin_pct", "sp_discount_pct",
    "alcohol", "bottle_size", "score_max",
    "enrichment_confidence", "overall_confidence",
    "popularity_score", "popularity_orders_90d", "popularity_revenue_90d",
    "popularity_qty_90d", "quantity_in_stock", "wn_stock",
}


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


def plan_product_deltas(
    db_path: Path, since: str | None, full_sync: bool = False
) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    # full_sync: push every product regardless of enrichment status or timestamp.
    # Default: only rows updated since last sync and with enrichment data.
    if full_sync:
        where = "WHERE 1=1"
        params: list = []
    else:
        where = "WHERE enrichment_confidence IS NOT NULL"
        params = []
        if since:
            where += " AND updated_at > ?"
            params.append(since)
    # Only select columns that actually exist in this DB (guard against schema drift)
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    cols = ["id"] + [c for c in PRODUCT_SYNC_COLUMNS if c in existing_cols]
    rows = conn.execute(
        f"SELECT {', '.join(cols)} FROM products {where} ORDER BY updated_at ASC",
        params,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        for col in _JSON_COLUMNS:
            if col in d and d[col]:
                try:
                    d[col] = json.loads(d[col])
                except (ValueError, TypeError):
                    pass
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
    # Strip columns not yet in the Supabase schema to avoid 400 errors.
    for col in _SUPABASE_SCHEMA_EXCLUDES:
        row.pop(col, None)
    # Coerce empty strings to None for numeric columns; Postgres rejects "" for NUMERIC.
    for col in _NUMERIC_COLUMNS:
        if col in row and row[col] == "":
            row[col] = None
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


def _fetch_local_taste_notes(db_path: Path, product_id: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT product_id, note, tier, intensity, note_family FROM product_taste_notes WHERE product_id=?",
        (product_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def sync_product_taste_notes(
    db_path: Path, supabase_url: str, api_key: str, product_id: str
) -> None:
    """DELETE all taste notes for product_id on Supabase, then INSERT fresh rows from local."""
    base = supabase_url.rstrip("/")
    headers_base = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # DELETE existing rows
    del_url = f"{base}/rest/v1/product_taste_notes?product_id=eq.{urllib.parse.quote(product_id)}"
    del_req = urllib.request.Request(del_url, method="DELETE", headers={
        **headers_base, "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(del_req, timeout=30):
        pass

    # INSERT fresh rows (bulk)
    rows = _fetch_local_taste_notes(db_path, product_id)
    if not rows:
        return
    ins_url = f"{base}/rest/v1/product_taste_notes"
    body = json.dumps(rows).encode("utf-8")
    ins_req = urllib.request.Request(ins_url, data=body, method="POST", headers={
        **headers_base, "Prefer": "return=minimal",
    })
    with urllib.request.urlopen(ins_req, timeout=30):
        pass


def enqueue_similarity_dirty(supabase_url: str, api_key: str, product_id: str) -> None:
    """Insert product_id into Supabase product_similar_dirty (ON CONFLICT DO NOTHING)."""
    url = f"{supabase_url.rstrip('/')}/rest/v1/product_similar_dirty"
    body = json.dumps({"product_id": product_id}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=30):
        pass


def sync_products(db_path: Path, supabase_url: str, api_key: str, dry_run: bool = False,
                  skip_taste_notes: bool = False, full_sync: bool = False) -> int:
    conn = sqlite3.connect(db_path)
    since = None if full_sync else _get_sync_state(conn, "products")
    conn.close()
    deltas = plan_product_deltas(db_path, since=since, full_sync=full_sync)
    if dry_run:
        print(f"[dry-run] {len(deltas)} product deltas")
        return len(deltas)
    count = 0
    latest_ts = since
    had_failure = False
    for d in deltas:
        ts = d.get("updated_at")
        pid = d.get("id")
        has_taste = bool(d.get("taste_profile"))
        try:
            _patch_product(supabase_url, api_key, dict(d))
            if not skip_taste_notes and has_taste:
                sync_product_taste_notes(db_path, supabase_url, api_key, pid)
                enqueue_similarity_dirty(supabase_url, api_key, pid)
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
    p.add_argument("--full-sync", action="store_true",
                   help="Push ALL products regardless of updated_at or enrichment status. "
                        "Use for initial population or to sync image_url + core catalog fields.")
    p.add_argument("--skip-taste-notes", action="store_true",
                   help="Skip syncing product_taste_notes rows (emergency bypass).")
    args = p.parse_args(argv)

    env = _load_env(REPO_ROOT / ".env.local")
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    api_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase_url or not api_key:
        print("ERROR: Supabase env missing.", file=sys.stderr)
        return 1

    n_prod = n_cache = 0
    if not args.cache_only:
        n_prod = sync_products(args.db, supabase_url, api_key, dry_run=args.dry_run,
                               skip_taste_notes=args.skip_taste_notes,
                               full_sync=args.full_sync)
    if not args.products_only:
        n_cache = sync_cache(args.db, supabase_url, api_key, dry_run=args.dry_run)
    print(f"products synced: {n_prod}  cache synced: {n_cache}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
