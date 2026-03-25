-- scripts/migration_add_validation_columns.sql
-- Run ONCE in Supabase SQL Editor before running the validation pipeline.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS subregion            TEXT,
  ADD COLUMN IF NOT EXISTS appellation          TEXT,
  ADD COLUMN IF NOT EXISTS wine_classification  TEXT,
  ADD COLUMN IF NOT EXISTS flavor_tags          TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_note      TEXT;

CREATE INDEX IF NOT EXISTS idx_products_subregion   ON products (subregion);
CREATE INDEX IF NOT EXISTS idx_products_appellation ON products (appellation);

CREATE TABLE IF NOT EXISTS taxonomy_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL,
  proposed_value TEXT NOT NULL,
  parent_path    TEXT NOT NULL DEFAULT '',
  source_sku     TEXT,
  occurrences    INT DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT,
  UNIQUE(type, proposed_value, parent_path)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_status ON taxonomy_proposals (status);
CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_type   ON taxonomy_proposals (type);

-- RPC for atomic occurrence increment on conflict.
-- PostgREST's resolution=merge-duplicates overwrites columns — it cannot do arithmetic.
-- This function must be created before running the validation script.
CREATE OR REPLACE FUNCTION upsert_taxonomy_proposal(
  p_type           TEXT,
  p_proposed_value TEXT,
  p_parent_path    TEXT,
  p_source_sku     TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO taxonomy_proposals (type, proposed_value, parent_path, source_sku, occurrences)
  VALUES (p_type, p_proposed_value, p_parent_path, p_source_sku, 1)
  ON CONFLICT (type, proposed_value, parent_path)
  DO UPDATE SET
    occurrences = taxonomy_proposals.occurrences + 1,
    source_sku  = EXCLUDED.source_sku;
END;
$$ LANGUAGE plpgsql;
