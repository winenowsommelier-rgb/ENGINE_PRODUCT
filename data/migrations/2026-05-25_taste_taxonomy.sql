BEGIN;

-- New columns on products
ALTER TABLE products
  ADD COLUMN taste_profile JSONB,
  ADD COLUMN taste_profile_override JSONB;

-- Denormalized note index (powers similarity + click-a-note)
CREATE TABLE product_taste_notes (
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  note         TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('primary','secondary','tertiary','flat')),
  intensity    SMALLINT NOT NULL CHECK (intensity BETWEEN 1 AND 3),
  note_family  TEXT NOT NULL,
  PRIMARY KEY (product_id, note, tier)
);
CREATE INDEX idx_ptn_note   ON product_taste_notes (note, tier);
CREATE INDEX idx_ptn_family ON product_taste_notes (note_family);

-- Pre-computed similarity
CREATE TABLE product_similar (
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  similar_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score          NUMERIC(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),
  matching_notes JSONB,
  computed_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, similar_id),
  CHECK (product_id <> similar_id)
);
CREATE INDEX idx_ps_product_score ON product_similar (product_id, score DESC);

-- Dirty queue for incremental similarity recompute
CREATE TABLE product_similar_dirty (
  product_id   TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  queued_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Drop placeholder columns (all hold the same dummy values)
ALTER TABLE products
  DROP COLUMN IF EXISTS flavor_profile,
  DROP COLUMN IF EXISTS character_traits;

COMMIT;
