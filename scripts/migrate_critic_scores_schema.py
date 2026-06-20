#!/usr/bin/env python3
"""One-shot, RUN-ONCE migration of critic_scores to the rich schema (spec §15).

Steps:
  1. add the rich columns (ALTER ADD COLUMN — additive, safe)
  2. backfill the existing magento_csv rows (source/tier/confidence/score_native…)
  3. table-rebuild to make `sku` nullable (SQLite can't drop NOT NULL via ALTER)

NOT idempotent: re-running errors on the duplicate ALTER / re-rebuild. Take the
Rule 10 backup first; on failure, restore from backup and re-run from the top.

Pure local — NO API spend. After running, refresh the live export (Rule 9):
    .venv/bin/python scripts/refresh_live_export.py
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

NEW_COLUMNS = [
    ("source", "TEXT"),
    ("score_native", "TEXT"),
    ("score_scale", "TEXT"),
    ("signal_class", "TEXT"),
    ("signal_tier", "INTEGER"),
    ("supporting_text", "TEXT"),
    ("confidence", "REAL"),
    ("producer", "TEXT"),
    ("cuvee", "TEXT"),
    ("fetched_at", "TEXT"),
]


def already_migrated(conn) -> bool:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(critic_scores)")}
    return "source" in cols


def add_columns(conn) -> None:
    for name, typ in NEW_COLUMNS:
        conn.execute(f"ALTER TABLE critic_scores ADD COLUMN {name} {typ}")


def backfill_curated(conn) -> int:
    # score_native must be AS-PUBLISHED, never a re-derived integer (spec §15).
    # All current rows are integer-valued; the CASE keeps any future 94.5 intact.
    cur = conn.execute("""
        UPDATE critic_scores
        SET source = 'magento_csv',
            score_native = CASE WHEN score = CAST(score AS INTEGER)
                                THEN CAST(CAST(score AS INTEGER) AS TEXT)
                                ELSE CAST(score AS TEXT) END,
            score_scale = '100pt',
            signal_class = 'critic_numeric',
            signal_tier = 1,
            confidence = 1.0,
            supporting_text = NULL,
            fetched_at = COALESCE(fetched_at, added_at)
        WHERE added_by LIKE 'magento_csv%' AND source IS NULL
    """)
    return cur.rowcount


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the backup (TESTS ONLY — never in production)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Rule 10: backup before any irreversible write.
    if not args.no_backup:
        bak = args.db.with_suffix(args.db.suffix + ".bak-pre-critic-migration")
        shutil.copy2(args.db, bak)
        print(f"backup -> {bak}")

    conn = sqlite3.connect(args.db)
    try:
        if already_migrated(conn):
            print("ALREADY MIGRATED (source column present) — aborting (run-once).",
                  file=sys.stderr)
            return 2

        # ALL THREE STEPS in ONE transaction so a failure rolls back atomically
        # (no half-migrated DB). foreign_keys pragma must be set OUTSIDE the tx.
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        add_columns(conn)
        n = backfill_curated(conn)
        rebuild_sku_nullable(conn)          # Task 3 — runs inside this same tx
        conn.execute("COMMIT")
        conn.execute("PRAGMA foreign_keys=ON")
        print(f"added {len(NEW_COLUMNS)} columns; backfilled {n} curated rows; "
              f"rebuilt critic_scores with nullable sku")
        return 0
    except Exception as e:
        conn.rollback()   # DB-API method — safe no-op if no tx is active
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
