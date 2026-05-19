-- Fresh project schema — rebuilt after old Supabase project (xfcvliyxxguhihehqwkg)
-- was pruned 2026-05-19 (free-tier inactivity).
--
-- Consolidates:
--   • The full `products` table schema (all columns from any prior migration)
--   • New `enrichment_cache` table (wine enrichment pipeline audit)
--   • New `critic_scores` table (sommelier-curated, starts empty)
--
-- Idempotent: re-running is safe. All ADD COLUMN / CREATE TABLE use IF NOT EXISTS.

-- ============================================================================
-- 1. products — main catalog
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  -- identity
  id              text PRIMARY KEY,            -- internal row id (e.g. "row-1669-...")
  sku             text NOT NULL,               -- catalog SKU; unique
  sku_base        text,                        -- SKU stripped of suffix variants

  -- core descriptive
  name            text,
  brand           text,
  vintage         text,
  bottle_size     text,
  alcohol         text,

  -- pricing (BI-owned)
  price           numeric,
  cost            numeric,
  currency        text,
  special_price   numeric,
  sp_discount_pct text,
  b2b_price       numeric,
  b2b_margin_thb  numeric,
  b2b_margin_pct  text,
  b2b_discount_pct text,
  margin_thb      numeric,
  margin_pct      text,
  promotion_price text,
  promotion_tier_price text,
  price_group     text,

  -- stock (BI-owned)
  is_in_stock     text,
  custom_stock_status text,
  wn_stock        integer,
  quantity_in_stock integer,
  sold_orders     integer,
  sold_qty        integer,
  consign         text,

  -- geography (PIM-owned)
  country         text,
  region          text,
  subregion       text,
  appellation     text,
  origin          text,
  origin_source   text,
  manufacturer    text,

  -- product classification (PIM-owned)
  classification  text,
  classification_source text,
  wine_classification text,
  wine_type       text,
  liquor_main_type text,
  other_type      text,

  -- enrichment data (PIM-owned)
  grape_variety   text,
  grape_blend_type text,
  wine_production_style text[],
  wine_color      text,
  wine_body       text,
  wine_acidity    text,
  wine_tannin     text,
  flavor_profile  text,
  flavor_tags     text,
  food_matching   text,
  character_traits text,
  full_description text,
  desc_en_short   text,
  producer_notes  text,

  -- images
  image_url       text,
  image_alt_text  text,
  image_local_path text,
  image_scraped_url text,

  -- popularity (BI sync)
  popularity_score         numeric(8,6),
  popularity_qty_90d       numeric,
  popularity_orders_90d    integer,
  popularity_revenue_90d   numeric,
  popularity_window_days   integer,
  popularity_synced_at     timestamptz,

  -- critic scores (derived from critic_scores table)
  score_max       numeric(4,1),
  score_summary   text,

  -- enrichment / validation
  enrichment_source     text,
  enrichment_note       text,
  enrichment_priority   text,
  enrichment_confidence numeric(4,3),
  enriched_at           timestamptz,
  enriched_by           text,
  overall_confidence    numeric(4,3),
  taxonomy_confidence   numeric(4,3),
  description_confidence numeric(4,3),
  validation_status     text,

  -- audit
  batch_id        text,
  queue_priority  integer,
  source_file     text,
  supplier_code   text,
  synced_at       timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Unique constraint on sku (we treat sku as a business key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);

-- Indexes for common filters / sorts
CREATE INDEX IF NOT EXISTS idx_products_classification    ON products (classification);
CREATE INDEX IF NOT EXISTS idx_products_country           ON products (country);
CREATE INDEX IF NOT EXISTS idx_products_region            ON products (region);
CREATE INDEX IF NOT EXISTS idx_products_brand             ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_validation_status ON products (validation_status);
CREATE INDEX IF NOT EXISTS idx_products_popularity_score  ON products (popularity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_products_score_max         ON products (score_max DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_products_grape_blend_type  ON products (grape_blend_type);
CREATE INDEX IF NOT EXISTS idx_products_wine_production_style
  ON products USING gin (wine_production_style);


-- ============================================================================
-- 2. enrichment_cache — full audit trail of every AI enrichment call
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 text NOT NULL,
  category            text NOT NULL DEFAULT 'wine',
  prompt_hash         text NOT NULL,
  evidence_hash       text NOT NULL,
  prompt_text         text NOT NULL,
  response_json       jsonb NOT NULL,
  response_raw        text,
  model               text NOT NULL,
  tokens_in           integer,
  tokens_out          integer,
  cost_thb            numeric(10,4),
  confidence          numeric(4,3),
  validation_status   text,
  validation_issues   jsonb,
  created_at          timestamptz DEFAULT now(),
  superseded_at       timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_cache_active
  ON enrichment_cache (sku, prompt_hash, evidence_hash)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_enrichment_cache_created_at
  ON enrichment_cache (created_at);


-- ============================================================================
-- 3. critic_scores — sommelier-curated numerical scores (NOT prose)
-- ============================================================================
CREATE TABLE IF NOT EXISTS critic_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           text NOT NULL,
  critic        text NOT NULL,
  score         numeric(4,1) NOT NULL,
  score_max     numeric(4,1) NOT NULL DEFAULT 100,
  vintage       text,
  tasting_year  integer,
  source_url    text,
  notes         text,
  added_by      text,
  added_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_critic_scores_sku ON critic_scores (sku);
CREATE INDEX IF NOT EXISTS idx_critic_scores_critic_score
  ON critic_scores (critic, score DESC);


-- ============================================================================
-- Sanity check — list the three tables exist
-- ============================================================================
SELECT 'products' AS t, count(*) AS rows FROM products
UNION ALL SELECT 'enrichment_cache', count(*) FROM enrichment_cache
UNION ALL SELECT 'critic_scores', count(*) FROM critic_scores;
