-- Fixes to the similarity function discovered when first running it
-- against populated product_taste_notes data (commit ae00eaf branch).
--
-- 1. matching_notes column is jsonb; INSERT was passing untyped NULL which
--    Postgres inferred as text → type mismatch. Cast to NULL::jsonb.
-- 2. The Tanimoto-style normalization (raw_score / min(self_a, self_b))
--    can exceed 1.0 when raw_score includes cross-tier + same-family bonus
--    matches that outweigh the smaller self-score. The CHECK constraint
--    rejects score > 1. Cap with LEAST(..., 1.0) before insertion.
-- 3. Also schedules the pg_cron jobs (similarity-incremental every 5 min;
--    similarity-full-recompute nightly at 20:00 UTC).
--
-- This file is the source of truth — the in-place fixes applied via
-- mcp__claude_ai_Supabase__apply_migration are equivalent.

CREATE OR REPLACE FUNCTION recompute_similarity_for_product(p_id TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  DELETE FROM product_similar WHERE product_id = p_id OR similar_id = p_id;

  WITH self_score AS (
    SELECT COALESCE(SUM(3.0 * intensity), 0) AS s
    FROM product_taste_notes WHERE product_id = p_id
  ),
  other_self_scores AS (
    SELECT product_id, SUM(3.0 * intensity) AS s
    FROM product_taste_notes WHERE product_id <> p_id GROUP BY product_id
  ),
  raw_scores AS (
    SELECT a.product_id AS pid_a, b.product_id AS pid_b,
      SUM(CASE
        WHEN a.note = b.note AND a.tier = b.tier THEN 3.0 * LEAST(a.intensity, b.intensity)
        WHEN a.note = b.note                     THEN 1.5 * LEAST(a.intensity, b.intensity)
        WHEN a.note_family = b.note_family       THEN 1.0 * LEAST(a.intensity, b.intensity)
        ELSE 0 END) AS raw_score
    FROM product_taste_notes a
    JOIN product_taste_notes b ON (a.note = b.note OR a.note_family = b.note_family) AND a.product_id <> b.product_id
    WHERE a.product_id = p_id GROUP BY a.product_id, b.product_id
  ),
  normalized AS (
    SELECT r.pid_a, r.pid_b, r.raw_score,
      -- Cap at 1.0 to satisfy the CHECK (score BETWEEN 0 AND 1) constraint.
      -- See note in header comment about why the raw ratio can exceed 1.
      LEAST(r.raw_score / NULLIF(LEAST((SELECT s FROM self_score), o.s), 0), 1.0) AS score
    FROM raw_scores r JOIN other_self_scores o ON o.product_id = r.pid_b
  ),
  top_pairs AS (
    SELECT pid_a, pid_b, score FROM normalized WHERE score >= 0.3 ORDER BY score DESC LIMIT 50
  )
  INSERT INTO product_similar (product_id, similar_id, score, matching_notes, computed_at)
  SELECT pid_a, pid_b, ROUND(score::numeric, 3), NULL::jsonb, NOW() FROM top_pairs
  UNION ALL
  SELECT pid_b, pid_a, ROUND(score::numeric, 3), NULL::jsonb, NOW() FROM top_pairs;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  DELETE FROM product_similar_dirty WHERE product_id = p_id;
  RETURN inserted_count;
END;
$$;

-- Schedule the cron jobs — only applies if pg_cron is enabled.
-- Idempotent: cron.schedule is a no-op if the jobname already exists with
-- the same schedule + command, but it'll error on conflict. The DO block
-- guards by checking cron.job first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'similarity-incremental') THEN
    PERFORM cron.schedule(
      'similarity-incremental',
      '*/5 * * * *',
      'SELECT process_similarity_dirty_queue()'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'similarity-full-recompute') THEN
    PERFORM cron.schedule(
      'similarity-full-recompute',
      '0 20 * * *',
      $cron$
      DO $do$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT id FROM products WHERE taste_profile IS NOT NULL LOOP
          PERFORM recompute_similarity_for_product(r.id);
        END LOOP;
      END $do$;
      $cron$
    );
  END IF;
END;
$$;
