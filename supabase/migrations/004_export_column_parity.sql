-- Adds columns that exist in the local SQLite products table but were never
-- added to Supabase, so the CI-generated export
-- (scripts/refresh_live_export_supabase.py) can reach parity with the local
-- one (scripts/refresh_live_export.py). All additive, nullable, no data loss.
-- See scripts/sync_to_supabase.py PRODUCT_SYNC_COLUMNS for the write side.

alter table products
  -- Attribute provenance (2026-06-xx) — distinguishes producer-sourced from
  -- AI-generated attributes.
  add column if not exists attr_sources text,
  add column if not exists attr_evidence_tier text,
  add column if not exists attr_verified_at text,
  -- Taste — bitterness (spirits/liqueur).
  add column if not exists bitterness text,
  -- Phase 2 spirits sub-style classification.
  add column if not exists gin_style text,
  add column if not exists agave_aging text,
  add column if not exists rum_style text,
  add column if not exists peat_level text,
  add column if not exists production_method text,
  -- Food pairing detail (longer-form companion to food_matching).
  add column if not exists food_matching_detail text,
  -- Enrichment metadata.
  add column if not exists enrichment_quality_grade text,
  -- Refiner attributes (2026-06-27) — certification body, accessory sub-type.
  add column if not exists origin_system text,
  add column if not exists accessory_type text,
  -- Reputation signals — tier, composite score, confidence, template copy.
  add column if not exists reputation_tier text,
  add column if not exists reputation_composite numeric(6,4),
  add column if not exists reputation_confidence numeric(6,4),
  add column if not exists reputation_summary text,
  -- Curation — food pairing rationale copy.
  add column if not exists pairing_rationale text,
  -- Parsed vintage (vintage is free text like "2015 [**VINTAGE MAY CHANGE]");
  -- vintage_year is the machine-usable year, vintage_is_provisional preserves
  -- the "may change" caveat.
  add column if not exists vintage_year integer,
  add column if not exists vintage_is_provisional boolean not null default false;
