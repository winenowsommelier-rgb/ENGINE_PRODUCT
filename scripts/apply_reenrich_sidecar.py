#!/usr/bin/env python3
"""Replay a reenrich sidecar JSONL into products.db.

Use when a re-enrichment run completed the Anthropic API calls successfully
(money spent, AI response captured) but the SQLite writes failed due to
lock contention. The sidecar JSONL has every successful result and can be
applied serially (single-writer) without contention.

Usage:
    scripts/apply_reenrich_sidecar.py data/reenrich_results-YYYYMMDD-HHMMSS.jsonl
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("sidecar", type=Path)
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--no-backup", action="store_true")
    args = p.parse_args(argv)

    if not args.sidecar.exists():
        print(f"ERROR: sidecar not found: {args.sidecar}", file=sys.stderr)
        return 1

    if not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-pre-sidecar-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}")

    conn = sqlite3.connect(args.db, timeout=30)
    cols_present = {r[1] for r in conn.execute("PRAGMA table_info(products)")}

    applied = 0
    skipped = 0
    with args.sidecar.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception as e:
                print(f"WARN: malformed line: {e}", file=sys.stderr)
                continue
            sku = rec.get("sku")
            result = rec.get("result")
            if not sku or not result:
                skipped += 1
                continue
            enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            # LHS keys = products (SQLite) columns (renamed); RHS result.get() = LLM sidecar-response keys (stable).
            payload = {
                "body": result.get("wine_body"),
                "acidity": result.get("wine_acidity"),
                "tannin": result.get("wine_tannin"),
                "flavor_tags": json.dumps(result.get("flavor_tags") or [], ensure_ascii=False),
                "food_matching": ", ".join(result.get("food_matching") or []),
                "desc_en_short": result.get("desc_en_short"),
                "full_description": result.get("full_description"),
                "pairing_rationale": result.get("pairing_rationale"),
                "enrichment_source": "ai_brand_library_v3",
                "enrichment_note": "Sonnet 4.6 + validated brand library + v3 storytelling prompt (sidecar replay)",
                "enriched_at": enriched_at,
                "enriched_by": "claude-sonnet-4-6",
                "updated_at": enriched_at,
                "enrichment_quality_grade": "A",
            }
            payload = {k: v for k, v in payload.items() if k in cols_present}
            sets = ", ".join(f"{k}=?" for k in payload.keys())
            with conn:
                conn.execute(
                    f"UPDATE products SET {sets} WHERE sku=?",
                    list(payload.values()) + [sku],
                )
            applied += 1
    conn.close()
    print(f"Applied {applied} sidecar records ({skipped} skipped).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
