#!/usr/bin/env python3
"""Create the curation-dossier schema in its own SQLite file (spec §4).

WHY a separate file, not products.db: parallel processes in this repo are
known to replace products.db wholesale (see the ~20 products.db.backup-*
files in the working tree) — that would wipe weeks of batched curation
content. dossier.db is ATTACHed at derive/read time. NOTE: this repo has a
similar precedent of using a SEPARATE file (data/taxonomy.db, read via its
own independent connection) but no EXISTING code actually uses SQLite's
ATTACH DATABASE mechanism — Task 10 is the first. ATTACH is a standard,
well-supported SQLite feature, but treat the cross-database join as new
territory to smoke-test (WAL mode across two attached files, path handling),
not as a proven pattern being copied.

Idempotent: safe to run against an existing dossier.db (CREATE TABLE IF NOT EXISTS).
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "dossier.db"

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wine_dossier (
  wine_key TEXT PRIMARY KEY,
  style_summary TEXT,
  expert_note TEXT,
  producer_history TEXT,
  signature_pairings_json TEXT,
  serve_guidance_json TEXT,
  content_hooks_json TEXT,
  occasion_tags_json TEXT,
  course_placement TEXT,
  btg_suitable INTEGER,
  cuisine_tags_json TEXT,
  provenance_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK(review_status IN ('unreviewed','ai-cross-checked','human-approved')),
  reviewed_by TEXT, reviewed_at TEXT,
  model_id TEXT, prompt_version TEXT, source_run_id TEXT,
  generated_at TEXT,
  refresh_due TEXT,
  suppressed INTEGER NOT NULL DEFAULT 0,
  CHECK (signature_pairings_json IS NULL OR json_valid(signature_pairings_json)),
  CHECK (serve_guidance_json IS NULL OR json_valid(serve_guidance_json)),
  CHECK (content_hooks_json IS NULL OR json_valid(content_hooks_json)),
  CHECK (occasion_tags_json IS NULL OR json_valid(occasion_tags_json)),
  CHECK (cuisine_tags_json IS NULL OR json_valid(cuisine_tags_json)),
  CHECK (provenance_json IS NULL OR json_valid(provenance_json))
);

CREATE TABLE IF NOT EXISTS sku_dossier_overlay (
  sku TEXT PRIMARY KEY,
  wine_key TEXT NOT NULL REFERENCES wine_dossier(wine_key),
  vintage_scope TEXT CHECK(vintage_scope IN
    ('exact-vintage','adjacent-vintage','producer-track-record',
     'non-vintage','unknown-stock-vintage')),
  drink_from_year INTEGER, drink_to_year INTEGER,
  peak_from_year INTEGER, peak_to_year INTEGER,
  window_source_url TEXT,
  honors_json TEXT,
  stock_snapshot_json TEXT,
  CHECK (honors_json IS NULL OR json_valid(honors_json)),
  CHECK (stock_snapshot_json IS NULL OR json_valid(stock_snapshot_json))
);
CREATE INDEX IF NOT EXISTS idx_overlay_wine_key ON sku_dossier_overlay(wine_key);

CREATE TABLE IF NOT EXISTS designation_reference (
  designation TEXT NOT NULL, region TEXT NOT NULL,
  kind TEXT CHECK(kind IN
    ('quality-rank','dosage','aging-class','production-style')),
  explainer TEXT, sources_json TEXT,
  PRIMARY KEY (designation, region),
  CHECK (sources_json IS NULL OR json_valid(sources_json))
);

CREATE TABLE IF NOT EXISTS dossier_runs (
  run_id TEXT PRIMARY KEY, started_at TEXT, model_id TEXT, prompt_version TEXT,
  skus_attempted INTEGER, skus_sourced INTEGER, total_cost_usd REAL
);

CREATE TABLE IF NOT EXISTS dossier_staging (
  wine_key TEXT NOT NULL, run_id TEXT NOT NULL,
  raw_response_json TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(validation_status IN ('pending','applied','rejected')),
  error TEXT, created_at TEXT, validated_at TEXT,
  PRIMARY KEY (wine_key, run_id)
);
"""


def migrate(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)
    migrate(args.db)
    print(f"dossier schema ready at {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
