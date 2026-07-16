#!/usr/bin/env python3
"""Produce the wine_key -> SKUs audit artifact for owner eyeball review.
Re-derives scope counts at RUN TIME -- any hardcoded historical figures in
docs are a point-in-time snapshot, not a constant (stock shifts nightly).
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from data.lib.dossier.wine_key import _FORMAT_TOKENS, wine_key_for  # noqa: E402

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "dossier_wine_key_audit.json"

# Group sizes worth a targeted eyeball for the format-token false-merge risk
# class (see Task 3 code-quality review). Groups larger than this are either
# clearly a real multi-vintage/multi-format family or too large to be a
# plausible accidental 2-3-SKU collision, so they're left to the general
# eyeball pass instead of this specific flag.
_FLAG_GROUP_SIZE_MAX = 3


def build_audit(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("""
        SELECT DISTINCT p.sku, p.name
        FROM products p
        JOIN critic_scores cs ON cs.sku = p.sku
        WHERE (p.custom_stock_status IS NULL OR p.custom_stock_status != 'CATALOG')
        ORDER BY p.sku
    """).fetchall()

    groups: dict[str, list[str]] = {}
    names_by_sku: dict[str, str] = {}
    for sku, name in rows:
        name = name or ""
        names_by_sku[sku] = name
        key = wine_key_for(sku, name)
        groups.setdefault(key, []).append(sku)

    multi = sum(1 for skus in groups.values() if len(skus) > 1)

    flagged_for_review = []
    for key, skus in sorted(groups.items()):
        if len(skus) < 2 or len(skus) > _FLAG_GROUP_SIZE_MAX:
            continue
        # Flag if ANY member's raw (pre-strip) name contains a format token --
        # reuse the exact regex wine_key_for() strips, so this can never
        # drift from actual stripping behavior.
        if any(_FORMAT_TOKENS.search(names_by_sku[sku]) for sku in skus):
            flagged_for_review.append({
                "wine_key": key,
                "skus": sorted(skus),
                "reason": (
                    "contains a stripped format-size token -- verify this "
                    "isn't a false merge of two distinct products"
                ),
            })

    return {
        "in_stock_critic_scored_count": len(rows),
        "distinct_wine_key_count": len(groups),
        "multi_vintage_family_count": multi,
        "groups": [
            {"wine_key": k, "skus": sorted(v)}
            for k, v in sorted(groups.items())
        ],
        "flagged_for_review": flagged_for_review,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    audit = build_audit(conn)
    args.out.write_text(json.dumps(audit, indent=2, ensure_ascii=False))
    print(f"in-stock critic-scored SKUs: {audit['in_stock_critic_scored_count']}")
    print(f"distinct wine_keys:          {audit['distinct_wine_key_count']}")
    print(f"multi-vintage families:      {audit['multi_vintage_family_count']}")
    print(f"flagged for review:          {len(audit['flagged_for_review'])}")
    print(f"Wrote {args.out} -- EYEBALL THIS before any generation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
