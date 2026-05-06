#!/usr/bin/env python3
"""Push image_url from data/db/product-images.json into the Supabase products table.

Surgical sync: only the `image_url` field is touched per matching SKU.
Uses Supabase's upsert with on_conflict=sku and merge-duplicates resolution.

Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from .env.local.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "data" / "db" / "product-images.json"
DEFAULT_PRODUCTS = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_ENV = REPO_ROOT / ".env.local"
CHUNK_SIZE = 500


def load_env(env_path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env file into a dict."""
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        out[k.strip()] = v
    return out


def post_chunk(supabase_url: str, key: str, rows: list[dict]) -> tuple[int, str]:
    """POST upsert one chunk. Returns (status_code, body_text)."""
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/products?on_conflict=sku",
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    p.add_argument("--products", type=Path, default=DEFAULT_PRODUCTS,
                   help="products.json — used to look up the row id for each SKU.")
    p.add_argument("--env", type=Path, default=DEFAULT_ENV)
    p.add_argument("--dry-run", action="store_true", help="Don't actually POST to Supabase.")
    p.add_argument("--limit", type=int, default=0, help="Cap rows to send (0 = all).")
    args = p.parse_args(argv)

    env = load_env(args.env)
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    supabase_key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase_url or not supabase_key:
        print("ERROR: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local", file=sys.stderr)
        return 1

    if not args.input.exists():
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 1
    if not args.products.exists():
        print(f"ERROR: products file not found: {args.products}", file=sys.stderr)
        return 1

    # Build sku -> id map from products.json (Supabase requires id on upsert).
    products = json.loads(args.products.read_text())
    sku_to_id: dict[str, str] = {}
    for p_row in products:
        sku_val = p_row.get("sku")
        id_val = p_row.get("id")
        if sku_val and id_val:
            sku_to_id[sku_val] = str(id_val)
    print(f"Loaded {len(sku_to_id)} sku->id mappings from {args.products.name}")

    data = json.loads(args.input.read_text())
    records = data.get("records", {})
    rows: list[dict] = []
    skipped_no_id = 0
    for sku, rec in records.items():
        images = rec.get("images")
        if not images:
            continue
        url = images.get("image", {}).get("url")
        if not url:
            continue
        row_id = sku_to_id.get(sku)
        if not row_id:
            skipped_no_id += 1
            continue
        rows.append({"id": row_id, "sku": sku, "image_url": url})
    if skipped_no_id:
        print(f"Skipped {skipped_no_id} SKUs not present in products.json (no Supabase row to update).")

    if args.limit:
        rows = rows[: args.limit]

    print(f"Loaded {len(rows)} {{sku, image_url}} pairs from {args.input.name}")
    if args.dry_run:
        print("[dry-run] showing first 3 rows:")
        for r in rows[:3]:
            print(f"  {r}")
        print(f"[dry-run] would POST {len(rows)} rows in {((len(rows) - 1) // CHUNK_SIZE) + 1} chunks")
        return 0

    sent = 0
    failed = 0
    start = time.time()
    total_chunks = (len(rows) + CHUNK_SIZE - 1) // CHUNK_SIZE
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        chunk_idx = i // CHUNK_SIZE + 1
        status, body = post_chunk(supabase_url, supabase_key, chunk)
        if status >= 200 and status < 300:
            sent += len(chunk)
            print(f"  [{chunk_idx}/{total_chunks}] OK {status} ({len(chunk)} rows)")
        else:
            failed += len(chunk)
            print(f"  [{chunk_idx}/{total_chunks}] FAIL {status}: {body[:200]}", file=sys.stderr)

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s — sent={sent}, failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
