-- Requires pg_cron extension (enabled separately in Phase 0 pre-flight)

-- Weighted-overlap similarity, Tanimoto-style normalization
CREATE OR REPLACE FUNCTION recompute_similarity_for_product(p_id TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  -- Clean existing similarity rows for this product (both directions)
  DELETE FROM product_similar WHERE product_id = p_id OR similar_id = p_id;

  WITH self_score AS (
    SELECT COALESCE(SUM(3.0 * intensity), 0) AS s
    FROM product_taste_notes WHERE product_id = p_id
  ),
  other_self_scores AS (
    SELECT product_id, SUM(3.0 * intensity) AS s
    FROM product_taste_notes
    WHERE product_id <> p_id
    GROUP BY product_id
  ),
  raw_scores AS (
    SELECT
      a.product_id AS pid_a,
      b.product_id AS pid_b,
      SUM(
        CASE
          WHEN a.note = b.note AND a.tier = b.tier THEN 3.0 * LEAST(a.intensity, b.intensity)
          WHEN a.note = b.note                     THEN 1.5 * LEAST(a.intensity, b.intensity)
          WHEN a.note_family = b.note_family       THEN 1.0 * LEAST(a.intensity, b.intensity)
          ELSE 0
        END
      ) AS raw_score
    FROM product_taste_notes a
    JOIN product_taste_notes b
      ON (a.note = b.note OR a.note_family = b.note_family)
     AND a.product_id <> b.product_id
    WHERE a.product_id = p_id
    GROUP BY a.product_id, b.product_id
  ),
  normalized AS (
    SELECT
      r.pid_a, r.pid_b, r.raw_score,
      r.raw_score / NULLIF(LEAST((SELECT s FROM self_score), o.s), 0) AS score
    FROM raw_scores r
    JOIN other_self_scores o ON o.product_id = r.pid_b
  )
  INSERT INTO product_similar (product_id, similar_id, score, matching_notes, computed_at)
  SELECT pid_a, pid_b, ROUND(score::numeric, 3), NULL, NOW()
  FROM normalized
  WHERE score >= 0.3
  ORDER BY score DESC
  LIMIT 50;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  DELETE FROM product_similar_dirty WHERE product_id = p_id;

  RETURN inserted_count;
END;
$$;

-- Process dirty queue
CREATE OR REPLACE FUNCTION process_similarity_dirty_queue()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  total INTEGER := 0;
BEGIN
  FOR r IN SELECT product_id FROM product_similar_dirty ORDER BY queued_at LIMIT 200 LOOP
    total := total + recompute_similarity_for_product(r.product_id);
  END LOOP;
  RETURN total;
END;
$$;

-- Cron jobs (commented out — schedule via separate cron.schedule() calls after first verifying functions work)
-- SELECT cron.schedule('similarity-incremental', '*/5 * * * *',
--   $$SELECT process_similarity_dirty_queue()$$);
--
-- SELECT cron.schedule('similarity-full-recompute', '0 20 * * *',
--   $$DO $do$
--     DECLARE r RECORD;
--   BEGIN
--     FOR r IN SELECT id FROM products WHERE taste_profile IS NOT NULL LOOP
--       PERFORM recompute_similarity_for_product(r.id);
--     END LOOP;
--   END $do$;$$);
