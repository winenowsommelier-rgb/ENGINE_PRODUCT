#!/usr/bin/env python3
"""One-shot, RUN-ONCE migration of critic_scores to the rich schema (spec §15).

Steps:
  1. add the rich columns (ALTER ADD COLUMN — additive, safe)
  2. backfill the existing magento_csv rows (source/tier/confidence/score_native…)
  3. table-rebuild to make `sku` nullable (SQLite can't drop NOT NULL via ALTER)

Run-once: a second run detects the `source` column and aborts cleanly with exit
code 2 (no duplicate ALTER). Take the Rule 10 backup before the first run; on
failure, restore from backup and re-run from the top.

Pure local — NO API spend. After running, refresh the live export (Rule 9):
    .venv/bin/python scripts/refresh_live_export.py

NOTE: Always pass --db explicitly when running from a git worktree; the default
path resolves relative to the script and can point at the wrong DB.
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


def rebuild_sku_nullable(conn) -> None:
    """SQLite can't drop NOT NULL via ALTER — rebuild the table with nullable sku.
    Preserves all rows + all (now-migrated) columns + indexes. Runs inside the
    caller's transaction (no BEGIN/COMMIT/PRAGMA here)."""
    conn.execute("""
        CREATE TABLE critic_scores_new (
          id            TEXT PRIMARY KEY,
          sku           TEXT,                       -- now NULLABLE (scraped rows bind by producer+cuvee+vintage)
          critic        TEXT NOT NULL,
          score         REAL NOT NULL,
          score_max     REAL NOT NULL DEFAULT 100,
          vintage       TEXT,
          tasting_year  INTEGER,
          source_url    TEXT,
          notes         TEXT,
          added_by      TEXT,
          added_at      TEXT DEFAULT CURRENT_TIMESTAMP,
          source        TEXT,
          score_native  TEXT,
          score_scale   TEXT,
          signal_class  TEXT,
          signal_tier   INTEGER,
          supporting_text TEXT,
          confidence    REAL,
          producer      TEXT,
          cuvee         TEXT,
          fetched_at    TEXT
        )
    """)
    conn.execute("""
        INSERT INTO critic_scores_new
          (id, sku, critic, score, score_max, vintage, tasting_year, source_url,
           notes, added_by, added_at, source, score_native, score_scale,
           signal_class, signal_tier, supporting_text, confidence, producer,
           cuvee, fetched_at)
        SELECT
           id, sku, critic, score, score_max, vintage, tasting_year, source_url,
           notes, added_by, added_at, source, score_native, score_scale,
           signal_class, signal_tier, supporting_text, confidence, producer,
           cuvee, fetched_at
        FROM critic_scores
    """)
    conn.execute("DROP TABLE critic_scores")
    conn.execute("ALTER TABLE critic_scores_new RENAME TO critic_scores")
    conn.execute("CREATE INDEX idx_critic_scores_sku ON critic_scores (sku)")
    conn.execute("CREATE INDEX idx_critic_scores_critic_score ON critic_scores (critic, score DESC)")
    # NO COMMIT / PRAGMA here — main() owns the single transaction.


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the backup (TESTS ONLY — never in production)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Guard against the worktree/stray-empty-DB trap: refuse to migrate a DB that
    # doesn't actually contain the critic_scores table we expect. A 0-byte or
    # wrong-path DB (e.g. the default resolving into a git worktree) would
    # otherwise "succeed" silently against the wrong file. (CLAUDE.md Rule 1.)
    probe = sqlite3.connect(args.db)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='critic_scores'"
        ).fetchone()[0]
        row_count = (
            probe.execute("SELECT count(*) FROM critic_scores").fetchone()[0]
            if has_table else 0
        )
    finally:
        probe.close()
    if not has_table or row_count == 0:
        print(
            f"ERROR: {args.db} has no populated critic_scores table "
            f"(has_table={bool(has_table)}, rows={row_count}). Refusing to migrate "
            f"— pass --db with the real database path. This guards the worktree/"
            f"empty-DB trap (CLAUDE.md Rule 1).",
            file=sys.stderr,
        )
        return 1

    conn = sqlite3.connect(args.db)
    try:
        # Run-once guard FIRST: a re-run must NOT overwrite the good
        # pre-migration backup with a post-migration copy (destroys rollback).
        if already_migrated(conn):
            print("ALREADY MIGRATED (source column present) — aborting (run-once).",
                  file=sys.stderr)
            return 2

        # Rule 10: backup only now that we're actually about to migrate.
        # Safe to copy the file with the connection open — no write tx is
        # active yet (we back up BEFORE BEGIN).
        if not args.no_backup:
            bak = args.db.with_suffix(args.db.suffix + ".bak-pre-critic-migration")
            shutil.copy2(args.db, bak)
            print(f"backup -> {bak}")

        # ALL THREE STEPS in ONE transaction so a failure rolls back atomically
        # (no half-migrated DB). foreign_keys pragma must be set OUTSIDE the tx.
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        add_columns(conn)
        n = backfill_curated(conn)
        rebuild_sku_nullable(conn)          # Task 3 — runs inside this same tx
        conn.execute("COMMIT")
        # COMMIT succeeded → migration is durable; success is now locked in.
        # The PRAGMA re-enable below runs in finally so a PRAGMA throw can NOT
        # flip this committed run to exit 1.
        print(f"added {len(NEW_COLUMNS)} columns; backfilled {n} curated rows; "
              f"rebuilt critic_scores with nullable sku")
        return 0
    except Exception as e:
        conn.rollback()   # DB-API method — safe no-op if no tx is active
        print(f"ERROR — rolled back: {e}", file=sys.stderr)
        return 1
    finally:
        # Always restore the default; not part of the success/failure verdict.
        try:
            conn.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
