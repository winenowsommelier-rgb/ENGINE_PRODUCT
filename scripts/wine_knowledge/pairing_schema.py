"""Creates pairing_rules (component-matching layer only, §5) and collections
(dynamic saved-filter, §7) tables. Idempotent."""
from __future__ import annotations
import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS pairing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wine_dimension TEXT NOT NULL,      -- e.g. 'acidity'
      wine_op TEXT NOT NULL,             -- '>=','<=','=='
      wine_value REAL NOT NULL,
      food_attribute TEXT NOT NULL,      -- e.g. 'fat'
      food_value TEXT NOT NULL,          -- e.g. 'high'
      score REAL NOT NULL,               -- +2 boost / -2 clash
      rationale TEXT,                    -- 'cuts richness'
      source_citation TEXT NOT NULL,     -- component-matching only; §5
      confidence TEXT
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      filter_definition TEXT NOT NULL DEFAULT '{}',  -- JSON; clean-join fields only §7
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)
    conn.commit()
