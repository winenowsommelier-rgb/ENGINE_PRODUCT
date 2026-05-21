-- SQLite schema for local-first enrichment pipeline
-- Mirrors: data/migrations/2026-05-19_fresh_project_schema.sql (Supabase Postgres)
-- Migration date: 2026-05-21
--
-- Purpose: Local-first SQLite primary store that captures every enrichment call
-- (success AND failure). A separate sync script pushes to Supabase later.
--
-- Type-translation rules (Postgres → SQLite):
--   text              → TEXT
--   integer           → INTEGER
--   numeric / numeric(p,s) → REAL
--   timestamptz       → TEXT   (ISO-8601 strings; caller stores UTC)
--   uuid              → TEXT   (caller provides UUID via uuid.uuid4())
--   text[]            → TEXT   (JSON-encoded list)
--   jsonb             → TEXT   (JSON string)
--   DEFAULT now()     → DEFAULT CURRENT_TIMESTAMP
--
-- Not supported in SQLite (omitted):
--   GIN indexes (wine_production_style)
--   NULLS LAST in index ORDER BY (silently ignored by SQLite; omitted for clarity)
--   gen_random_uuid() (caller must supply UUID)

PRAGMA foreign_keys = ON;

-- ============================================================================
-- 1. products — main catalog
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  -- identity
  id              TEXT PRIMARY KEY,
  sku             TEXT NOT NULL,
  sku_base        TEXT,

  -- core descriptive
  name            TEXT,
  brand           TEXT,
  vintage         TEXT,
  bottle_size     TEXT,
  alcohol         TEXT,

  -- pricing (BI-owned)
  price           REAL,
  cost            REAL,
  currency        TEXT,
  special_price   REAL,
  sp_discount_pct TEXT,
  b2b_price       REAL,
  b2b_margin_thb  REAL,
  b2b_margin_pct  TEXT,
  b2b_discount_pct TEXT,
  margin_thb      REAL,
  margin_pct      TEXT,
  promotion_price TEXT,
  promotion_tier_price TEXT,
  price_group     TEXT,

  -- stock (BI-owned)
  is_in_stock     TEXT,
  custom_stock_status TEXT,
  wn_stock        INTEGER,
  quantity_in_stock INTEGER,
  sold_orders     INTEGER,
  sold_qty        INTEGER,
  consign         TEXT,

  -- geography (PIM-owned)
  country         TEXT,
  region          TEXT,
  subregion       TEXT,
  appellation     TEXT,
  origin          TEXT,
  origin_source   TEXT,
  manufacturer    TEXT,

  -- product classification (PIM-owned)
  classification  TEXT,
  classification_source TEXT,
  wine_classification TEXT,
  wine_type       TEXT,
  liquor_main_type TEXT,
  other_type      TEXT,

  -- enrichment data (PIM-owned)
  grape_variety   TEXT,
  grape_blend_type TEXT,
  wine_production_style TEXT,    -- JSON-encoded list (text[] → TEXT)
  wine_color      TEXT,
  wine_body       TEXT,
  wine_acidity    TEXT,
  wine_tannin     TEXT,
  flavor_profile  TEXT,
  flavor_tags     TEXT,
  food_matching   TEXT,
  character_traits TEXT,
  full_description TEXT,
  desc_en_short   TEXT,
  producer_notes  TEXT,

  -- images
  image_url       TEXT,
  image_alt_text  TEXT,
  image_local_path TEXT,
  image_scraped_url TEXT,

  -- popularity (BI sync)
  popularity_score         REAL,
  popularity_qty_90d       REAL,
  popularity_orders_90d    INTEGER,
  popularity_revenue_90d   REAL,
  popularity_window_days   INTEGER,
  popularity_synced_at     TEXT,

  -- critic scores (derived from critic_scores table)
  score_max       REAL,
  score_summary   TEXT,

  -- enrichment / validation
  enrichment_source     TEXT,
  enrichment_note       TEXT,
  enrichment_priority   TEXT,
  enrichment_confidence REAL,
  enriched_at           TEXT,
  enriched_by           TEXT,
  overall_confidence    REAL,
  taxonomy_confidence   REAL,
  description_confidence REAL,
  validation_status     TEXT,

  -- audit
  batch_id        TEXT,
  queue_priority  INTEGER,
  source_file     TEXT,
  supplier_code   TEXT,
  synced_at       TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on sku (business key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products (sku);

-- Indexes for common filters / sorts
CREATE INDEX IF NOT EXISTS idx_products_classification    ON products (classification);
CREATE INDEX IF NOT EXISTS idx_products_country           ON products (country);
CREATE INDEX IF NOT EXISTS idx_products_region            ON products (region);
CREATE INDEX IF NOT EXISTS idx_products_brand             ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_validation_status ON products (validation_status);
CREATE INDEX IF NOT EXISTS idx_products_popularity_score  ON products (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_products_score_max         ON products (score_max DESC);
CREATE INDEX IF NOT EXISTS idx_products_grape_blend_type  ON products (grape_blend_type);
-- Note: GIN index on wine_production_style omitted (not supported in SQLite)


-- ============================================================================
-- 2. enrichment_cache — full audit trail of every successful AI enrichment call
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_cache (
  id                  TEXT PRIMARY KEY,          -- caller supplies UUID
  sku                 TEXT NOT NULL,
  category            TEXT NOT NULL DEFAULT 'wine',
  prompt_hash         TEXT NOT NULL,
  evidence_hash       TEXT NOT NULL,
  prompt_text         TEXT NOT NULL,
  response_json       TEXT NOT NULL,             -- JSON string (jsonb → TEXT)
  response_raw        TEXT,
  model               TEXT NOT NULL,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  cost_thb            REAL,
  confidence          REAL,
  validation_status   TEXT,
  validation_issues   TEXT,                      -- JSON-encoded list (jsonb → TEXT)
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  superseded_at       TEXT
);

-- Partial unique index: only one active (non-superseded) entry per (sku, hashes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_cache_active
  ON enrichment_cache (sku, prompt_hash, evidence_hash)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_enrichment_cache_created_at
  ON enrichment_cache (created_at);


-- ============================================================================
-- 3. enrichment_failures — NEW local-only table for failed enrichment attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrichment_failures (
  id                  TEXT PRIMARY KEY,          -- caller supplies UUID
  sku                 TEXT NOT NULL,
  failure_type        TEXT NOT NULL,             -- 'parse' | 'validation_first' | 'validation_retry'
  raw_response        TEXT,
  validation_issues   TEXT,                      -- JSON-encoded list
  prompt_hash         TEXT,
  evidence_hash       TEXT,
  model               TEXT,
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  cost_thb            REAL,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrichment_failures_sku          ON enrichment_failures (sku);
CREATE INDEX IF NOT EXISTS idx_enrichment_failures_failure_type ON enrichment_failures (failure_type);


-- ============================================================================
-- 4. critic_scores — sommelier-curated numerical scores
-- ============================================================================
CREATE TABLE IF NOT EXISTS critic_scores (
  id            TEXT PRIMARY KEY,               -- caller supplies UUID
  sku           TEXT NOT NULL,
  critic        TEXT NOT NULL,
  score         REAL NOT NULL,
  score_max     REAL NOT NULL DEFAULT 100,
  vintage       TEXT,
  tasting_year  INTEGER,
  source_url    TEXT,
  notes         TEXT,
  added_by      TEXT,
  added_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_critic_scores_sku ON critic_scores (sku);
CREATE INDEX IF NOT EXISTS idx_critic_scores_critic_score
  ON critic_scores (critic, score DESC);


-- ============================================================================
-- 5. sync_state — tracks last successful push to Supabase per table
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_state (
  table_name      TEXT PRIMARY KEY,
  last_synced_at  TEXT,
  last_synced_id  TEXT
);
