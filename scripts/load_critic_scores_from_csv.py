#!/usr/bin/env python3
"""Load critic scores + review text from the Magento score CSV into products.db.

Source : Magento "Wine score" export (cols WE/WA/WS/JS = numeric scores;
         wineenthusiast/wineadvocate/winespectator/jamessuckling = review prose).
Target : critic_scores  (one row per critic-with-a-score per SKU)
         products.score_max + products.score_summary  (denormalized for UI/curation)

Idempotent: deletes any prior rows tagged with the same added_by source before
re-inserting, so re-runs don't duplicate. Pure local parse — NO API spend.

Per CLAUDE.md Rule 9, the live export must be refreshed afterwards:
    .venv/bin/python scripts/refresh_live_export.py
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # repo root, so `lib` imports when run as a script
from lib.critic_reviews import refresh_products_summary  # noqa: E402

DEFAULT_DB = ROOT / "data" / "db" / "products.db"
SOURCE_TAG = "magento_csv_2026-06-15"

# (score column, review-text column, canonical critic name, summary abbr)
CRITICS = [
    ("WE", "wineenthusiast", "Wine Enthusiast", "WE"),
    ("WA", "wineadvocate",   "Wine Advocate",   "WA"),
    ("WS", "winespectator",  "Wine Spectator",  "WS"),
    ("JS", "jamessuckling",  "James Suckling",  "JS"),
]
DASHES = {"-", "–", "—", ""}


def clean(v: str | None) -> str:
    return (v or "").strip()


def parse_score(raw: str) -> float | None:
    raw = clean(raw)
    if raw in DASHES:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true", help="parse + report, write nothing")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1
    if not args.csv.exists():
        print(f"ERROR: csv not found: {args.csv}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    db_skus = {r[0] for r in conn.execute("SELECT sku FROM products")}

    # sku -> list of critic-score dicts
    by_sku: dict[str, list[dict]] = {}
    score_rows: list[tuple] = []
    orphan_skus: set[str] = set()

    # One timestamp per load batch — a batch is fetched at one moment, and with
    # seconds precision per-row now() would split rows across a second boundary.
    loaded_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    with args.csv.open(newline="") as f:
        for row in csv.DictReader(f):
            sku = clean(row.get("sku"))
            if not sku:
                continue
            vintage = clean(row.get("vintage")) or None
            for score_col, text_col, critic_name, abbr in CRITICS:
                score = parse_score(row.get(score_col))
                if score is None:
                    continue
                notes = clean(row.get(text_col)) or None
                row_id = str(uuid.uuid4())
                score_rows.append(
                    (row_id, sku, critic_name, score, 100.0, vintage,
                     None, None, notes, SOURCE_TAG,
                     # rich-schema cols: source, score_native, score_scale,
                     # signal_class, signal_tier, confidence, supporting_text, fetched_at
                     "magento_csv", clean(row.get(score_col)), "100pt",
                     "critic_numeric", 1, 1.0, None,
                     loaded_at)
                )
                by_sku.setdefault(sku, []).append(
                    {"abbr": abbr, "critic": critic_name,
                     "score_native": clean(row.get(score_col)), "score": score}
                )
                if sku not in db_skus:
                    orphan_skus.add(sku)

    binding_skus = [s for s in by_sku if s in db_skus]
    print(f"Parsed {len(score_rows)} critic_scores rows across {len(by_sku)} SKUs.")
    print(f"  bind to a product: {len(score_rows) - sum(len(by_sku[s]) for s in orphan_skus)}"
          f" rows / {len(binding_skus)} SKUs")
    print(f"  orphan (SKU not in products): "
          f"{sum(len(by_sku[s]) for s in orphan_skus)} rows / {len(orphan_skus)} SKUs")

    if args.dry_run:
        print("DRY RUN — nothing written.")
        return 0

    cur = conn.cursor()
    # idempotent: clear prior load from this source
    deleted = cur.execute(
        "DELETE FROM critic_scores WHERE added_by = ?", (SOURCE_TAG,)
    ).rowcount
    if deleted:
        print(f"  cleared {deleted} prior rows tagged {SOURCE_TAG}")

    # guard against positional drift between the tuple and the INSERT column list
    assert all(len(r) == 18 for r in score_rows), "score_rows width != 18 — INSERT column/value mismatch"
    cur.executemany(
        """INSERT INTO critic_scores
           (id, sku, critic, score, score_max, vintage, tasting_year,
            source_url, notes, added_by,
            source, score_native, score_scale, signal_class, signal_tier,
            confidence, supporting_text, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)""",
        score_rows,
    )

    conn.commit()  # make inserted critic_scores rows visible to the all-sources merge
    updated = refresh_products_summary.refresh_all(conn)
    print(f"Inserted {len(score_rows)} critic_scores rows; "
          f"re-derived score_max/score_summary across all sources on {updated} products.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
