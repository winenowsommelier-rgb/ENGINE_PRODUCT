-- Wine enrichment pipeline schema (idempotent).
-- See docs/superpowers/specs/2026-05-12-wine-enrichment-design.md

-- New product columns (5)
ALTER TABLE products ADD COLUMN IF NOT EXISTS grape_blend_type text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS wine_production_style text[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS score_max numeric(4,1);
ALTER TABLE products ADD COLUMN IF NOT EXISTS score_summary text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS desc_en_short text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enrichment_confidence numeric(4,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS enrichment_source text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enrichment_note text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enriched_by text;

CREATE INDEX IF NOT EXISTS idx_products_grape_blend_type ON products (grape_blend_type);
CREATE INDEX IF NOT EXISTS idx_products_wine_production_style ON products USING gin (wine_production_style);
CREATE INDEX IF NOT EXISTS idx_products_score_max ON products (score_max DESC NULLS LAST);

-- enrichment_cache
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  category text NOT NULL DEFAULT 'wine',
  prompt_hash text NOT NULL,
  evidence_hash text NOT NULL,
  prompt_text text NOT NULL,
  response_json jsonb NOT NULL,
  response_raw text,
  model text NOT NULL,
  tokens_in integer,
  tokens_out integer,
  cost_thb numeric(10,4),
  confidence numeric(4,3),
  validation_status text,
  validation_issues jsonb,
  created_at timestamptz DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_cache_active
  ON enrichment_cache (sku, prompt_hash, evidence_hash)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_created_at
  ON enrichment_cache (created_at);

-- critic_scores (sommelier-curated, starts empty)
CREATE TABLE IF NOT EXISTS critic_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  critic text NOT NULL,
  score numeric(4,1) NOT NULL,
  score_max numeric(4,1) NOT NULL DEFAULT 100,
  vintage text,
  tasting_year integer,
  source_url text,
  notes text,
  added_by text,
  added_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_critic_scores_sku ON critic_scores (sku);
CREATE INDEX IF NOT EXISTS idx_critic_scores_critic_score
  ON critic_scores (critic, score DESC);
