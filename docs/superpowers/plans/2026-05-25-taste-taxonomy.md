# Taste Taxonomy v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tiered taste taxonomy (WSET-style 3-ring wheel for wine/spirits + intensity-grouped chip card for beer/liqueur/RTD) with three AI features (more-like-this rail, click-a-note discovery, smarter food pairing), bundled into the planned catalog re-enrichment.

**Architecture:** Three layers — (L1) `taste_vocab.yml` controlled vocabulary + `taste_profile` JSONB column + `product_taste_notes` denormalized index + `product_similar` pre-compute table; (L2) evolve the existing `data/lib/enrichment/wine/` prompt + validator to emit taste fields, dispatched by classification; (L3) React components (TasteWheel, TasteChipCard, StructuralGauges, TasteNote, TasteProfileSection, SimilarProductsRail) + nightly SQL-based similarity recompute + extended search API.

**Tech Stack:** Python 3.11 (stdlib `sqlite3`, `anthropic`, existing pytest 8.4.2), PostgreSQL/Supabase (JSONB, pg_cron), Next.js 14 (React 18 + TypeScript), SVG (no charting library needed).

**Spec:** [docs/superpowers/specs/2026-05-25-taste-taxonomy-design.md](../specs/2026-05-25-taste-taxonomy-design.md)

**Related plan (foundation):** [docs/superpowers/plans/2026-05-21-local-first-sqlite-enrichment.md](2026-05-21-local-first-sqlite-enrichment.md) — local-first SQLite storage this plan builds on.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `data/migrations/2026-05-25_taste_taxonomy.sql` | Add Supabase tables/columns: `taste_profile`, `taste_profile_override` JSONB on `products`; create `product_taste_notes`, `product_similar`; drop placeholder `flavor_profile`, `character_traits`. |
| `data/migrations/2026-05-25_taste_taxonomy_sqlite.sql` | Same shape adapted for local SQLite mirror. |
| `data/migrations/2026-05-25_similarity_pg_cron.sql` | SQL function `recompute_similarity_for_product(text)` + pg_cron schedule for nightly full pass. |
| `data/lib/enrichment/shared/taste_vocab.yml` | Controlled vocabulary (~300 notes seeded from UC Davis + WSET + spirits + beer). |
| `data/lib/enrichment/shared/vocab_loader.py` | Parses YAML; builds alias reverse-map; exposes `lookup(name) → CanonicalNote \| None` and `for_category(classification) → set[str]`. |
| `data/lib/enrichment/wine/schemas.py` | `TypedDict` definitions for `TasteProfile` (tiered + flat variants) and `Note`. |
| `tests/test_vocab_loader.py` | Unit tests for YAML parse, alias lookup, category filtering. |
| `tests/test_taste_schemas.py` | Schema type tests (smoke). |
| `tests/fixtures/taste_vocab_min.yml` | Tiny fixture vocab (~10 notes) for fast unit tests. |
| `components/product/TasteNote.tsx` | Shared clickable note primitive. Navigation owner. |
| `components/product/TasteWheel.tsx` | 3-ring SVG wheel. |
| `components/product/TasteChipCard.tsx` | Intensity-grouped chip card. |
| `components/product/StructuralGauges.tsx` | 4-cell color-coded segmented track per axis. |
| `components/product/TasteProfileSection.tsx` | Top-level dispatcher (tiered vs flat). |
| `components/product/SimilarProductsRail.tsx` | Horizontal rail under TasteProfileSection. |
| `components/product/__tests__/TasteWheel.test.tsx` | Component snapshot + interaction tests. |
| `app/api/products/[id]/similar/route.ts` | New API endpoint returning ordered similar products. |
| `scripts/seed_taste_vocab.py` | One-shot script — applies vocab to existing DB rows (canonicalize aliases written by ad-hoc paths). Optional safety net. |

### Files to modify

| Path | Change |
|---|---|
| `data/lib/enrichment/wine/prompt.py` | Add `_taste_section(classification)` helper that injects category-specific tier definitions + vocab subset. Extend output JSON schema to include `taste_profile`. Add taste-related instructions to system prompt. |
| `data/lib/enrichment/wine/validator.py` | Add `_validate_taste_profile()` (vocab lookup, alias fuzzy-repair, tier validity, intensity validity, minimum content, auto-sort). Wire into existing `validate()` flow. |
| `data/enrich_wines.py` | After successful validation, write `taste_profile` JSON to `products.taste_profile` and refresh `product_taste_notes` rows in a single transaction. Enqueue product for similarity recompute (write a row to `product_similar_dirty` queue table, or call SQL function directly). |
| `data/lib/enrichment/wine/local_router.py` (created by 2026-05-21 plan) | Extend `update_product()` to write `taste_profile` + maintain `product_taste_notes` in local SQLite. |
| `scripts/sync_to_supabase.py` (created by 2026-05-21 plan) | Push new tables/columns: `products.taste_profile`, `product_taste_notes`, `product_similar`. |
| `app/api/products/search/route.ts` | Accept new optional query params `?note=&tier=` — JOIN to `product_taste_notes` when present. |
| `components/explore/ProductDetailCard.tsx` | Import + mount `<TasteProfileSection>` and `<SimilarProductsRail>`. Render `pairing_rationale` paragraph in existing pairing section if present. |
| `components/explore/ProductSidebar.tsx` | When `?note=` is in URL, render dismissible "Filtered by: {note} · {tier}" chip. |
| `tests/test_wine_enrichment_prompt.py` | Add per-classification dispatch tests (wine prompt has wine vocab; beer prompt has beer vocab + flat schema). |
| `tests/test_wine_enrichment_validator.py` | Add taste-profile validation tests (vocab match, alias repair, fuzzy repair, unknown rejection, tier validity, intensity bounds, auto-sort, minimum content). |
| `tests/test_enrich_wines.py` | Extend to assert `taste_profile` JSON + `product_taste_notes` rows are written. |
| `data/lib/enrichment/wine/taxonomies.py` | NO change — existing BODY/ACIDITY/TANNIN enums reused; add `BITTERNESS_VALUES`, `CARBONATION_VALUES` only if beer enrichment goes deep enough to need them in this phase. |
| `next.config.mjs` (or equivalent) | Expose `NEXT_PUBLIC_TASTE_PROFILE_ENABLED` env var (defaults `false`). |

### Files NOT touched in this plan

- `app/explore/[...slug]/page.tsx` — existing route already handles search params; the new `?note=` flows through naturally.
- `data/lib/enrichment/wine/evidence.py`, `scoring.py` — unchanged.
- `data/lib/enrichment/shared/client.py`, `food_pairing.py` — unchanged.
- Magento integration (`scripts/bulk-process-magento.ts`) — unaffected by this work.

### Open implementation decisions resolved here (from spec)

1. **Similarity recompute infra** → **Supabase pg_cron + plpgsql SQL function**. Keeps compute next to data, no separate worker infrastructure, free, the weighted-overlap formula is feasible in SQL.
2. **Family taxonomy location** → **Inline in `taste_vocab.yml`** (per-note `family:` field). Avoids a second file; family list expected to stay small (<40 entries).
3. **QA-edit UI for `taste_profile_override`** → **Deferred to phase 2**. Column exists in Phase 0 migration; DB-edit only in v1. No UI work in this plan.
4. **Renaming `data/lib/enrichment/wine/` → `core/`** → **Out of scope**, follow-up PR after launch.

---

## Execution order

```
Phase 0: Foundations
  Task 0.1: SQL migration (Supabase + SQLite + pg_cron)
    ↓
  Task 0.2: Seed taste_vocab.yml
    ↓
  Task 0.3: vocab_loader.py
    ↓
  Task 0.4: schemas.py (TypedDicts)
    ↓
Phase 1: Pipeline evolution (sequential)
  Task 1.1: Add taste fields to prompt.py
    ↓
  Task 1.2: Extend validator.py
    ↓
  Task 1.3: Wire enrich_wines.py to write taste_profile + index rows
    ↓
  Task 1.4: Extend local_router.py + sync_to_supabase.py
    ↓
  Task 1.5: 10-SKU dry-run smoke test
    ↓
Phase 2: Frontend components (parallel to Phase 1 — different files)
  Task 2.1: TasteNote primitive + hook
  Task 2.2: TasteWheel SVG
  Task 2.3: TasteChipCard
  Task 2.4: StructuralGauges
  Task 2.5: TasteProfileSection dispatcher
  Task 2.6: Mount in ProductDetailCard + feature flag
    ↓
Phase 3: Smoke-test re-enrichment (operational; user-triggered)
  Task 3.1: Re-enrich top 500 + manual QA
    ↓
Phase 4: AI features
  Task 4.1: Similarity SQL function + pg_cron schedule
  Task 4.2: /api/products/[id]/similar endpoint
  Task 4.3: SimilarProductsRail component
  Task 4.4: Extend search API with ?note=&tier=
  Task 4.5: ProductSidebar filter chip
  Task 4.6: Pairing rationale render
    ↓
Phase 5: Full re-enrichment (operational; user-triggered)
    ↓
Phase 6: Launch
```

Tasks 0.1 → 0.4 sequential. Tasks 1.1 → 1.5 sequential within Phase 1. Phase 2 can run fully parallel to Phase 1 by a different worker (different files, no shared code). Phase 4 sequential.

---

# Phase 0 — Foundations

## Task 0.1: SQL migrations

**Files:**
- Create: `data/migrations/2026-05-25_taste_taxonomy.sql`
- Create: `data/migrations/2026-05-25_taste_taxonomy_sqlite.sql`
- Create: `data/migrations/2026-05-25_similarity_pg_cron.sql`

- [ ] **Step 1.1: Write Supabase migration**

```sql
-- data/migrations/2026-05-25_taste_taxonomy.sql
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
```

- [ ] **Step 1.2: Write SQLite mirror migration**

```sql
-- data/migrations/2026-05-25_taste_taxonomy_sqlite.sql
BEGIN;

ALTER TABLE products ADD COLUMN taste_profile TEXT;            -- JSON as TEXT in SQLite
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
  matching_notes TEXT,                                          -- JSON as TEXT
  computed_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, similar_id),
  CHECK (product_id <> similar_id)
);
CREATE INDEX idx_ps_product_score ON product_similar (product_id, score DESC);

CREATE TABLE product_similar_dirty (
  product_id   TEXT PRIMARY KEY,
  queued_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Drop placeholders if they exist (SQLite < 3.35 lacks DROP COLUMN — safe to leave for SQLite if older)
-- Run only on SQLite >= 3.35.0:
ALTER TABLE products DROP COLUMN flavor_profile;
ALTER TABLE products DROP COLUMN character_traits;

COMMIT;
```

- [ ] **Step 1.3: Write pg_cron schedule + similarity SQL function**

```sql
-- data/migrations/2026-05-25_similarity_pg_cron.sql
-- Requires the pg_cron extension to be enabled in Supabase (Database → Extensions → pg_cron).

-- Weighted-overlap similarity, Tanimoto-style normalization
CREATE OR REPLACE FUNCTION recompute_similarity_for_product(p_id TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  -- Clean existing similarity rows for this product (both directions)
  DELETE FROM product_similar WHERE product_id = p_id OR similar_id = p_id;

  -- Compute and insert top-50 similar
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

  -- Remove from dirty queue
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

-- Cron: process dirty queue every 5 min during the day; full pass at 03:00 ICT
SELECT cron.schedule('similarity-incremental', '*/5 * * * *',
  $$SELECT process_similarity_dirty_queue()$$);

SELECT cron.schedule('similarity-full-recompute', '0 20 * * *',
  -- 20:00 UTC = 03:00 ICT next day
  $$DO $do$
  DECLARE r RECORD; BEGIN
    FOR r IN SELECT id FROM products WHERE taste_profile IS NOT NULL LOOP
      PERFORM recompute_similarity_for_product(r.id);
    END LOOP;
  END $do$$$);
```

- [ ] **Step 1.4: Apply migrations**

Run via Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`) for the Postgres migrations. For the SQLite mirror, append to `scripts/seed_sqlite_from_json.py` setup or run manually.

```bash
# Supabase (use the MCP tool)
# mcp__claude_ai_Supabase__apply_migration: name="2026-05-25_taste_taxonomy", query=<contents of file>
# mcp__claude_ai_Supabase__apply_migration: name="2026-05-25_similarity_pg_cron", query=<contents of file>

# Local SQLite
sqlite3 data/db/products.db < data/migrations/2026-05-25_taste_taxonomy_sqlite.sql
```

- [ ] **Step 1.5: Verify migrations applied**

```bash
# Supabase: check via SQL editor or
# mcp__claude_ai_Supabase__list_tables → expect product_taste_notes, product_similar, product_similar_dirty
# Local
sqlite3 data/db/products.db '.schema product_taste_notes'
```

Expected: schema printed for both. `flavor_profile` and `character_traits` columns NO LONGER appear on `products`.

- [ ] **Step 1.6: Commit**

```bash
git add data/migrations/2026-05-25_*.sql
git commit -m "feat(db): taste_profile + denormalized note index + similarity pg_cron"
```

---

## Task 0.2: Seed taste_vocab.yml

**Files:**
- Create: `data/lib/enrichment/shared/taste_vocab.yml`
- Create: `tests/fixtures/taste_vocab_min.yml`

- [ ] **Step 2.1: Define the YAML structure with a small starter sample**

Write `data/lib/enrichment/shared/taste_vocab.yml`:

```yaml
# Canonical taste-note vocabulary for the enrichment pipeline.
# Each note must have: name, default_tier, family, applies_to.
# Aliases are optional; validator uses them for fuzzy repair.
#
# applies_to values:
#   wine | brown_spirit | white_spirit | beer | liqueur | rtd
#
# tier values: primary | secondary | tertiary | flat
#
# family is a dotted hierarchy (e.g. fruit.black, wood, earth.aged).
# Keep family list small (<40 distinct values across the file).

version: 1
notes:
  # ===== PRIMARY — Fruit (wine/spirits) =====
  - { name: Blackcurrant,  default_tier: primary,   family: fruit.black,  aliases: [black currant, cassis, blackcurrants], applies_to: [wine, brown_spirit] }
  - { name: Blackberry,    default_tier: primary,   family: fruit.black,  aliases: [black berry, brambleberry],            applies_to: [wine] }
  - { name: Dark Plum,     default_tier: primary,   family: fruit.black,  aliases: [black plum, dark plums],                applies_to: [wine] }
  - { name: Cherry,        default_tier: primary,   family: fruit.red,    aliases: [cherries, red cherry],                  applies_to: [wine] }
  - { name: Raspberry,     default_tier: primary,   family: fruit.red,    aliases: [raspberries],                           applies_to: [wine] }
  - { name: Strawberry,    default_tier: primary,   family: fruit.red,    aliases: [strawberries],                          applies_to: [wine] }
  - { name: Cranberry,     default_tier: primary,   family: fruit.red,    aliases: [],                                       applies_to: [wine] }
  - { name: Green Apple,   default_tier: primary,   family: fruit.tree,   aliases: [granny smith, apple, tart apple],       applies_to: [wine] }
  - { name: Pear,          default_tier: primary,   family: fruit.tree,   aliases: [pears],                                  applies_to: [wine] }
  - { name: Stone Fruit,   default_tier: primary,   family: fruit.stone,  aliases: [stonefruit],                             applies_to: [wine] }
  - { name: Peach,         default_tier: primary,   family: fruit.stone,  aliases: [peaches, white peach],                  applies_to: [wine] }
  - { name: Apricot,       default_tier: primary,   family: fruit.stone,  aliases: [apricots],                               applies_to: [wine] }
  - { name: Lemon,         default_tier: primary,   family: fruit.citrus, aliases: [lemons],                                 applies_to: [wine, brown_spirit, white_spirit] }
  - { name: Grapefruit,    default_tier: primary,   family: fruit.citrus, aliases: [],                                       applies_to: [wine] }
  - { name: Lime,          default_tier: primary,   family: fruit.citrus, aliases: [],                                       applies_to: [wine, white_spirit] }
  - { name: Tropical,      default_tier: primary,   family: fruit.tropical, aliases: [tropical fruit, exotic fruit],        applies_to: [wine, beer] }
  - { name: Pineapple,     default_tier: primary,   family: fruit.tropical, aliases: [],                                    applies_to: [wine] }
  - { name: Mango,         default_tier: primary,   family: fruit.tropical, aliases: [],                                    applies_to: [wine, beer] }

  # ===== PRIMARY — Floral / Herbal =====
  - { name: Violet,        default_tier: primary,   family: floral,       aliases: [violets],                                applies_to: [wine] }
  - { name: Rose,          default_tier: primary,   family: floral,       aliases: [roses, rose petal],                      applies_to: [wine] }
  - { name: Jasmine,       default_tier: primary,   family: floral,       aliases: [],                                       applies_to: [wine] }
  - { name: Elderflower,   default_tier: primary,   family: floral,       aliases: [],                                       applies_to: [wine, white_spirit] }
  - { name: Honeysuckle,   default_tier: primary,   family: floral,       aliases: [],                                       applies_to: [wine] }
  - { name: Mint,          default_tier: primary,   family: herbal,       aliases: [spearmint],                              applies_to: [wine] }
  - { name: Eucalyptus,    default_tier: primary,   family: herbal,       aliases: [],                                       applies_to: [wine] }
  - { name: Sage,          default_tier: primary,   family: herbal,       aliases: [],                                       applies_to: [wine] }
  - { name: Bell Pepper,   default_tier: primary,   family: herbal,       aliases: [green pepper, capsicum, green bell],    applies_to: [wine] }
  - { name: Grass,         default_tier: primary,   family: herbal,       aliases: [grassy, fresh grass, cut grass],        applies_to: [wine] }
  - { name: Tomato Leaf,   default_tier: primary,   family: herbal,       aliases: [tomato vine],                            applies_to: [wine] }

  # ===== PRIMARY — Spice (some are tertiary in old wines but default to primary) =====
  - { name: Black Pepper,  default_tier: primary,   family: spice.pepper, aliases: [pepper, peppercorn],                    applies_to: [wine, brown_spirit] }
  - { name: White Pepper,  default_tier: primary,   family: spice.pepper, aliases: [],                                       applies_to: [wine] }
  - { name: Clove,         default_tier: primary,   family: spice.warm,   aliases: [cloves],                                 applies_to: [wine, brown_spirit] }
  - { name: Cinnamon,      default_tier: primary,   family: spice.warm,   aliases: [],                                       applies_to: [wine, brown_spirit] }
  - { name: Anise,         default_tier: primary,   family: spice.warm,   aliases: [aniseed, star anise],                    applies_to: [wine, liqueur] }

  # ===== SECONDARY — Winemaking / production =====
  - { name: Cedar,         default_tier: secondary, family: wood,         aliases: [cedarwood],                              applies_to: [wine, brown_spirit] }
  - { name: Oak,           default_tier: secondary, family: wood,         aliases: [oaky, fresh oak, toasted oak],          applies_to: [wine, brown_spirit] }
  - { name: Sandalwood,    default_tier: secondary, family: wood,         aliases: [],                                       applies_to: [wine, brown_spirit] }
  - { name: Vanilla,       default_tier: secondary, family: wood.sweet,   aliases: [vanilla pod, vanillin],                  applies_to: [wine, brown_spirit] }
  - { name: Cocoa,         default_tier: secondary, family: wood.sweet,   aliases: [chocolate, dark chocolate],              applies_to: [wine, brown_spirit] }
  - { name: Mocha,         default_tier: secondary, family: wood.sweet,   aliases: [coffee, espresso],                       applies_to: [wine, brown_spirit] }
  - { name: Smoke,         default_tier: secondary, family: smoke,        aliases: [smoky, smokiness, peat smoke, peat],    applies_to: [wine, brown_spirit] }
  - { name: Toast,         default_tier: secondary, family: wood,         aliases: [toasted, toasty bread],                  applies_to: [wine, beer] }
  - { name: Butter,        default_tier: secondary, family: dairy,        aliases: [buttery, butterscotch],                  applies_to: [wine] }
  - { name: Brioche,       default_tier: secondary, family: bread,        aliases: [bread, yeasty, autolytic, lees],        applies_to: [wine] }
  - { name: Hazelnut,      default_tier: secondary, family: nut,          aliases: [nutty, almond],                          applies_to: [wine, brown_spirit] }

  # ===== TERTIARY — Aging =====
  - { name: Tobacco,       default_tier: tertiary,  family: earth.aged,   aliases: [tobacco leaf, cigar],                    applies_to: [wine, brown_spirit] }
  - { name: Leather,       default_tier: tertiary,  family: earth.aged,   aliases: [old leather, saddle leather],            applies_to: [wine, brown_spirit] }
  - { name: Dried Fruit,   default_tier: tertiary,  family: fruit.dried,  aliases: [dried fruits, raisin, prune, fig],      applies_to: [wine, brown_spirit] }
  - { name: Earth,         default_tier: tertiary,  family: earth.aged,   aliases: [earthy, forest floor, soil],             applies_to: [wine] }
  - { name: Mushroom,      default_tier: tertiary,  family: earth.aged,   aliases: [truffle, fungal],                        applies_to: [wine] }
  - { name: Petrol,        default_tier: tertiary,  family: mineral,      aliases: [petroleum, kerosene],                    applies_to: [wine] }
  - { name: Honey,         default_tier: tertiary,  family: sweet.aged,   aliases: [honeyed, beeswax],                       applies_to: [wine, liqueur] }

  # ===== Mineral (cross-tier, often primary in young wine, tertiary in aged) =====
  - { name: Wet Stone,     default_tier: primary,   family: mineral,      aliases: [stone, flint, gravel],                   applies_to: [wine] }
  - { name: Sea Salt,      default_tier: primary,   family: mineral,      aliases: [salinity, briny, oyster shell],          applies_to: [wine] }
  - { name: Slate,         default_tier: primary,   family: mineral,      aliases: [],                                       applies_to: [wine] }

  # ===== BEER =====
  - { name: Citrus Hops,   default_tier: primary,   family: hops,         aliases: [hoppy citrus, citra, hop citrus],        applies_to: [beer] }
  - { name: Piney Hops,    default_tier: primary,   family: hops,         aliases: [pine, resinous hops],                    applies_to: [beer] }
  - { name: Floral Hops,   default_tier: primary,   family: hops,         aliases: [],                                       applies_to: [beer] }
  - { name: Earthy Hops,   default_tier: primary,   family: hops,         aliases: [],                                       applies_to: [beer] }
  - { name: Malt Biscuit,  default_tier: primary,   family: malt,         aliases: [biscuit, biscuity malt, cracker],        applies_to: [beer] }
  - { name: Caramel Malt,  default_tier: primary,   family: malt,         aliases: [caramel, toffee malt],                   applies_to: [beer] }
  - { name: Roasted Malt,  default_tier: primary,   family: malt,         aliases: [roast malt, dark roast],                 applies_to: [beer] }
  - { name: Bitter,        default_tier: flat,      family: bitter,       aliases: [bitterness],                             applies_to: [beer, rtd] }
  - { name: Banana Ester,  default_tier: secondary, family: ferment,      aliases: [banana, isoamyl],                        applies_to: [beer] }
  - { name: Clove Ester,   default_tier: secondary, family: ferment,      aliases: [],                                       applies_to: [beer] }
  - { name: Brett Funk,    default_tier: secondary, family: ferment.wild, aliases: [brettanomyces, funky, barnyard],         applies_to: [beer, wine] }

  # ===== LIQUEUR (mostly flat) =====
  - { name: Herbal Sweet,  default_tier: flat,      family: herbal.sweet, aliases: [],                                       applies_to: [liqueur] }
  - { name: Lemon Zest,    default_tier: flat,      family: fruit.citrus, aliases: [],                                       applies_to: [liqueur, rtd] }

  # ===== RTD =====
  - { name: Tonic,         default_tier: flat,      family: mixer,        aliases: [tonic water],                            applies_to: [rtd] }
  - { name: Soda,          default_tier: flat,      family: mixer,        aliases: [club soda, soda water],                  applies_to: [rtd] }
  - { name: Salt Rim,      default_tier: flat,      family: salt,         aliases: [],                                       applies_to: [rtd] }
```

> **Note on completeness:** This file starts with ~70 notes covering the most common wine/spirit/beer descriptors. The vocab grows organically from the "unknown note" reject log during smoke-test (Phase 3). Bi-weekly vocab review will push toward the ~300-note target. **Do not try to seed all 300 at once** — gaps surface naturally and adding them in batches is fine since vocab is YAML data, not code.

- [ ] **Step 2.2: Write the minimal fixture for tests**

Create `tests/fixtures/taste_vocab_min.yml`:

```yaml
version: 1
notes:
  - { name: Blackcurrant, default_tier: primary,   family: fruit.black, aliases: [cassis, black currant], applies_to: [wine] }
  - { name: Cedar,        default_tier: secondary, family: wood,        aliases: [cedarwood],             applies_to: [wine] }
  - { name: Tobacco,      default_tier: tertiary,  family: earth.aged,  aliases: [],                      applies_to: [wine] }
  - { name: Citrus Hops,  default_tier: primary,   family: hops,        aliases: [citra],                 applies_to: [beer] }
```

- [ ] **Step 2.3: Commit**

```bash
git add data/lib/enrichment/shared/taste_vocab.yml tests/fixtures/taste_vocab_min.yml
git commit -m "feat(taste): seed controlled vocabulary (~70 notes, target ~300)"
```

---

## Task 0.3: vocab_loader.py

**Files:**
- Create: `data/lib/enrichment/shared/vocab_loader.py`
- Create: `tests/test_vocab_loader.py`

- [ ] **Step 3.1: Write failing tests**

Create `tests/test_vocab_loader.py`:

```python
"""Tests for the taste vocab YAML loader."""
from pathlib import Path

import pytest

from data.lib.enrichment.shared.vocab_loader import VocabLoader, CanonicalNote

FIXTURE = Path(__file__).parent / "fixtures" / "taste_vocab_min.yml"


def test_loads_all_notes():
    loader = VocabLoader.from_path(FIXTURE)
    assert len(loader.all_notes()) == 4


def test_lookup_canonical_name():
    loader = VocabLoader.from_path(FIXTURE)
    note = loader.lookup("Blackcurrant")
    assert note is not None
    assert note.name == "Blackcurrant"
    assert note.default_tier == "primary"
    assert note.family == "fruit.black"


def test_lookup_alias():
    loader = VocabLoader.from_path(FIXTURE)
    assert loader.lookup("cassis").name == "Blackcurrant"
    assert loader.lookup("Cassis").name == "Blackcurrant"  # case-insensitive
    assert loader.lookup("black currant").name == "Blackcurrant"


def test_lookup_unknown_returns_none():
    loader = VocabLoader.from_path(FIXTURE)
    assert loader.lookup("Dragonfruit") is None


def test_for_category_filters():
    loader = VocabLoader.from_path(FIXTURE)
    wine_notes = loader.for_category("wine")
    assert "Blackcurrant" in wine_notes
    assert "Cedar" in wine_notes
    assert "Citrus Hops" not in wine_notes

    beer_notes = loader.for_category("beer")
    assert "Citrus Hops" in beer_notes
    assert "Blackcurrant" not in beer_notes


def test_invalid_yaml_raises():
    bad = Path(__file__).parent / "fixtures" / "_bad_vocab.yml"
    bad.write_text("notes:\n  - name: NoTier\n    family: fruit\n    applies_to: [wine]")
    try:
        with pytest.raises(ValueError, match="default_tier"):
            VocabLoader.from_path(bad)
    finally:
        bad.unlink()
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
PYTHONPATH=. .venv/bin/pytest tests/test_vocab_loader.py -v
```

Expected: ImportError / module not found.

- [ ] **Step 3.3: Implement vocab_loader.py**

Create `data/lib/enrichment/shared/vocab_loader.py`:

```python
"""Loads and indexes the taste-note controlled vocabulary."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml

Tier = Literal["primary", "secondary", "tertiary", "flat"]
Category = Literal["wine", "brown_spirit", "white_spirit", "beer", "liqueur", "rtd"]

REQUIRED_FIELDS = ("name", "default_tier", "family", "applies_to")
VALID_TIERS = {"primary", "secondary", "tertiary", "flat"}


@dataclass(frozen=True)
class CanonicalNote:
    name: str
    default_tier: Tier
    family: str
    aliases: tuple[str, ...]
    applies_to: tuple[Category, ...]


class VocabLoader:
    """Index of canonical taste notes with alias + category lookups.

    Build once at process startup; lookups are O(1).
    """

    def __init__(self, notes: list[CanonicalNote]):
        self._notes_by_name: dict[str, CanonicalNote] = {n.name: n for n in notes}
        # Alias reverse-map: lowercase alias → canonical note. Includes the
        # canonical name itself (lowercased) so lookup is case-insensitive.
        self._by_alias: dict[str, CanonicalNote] = {}
        for n in notes:
            self._by_alias[n.name.lower()] = n
            for a in n.aliases:
                self._by_alias[a.lower()] = n

    @classmethod
    def from_path(cls, path: Path) -> "VocabLoader":
        raw = yaml.safe_load(path.read_text())
        notes_raw = raw.get("notes", [])
        notes: list[CanonicalNote] = []
        for i, entry in enumerate(notes_raw):
            for field in REQUIRED_FIELDS:
                if field not in entry:
                    raise ValueError(f"notes[{i}]: missing required field '{field}'")
            if entry["default_tier"] not in VALID_TIERS:
                raise ValueError(f"notes[{i}] ({entry['name']}): invalid default_tier '{entry['default_tier']}'")
            notes.append(CanonicalNote(
                name=entry["name"],
                default_tier=entry["default_tier"],
                family=entry["family"],
                aliases=tuple(entry.get("aliases") or ()),
                applies_to=tuple(entry["applies_to"]),
            ))
        return cls(notes)

    def lookup(self, name: str) -> CanonicalNote | None:
        """Look up a canonical note by name or alias (case-insensitive)."""
        return self._by_alias.get(name.strip().lower())

    def all_notes(self) -> list[CanonicalNote]:
        return list(self._notes_by_name.values())

    def for_category(self, category: Category) -> set[str]:
        """Return canonical names of notes valid for this category."""
        return {n.name for n in self._notes_by_name.values() if category in n.applies_to}
```

- [ ] **Step 3.4: Add `pyyaml` to requirements**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
grep -q '^pyyaml' requirements.txt || echo 'pyyaml>=6.0' >> requirements.txt
.venv/bin/pip install -r requirements.txt
```

- [ ] **Step 3.5: Run tests to verify pass**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_vocab_loader.py -v
```

Expected: 6 passed.

- [ ] **Step 3.6: Commit**

```bash
git add data/lib/enrichment/shared/vocab_loader.py tests/test_vocab_loader.py requirements.txt
git commit -m "feat(taste): vocab loader — YAML parse + alias reverse-map"
```

---

## Task 0.4: schemas.py

**Files:**
- Create: `data/lib/enrichment/wine/schemas.py`
- Create: `tests/test_taste_schemas.py`

- [ ] **Step 4.1: Write the schema module**

Create `data/lib/enrichment/wine/schemas.py`:

```python
"""TypedDict definitions for the v2 taste_profile shape."""
from __future__ import annotations

from typing import Literal, TypedDict


class Note(TypedDict):
    note: str
    intensity: int  # 1 (subtle) | 2 (supporting) | 3 (dominant)


class Tiers(TypedDict):
    primary: list[Note]
    secondary: list[Note]
    tertiary: list[Note]


class TasteProfileTiered(TypedDict):
    schema_version: Literal["2.0"]
    structure: Literal["tiered"]
    tiers: Tiers
    structural: dict[str, str | None]
    confidence: float
    prompt_version: str
    enriched_at: str  # ISO 8601


class TasteProfileFlat(TypedDict):
    schema_version: Literal["2.0"]
    structure: Literal["flat"]
    flat_tags: list[Note]
    structural: dict[str, str | None]
    confidence: float
    prompt_version: str
    enriched_at: str


TasteProfile = TasteProfileTiered | TasteProfileFlat


CATEGORY_TO_STRUCTURE: dict[str, Literal["tiered", "flat"]] = {
    # Strong-fits (tiered)
    "Red Wine": "tiered", "White Wine": "tiered", "Rosé Wine": "tiered",
    "Sparkling Wine": "tiered", "Champagne": "tiered", "Dessert Wine": "tiered",
    "Port Wine": "tiered", "Orange Wine": "tiered", "Korean Wine": "tiered",
    "Fruit Wine": "tiered",
    "Brandy": "tiered", "Whisky": "tiered", "Cognac": "tiered",
    "Gin": "tiered", "Vodka": "tiered", "Tequila": "tiered",
    "Chinese Spirits": "tiered", "Sake/Shochu": "tiered",
    # Weak-fits (flat)
    "Beer": "flat", "Liqueur": "flat", "Ready to Drink": "flat",
    # Skip (not in this dict — produces None at lookup site, signals "no taste section")
}


CATEGORY_TO_FAMILY: dict[str, str] = {
    # Used by prompt to pick vocab subset (applies_to value)
    "Red Wine": "wine", "White Wine": "wine", "Rosé Wine": "wine",
    "Sparkling Wine": "wine", "Champagne": "wine", "Dessert Wine": "wine",
    "Port Wine": "wine", "Orange Wine": "wine", "Korean Wine": "wine",
    "Fruit Wine": "wine",
    "Brandy": "brown_spirit", "Whisky": "brown_spirit", "Cognac": "brown_spirit",
    "Chinese Spirits": "brown_spirit",  # baijiu often aged; treat as brown family
    "Gin": "white_spirit", "Vodka": "white_spirit", "Tequila": "white_spirit",
    "Sake/Shochu": "white_spirit",
    "Beer": "beer", "Liqueur": "liqueur", "Ready to Drink": "rtd",
}
```

- [ ] **Step 4.2: Write the smoke test**

Create `tests/test_taste_schemas.py`:

```python
"""Smoke tests for taste schema module."""
from data.lib.enrichment.wine.schemas import (
    TasteProfile,
    CATEGORY_TO_STRUCTURE,
    CATEGORY_TO_FAMILY,
)


def test_structure_lookup_strong_fits_tiered():
    assert CATEGORY_TO_STRUCTURE["Red Wine"] == "tiered"
    assert CATEGORY_TO_STRUCTURE["Brandy"] == "tiered"
    assert CATEGORY_TO_STRUCTURE["Gin"] == "tiered"


def test_structure_lookup_weak_fits_flat():
    assert CATEGORY_TO_STRUCTURE["Beer"] == "flat"
    assert CATEGORY_TO_STRUCTURE["Liqueur"] == "flat"
    assert CATEGORY_TO_STRUCTURE["Ready to Drink"] == "flat"


def test_structure_lookup_skip_categories_missing():
    # Skip categories not in dict — caller must handle KeyError / None lookup
    assert "Cigar" not in CATEGORY_TO_STRUCTURE
    assert "Mineral Water" not in CATEGORY_TO_STRUCTURE
    assert "Accessories" not in CATEGORY_TO_STRUCTURE


def test_family_lookup():
    assert CATEGORY_TO_FAMILY["Red Wine"] == "wine"
    assert CATEGORY_TO_FAMILY["Brandy"] == "brown_spirit"
    assert CATEGORY_TO_FAMILY["Gin"] == "white_spirit"
    assert CATEGORY_TO_FAMILY["Beer"] == "beer"
```

- [ ] **Step 4.3: Run tests to verify pass**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_taste_schemas.py -v
```

Expected: 4 passed.

- [ ] **Step 4.4: Commit**

```bash
git add data/lib/enrichment/wine/schemas.py tests/test_taste_schemas.py
git commit -m "feat(taste): TypedDict schemas + category→structure/family lookups"
```

---

# Phase 1 — Pipeline evolution

## Task 1.1: Extend prompt.py with taste fields

**Files:**
- Modify: `data/lib/enrichment/wine/prompt.py`
- Modify: `tests/test_wine_enrichment_prompt.py`

- [ ] **Step 1.1.1: Write failing prompt tests**

Append to `tests/test_wine_enrichment_prompt.py` (or create the test file if it doesn't exist):

```python
def test_wine_prompt_includes_tiered_schema():
    """Wine system prompt requires tiered taste_profile output."""
    from data.lib.enrichment.wine import prompt
    from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    from pathlib import Path

    vocab = VocabLoader.from_path(Path("data/lib/enrichment/shared/taste_vocab.yml"))
    food = FoodTaxonomy.load_default()
    sys = prompt._system_prompt(food, vocab, classification="Red Wine")
    assert '"structure": "tiered"' in sys
    assert '"primary"' in sys and '"secondary"' in sys and '"tertiary"' in sys
    assert "Blackcurrant" in sys  # wine vocab present
    assert "Citrus Hops" not in sys  # beer vocab NOT included


def test_beer_prompt_includes_flat_schema():
    from data.lib.enrichment.wine import prompt
    from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    from pathlib import Path

    vocab = VocabLoader.from_path(Path("data/lib/enrichment/shared/taste_vocab.yml"))
    food = FoodTaxonomy.load_default()
    sys = prompt._system_prompt(food, vocab, classification="Beer")
    assert '"structure": "flat"' in sys
    assert '"flat_tags"' in sys
    assert "Citrus Hops" in sys
    assert "Blackcurrant" not in sys  # wine vocab NOT included for beer
```

- [ ] **Step 1.1.2: Run tests to verify they fail**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_wine_enrichment_prompt.py -k "tiered_schema or flat_schema" -v
```

Expected: FAIL (signature mismatch).

- [ ] **Step 1.1.3: Modify prompt.py**

Edit `data/lib/enrichment/wine/prompt.py`. The existing `_system_prompt(food_tax)` becomes `_system_prompt(food_tax, vocab, classification)`. Add a helper:

```python
# Add near top of file
from data.lib.enrichment.shared.vocab_loader import VocabLoader
from data.lib.enrichment.wine.schemas import CATEGORY_TO_STRUCTURE, CATEGORY_TO_FAMILY


_TIER_DEFINITIONS: dict[str, dict[str, str]] = {
    "wine": {
        "primary":   "from the grape (fruit, floral, herbal, citrus)",
        "secondary": "from winemaking (oak, vanilla, butter, brioche, char)",
        "tertiary":  "from aging (leather, tobacco, dried fruit, mushroom)",
    },
    "brown_spirit": {
        "primary":   "from the raw material (grain, grape, molasses, agave)",
        "secondary": "from distillation/fermentation (copper, ferment esters, smoke)",
        "tertiary":  "from cask aging (vanilla, caramel, oak, sherry, dried fruit)",
    },
    "white_spirit": {
        "primary":   "from the base (grain, sugar, agave, rice)",
        "secondary": "from botanicals or fermentation (juniper, citrus peel, coriander; or rice ferment notes)",
        "tertiary":  "from any aging (oak, mineral earth) — often empty",
    },
    "beer":    None,  # uses flat structure
    "liqueur": None,
    "rtd":     None,
}


def _taste_section(vocab: VocabLoader, classification: str) -> str:
    """Build the taste-profile schema + vocab subset block for the system prompt."""
    structure = CATEGORY_TO_STRUCTURE.get(classification)
    if structure is None:
        return ""  # Caller should not have invoked enrichment for this category

    family = CATEGORY_TO_FAMILY[classification]
    allowed = sorted(vocab.for_category(family))
    vocab_list = "\n  - " + "\n  - ".join(allowed)

    if structure == "tiered":
        tier_defs = _TIER_DEFINITIONS[family]
        return f'''
TASTE TAXONOMY (tiered) for {classification}:
Output a "taste_profile" object with this exact shape:
{{
  "schema_version": "2.0",
  "structure": "tiered",
  "tiers": {{
    "primary":   [ {{"note": "<canonical name>", "intensity": 1|2|3}}, ... ],
    "secondary": [ {{"note": "<canonical name>", "intensity": 1|2|3}}, ... ],
    "tertiary":  [ {{"note": "<canonical name>", "intensity": 1|2|3}}, ... ]
  }},
  "structural": {{
    "body":      "Light|Medium|Medium-Full|Full",
    "acidity":   "Low|Medium|Medium-High|High",
    "tannin":    "Low|Medium|Medium-High|High",
    "sweetness": "Dry|Off-Dry|Medium-Sweet|Sweet"
  }},
  "confidence": 0.0-1.0
}}

Tier meanings for {classification}:
- primary:   {tier_defs["primary"]}
- secondary: {tier_defs["secondary"]}
- tertiary:  {tier_defs["tertiary"]}

Intensity: 1=subtle, 2=supporting, 3=dominant.

CANONICAL VOCABULARY — use ONLY these exact names (case-sensitive):{vocab_list}

If a perfect descriptor is missing, pick the closest match. Do NOT invent new names.
'''
    else:
        return f'''
TASTE TAXONOMY (flat) for {classification}:
Output a "taste_profile" object with this exact shape:
{{
  "schema_version": "2.0",
  "structure": "flat",
  "flat_tags": [ {{"note": "<canonical name>", "intensity": 1|2|3}}, ... ],
  "structural": {{
    "body":         "Light|Medium|Medium-Full|Full",
    "bitterness":   "Low|Medium|Medium-High|High",
    "sweetness":    "Low|Medium|Medium-High|High",
    "carbonation":  "Low|Medium|Medium-High|High"
  }},
  "confidence": 0.0-1.0
}}

Provide 3-8 flat_tags. Intensity: 1=subtle, 2=supporting, 3=dominant.

CANONICAL VOCABULARY — use ONLY these exact names:{vocab_list}
'''
```

Then modify the existing `_system_prompt(food_tax)` signature to `_system_prompt(food_tax, vocab, classification)` and append `_taste_section(vocab, classification)` to its returned string. Update any other callers in the file (`build_prompt(...)` etc.) to accept and forward `vocab` + `classification`.

- [ ] **Step 1.1.4: Run tests to verify pass**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_wine_enrichment_prompt.py -v
```

Expected: existing tests still pass + the 2 new tests pass.

- [ ] **Step 1.1.5: Commit**

```bash
git add data/lib/enrichment/wine/prompt.py tests/test_wine_enrichment_prompt.py
git commit -m "feat(taste): per-classification taste section in enrichment prompt"
```

---

## Task 1.2: Extend validator.py with taste rules

**Files:**
- Modify: `data/lib/enrichment/wine/validator.py`
- Modify: `tests/test_wine_enrichment_validator.py`

- [ ] **Step 1.2.1: Write failing validator tests**

Append to `tests/test_wine_enrichment_validator.py`:

```python
import json
from pathlib import Path

from data.lib.enrichment.wine import validator
from data.lib.enrichment.shared.vocab_loader import VocabLoader

VOCAB_FIXTURE = Path(__file__).parent / "fixtures" / "taste_vocab_min.yml"


def _wine_payload(taste_profile: dict) -> dict:
    return {
        "wine_body": "Full", "wine_acidity": "Medium-High", "wine_tannin": "High",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "Single Varietal",
        "wine_production_style": ["Conventional"],
        "flavor_tags": ["blackcurrant", "cedar"],
        "food_matching": ["Grilled red meat"],
        "desc_en_short": "test",
        "full_description": "<p>test</p>",
        "confidence": 0.8,
        "confidence_notes": "test",
        "citations": {},
        "taste_profile": taste_profile,
    }


def test_taste_profile_canonical_notes_pass():
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary":   [{"note": "Blackcurrant", "intensity": 3}],
            "secondary": [{"note": "Cedar",        "intensity": 2}],
            "tertiary":  [{"note": "Tobacco",      "intensity": 2}],
        },
        "structural": {"body": "Full", "acidity": "Medium-High", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.78,
    }
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    assert result["ok"] is True


def test_taste_profile_alias_is_repaired():
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary":   [{"note": "cassis", "intensity": 3}],  # alias of Blackcurrant
            "secondary": [], "tertiary": [],
        },
        "structural": {"body": "Full", "acidity": "Medium", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.7,
    }
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    assert result["ok"] is True
    assert tp["tiers"]["primary"][0]["note"] == "Blackcurrant"
    assert "Blackcurrant" in result["repairs"]


def test_taste_profile_unknown_note_rejected():
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary":   [{"note": "Dragonfruit", "intensity": 3}],
            "secondary": [], "tertiary": [],
        },
        "structural": {"body": "Full", "acidity": "Medium", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.7,
    }
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    assert result["ok"] is False
    assert "Dragonfruit" in result["unknown_notes"]


def test_taste_profile_intensity_out_of_range_rejected():
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary":   [{"note": "Blackcurrant", "intensity": 5}],  # invalid
            "secondary": [], "tertiary": [],
        },
        "structural": {"body": "Full", "acidity": "Medium", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.7,
    }
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    assert result["ok"] is False


def test_taste_profile_minimum_content_enforced():
    """Tiered: all tiers empty → reject."""
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {"primary": [], "secondary": [], "tertiary": []},
        "structural": {"body": "Full", "acidity": "Medium", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.5,
    }
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    assert result["ok"] is False


def test_taste_profile_auto_sorts_within_tier():
    vocab = VocabLoader.from_path(VOCAB_FIXTURE)
    tp = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary": [
                {"note": "Blackcurrant", "intensity": 1},  # subtle
                {"note": "Blackcurrant", "intensity": 3},  # dominant — would be a dupe key in real data; use 2 distinct
            ],
            "secondary": [], "tertiary": [],
        },
        "structural": {"body": "Full", "acidity": "Medium", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.7,
    }
    # Adjust test to use two distinct notes if needed; for this stub, just test the sort path
    tp["tiers"]["primary"] = [
        {"note": "Blackcurrant", "intensity": 1},
        {"note": "Cedar",        "intensity": 3},
    ]
    result = validator._validate_taste_profile(tp, vocab, classification="Red Wine")
    # After auto-sort, intensity 3 should come first
    assert tp["tiers"]["primary"][0]["intensity"] == 3
```

- [ ] **Step 1.2.2: Run tests to verify they fail**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_wine_enrichment_validator.py -k taste_profile -v
```

Expected: AttributeError / not implemented.

- [ ] **Step 1.2.3: Implement validator additions**

Append to `data/lib/enrichment/wine/validator.py`:

```python
# At top: import the schema constants
from data.lib.enrichment.shared.vocab_loader import VocabLoader
from data.lib.enrichment.wine.schemas import CATEGORY_TO_STRUCTURE

_VALID_INTENSITIES = {1, 2, 3}
_TIER_NAMES = ("primary", "secondary", "tertiary")


def _validate_taste_profile(tp: dict, vocab: VocabLoader, classification: str) -> dict:
    """Validate + canonicalize a taste_profile in-place.

    Returns dict with keys:
      ok: bool
      repairs: list[str]         — canonical names that an alias resolved to
      unknown_notes: list[str]   — notes that couldn't be canonicalized
      issues: list[str]
    """
    repairs: list[str] = []
    unknown: list[str] = []
    issues: list[str] = []

    expected_structure = CATEGORY_TO_STRUCTURE.get(classification)
    if expected_structure is None:
        issues.append(f"classification '{classification}' is out of scope for taste_profile")
        return {"ok": False, "repairs": repairs, "unknown_notes": unknown, "issues": issues}

    if tp.get("structure") != expected_structure:
        issues.append(f"structure mismatch: got {tp.get('structure')!r}, expected {expected_structure!r}")
        return {"ok": False, "repairs": repairs, "unknown_notes": unknown, "issues": issues}

    # Validate intensity + canonicalize notes
    def _process_notes(notes: list[dict], tier_label: str) -> bool:
        ok = True
        for n in notes:
            if n.get("intensity") not in _VALID_INTENSITIES:
                issues.append(f"{tier_label}: intensity {n.get('intensity')!r} not in {{1,2,3}}")
                ok = False
                continue
            canonical = vocab.lookup(n.get("note", ""))
            if canonical is None:
                unknown.append(n.get("note", ""))
                ok = False
                continue
            if canonical.name != n["note"]:
                repairs.append(canonical.name)
                n["note"] = canonical.name
        return ok

    if expected_structure == "tiered":
        tiers = tp.get("tiers") or {}
        for tier in _TIER_NAMES:
            if tier not in tiers:
                issues.append(f"missing tier '{tier}'")
                continue
            if not _process_notes(tiers[tier], tier_label=tier):
                pass  # issues already appended
            # auto-sort intensity descending
            tiers[tier].sort(key=lambda n: n.get("intensity", 0), reverse=True)
        # Minimum content
        if sum(len(tiers.get(t, [])) for t in _TIER_NAMES) == 0:
            issues.append("all tiers empty")
    else:  # flat
        flat = tp.get("flat_tags") or []
        _process_notes(flat, tier_label="flat_tags")
        flat.sort(key=lambda n: n.get("intensity", 0), reverse=True)
        if len(flat) < 3:
            issues.append(f"flat_tags has {len(flat)} entries (minimum 3)")

    ok = not unknown and not issues
    return {"ok": ok, "repairs": repairs, "unknown_notes": unknown, "issues": issues}
```

Then wire this into the existing `validate()` entry point. Find the existing function (likely `validate(parsed, ...)`); after structural checks pass, before returning, run:

```python
# Inside existing validate() — after structural checks, before return
if "taste_profile" in parsed:
    vocab = _vocab_singleton()   # see helper below
    tp_result = _validate_taste_profile(parsed["taste_profile"], vocab, classification=evidence.facts.get("classification"))
    if not tp_result["ok"]:
        # Log unknowns + fail validation; existing FailureLogger picks this up
        return ValidationResult(
            outcome="rejected",
            repaired_json=parsed,
            issues=[*tp_result["issues"], *(f"unknown note: {n}" for n in tp_result["unknown_notes"])],
            can_retry=True,
        )
    # Log repairs for QA (non-fatal)
    if tp_result["repairs"]:
        # Existing logger pattern — adjust to project's logging convention
        import logging
        logging.getLogger(__name__).info("vocab_repairs", extra={"repairs": tp_result["repairs"]})
```

Add the singleton helper:

```python
from functools import lru_cache
from pathlib import Path

_VOCAB_PATH = Path(__file__).resolve().parents[2] / "shared" / "taste_vocab.yml"

@lru_cache(maxsize=1)
def _vocab_singleton() -> VocabLoader:
    return VocabLoader.from_path(_VOCAB_PATH)
```

- [ ] **Step 1.2.4: Run tests to verify pass**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_wine_enrichment_validator.py -v
```

Expected: existing tests still pass + the 6 new tests pass.

- [ ] **Step 1.2.5: Commit**

```bash
git add data/lib/enrichment/wine/validator.py tests/test_wine_enrichment_validator.py
git commit -m "feat(taste): validator enforces vocab + tier + intensity rules"
```

---

## Task 1.3: Wire enrich_wines.py to write taste_profile + index

**Files:**
- Modify: `data/enrich_wines.py`
- Modify: `data/lib/enrichment/wine/local_router.py` (assume Phase 2 of 2026-05-21 plan exists)
- Modify: `tests/test_enrich_wines.py` (or `tests/test_local_router.py`)

- [ ] **Step 1.3.1: Write failing test on local router**

Append to `tests/test_local_router.py`:

```python
def test_router_writes_taste_profile_and_index_rows(tmp_path):
    """LocalRouter.update_product writes taste_profile JSON AND maintains product_taste_notes."""
    from data.lib.enrichment.wine.local_router import LocalRouter
    import json, sqlite3

    db = tmp_path / "test.db"
    # Set up schema (use the migration)
    schema = (Path(__file__).resolve().parents[1] / "data" / "migrations" / "2026-05-25_taste_taxonomy_sqlite.sql").read_text()
    # Plus the base products table from the earlier migration
    conn = sqlite3.connect(db)
    conn.executescript("CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT);")
    conn.commit()
    conn.executescript(schema)
    conn.execute("INSERT INTO products (id, sku) VALUES (?, ?)", ("p1", "SKU1"))
    conn.commit()

    router = LocalRouter(db_path=db)
    taste_profile = {
        "schema_version": "2.0", "structure": "tiered",
        "tiers": {
            "primary":   [{"note": "Blackcurrant", "intensity": 3}],
            "secondary": [{"note": "Cedar",        "intensity": 2}],
            "tertiary":  [],
        },
        "structural": {"body": "Full", "acidity": "High", "tannin": "High", "sweetness": "Dry"},
        "confidence": 0.78,
        "prompt_version": "2.0.0",
        "enriched_at": "2026-05-25T10:00:00Z",
    }
    router.update_product("p1", {
        "taste_profile": json.dumps(taste_profile),
        # other existing fields...
    })

    # Assert: taste_profile JSON stored
    row = conn.execute("SELECT taste_profile FROM products WHERE id = 'p1'").fetchone()
    assert json.loads(row[0])["tiers"]["primary"][0]["note"] == "Blackcurrant"

    # Assert: product_taste_notes has the right rows
    notes = conn.execute("SELECT note, tier, intensity, note_family FROM product_taste_notes WHERE product_id='p1' ORDER BY tier, note").fetchall()
    assert ("Blackcurrant", "primary", 3, "fruit.black") in notes
    assert ("Cedar", "secondary", 2, "wood") in notes
    # Assert: dirty queue row written
    dirty = conn.execute("SELECT product_id FROM product_similar_dirty").fetchall()
    assert dirty == [("p1",)]
```

- [ ] **Step 1.3.2: Run test to verify fail**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_local_router.py::test_router_writes_taste_profile_and_index_rows -v
```

Expected: NotImplementedError or column missing.

- [ ] **Step 1.3.3: Modify LocalRouter**

In `data/lib/enrichment/wine/local_router.py`, extend `update_product()`. The exact signature depends on the 2026-05-21 plan — likely something like:

```python
def update_product(self, product_id: str, fields: dict) -> None:
    """Write fields to products table; maintain taste_profile index rows."""
    import json
    from data.lib.enrichment.shared.vocab_loader import VocabLoader
    from pathlib import Path

    # Existing UPDATE of products
    set_clauses = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [product_id]
    self._conn.execute(f"UPDATE products SET {set_clauses} WHERE id = ?", values)

    # Maintain product_taste_notes index if taste_profile changed
    if "taste_profile" in fields:
        tp = json.loads(fields["taste_profile"]) if isinstance(fields["taste_profile"], str) else fields["taste_profile"]
        vocab = VocabLoader.from_path(Path("data/lib/enrichment/shared/taste_vocab.yml"))
        self._refresh_taste_notes(product_id, tp, vocab)
        # Enqueue for similarity recompute
        self._conn.execute(
            "INSERT OR REPLACE INTO product_similar_dirty (product_id) VALUES (?)",
            (product_id,),
        )
    self._conn.commit()


def _refresh_taste_notes(self, product_id: str, taste_profile: dict, vocab: VocabLoader) -> None:
    """Delete existing index rows for product; insert new ones from taste_profile."""
    self._conn.execute("DELETE FROM product_taste_notes WHERE product_id = ?", (product_id,))

    def _insert_notes(notes: list[dict], tier: str) -> None:
        for n in notes:
            canonical = vocab.lookup(n["note"])
            if canonical is None:
                continue  # validator should have caught this; defensive skip
            self._conn.execute(
                "INSERT INTO product_taste_notes (product_id, note, tier, intensity, note_family) VALUES (?, ?, ?, ?, ?)",
                (product_id, canonical.name, tier, n["intensity"], canonical.family),
            )

    structure = taste_profile.get("structure")
    if structure == "tiered":
        for tier in ("primary", "secondary", "tertiary"):
            _insert_notes(taste_profile.get("tiers", {}).get(tier, []), tier)
    elif structure == "flat":
        _insert_notes(taste_profile.get("flat_tags", []), "flat")
```

- [ ] **Step 1.3.4: Run test to verify pass**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_local_router.py -v
```

Expected: all pass.

- [ ] **Step 1.3.5: Wire enrich_wines.py to actually write taste_profile**

Find the place in `data/enrich_wines.py` where the validated AI output is written to the local store (likely inside the main loop after validator returns). After the existing fields are set, also pass `taste_profile`:

```python
# Inside main loop, after validator returns ok
import json

if validation.outcome == "passed":
    update_fields = {
        # ... existing fields like desc_en_short, desc_en_full, etc.
        "taste_profile": json.dumps({
            **validation.repaired_json["taste_profile"],
            "prompt_version": prompt.PROMPT_TEMPLATE_VERSION,
            "enriched_at": datetime.now(timezone.utc).isoformat(),
        }),
    }
    router.update_product(product_id, update_fields)
```

- [ ] **Step 1.3.6: Add e2e test (mocked AI)**

Append to `tests/test_enrich_wines.py`:

```python
def test_enrich_writes_taste_profile_end_to_end(tmp_path, monkeypatch):
    """Mock Anthropic call; assert taste_profile + index rows land in SQLite."""
    # Set up DB (same pattern as test_router test); seed one product
    # Patch the client to return a stub JSON with taste_profile
    # Run one enrichment iteration
    # Assert taste_profile in products row, rows in product_taste_notes, row in product_similar_dirty
```

(Full implementation requires knowing the existing test scaffolding in `test_enrich_wines.py`; the test's purpose is to lock in the end-to-end wiring.)

- [ ] **Step 1.3.7: Commit**

```bash
git add data/enrich_wines.py data/lib/enrichment/wine/local_router.py tests/test_local_router.py tests/test_enrich_wines.py
git commit -m "feat(taste): enrich_wines writes taste_profile + refreshes index + enqueues recompute"
```

---

## Task 1.4: Extend sync_to_supabase.py

**Files:**
- Modify: `scripts/sync_to_supabase.py`
- Modify: `tests/test_sync_to_supabase.py`

- [ ] **Step 1.4.1: Add taste_profile + product_taste_notes to sync**

In `scripts/sync_to_supabase.py`, locate the sync logic (likely a function that pushes products' delta). Add `taste_profile` and `taste_profile_override` to the list of columns synced from `products`. Add a new sync block for `product_taste_notes` (DELETE-then-INSERT per product). Add a new sync block for `product_similar_dirty` (so the Supabase pg_cron job picks up dirty rows from local enrichments).

- [ ] **Step 1.4.2: Add test**

Extend `tests/test_sync_to_supabase.py`:

```python
def test_sync_includes_taste_profile_and_index(tmp_path, mock_supabase):
    """Dry-run shows taste_profile column + product_taste_notes rows in the delta."""
    # Set up local DB with a product having taste_profile + 3 note rows
    # Run sync_to_supabase with --dry-run
    # Assert the delta includes the taste_profile JSON and the 3 note rows
```

- [ ] **Step 1.4.3: Run tests**

```bash
PYTHONPATH=. .venv/bin/pytest tests/test_sync_to_supabase.py -v
```

- [ ] **Step 1.4.4: Commit**

```bash
git add scripts/sync_to_supabase.py tests/test_sync_to_supabase.py
git commit -m "feat(taste): sync taste_profile + index + dirty queue to Supabase"
```

---

## Task 1.5: 10-SKU dry-run smoke test

**Files:** none (operational task — uses real AI calls but on a small set).

- [ ] **Step 1.5.1: Pick 10 representative SKUs**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
python3 -c "
import json
items = json.load(open('data/db/products.json'))
# Pick 2 from each of: Red Wine, White Wine, Brandy, Gin, Beer
samples = {}
for p in items:
    cl = p.get('classification')
    if cl in ('Red Wine','White Wine','Brandy','Gin','Beer') and samples.get(cl,0) < 2:
        print(f'{cl}: {p[\"sku\"]} — {p[\"name\"][:60]}')
        samples[cl] = samples.get(cl,0) + 1
        if sum(samples.values()) >= 10: break
" | tee /tmp/dry_run_skus.txt
```

- [ ] **Step 1.5.2: Run enrichment on those 10 SKUs**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
PYTHONPATH=. .venv/bin/python data/enrich_wines.py --sku $(cat /tmp/dry_run_skus.txt | awk '{print $2}' | tr '\n' ',' | sed 's/,$//') --limit 10
```

- [ ] **Step 1.5.3: Inspect output**

```bash
sqlite3 data/db/products.db "
SELECT sku, classification, json_extract(taste_profile, '$.structure'),
       json_extract(taste_profile, '$.confidence'),
       json_array_length(json_extract(taste_profile, '$.tiers.primary')) AS n_primary,
       json_array_length(json_extract(taste_profile, '$.tiers.secondary')) AS n_secondary,
       json_array_length(json_extract(taste_profile, '$.tiers.tertiary')) AS n_tertiary
FROM products
WHERE sku IN ($(cat /tmp/dry_run_skus.txt | awk '{print \"'\\''\"\$2\"'\\''\"}' | tr '\n' ',' | sed 's/,$//'))
"
```

Visual inspection: do the notes feel right for each wine? Are intensities sensible? Did beer products produce flat structure with bitterness/carbonation in structural?

- [ ] **Step 1.5.4: Spot-check vocab repair + unknown logs**

```bash
grep "vocab_repairs\|unknown note" data/lib/enrichment/logs/enrichment.log 2>/dev/null | head -20
```

Confirm: repair rate < 10%, unknown rate low. If high, expand `taste_vocab.yml` and retry.

- [ ] **Step 1.5.5: Commit any vocab additions discovered**

```bash
# After expanding taste_vocab.yml with notes the AI tried to use:
git add data/lib/enrichment/shared/taste_vocab.yml
git commit -m "feat(taste): expand vocab — surfaced by 10-SKU dry run"
```

---

# Phase 2 — Frontend components

> Phase 2 can run fully in parallel with Phase 1 by a different worker. All files are new; no shared imports with Phase 1.

## Task 2.1: TasteNote primitive

**Files:**
- Create: `components/product/TasteNote.tsx`
- Create: `components/product/__tests__/TasteNote.test.tsx`

- [ ] **Step 2.1.1: Write failing test**

```tsx
// components/product/__tests__/TasteNote.test.tsx
import { render, fireEvent, screen } from '@testing-library/react';
import { TasteNote } from '../TasteNote';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));

describe('TasteNote', () => {
  it('renders the note name', () => {
    render(<TasteNote note="Blackcurrant" tier="primary" intensity={3} />);
    expect(screen.getByText('Blackcurrant')).toBeInTheDocument();
  });

  it('navigates to explore with note + tier params on click', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });
    render(<TasteNote note="Blackcurrant" tier="primary" intensity={3} />);
    fireEvent.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledWith('/explore?note=Blackcurrant&tier=primary');
  });

  it('sets data-intensity attribute for styling', () => {
    render(<TasteNote note="Cedar" tier="secondary" intensity={2} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-intensity', '2');
  });
});
```

- [ ] **Step 2.1.2: Run test (expect fail)**

```bash
npm test -- TasteNote
```

- [ ] **Step 2.1.3: Implement**

```tsx
// components/product/TasteNote.tsx
"use client";

import { useRouter } from 'next/navigation';

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  className?: string;
}

export function TasteNote({ note, tier, intensity, className }: TasteNoteProps) {
  const router = useRouter();
  const handleClick = () => {
    const url = `/explore?note=${encodeURIComponent(note)}&tier=${tier}`;
    router.push(url);
  };
  return (
    <button
      type="button"
      data-intensity={intensity}
      data-tier={tier}
      onClick={handleClick}
      className={className ?? 'taste-note'}
      aria-label={`Find other products with ${note} as ${tier} tier`}
    >
      {note}
    </button>
  );
}
```

- [ ] **Step 2.1.4: Run test (expect pass)**

```bash
npm test -- TasteNote
```

- [ ] **Step 2.1.5: Commit**

```bash
git add components/product/TasteNote.tsx components/product/__tests__/TasteNote.test.tsx
git commit -m "feat(ui): TasteNote primitive — clickable note with explore nav"
```

---

## Task 2.2: TasteWheel (3-ring SVG)

**Files:**
- Create: `components/product/TasteWheel.tsx`
- Create: `components/product/__tests__/TasteWheel.test.tsx`

- [ ] **Step 2.2.1: Write failing test**

```tsx
// components/product/__tests__/TasteWheel.test.tsx
import { render, screen } from '@testing-library/react';
import { TasteWheel } from '../TasteWheel';

const fixture = {
  primary:   [{ note: 'Blackcurrant', intensity: 3 as const }, { note: 'Plum', intensity: 2 as const }],
  secondary: [{ note: 'Cedar', intensity: 3 as const }],
  tertiary:  [{ note: 'Tobacco', intensity: 2 as const }],
};

describe('TasteWheel', () => {
  it('renders an SVG with 3 rings', () => {
    const { container } = render(<TasteWheel tiers={fixture} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    // Outer ring path, middle ring path, inner ring path
    expect(container.querySelectorAll('g.taste-ring').length).toBe(3);
  });

  it('renders one TasteNote per note', () => {
    render(<TasteWheel tiers={fixture} />);
    expect(screen.getByText('Blackcurrant')).toBeInTheDocument();
    expect(screen.getByText('Plum')).toBeInTheDocument();
    expect(screen.getByText('Cedar')).toBeInTheDocument();
    expect(screen.getByText('Tobacco')).toBeInTheDocument();
  });

  it('omits empty tiers gracefully', () => {
    const { container } = render(<TasteWheel tiers={{ ...fixture, tertiary: [] }} />);
    // Tertiary ring still rendered as a placeholder, but no notes inside
    expect(container.querySelectorAll('.taste-note').length).toBe(3);
  });
});
```

- [ ] **Step 2.2.2: Run test (expect fail)**

```bash
npm test -- TasteWheel
```

- [ ] **Step 2.2.3: Implement TasteWheel**

```tsx
// components/product/TasteWheel.tsx
"use client";

import { TasteNote, type Tier } from './TasteNote';

export interface Note { note: string; intensity: 1 | 2 | 3; }
export interface Tiers { primary: Note[]; secondary: Note[]; tertiary: Note[]; }

interface TasteWheelProps {
  tiers: Tiers;
  size?: number;     // default 240
}

const TIER_COLORS: Record<keyof Tiers, string> = {
  primary:   '#c64633',
  secondary: '#8b5a2b',
  tertiary:  '#6c6055',
};

const RINGS: Array<{ key: keyof Tiers; rOuter: number; rInner: number }> = [
  { key: 'primary',   rOuter: 0.95, rInner: 0.66 },
  { key: 'secondary', rOuter: 0.66, rInner: 0.42 },
  { key: 'tertiary',  rOuter: 0.42, rInner: 0.22 },
];

function describeWedge(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const polarToCart = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = polarToCart(rOuter, startAngle);
  const [x2, y2] = polarToCart(rOuter, endAngle);
  const [x3, y3] = polarToCart(rInner, endAngle);
  const [x4, y4] = polarToCart(rInner, startAngle);
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

export function TasteWheel({ tiers, size = 240 }: TasteWheelProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  return (
    <div className="taste-wheel">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Taste profile wheel">
        {RINGS.map(({ key, rOuter, rInner }) => {
          const notes = tiers[key];
          const ROuter = r * rOuter;
          const RInner = r * rInner;
          const totalWeight = notes.reduce((s, n) => s + n.intensity, 0) || 1;
          let angle = -Math.PI / 2;
          return (
            <g key={key} className="taste-ring" data-tier={key}>
              {notes.length === 0 ? (
                <circle cx={cx} cy={cy} r={(ROuter + RInner) / 2} fill="none" stroke="#eee" strokeWidth={ROuter - RInner} />
              ) : notes.map((n, i) => {
                const sweep = (n.intensity / totalWeight) * Math.PI * 2;
                const path = describeWedge(cx, cy, ROuter, RInner, angle, angle + sweep);
                const result = (
                  <path
                    key={`${key}-${i}`}
                    d={path}
                    fill={TIER_COLORS[key]}
                    fillOpacity={0.35 + (n.intensity / 3) * 0.55}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                );
                angle += sweep;
                return result;
              })}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={r * 0.22} fill="#f7f2ea" stroke="#d5cdb5" />
      </svg>
      {/* Below the wheel: tier listings with clickable TasteNotes */}
      <div className="taste-wheel-legend">
        {(['primary', 'secondary', 'tertiary'] as const).map(tier => (
          <div key={tier} className={`taste-wheel-legend-row taste-wheel-legend-${tier}`}>
            <span className="taste-wheel-legend-label">{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
            <div className="taste-notes-row">
              {tiers[tier].map((n, i) => (
                <TasteNote key={`${tier}-${i}`} note={n.note} tier={tier} intensity={n.intensity} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2.4: Run test (expect pass)**

```bash
npm test -- TasteWheel
```

- [ ] **Step 2.2.5: Commit**

```bash
git add components/product/TasteWheel.tsx components/product/__tests__/TasteWheel.test.tsx
git commit -m "feat(ui): TasteWheel — 3-ring SVG, intensity-weighted wedges"
```

---

## Task 2.3: TasteChipCard

**Files:**
- Create: `components/product/TasteChipCard.tsx`
- Create: `components/product/__tests__/TasteChipCard.test.tsx`

- [ ] **Step 2.3.1: Write failing test**

```tsx
// components/product/__tests__/TasteChipCard.test.tsx
import { render, screen } from '@testing-library/react';
import { TasteChipCard } from '../TasteChipCard';

describe('TasteChipCard', () => {
  it('groups chips by intensity', () => {
    render(<TasteChipCard flatTags={[
      { note: 'Citrus Hops', intensity: 3 },
      { note: 'Pine', intensity: 3 },
      { note: 'Bitter', intensity: 2 },
      { note: 'Tropical', intensity: 1 },
    ]} />);
    // Three section headings
    expect(screen.getByText(/dominant/i)).toBeInTheDocument();
    expect(screen.getByText(/supporting/i)).toBeInTheDocument();
    expect(screen.getByText(/subtle/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.3.2: Run + fail + implement + run + pass + commit**

```tsx
// components/product/TasteChipCard.tsx
"use client";

import { TasteNote } from './TasteNote';

interface Note { note: string; intensity: 1 | 2 | 3; }

export function TasteChipCard({ flatTags }: { flatTags: Note[] }) {
  const groups: Record<string, Note[]> = {
    Dominant:   flatTags.filter(n => n.intensity === 3),
    Supporting: flatTags.filter(n => n.intensity === 2),
    Subtle:     flatTags.filter(n => n.intensity === 1),
  };
  return (
    <div className="taste-chip-card">
      {Object.entries(groups).map(([label, notes]) => (
        notes.length > 0 && (
          <div key={label} className="taste-chip-group">
            <div className="taste-chip-group-label">{label}</div>
            <div className="taste-chip-row">
              {notes.map((n, i) => (
                <TasteNote key={`${label}-${i}`} note={n.note} tier="flat" intensity={n.intensity} />
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
```

```bash
npm test -- TasteChipCard
git add components/product/TasteChipCard.tsx components/product/__tests__/TasteChipCard.test.tsx
git commit -m "feat(ui): TasteChipCard — intensity-grouped chips for weak-fit categories"
```

---

## Task 2.4: StructuralGauges

**Files:**
- Create: `components/product/StructuralGauges.tsx`
- Create: `components/product/__tests__/StructuralGauges.test.tsx`

- [ ] **Step 2.4.1: Write failing test**

```tsx
// components/product/__tests__/StructuralGauges.test.tsx
import { render, screen } from '@testing-library/react';
import { StructuralGauges } from '../StructuralGauges';

describe('StructuralGauges', () => {
  it('renders one axis row per non-null structural field', () => {
    render(<StructuralGauges structural={{
      body: 'Full', acidity: 'Medium-High', tannin: 'High', sweetness: 'Dry'
    }} />);
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Acidity')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
  });

  it('skips axes with null values', () => {
    render(<StructuralGauges structural={{
      body: 'Full', acidity: null, tannin: null, sweetness: null
    }} />);
    expect(screen.queryByText('Acidity')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2.4.2: Implement**

```tsx
// components/product/StructuralGauges.tsx
const SCALE_DEFINITIONS: Record<string, { scale: string[]; color: string }> = {
  body:        { scale: ['Light', 'Medium', 'Medium-Full', 'Full'],         color: '#a4392b' },
  acidity:     { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a8542' },
  tannin:      { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  sweetness:   { scale: ['Dry',   'Off-Dry','Medium-Sweet','Sweet'],         color: '#d4a017' },
  bitterness:  { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#5a4a3c' },
  carbonation: { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#4a7ec9' },
  intensity:   { scale: ['Low',   'Medium', 'Medium-High', 'High'],         color: '#a4392b' },
};

interface StructuralGaugesProps { structural: Record<string, string | null>; }

export function StructuralGauges({ structural }: StructuralGaugesProps) {
  return (
    <div className="structural-gauges">
      {Object.entries(structural).map(([axis, value]) => {
        if (!value) return null;
        const def = SCALE_DEFINITIONS[axis];
        if (!def) return null;
        const filledCount = def.scale.indexOf(value) + 1;
        return (
          <div key={axis} className="gauge-row">
            <div className="gauge-header">
              <span className="gauge-label">{axis.charAt(0).toUpperCase() + axis.slice(1)}</span>
              <span className="gauge-value" style={{ color: def.color }}>{value}</span>
            </div>
            <div className="gauge-track">
              {def.scale.map((_, i) => (
                <div
                  key={i}
                  className="gauge-cell"
                  style={{ background: i < filledCount ? def.color : '#e5dccb' }}
                />
              ))}
            </div>
            <div className="gauge-scale-labels">
              {def.scale.map((label, i) => <span key={i}>{label}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2.4.3: Run + commit**

```bash
npm test -- StructuralGauges
git add components/product/StructuralGauges.tsx components/product/__tests__/StructuralGauges.test.tsx
git commit -m "feat(ui): StructuralGauges — color-coded segmented tracks per axis"
```

---

## Task 2.5: TasteProfileSection dispatcher

**Files:**
- Create: `components/product/TasteProfileSection.tsx`
- Create: `components/product/__tests__/TasteProfileSection.test.tsx`

- [ ] **Step 2.5.1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { TasteProfileSection } from '../TasteProfileSection';

describe('TasteProfileSection', () => {
  it('renders TasteWheel for tiered structure', () => {
    const { container } = render(<TasteProfileSection profile={{
      schema_version: '2.0', structure: 'tiered',
      tiers: { primary: [{ note: 'Blackcurrant', intensity: 3 }], secondary: [], tertiary: [] },
      structural: { body: 'Full' }, confidence: 0.8, prompt_version: '2.0.0', enriched_at: ''
    }} productId="p1" />);
    expect(container.querySelector('.taste-wheel')).toBeInTheDocument();
  });

  it('renders TasteChipCard for flat structure', () => {
    const { container } = render(<TasteProfileSection profile={{
      schema_version: '2.0', structure: 'flat',
      flat_tags: [{ note: 'Citrus Hops', intensity: 3 }],
      structural: { body: 'Medium' }, confidence: 0.7, prompt_version: '2.0.0', enriched_at: ''
    }} productId="p1" />);
    expect(container.querySelector('.taste-chip-card')).toBeInTheDocument();
  });

  it('returns null when profile is missing', () => {
    const { container } = render(<TasteProfileSection profile={null} productId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when feature flag is off', () => {
    process.env.NEXT_PUBLIC_TASTE_PROFILE_ENABLED = 'false';
    const { container } = render(<TasteProfileSection profile={{ /* valid */ } as any} productId="p1" />);
    expect(container).toBeEmptyDOMElement();
    delete process.env.NEXT_PUBLIC_TASTE_PROFILE_ENABLED;
  });
});
```

- [ ] **Step 2.5.2: Implement**

```tsx
// components/product/TasteProfileSection.tsx
import { TasteWheel } from './TasteWheel';
import { TasteChipCard } from './TasteChipCard';
import { StructuralGauges } from './StructuralGauges';

interface Note { note: string; intensity: 1 | 2 | 3; }

export type TasteProfile =
  | { schema_version: '2.0'; structure: 'tiered';
      tiers: { primary: Note[]; secondary: Note[]; tertiary: Note[] };
      structural: Record<string, string | null>;
      confidence: number; prompt_version: string; enriched_at: string; }
  | { schema_version: '2.0'; structure: 'flat';
      flat_tags: Note[];
      structural: Record<string, string | null>;
      confidence: number; prompt_version: string; enriched_at: string; };

interface Props { profile: TasteProfile | null; productId: string; }

export function TasteProfileSection({ profile, productId }: Props) {
  if (process.env.NEXT_PUBLIC_TASTE_PROFILE_ENABLED !== 'true') return null;
  if (!profile) return null;

  return (
    <section className="taste-profile-section" aria-labelledby={`taste-profile-${productId}`}>
      <h2 id={`taste-profile-${productId}`} className="taste-profile-heading">Taste Profile</h2>
      {profile.confidence < 0.5 && (
        <div className="taste-profile-confidence-badge">Preliminary tasting profile</div>
      )}
      {profile.structure === 'tiered' ? (
        <TasteWheel tiers={profile.tiers} />
      ) : (
        <TasteChipCard flatTags={profile.flat_tags} />
      )}
      <StructuralGauges structural={profile.structural} />
    </section>
  );
}
```

- [ ] **Step 2.5.3: Run + commit**

```bash
npm test -- TasteProfileSection
git add components/product/TasteProfileSection.tsx components/product/__tests__/TasteProfileSection.test.tsx
git commit -m "feat(ui): TasteProfileSection dispatcher + feature flag"
```

---

## Task 2.6: Mount in ProductDetailCard + feature flag

**Files:**
- Modify: `components/explore/ProductDetailCard.tsx`
- Modify: `next.config.mjs` (or `.env.local.example`)

- [ ] **Step 2.6.1: Import + mount**

In `ProductDetailCard.tsx`, add the import and place `<TasteProfileSection>` in the appropriate section of the card layout:

```tsx
import { TasteProfileSection } from '@/components/product/TasteProfileSection';

// Inside the component, after existing product info:
<TasteProfileSection
  profile={product.taste_profile ?? null}
  productId={product.id}
/>
```

- [ ] **Step 2.6.2: Add feature flag env var**

```bash
# In .env.local.example (or equivalent), add:
echo "NEXT_PUBLIC_TASTE_PROFILE_ENABLED=false" >> .env.local.example
```

- [ ] **Step 2.6.3: Verify build still passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.6.4: Commit**

```bash
git add components/explore/ProductDetailCard.tsx .env.local.example
git commit -m "feat(ui): mount TasteProfileSection in ProductDetailCard (flag-gated, default off)"
```

---

# Phase 3 — Smoke-test re-enrichment

**Operational task — user triggers.** No code changes.

## Task 3.1: Re-enrich top 500 + manual QA

- [ ] **Step 3.1.1: Identify top 500 most-viewed products**

```bash
# Adjust query to wherever popularity/page_views are tracked
psql "$DB_URL" -c "
SELECT id FROM products
WHERE classification IN ('Red Wine','White Wine','Sparkling Wine','Champagne','Brandy','Whisky','Gin','Vodka','Beer')
ORDER BY popularity_score DESC NULLS LAST
LIMIT 500
" > /tmp/top500.csv
```

- [ ] **Step 3.1.2: Run enrichment on the batch**

```bash
PYTHONPATH=. .venv/bin/python data/enrich_wines.py --product-ids-file /tmp/top500.csv
```

- [ ] **Step 3.1.3: Run gate checks**

```bash
sqlite3 data/db/products.db <<'EOF'
SELECT
  COUNT(*) AS total_enriched,
  AVG(json_extract(taste_profile, '$.confidence')) AS avg_confidence,
  SUM(CASE WHEN json_extract(taste_profile, '$.confidence') >= 0.6 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS pct_above_0_6
FROM products
WHERE taste_profile IS NOT NULL
  AND id IN (... top 500 ...);
EOF
```

Gate: `pct_above_0_6 >= 0.80`.

- [ ] **Step 3.1.4: Vocab repair rate check**

```bash
grep "vocab_repairs" data/lib/enrichment/logs/enrichment.log | wc -l
# Compare against total notes generated; aim for < 10%
```

- [ ] **Step 3.1.5: Manual visual QA**

Open dev server with feature flag on:

```bash
NEXT_PUBLIC_TASTE_PROFILE_ENABLED=true npm run dev
```

Spot-check 20 product pages by eye. Note any "feels wrong" patterns; capture them for vocab expansion or prompt tweaks.

- [ ] **Step 3.1.6: Commit any vocab additions discovered**

```bash
git add data/lib/enrichment/shared/taste_vocab.yml
git commit -m "feat(taste): vocab additions from top-500 smoke test"
```

---

# Phase 4 — AI features

## Task 4.1: Similarity SQL function + pg_cron (already created in Task 0.1)

- [ ] **Step 4.1.1: Verify pg_cron schedule active**

Via Supabase MCP:
- `mcp__claude_ai_Supabase__execute_sql` with `SELECT * FROM cron.job;`

Expected: 2 entries (`similarity-incremental`, `similarity-full-recompute`).

- [ ] **Step 4.1.2: Manually trigger one recompute to verify**

```sql
-- Via Supabase SQL editor or MCP
SELECT recompute_similarity_for_product(
  (SELECT id FROM products WHERE taste_profile IS NOT NULL LIMIT 1)
);
SELECT COUNT(*) FROM product_similar;
```

Expected: rows present.

- [ ] **Step 4.1.3: No commit needed (SQL already committed in Task 0.1)**

---

## Task 4.2: /api/products/[id]/similar endpoint

**Files:**
- Create: `app/api/products/[id]/similar/route.ts`
- Create: `app/api/products/[id]/similar/route.test.ts` (or pattern-match existing API tests)

- [ ] **Step 4.2.1: Write failing test**

```ts
// app/api/products/[id]/similar/route.test.ts
import { GET } from './route';

describe('GET /api/products/[id]/similar', () => {
  it('returns ordered similar products', async () => {
    const req = new Request('http://x/api/products/p1/similar?limit=5');
    const res = await GET(req, { params: { id: 'p1' } });
    const body = await res.json();
    expect(Array.isArray(body.similar)).toBe(true);
    // ... shape assertions
  });
});
```

- [ ] **Step 4.2.2: Implement**

```ts
// app/api/products/[id]/similar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '10', 10));

  const { data, error } = await supabase
    .from('product_similar')
    .select(`
      similar_id,
      score,
      matching_notes,
      products:similar_id(id, sku, name, classification, price, image_url)
    `)
    .eq('product_id', params.id)
    .order('score', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ similar: data ?? [] });
}
```

- [ ] **Step 4.2.3: Commit**

```bash
git add app/api/products/[id]/similar/route.ts
git commit -m "feat(api): GET /api/products/[id]/similar — pre-computed similarity rail data"
```

---

## Task 4.3: SimilarProductsRail component

**Files:**
- Create: `components/product/SimilarProductsRail.tsx`

- [ ] **Step 4.3.1: Implement (TDD light here — UI rail)**

```tsx
"use client";
import { useEffect, useState } from 'react';

interface SimilarProduct { similar_id: string; score: number; matching_notes: any; products: any; }

export function SimilarProductsRail({ productId }: { productId: string }) {
  const [items, setItems] = useState<SimilarProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/products/${productId}/similar?limit=10`)
      .then(r => r.json())
      .then(d => { setItems(d.similar ?? []); setLoading(false); });
  }, [productId]);

  if (loading) return <div className="similar-rail-skeleton" />;
  if (items.length === 0) return null;

  return (
    <section className="similar-products-rail">
      <h3 className="similar-rail-heading">More like this</h3>
      <div className="similar-rail-scroll">
        {items.map(item => (
          <a key={item.similar_id} href={`/products/${item.products.sku}`} className="similar-card">
            <img src={item.products.image_url} alt={item.products.name} loading="lazy" />
            <div className="similar-card-name">{item.products.name}</div>
            <div className="similar-card-price">{item.products.price?.toLocaleString()} THB</div>
            <div className="similar-card-score">{Math.round(item.score * 100)}% match</div>
          </a>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4.3.2: Mount in ProductDetailCard**

```tsx
import { SimilarProductsRail } from '@/components/product/SimilarProductsRail';

// Inside ProductDetailCard, after TasteProfileSection:
<SimilarProductsRail productId={product.id} />
```

- [ ] **Step 4.3.3: Commit**

```bash
git add components/product/SimilarProductsRail.tsx components/explore/ProductDetailCard.tsx
git commit -m "feat(ui): SimilarProductsRail mounted under TasteProfileSection"
```

---

## Task 4.4: Extend /api/products/search

**Files:**
- Modify: `app/api/products/search/route.ts`

- [ ] **Step 4.4.1: Read existing route**

```bash
cat app/api/products/search/route.ts
```

- [ ] **Step 4.4.2: Add note + tier query params**

In the existing search query builder, when `note` (and optionally `tier`) is present in `searchParams`, add a JOIN to `product_taste_notes`:

```ts
const note = url.searchParams.get('note');
const tier = url.searchParams.get('tier'); // optional

if (note) {
  // Use a subquery on product_taste_notes
  query = query.in('id',
    supabase.from('product_taste_notes')
      .select('product_id')
      .eq('note', note)
      .ifTier(tier ? { tier } : {})  // pseudo-code; adapt to Supabase JS client
  );
}
```

(Exact API depends on the existing route's query-builder choice — kysely, raw supabase-js, etc. Match it.)

- [ ] **Step 4.4.3: Test + commit**

```bash
curl 'http://localhost:3000/api/products/search?note=Tobacco&tier=tertiary&limit=5' | jq .
git add app/api/products/search/route.ts
git commit -m "feat(api): /search accepts ?note=&tier= for click-a-note discovery"
```

---

## Task 4.5: ProductSidebar filter chip

**Files:**
- Modify: `components/explore/ProductSidebar.tsx`

- [ ] **Step 4.5.1: Add filter chip rendering**

```tsx
import { useSearchParams, useRouter } from 'next/navigation';

// Inside ProductSidebar component:
const sp = useSearchParams();
const router = useRouter();
const note = sp.get('note');
const tier = sp.get('tier');

{note && (
  <div className="filter-chip">
    <span>Filtered by: <strong>{note}</strong>{tier && ` · ${tier}`}</span>
    <button
      onClick={() => {
        const next = new URLSearchParams(sp.toString());
        next.delete('note');
        next.delete('tier');
        router.push(`/explore?${next.toString()}`);
      }}
      aria-label="Clear note filter"
    >✕</button>
  </div>
)}
```

- [ ] **Step 4.5.2: Commit**

```bash
git add components/explore/ProductSidebar.tsx
git commit -m "feat(ui): dismissible note-filter chip on /explore"
```

---

## Task 4.6: Pairing rationale render

**Files:**
- Modify: `components/explore/ProductDetailCard.tsx`
- Modify: `data/lib/enrichment/wine/prompt.py` (food pairing prompt section)
- Modify: `data/lib/enrichment/wine/validator.py` (optional `pairing_rationale` field)

- [ ] **Step 4.6.1: Update prompt to emit pairing_rationale**

Extend the existing food-pairing schema in `prompt.py`:

```python
# In the OUTPUT JSON SCHEMA section, add:
# "pairing_rationale": "1-2 sentences grounded in specific tier notes, e.g. 'The blackcurrant primary calls for lamb; cedar secondary suggests rosemary.'"
```

Update the prompt instructions:

```
FOOD PAIRING RATIONALE: ground the recommendation in 2-3 specific notes from the taste_profile. Use tier language ("primary", "secondary", "tertiary"). Example: "The blackcurrant primary calls for lamb; the cedar secondary suggests rosemary; the tobacco tertiary loves smoked brisket."
```

- [ ] **Step 4.6.2: Update validator to accept the optional field**

In `validator.py`, allow `pairing_rationale: str | None` in the schema; truncate to 500 chars if longer.

- [ ] **Step 4.6.3: Render in ProductDetailCard**

```tsx
{product.pairing_rationale && (
  <p className="pairing-rationale">{product.pairing_rationale}</p>
)}
```

(Mount in the existing food-pairing section of the card.)

- [ ] **Step 4.6.4: Commit**

```bash
git add data/lib/enrichment/wine/prompt.py data/lib/enrichment/wine/validator.py components/explore/ProductDetailCard.tsx
git commit -m "feat(taste): smarter food pairing — tier-grounded rationale paragraph"
```

---

# Phase 5 — Full re-enrichment

**Operational. User triggers their standard re-enrichment cadence.**

- [ ] **Step 5.1: Resume normal re-enrichment, processing the remaining ~10,900 products**
- [ ] **Step 5.2: Monitor confidence distribution + vocab repair rate at each batch boundary**
- [ ] **Step 5.3: Sync to Supabase at end of each batch (`scripts/sync_to_supabase.py`)**

---

# Phase 6 — Launch

- [ ] **Step 6.1: Verify gates**

```sql
-- Run in Supabase
SELECT
  COUNT(*) FILTER (WHERE taste_profile IS NOT NULL) * 1.0 / COUNT(*) AS coverage_pct,
  AVG((taste_profile->>'confidence')::numeric) FILTER (WHERE taste_profile IS NOT NULL) AS avg_confidence
FROM products
WHERE classification IN ('Red Wine','White Wine','Champagne','Brandy','Whisky','Gin','Beer', /* etc */);
```

Gate: `coverage_pct >= 0.90`.

- [ ] **Step 6.2: Flip feature flag**

```bash
# In Vercel project env vars:
# NEXT_PUBLIC_TASTE_PROFILE_ENABLED = "true"
# Re-deploy
```

- [ ] **Step 6.3: Smoke-test prod**

Open 10 random product pages. Confirm wheels render, gauges render, similar rail loads.

- [ ] **Step 6.4: Monitor for 24h**

- API error rate on `/similar` and `/search?note=`
- `product_similar_dirty` queue depth (should drain regularly)
- Click-through rate on the rail (baseline metric)
- "Unknown note" log (review weekly thereafter)

- [ ] **Step 6.5: Tag the release**

```bash
git tag -a v-taste-v2-launch -m "Taste taxonomy v2 — wheel + similarity + click-a-note + smart pairing"
git push --tags
```

---

# Acceptance Checklist

- [ ] All Phase 0 migrations applied to Supabase + local SQLite
- [ ] `taste_vocab.yml` seeded with ≥ 70 notes (target ~300 over time)
- [ ] All unit tests green: `PYTHONPATH=. .venv/bin/pytest tests/ -v` + `npm test`
- [ ] 10-SKU dry run (Phase 1) produced valid taste_profile JSON for each
- [ ] Top-500 smoke test (Phase 3) at ≥ 80% confidence ≥ 0.6, vocab repair < 10%
- [ ] Full re-enrichment (Phase 5) at ≥ 90% coverage
- [ ] Feature flag flipped; production smoke test passes
- [ ] 24h post-launch monitoring: no API errors, similarity queue draining

---

# What's NOT in this plan (deferred)

- Personalized recommendations (needs user-history infra)
- Curated tasting flights (needs editorial pipeline)
- Algorithmic cross-category bridges (cross-cat happens only via user-initiated click-a-note in v1)
- Bespoke per-category micro-visuals for beer/liqueur/RTD (Strategy C — phase 2)
- 4-axis radar comparison view (for a future "compare two wines" tool)
- QA admin UI for `taste_profile_override` (column exists, DB-edit-only in v1)
- Renaming `data/lib/enrichment/wine/` → `core/` (follow-up cleanup PR)
