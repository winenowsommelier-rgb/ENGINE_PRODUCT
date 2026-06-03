-- Local SQLite mirror of 2026-05-25_taste_taxonomy.sql
-- Note: SQLite has no BEGIN/COMMIT for DDL (auto-committed per statement);
-- run as separate statements via .read or executescript.

ALTER TABLE products ADD COLUMN taste_profile TEXT;            -- JSON as TEXT
ALTER TABLE products ADD COLUMN taste_profile_override TEXT;

CREATE TABLE product_taste_notes (
  product_id   TEXT NOT NULL,
  note         TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('primary','secondary','tertiary','flat')),
  intensity    INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 3),
  note_family  TEXT NOT NULL,
  PRIMARY KEY (product_id, note, tier),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX idx_ptn_note   ON product_taste_notes (note, tier);
CREATE INDEX idx_ptn_family ON product_taste_notes (note_family);

CREATE TABLE product_similar (
  product_id     TEXT NOT NULL,
  similar_id     TEXT NOT NULL,
  score          REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  matching_notes TEXT,
  computed_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, similar_id),
  CHECK (product_id <> similar_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (similar_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX idx_ps_product_score ON product_similar (product_id, score DESC);

CREATE TABLE product_similar_dirty (
  product_id   TEXT PRIMARY KEY,
  queued_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Drop placeholders (SQLite >= 3.35 supports DROP COLUMN)
ALTER TABLE products DROP COLUMN flavor_profile;
ALTER TABLE products DROP COLUMN character_traits;
