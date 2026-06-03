#!/usr/bin/env python3
"""Backfill products table from enrichment_cache.response_json.

Why this exists
---------------
Phase 5 paid Anthropic for ~4,316 enrichments. Every cache row contains the
full AI response (desc_en_short, full_description, wine_body, flavor_tags,
food_matching, etc.). LocalRouter.update_product silently SKIPPED the
descriptive write whenever final_confidence < write_threshold (0.85).
~99% of Phase 5 SKUs had final_confidence in 0.55-0.74, so the entire
descriptive payload went to CSV only, never to the products table.

This script copies cache → products. No new API calls. No new spend.

Usage
-----
    .venv/bin/python scripts/backfill_from_cache.py --dry-run --limit 5
    .venv/bin/python scripts/backfill_from_cache.py            # full run
    .venv/bin/python scripts/backfill_from_cache.py --sku WRW2106AC

Idempotency
-----------
Safe to re-run. Only updates rows where the cache exists. Picks the most
recent cache row per (sku, validation_status='passed'|'repaired'|
'failed_then_retried') if multiple exist.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"

VALID_STATUSES = ("passed", "repaired", "failed_then_retried")


def load_cache_rows(conn: sqlite3.Connection, skus: list[str] | None) -> list[dict]:
    """Return one cache row per SKU, preferring the most recent valid one."""
    where_sku = ""
    params: list = []
    if skus:
        placeholders = ",".join("?" for _ in skus)
        where_sku = f"AND ec.sku IN ({placeholders})"
        params = list(skus)
    sql = f"""
        SELECT ec.id, ec.sku, ec.response_json, ec.confidence, ec.validation_status,
               ec.model, ec.created_at,
               p.id AS products_id
        FROM enrichment_cache ec
        JOIN products p ON p.sku = ec.sku
        WHERE ec.validation_status IN ('passed','repaired','failed_then_retried')
          {where_sku}
        ORDER BY ec.sku, ec.created_at DESC
    """
    seen: set[str] = set()
    rows: list[dict] = []
    for r in conn.execute(sql, params):
        if r[1] in seen:
            continue
        seen.add(r[1])
        rows.append({
            "cache_id": r[0],
            "sku": r[1],
            "response": json.loads(r[2]),
            "confidence": r[3],
            "validation_status": r[4],
            "model": r[5],
            "enriched_at": r[6],
            "products_id": r[7],
        })
    return rows


def build_payload(response: dict, confidence: float, model: str, enriched_at: str) -> dict:
    """Map AI response JSON → products column values."""
    return {
        "wine_body": response.get("wine_body"),
        "wine_acidity": response.get("wine_acidity"),
        "wine_tannin": response.get("wine_tannin"),
        "grape_variety": ", ".join(response.get("grape_variety") or []) or None,
        "grape_blend_type": response.get("grape_blend_type"),
        "wine_production_style": json.dumps(response.get("wine_production_style") or []),
        "flavor_tags": json.dumps(response.get("flavor_tags") or []),
        "food_matching": ", ".join(response.get("food_matching") or []) or None,
        "desc_en_short": response.get("desc_en_short"),
        "full_description": response.get("full_description"),
        "enrichment_confidence": round(float(confidence or 0), 3),
        "enrichment_source": "ai_backfill_from_cache",
        "enrichment_note": "Backfilled from enrichment_cache (Phase-5 recovery)",
        "enriched_at": enriched_at,
        "enriched_by": model,
        "updated_at": enriched_at,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dry-run", action="store_true",
                   help="Show what WOULD change for the first N SKUs without writing.")
    p.add_argument("--limit", type=int, default=0, help="Process at most N rows (0 = all).")
    p.add_argument("--sku", action="append", help="Process only these SKUs (repeatable).")
    args = p.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    try:
        rows = load_cache_rows(conn, args.sku)
        if args.limit > 0:
            rows = rows[: args.limit]
        print(f"Found {len(rows)} cache rows to backfill")

        written = 0
        skipped_no_id = 0
        for r in rows:
            if not r["products_id"]:
                skipped_no_id += 1
                continue
            payload = build_payload(
                r["response"], r["confidence"], r["model"], r["enriched_at"]
            )

            if args.dry_run:
                # Show before/after for inspection
                before = conn.execute(
                    "SELECT desc_en_short, wine_body, flavor_tags FROM products WHERE id=?",
                    (r["products_id"],),
                ).fetchone()
                print(f"\n--- {r['sku']} (id={r['products_id']}, conf={r['confidence']}) ---")
                print(f"  BEFORE: desc='{(before['desc_en_short'] or '')[:60]}'  body={before['wine_body']!r}  flavors={(before['flavor_tags'] or '')[:40]}")
                print(f"  AFTER:  desc='{(payload['desc_en_short'] or '')[:60]}'  body={payload['wine_body']!r}  flavors={(payload['flavor_tags'] or '')[:40]}")
                continue

            sets = ", ".join(f"{k}=?" for k in payload.keys())
            with conn:
                conn.execute(
                    f"UPDATE products SET {sets} WHERE id=?",
                    list(payload.values()) + [r["products_id"]],
                )
            written += 1
            if written % 250 == 0:
                print(f"  ... {written}/{len(rows)} rows backfilled")

        if args.dry_run:
            print(f"\nDRY-RUN: would update {len(rows) - skipped_no_id} rows ({skipped_no_id} skipped: products row missing)")
        else:
            print(f"\nBackfilled {written} rows ({skipped_no_id} skipped: products row missing)")

        # Final verification tally
        check = conn.execute("""
            SELECT
              SUM(CASE WHEN desc_en_short IS NOT NULL AND desc_en_short != '' THEN 1 ELSE 0 END) AS has_desc,
              SUM(CASE WHEN flavor_tags IS NOT NULL AND flavor_tags NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_flavors,
              SUM(CASE WHEN food_matching IS NOT NULL AND food_matching != '' THEN 1 ELSE 0 END) AS has_food,
              SUM(CASE WHEN taste_profile IS NOT NULL THEN 1 ELSE 0 END) AS has_taste,
              COUNT(*) AS total
            FROM products
        """).fetchone()
        print(f"\nPost-state: desc={check['has_desc']}  flavors={check['has_flavors']}  food={check['has_food']}  taste={check['has_taste']}  (of {check['total']} total)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
