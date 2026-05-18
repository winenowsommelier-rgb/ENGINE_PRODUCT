# Wine Enrichment Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-driven (Claude Haiku 4.5) wine enrichment pipeline that fills body/acidity/tannin/grape/food-matching/descriptions for ~6,375 wine SKUs, gated by confidence (≥0.85 direct-writes to Supabase, all SKUs export to Magento-ready CSV).

**Architecture:** Pure-Python batch CLI (`data/enrich_wines.py`) backed by a pure-functions library at `data/lib/enrichment/wine/` (per-category) and `data/lib/enrichment/shared/` (cross-category Anthropic client + Supabase cache). Five grounding sources feed each prompt (product facts + Winesensed records + brand library + taxonomy heuristics + critic scores). Cache-keyed by `(sku, prompt_hash, evidence_hash)` so re-runs cost ~$0. Confidence-gated routing: Supabase write for high-conf rows; CSV export for all rows (human review interface).

**Tech Stack:** Python 3.11+ stdlib + `anthropic` SDK (new dep) + `psycopg2-binary` (already installed) + `pytest 8.4.2` (already installed). No Node/TypeScript work in this plan beyond a 1-line `route.ts` edit at the end.

**Spec:** `docs/superpowers/specs/2026-05-12-wine-enrichment-design.md`

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `data/migrations/2026-05-12_wine_enrichment.sql` | DDL: 5 new product columns + `enrichment_cache` + `critic_scores` tables. |
| `data/db/food-pairing-taxonomy.json` | 43 curated food categories in 10 groups. Loaded into prompt at runtime. |
| `data/db/critic_scores_seed.csv` | Optional starter rows (empty for v1; sommelier fills over time). |
| `data/lib/enrichment/__init__.py` | Empty (Python package marker). |
| `data/lib/enrichment/shared/__init__.py` | Empty. |
| `data/lib/enrichment/shared/client.py` | Anthropic SDK wrapper with retries + cost tracking. |
| `data/lib/enrichment/shared/cache.py` | Supabase `enrichment_cache` reader/writer with hash-based lookup. |
| `data/lib/enrichment/shared/taxonomies/__init__.py` | Empty. |
| `data/lib/enrichment/shared/taxonomies/food_pairing.py` | Loads `food-pairing-taxonomy.json` into typed dataclasses. |
| `data/lib/enrichment/wine/__init__.py` | Empty. |
| `data/lib/enrichment/wine/taxonomies.py` | Wine-specific enums: body/acidity/tannin (4 each), `BLEND_TYPES` (12), `PRODUCTION_STYLES` (7), `GRAPE_REGION_HEURISTICS` dict (~40 combos). |
| `data/lib/enrichment/wine/evidence.py` | `collect_evidence(sku, products_row) -> Evidence` — 5 grounding sources. |
| `data/lib/enrichment/wine/prompt.py` | `build_prompt(evidence) -> (system, user, prompt_hash)`. |
| `data/lib/enrichment/wine/validator.py` | `validate(response_json, evidence) -> ValidationResult` with fuzzy-repair table. |
| `data/lib/enrichment/wine/scoring.py` | `final_confidence(ai_conf, tier, validator_outcome) -> float`. |
| `data/lib/enrichment/wine/output.py` | `route(...)` — Supabase write (≥threshold) + CSV append (always). |
| `data/enrich_wines.py` | CLI driver. ~150 lines. |
| `tests/test_wine_enrichment_taxonomies.py` | Unit tests for `taxonomies.py` constants + heuristic lookup. |
| `tests/test_wine_enrichment_evidence.py` | Unit tests for `evidence.py` (with stubbed source data). |
| `tests/test_wine_enrichment_prompt.py` | Unit tests for `prompt.py` (hash stability, evidence injection). |
| `tests/test_wine_enrichment_validator.py` | Unit tests for `validator.py` (vocab repair, citation pruning). |
| `tests/test_wine_enrichment_scoring.py` | Unit tests for `scoring.py` (multiplier math, edge cases). |
| `tests/test_wine_enrichment_cache.py` | Unit tests for `cache.py` (mocked Supabase HTTP). |
| `tests/test_wine_enrichment_output.py` | Unit tests for `output.py` (CSV row construction, routing). |
| `tests/test_enrich_wines.py` | Integration test on fixture SKUs (mocked Anthropic). |
| `tests/fixtures/wine_pilot_skus.json` | 5-SKU fixture: Bordeaux Cru, Napa Cab, Aussie Shiraz, NZ Sauv Blanc, obscure Sicilian. |
| `tests/fixtures/winesensed_sample.json` | 10-record Winesensed subset for offline tests. |
| `tests/fixtures/brand_library_sample.csv` | 5-row brand library subset. |

### Files to modify

| Path | Change |
|---|---|
| `requirements.txt` | Add `anthropic>=0.40.0`. |
| `app/api/explore/products/route.ts` | Extend `SELECT_FIELDS` to include `grape_blend_type`, `wine_production_style`, `score_max`, `score_summary`. |
| `PRODUCT_DATA_API.md` | Document new fields + the wine-enrichment pipeline. |

### Files generated at runtime (not part of implementation)

- `data/exports/wine-enrichment-{timestamp}.csv` — Magento-ready output per run (gitignored).

---

## Important Notes for the Implementer

1. **Stay on `main`.** This project commits direct-to-main per existing convention. No feature branch unless explicitly chosen.
2. **Use `.venv/bin/python3` and `.venv/bin/pytest`.** The system Python lacks pytest + project libs.
3. **Never `git add -A`.** Stage exact paths per commit step.
4. **TDD discipline.** Write failing test → run it failing → minimal code → run it passing → commit. Don't skip the failing-test verification.
5. **Anthropic API key.** Required as `ANTHROPIC_API_KEY` env var. Already set in `.env.local`. Tests mock the SDK; only the pilot run needs real key.
6. **Supabase env.** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` already in `.env.local`. Migration runs via direct postgres connection (existing `data/apply_migration.py` helper); REST API used for cache and product writes.
7. **Don't pre-fill `critic_scores`.** Table starts empty. AI handles empty case gracefully.
8. **One subagent per task.** Tasks are subagent-sized; pass full task text to each.

---

## Task 1: Add `anthropic` SDK to requirements + scaffold package directories

**Files:**
- Modify: `requirements.txt`
- Create: `data/lib/enrichment/__init__.py`, `data/lib/enrichment/shared/__init__.py`, `data/lib/enrichment/shared/taxonomies/__init__.py`, `data/lib/enrichment/wine/__init__.py`

- [ ] **Step 1: Add SDK to requirements.txt**

Append:
```
anthropic>=0.40.0
```

- [ ] **Step 2: Install in venv**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/pip install -r requirements.txt
.venv/bin/python3 -c "import anthropic; print(anthropic.__version__)"
```

Expected: SDK version printed without error.

- [ ] **Step 3: Create the 4 empty `__init__.py` files**

```bash
mkdir -p "data/lib/enrichment/shared/taxonomies" "data/lib/enrichment/wine"
touch data/lib/enrichment/__init__.py
touch data/lib/enrichment/shared/__init__.py
touch data/lib/enrichment/shared/taxonomies/__init__.py
touch data/lib/enrichment/wine/__init__.py
```

- [ ] **Step 4: Verify import**

```bash
.venv/bin/python3 -c "from data.lib.enrichment import wine, shared; print('ok')"
```

Expected output: `ok`

- [ ] **Step 5: Commit**

```bash
git add requirements.txt data/lib/enrichment/__init__.py data/lib/enrichment/shared/__init__.py data/lib/enrichment/shared/taxonomies/__init__.py data/lib/enrichment/wine/__init__.py
git commit -m "scaffold: data/lib/enrichment/ package + anthropic SDK dep"
```

---

## Task 2: Migration — new tables + product columns

**Files:**
- Create: `data/migrations/2026-05-12_wine_enrichment.sql`

- [ ] **Step 1: Write the migration**

File: `data/migrations/2026-05-12_wine_enrichment.sql`

```sql
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
```

- [ ] **Step 2: Apply via Supabase SQL Editor** (manual — like the earlier popularity migration)

Open Supabase Dashboard → SQL Editor → New query → paste the migration content above → Run.

Expected: Success, no errors. Verify via:
```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/products?limit=1&select=sku,grape_blend_type,score_max" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | python3 -m json.tool
```

Expected output: a record with `grape_blend_type: null, score_max: null` confirms columns exist.

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/critic_scores?limit=0" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
```

Expected output: `[]` confirms `critic_scores` table exists and is empty.

- [ ] **Step 3: Commit**

```bash
git add data/migrations/2026-05-12_wine_enrichment.sql
git commit -m "migration: wine enrichment schema (5 product columns + cache + critic_scores)"
```

---

## Task 3: Food-pairing taxonomy JSON

**Files:**
- Create: `data/db/food-pairing-taxonomy.json`

- [ ] **Step 1: Write the taxonomy**

File: `data/db/food-pairing-taxonomy.json` — 43 categories per spec §10.

```json
{
  "version": "1.0.0",
  "last_updated": "2026-05-12",
  "categories": [
    { "id": "grilled_red_meat", "label": "Grilled red meat", "group": "Red Meat", "wine_style_hint": ["Full red", "Medium-Full red"], "examples": "steak, ribeye, T-bone, beef short ribs" },
    { "id": "lamb_dishes", "label": "Lamb dishes", "group": "Red Meat", "wine_style_hint": ["Full red", "Medium-Full red"], "examples": "rack of lamb, lamb shank, kofta" },
    { "id": "game_meats", "label": "Game meats", "group": "Red Meat", "wine_style_hint": ["Full red"], "examples": "venison, wild boar, duck" },
    { "id": "beef_stew_braised", "label": "Beef stew & braised", "group": "Red Meat", "wine_style_hint": ["Full red", "Medium-Full red"], "examples": "bourguignon, brisket, oxtail" },
    { "id": "charcuterie_cured_meats", "label": "Charcuterie & cured meats", "group": "Red Meat", "wine_style_hint": ["Medium red", "Sparkling"], "examples": "prosciutto, salumi, jamon" },
    { "id": "pate_terrine", "label": "Pâté & terrine", "group": "Red Meat", "wine_style_hint": ["Medium-Full red", "Off-dry white"], "examples": "duck pâté, country terrine" },
    { "id": "roast_chicken", "label": "Roast chicken", "group": "Poultry & Pork", "wine_style_hint": ["Medium red", "Full white", "Sparkling"], "examples": "roast chicken, herb chicken" },
    { "id": "duck", "label": "Duck (breast/confit)", "group": "Poultry & Pork", "wine_style_hint": ["Medium-Full red"], "examples": "duck breast, confit, magret" },
    { "id": "pork_dishes", "label": "Pork dishes", "group": "Poultry & Pork", "wine_style_hint": ["Medium red", "Off-dry white"], "examples": "roast pork, pork belly, ham" },
    { "id": "grilled_fish", "label": "Grilled fish", "group": "Seafood", "wine_style_hint": ["Light white", "Medium white"], "examples": "sea bass, snapper, grouper" },
    { "id": "oily_fish", "label": "Oily fish (salmon, tuna)", "group": "Seafood", "wine_style_hint": ["Full white", "Light red"], "examples": "salmon, tuna, mackerel" },
    { "id": "shellfish", "label": "Shellfish (lobster, crab, prawn)", "group": "Seafood", "wine_style_hint": ["Full white", "Sparkling"], "examples": "lobster, crab, prawns" },
    { "id": "oysters_raw_seafood", "label": "Oysters & raw seafood", "group": "Seafood", "wine_style_hint": ["Light white", "Sparkling"], "examples": "oysters, ceviche, crudo" },
    { "id": "sushi_sashimi", "label": "Sushi & sashimi", "group": "Seafood", "wine_style_hint": ["Light white", "Sake", "Sparkling"], "examples": "sushi, sashimi, nigiri" },
    { "id": "tomato_pasta", "label": "Tomato-based pasta", "group": "Pasta, Rice & Grains", "wine_style_hint": ["Medium red", "Sangiovese-based"], "examples": "spaghetti pomodoro, lasagna, arrabbiata" },
    { "id": "cream_pasta_risotto", "label": "Cream-based pasta & risotto", "group": "Pasta, Rice & Grains", "wine_style_hint": ["Full white", "Chardonnay"], "examples": "carbonara, alfredo, risotto" },
    { "id": "pesto_oil_pasta", "label": "Pesto & oil-based pasta", "group": "Pasta, Rice & Grains", "wine_style_hint": ["Light white", "Medium white"], "examples": "pesto, aglio e olio, primavera" },
    { "id": "soft_fresh_cheese", "label": "Soft fresh cheese", "group": "Cheese", "wine_style_hint": ["Light white", "Sparkling"], "examples": "brie, camembert, burrata" },
    { "id": "aged_hard_cheese", "label": "Aged hard cheese", "group": "Cheese", "wine_style_hint": ["Full red", "Aged white"], "examples": "parmesan, manchego, comté" },
    { "id": "blue_cheese", "label": "Blue cheese", "group": "Cheese", "wine_style_hint": ["Dessert", "Sweet white"], "examples": "roquefort, stilton, gorgonzola" },
    { "id": "goat_cheese", "label": "Goat cheese", "group": "Cheese", "wine_style_hint": ["Sauvignon Blanc", "Light white"], "examples": "chèvre, crottin, fresh goat" },
    { "id": "grilled_vegetables", "label": "Grilled vegetables", "group": "Vegetables", "wine_style_hint": ["Medium white", "Rosé"], "examples": "grilled aubergine, peppers, zucchini" },
    { "id": "leafy_salads", "label": "Leafy salads", "group": "Vegetables", "wine_style_hint": ["Light white", "Sauvignon Blanc"], "examples": "garden salad, niçoise, caprese" },
    { "id": "mushroom_dishes", "label": "Mushroom dishes", "group": "Vegetables", "wine_style_hint": ["Pinot Noir", "Medium red"], "examples": "mushroom risotto, truffles, porcini" },
    { "id": "thai_spicy_sour", "label": "Thai food (spicy & sour)", "group": "Asian", "wine_style_hint": ["Off-dry white", "Riesling", "Light sparkling"], "examples": "tom yum, som tam, green curry, larb" },
    { "id": "chinese_cuisine", "label": "Chinese cuisine", "group": "Asian", "wine_style_hint": ["Off-dry white", "Light red"], "examples": "dim sum, peking duck, mapo tofu" },
    { "id": "japanese_cuisine", "label": "Japanese cuisine", "group": "Asian", "wine_style_hint": ["Sparkling", "Light white", "Sake"], "examples": "tempura, yakitori, soba" },
    { "id": "korean_bbq", "label": "Korean BBQ", "group": "Asian", "wine_style_hint": ["Medium red", "Off-dry white"], "examples": "kalbi, bulgogi, kimchi-jjigae" },
    { "id": "indian_curry", "label": "Indian curry", "group": "Asian", "wine_style_hint": ["Off-dry white", "Rosé"], "examples": "tikka masala, vindaloo, biryani" },
    { "id": "vietnamese_cuisine", "label": "Vietnamese cuisine", "group": "Asian", "wine_style_hint": ["Light white", "Off-dry Riesling"], "examples": "pho, bánh mì, fresh rolls" },
    { "id": "hot_pot_shabu", "label": "Hot pot & Shabu Shabu", "group": "Asian", "wine_style_hint": ["Light white", "Sparkling"], "examples": "Chinese hotpot, shabu shabu, sukiyaki" },
    { "id": "dim_sum", "label": "Dim Sum", "group": "Asian", "wine_style_hint": ["Sparkling", "Light white"], "examples": "har gow, siu mai, char siu bao" },
    { "id": "pizza_flatbreads", "label": "Pizza & flatbreads", "group": "Other Dishes", "wine_style_hint": ["Medium red", "Sangiovese"], "examples": "margherita, pepperoni, flammkuchen" },
    { "id": "mexican_tex_mex", "label": "Mexican & Tex-Mex", "group": "Other Dishes", "wine_style_hint": ["Off-dry white", "Rosé"], "examples": "tacos, enchiladas, fajitas" },
    { "id": "tapas_small_plates", "label": "Tapas & small plates", "group": "Other Dishes", "wine_style_hint": ["Sherry", "Rosé", "Sparkling"], "examples": "patatas bravas, jamón, croquetas" },
    { "id": "bbq_smoky_grills", "label": "BBQ & smoky grills", "group": "Other Dishes", "wine_style_hint": ["Full red", "Zinfandel"], "examples": "pulled pork, brisket, ribs" },
    { "id": "mediterranean_cuisine", "label": "Mediterranean cuisine", "group": "Other Dishes", "wine_style_hint": ["Medium red", "Rosé", "Light white"], "examples": "hummus, falafel, moussaka" },
    { "id": "dark_chocolate", "label": "Dark chocolate", "group": "Desserts", "wine_style_hint": ["Port", "Full red"], "examples": "dark chocolate, brownies, truffles" },
    { "id": "fruit_desserts", "label": "Fruit desserts", "group": "Desserts", "wine_style_hint": ["Sweet white", "Moscato"], "examples": "fruit tart, sorbet, crumble" },
    { "id": "creamy_desserts_pastries", "label": "Creamy desserts & pastries", "group": "Desserts", "wine_style_hint": ["Dessert wine", "Sweet sparkling"], "examples": "crème brûlée, tiramisu, éclairs" },
    { "id": "aperitif_hors_doeuvres", "label": "Apéritif & hors d'oeuvres", "group": "Casual", "wine_style_hint": ["Sparkling", "Light white"], "examples": "olives, nuts, canapés" },
    { "id": "cocktail_snacks", "label": "Cocktail snacks", "group": "Casual", "wine_style_hint": ["Sparkling", "Rosé"], "examples": "chips, crudités, dips" },
    { "id": "comfort_food", "label": "Comfort food (pasta bakes, casseroles, roasts)", "group": "Casual", "wine_style_hint": ["Medium red", "Full white"], "examples": "mac and cheese, shepherd's pie, pot roast" }
  ]
}
```

- [ ] **Step 2: Verify the JSON is valid + count is 43**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python3 -c "
import json
data = json.load(open('data/db/food-pairing-taxonomy.json'))
print(f'Version: {data[\"version\"]}')
print(f'Count: {len(data[\"categories\"])}')
from collections import Counter
groups = Counter(c['group'] for c in data['categories'])
for g, n in groups.most_common():
    print(f'  {g}: {n}')
"
```

Expected output:
```
Version: 1.0.0
Count: 43
  Asian: 8
  Red Meat: 6
  Seafood: 5
  Other Dishes: 5
  Cheese: 4
  Poultry & Pork: 3
  Pasta, Rice & Grains: 3
  Vegetables: 3
  Desserts: 3
  Casual: 3
```

- [ ] **Step 3: Commit**

```bash
git add data/db/food-pairing-taxonomy.json
git commit -m "data: add food-pairing-taxonomy.json (43 categories, 10 groups)"
```

---

## Task 4: Wine taxonomies module (enums + heuristics)

**Files:**
- Create: `data/lib/enrichment/wine/taxonomies.py`
- Create: `tests/test_wine_enrichment_taxonomies.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_taxonomies.py`

```python
"""Unit tests for data/lib/enrichment/wine/taxonomies.py."""
from __future__ import annotations

import pytest
from data.lib.enrichment.wine import taxonomies as tax


class TestEnums:
    def test_body_values(self):
        assert tax.BODY_VALUES == ("Light", "Medium", "Medium-Full", "Full")

    def test_acidity_values(self):
        assert tax.ACIDITY_VALUES == ("Low", "Medium", "Medium-High", "High")

    def test_tannin_values(self):
        assert tax.TANNIN_VALUES == ("Low", "Medium", "Medium-High", "High")

    def test_blend_types_count(self):
        assert len(tax.BLEND_TYPES) == 12
        assert "Single Varietal" in tax.BLEND_TYPES
        assert "Bordeaux Red Blend" in tax.BLEND_TYPES
        assert "Bordeaux White Blend" in tax.BLEND_TYPES
        assert "Rhône South Blend (GSM)" in tax.BLEND_TYPES
        assert "Super Tuscan" in tax.BLEND_TYPES
        assert "Unknown Blend" in tax.BLEND_TYPES

    def test_production_styles_count(self):
        assert len(tax.PRODUCTION_STYLES) == 7
        assert {"Conventional", "Natural", "Biodynamic", "Organic", "Orange", "Pet-Nat", "Vegan"} == set(tax.PRODUCTION_STYLES)


class TestHeuristics:
    def test_known_grape_region_combo(self):
        result = tax.heuristic_for("Shiraz", "Barossa Valley", "Red Wine")
        assert "Full body" in result or "full body" in result.lower()
        assert "tannin" in result.lower()

    def test_known_pinot_burgundy(self):
        result = tax.heuristic_for("Pinot Noir", "Burgundy", "Red Wine")
        assert "Pinot Noir" in result or "pinot" in result.lower()

    def test_unknown_grape_falls_back_to_classification(self):
        result = tax.heuristic_for("Obscure Grape", "Unknown Region", "Red Wine")
        # Should still return a non-empty generic Red Wine profile
        assert result
        assert "Red Wine" in result or "red wine" in result.lower() or "tannin" in result.lower()

    def test_blank_classification_returns_neutral(self):
        result = tax.heuristic_for("", "", "")
        assert isinstance(result, str)  # never None or crash


class TestFuzzyVocabRepair:
    def test_medium_heavy_repairs_to_medium_full(self):
        assert tax.repair_body("Medium-Heavy") == "Medium-Full"

    def test_light_medium_repairs_to_medium(self):
        assert tax.repair_body("Light-Medium") == "Medium"

    def test_known_value_passes_through(self):
        assert tax.repair_body("Full") == "Full"

    def test_unknown_returns_none(self):
        assert tax.repair_body("Sparkling") is None

    def test_blend_type_gsm_repairs(self):
        assert tax.repair_blend_type("GSM") == "Rhône South Blend (GSM)"
        assert tax.repair_blend_type("Rhone Blend") == "Rhône South Blend (GSM)"
```

- [ ] **Step 2: Run and confirm fail**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/pytest tests/test_wine_enrichment_taxonomies.py -v
```

Expected: collection error or ImportError because `taxonomies` module doesn't exist yet.

- [ ] **Step 3: Implement taxonomies.py**

File: `data/lib/enrichment/wine/taxonomies.py`

```python
"""Wine enrichment taxonomies — enums, heuristics, fuzzy-repair table.

Pure constants + pure functions. No I/O.
"""
from __future__ import annotations

BODY_VALUES: tuple[str, ...] = ("Light", "Medium", "Medium-Full", "Full")
ACIDITY_VALUES: tuple[str, ...] = ("Low", "Medium", "Medium-High", "High")
TANNIN_VALUES: tuple[str, ...] = ("Low", "Medium", "Medium-High", "High")

BLEND_TYPES: tuple[str, ...] = (
    "Single Varietal",
    "Bordeaux Red Blend",
    "Bordeaux White Blend",
    "Rhône North Blend",
    "Rhône South Blend (GSM)",
    "Champagne Blend",
    "Super Tuscan",
    "Port-Style Blend",
    "Sherry-Style Blend",
    "Field Blend",
    "Proprietary Blend",
    "Unknown Blend",
)

PRODUCTION_STYLES: tuple[str, ...] = (
    "Conventional", "Natural", "Biodynamic", "Organic", "Orange", "Pet-Nat", "Vegan",
)

# Fuzzy-repair table for common AI variants.
_BODY_REPAIR: dict[str, str] = {
    "Medium-Heavy": "Medium-Full",
    "Light-Medium": "Medium",
    "Heavy": "Full",
    "Light Body": "Light",
    "Medium Body": "Medium",
    "Full Body": "Full",
    "Full-Bodied": "Full",
    "Light-Bodied": "Light",
}

_BLEND_REPAIR: dict[str, str] = {
    "GSM": "Rhône South Blend (GSM)",
    "Rhone Blend": "Rhône South Blend (GSM)",
    "Rhône Blend": "Rhône South Blend (GSM)",
    "Bordeaux Blend": "Bordeaux Red Blend",
    "Bordeaux-Style Blend": "Bordeaux Red Blend",
}


def repair_body(value: str) -> str | None:
    """Return canonical body value, or None if not recoverable."""
    if value in BODY_VALUES:
        return value
    return _BODY_REPAIR.get(value)


def repair_acidity(value: str) -> str | None:
    if value in ACIDITY_VALUES:
        return value
    # Common variants
    mapping = {"Medium-Heavy": "Medium-High", "Crisp": "High", "Soft": "Low"}
    return mapping.get(value)


def repair_tannin(value: str) -> str | None:
    if value in TANNIN_VALUES:
        return value
    mapping = {"Soft": "Low", "Firm": "Medium-High", "Grippy": "High"}
    return mapping.get(value)


def repair_blend_type(value: str) -> str | None:
    if value in BLEND_TYPES:
        return value
    return _BLEND_REPAIR.get(value)


# Grape+region heuristic profiles. Used when Winesensed + brand library both miss.
# Strings are written so they read naturally inside a prompt evidence block.
_HEURISTICS: dict[tuple[str, str], str] = {
    # Australia
    ("Shiraz", "Barossa Valley"): "Full body, high tannin, dark fruit (blackberry, blueberry), spice (clove, pepper), chocolate notes, oak-driven.",
    ("Shiraz", "McLaren Vale"): "Full body, ripe blackberry, plum, mocha, soft tannin.",
    ("Cabernet Sauvignon", "Coonawarra"): "Full body, high tannin, blackcurrant, mint, eucalyptus, structured.",
    ("Pinot Noir", "Yarra Valley"): "Light-medium body, medium tannin, red cherry, raspberry, earthy.",
    # France
    ("Pinot Noir", "Burgundy"): "Medium body, high acidity, medium tannin, red fruit (cherry, raspberry), earth, mushroom, silky texture.",
    ("Cabernet Sauvignon", "Bordeaux"): "Full body, high tannin, blackcurrant, cedar, tobacco, age-worthy.",
    ("Merlot", "Bordeaux"): "Medium-Full body, medium tannin, plum, chocolate, soft texture.",
    ("Syrah", "Northern Rhône"): "Full body, high tannin, blackberry, smoked meat, white pepper, olive.",
    ("Grenache", "Châteauneuf-du-Pape"): "Full body, medium tannin, raspberry, herbs (garrigue), warm spice.",
    ("Sauvignon Blanc", "Sancerre"): "Light-medium body, high acidity, citrus, gooseberry, flinty mineral.",
    ("Chardonnay", "Chablis"): "Medium body, high acidity, citrus, green apple, oyster-shell mineral.",
    ("Chardonnay", "Burgundy"): "Medium-Full body, medium-high acidity, lemon, apple, hazelnut, subtle oak.",
    # Italy
    ("Sangiovese", "Tuscany"): "Medium-Full body, high acidity, medium-high tannin, sour cherry, dried herbs, leather.",
    ("Nebbiolo", "Piedmont"): "Full body, high tannin, high acidity, rose, tar, dried cherry, age-worthy.",
    ("Corvina", "Veneto"): "Medium body, medium tannin, sour cherry, almond, herbal (Valpolicella style).",
    # Spain
    ("Tempranillo", "Rioja"): "Medium-Full body, medium tannin, red cherry, leather, vanilla oak, dried herbs.",
    ("Garnacha", "Priorat"): "Full body, high tannin, blackberry, licorice, slate mineral, concentrated.",
    ("Albariño", "Rías Baixas"): "Light body, high acidity, citrus, white peach, sea salt, mineral.",
    # USA
    ("Cabernet Sauvignon", "Napa Valley"): "Full body, high tannin, ripe blackcurrant, vanilla oak, cedar, tobacco, age-worthy.",
    ("Pinot Noir", "Sonoma County"): "Medium body, medium-high acidity, red cherry, raspberry, baking spice.",
    ("Chardonnay", "Napa Valley"): "Full body, medium acidity, ripe apple, vanilla oak, butter, tropical fruit.",
    ("Zinfandel", "Lodi"): "Full body, medium-high tannin, jammy blackberry, brambly, peppery.",
    # NZ
    ("Sauvignon Blanc", "Marlborough"): "Light body, high acidity, grapefruit, gooseberry, passionfruit, herbaceous.",
    ("Pinot Noir", "Central Otago"): "Medium body, medium tannin, dark cherry, spice, savoury herbs.",
    # Chile
    ("Carmenère", "Colchagua Valley"): "Full body, medium tannin, dark plum, green pepper, mocha.",
    # Germany
    ("Riesling", "Mosel"): "Light body, very high acidity, peach, apricot, lime, slate mineral, often off-dry.",
    # Argentina
    ("Malbec", "Mendoza"): "Full body, medium-high tannin, blackberry, plum, violet, cocoa, smooth.",
    # Champagne
    ("Pinot Noir", "Champagne"): "Sparkling — high acidity, red apple, brioche, citrus, fine mousse.",
    ("Chardonnay", "Champagne"): "Sparkling — high acidity, lemon, almond, brioche, chalky mineral.",
    # Generic fallback profiles by classification
}

_GRAPE_FALLBACKS: dict[str, str] = {
    "Pinot Noir": "Light-Medium body, high acidity, medium tannin, red fruit, earthy, silky.",
    "Cabernet Sauvignon": "Full body, high tannin, blackcurrant, cedar, oak.",
    "Merlot": "Medium-Full body, medium tannin, plum, soft texture.",
    "Shiraz": "Full body, medium-high tannin, dark fruit, spice.",
    "Syrah": "Full body, medium-high tannin, blackberry, pepper.",
    "Chardonnay": "Medium-Full body, medium acidity, apple, citrus, oak-influenced.",
    "Sauvignon Blanc": "Light body, high acidity, citrus, herbaceous.",
    "Riesling": "Light-Medium body, high acidity, stone fruit, mineral.",
    "Sangiovese": "Medium-Full body, high acidity, sour cherry, savoury.",
    "Tempranillo": "Medium-Full body, medium tannin, red cherry, leather, oak.",
    "Malbec": "Full body, medium-high tannin, plum, violet.",
    "Nebbiolo": "Full body, high tannin, high acidity, rose, tar.",
}

_CLASSIFICATION_FALLBACK: dict[str, str] = {
    "Red Wine": "Red Wine: medium-full body, medium tannin, red-to-dark fruit, food-friendly.",
    "White Wine": "White Wine: medium body, medium-high acidity, citrus-to-stone fruit, refreshing.",
    "Sparkling Wine": "Sparkling Wine: high acidity, fine bubbles, apple/citrus, brioche or fruity.",
    "Rose Wine": "Rosé: light-medium body, medium acidity, red berry, fresh.",
    "Dessert Wine": "Dessert Wine: sweet, often high acidity, honeyed or tropical, rich texture.",
}


def heuristic_for(grape: str, region: str, classification: str = "") -> str:
    """Return a typical profile string for the given combo. Always returns a non-empty string."""
    grape_clean = (grape or "").strip()
    region_clean = (region or "").strip()
    cls_clean = (classification or "").strip()

    if grape_clean and region_clean:
        key = (grape_clean, region_clean)
        if key in _HEURISTICS:
            return _HEURISTICS[key]

    if grape_clean in _GRAPE_FALLBACKS:
        return _GRAPE_FALLBACKS[grape_clean]

    if cls_clean in _CLASSIFICATION_FALLBACK:
        return _CLASSIFICATION_FALLBACK[cls_clean]

    return "Wine: typical structure for category; no specific grape/region profile available."
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_taxonomies.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/wine/taxonomies.py tests/test_wine_enrichment_taxonomies.py
git commit -m "feat(wine_enrichment): taxonomies (enums + heuristics + fuzzy-repair)"
```

---

## Task 5: Test fixtures

**Files:**
- Create: `tests/fixtures/wine_pilot_skus.json`
- Create: `tests/fixtures/winesensed_sample.json`
- Create: `tests/fixtures/brand_library_sample.csv`

- [ ] **Step 1: Create `wine_pilot_skus.json` (5 SKUs covering different evidence tiers)**

File: `tests/fixtures/wine_pilot_skus.json`

```json
[
  {
    "id": "fixture-wine-1",
    "sku": "FX-BORDEAUX-001",
    "name": "Château Test Premier Cru",
    "brand": "Château Test",
    "vintage": "2015",
    "bottle_size": "750ml",
    "classification": "Red Wine",
    "country": "France",
    "region": "Bordeaux",
    "subregion": "Pauillac",
    "grape_variety": "Cabernet Sauvignon, Merlot, Petit Verdot",
    "price": 8500,
    "alcohol": "13.5%"
  },
  {
    "id": "fixture-wine-2",
    "sku": "FX-NAPACAB-001",
    "name": "Test Napa Estate Cabernet",
    "brand": "Test Napa Estate",
    "vintage": "2020",
    "bottle_size": "750ml",
    "classification": "Red Wine",
    "country": "USA",
    "region": "Napa Valley",
    "grape_variety": "Cabernet Sauvignon",
    "price": 4500,
    "alcohol": "14.5%"
  },
  {
    "id": "fixture-wine-3",
    "sku": "FX-AUSSHIRAZ-001",
    "name": "Test Shiraz",
    "brand": "Test Australian Winery",
    "vintage": "2021",
    "bottle_size": "750ml",
    "classification": "Red Wine",
    "country": "Australia",
    "region": "Barossa Valley",
    "grape_variety": "Shiraz",
    "price": 1200,
    "alcohol": "14%"
  },
  {
    "id": "fixture-wine-4",
    "sku": "FX-NZSAUV-001",
    "name": "Test Marlborough Sauvignon",
    "brand": "Test NZ Winery",
    "vintage": "2023",
    "bottle_size": "750ml",
    "classification": "White Wine",
    "country": "New Zealand",
    "region": "Marlborough",
    "grape_variety": "Sauvignon Blanc",
    "price": 900,
    "alcohol": "12.5%"
  },
  {
    "id": "fixture-wine-5",
    "sku": "FX-SICILIAN-001",
    "name": "Test Sicilian Red",
    "brand": "Obscure Sicilian Cantina",
    "vintage": "2020",
    "bottle_size": "750ml",
    "classification": "Red Wine",
    "country": "Italy",
    "region": "Sicily",
    "grape_variety": "Nero d'Avola",
    "price": 750,
    "alcohol": "13%"
  }
]
```

- [ ] **Step 2: Create `winesensed_sample.json` (10 records for matching tests)**

File: `tests/fixtures/winesensed_sample.json`

```json
[
  {"id": "ws-1", "source": "winesensed", "normalized_grape": "cabernet sauvignon", "normalized_region": "bordeaux", "normalized_country": "france", "grape": "Cabernet Sauvignon", "region": "Bordeaux", "country": "France", "year": 2015, "rating": 4.5, "review": "Sample Bordeaux note", "review_language_hint": "english"},
  {"id": "ws-2", "source": "winesensed", "normalized_grape": "cabernet sauvignon", "normalized_region": "bordeaux", "normalized_country": "france", "grape": "Cabernet Sauvignon", "region": "Bordeaux", "country": "France", "year": 2016, "rating": 4.3, "review": "Sample 2", "review_language_hint": "english"},
  {"id": "ws-3", "source": "winesensed", "normalized_grape": "cabernet sauvignon", "normalized_region": "napa valley", "normalized_country": "usa", "grape": "Cabernet Sauvignon", "region": "Napa Valley", "country": "USA", "year": 2018, "rating": 4.4, "review": "Sample Napa", "review_language_hint": "english"},
  {"id": "ws-4", "source": "winesensed", "normalized_grape": "shiraz", "normalized_region": "barossa valley", "normalized_country": "australia", "grape": "Shiraz", "region": "Barossa Valley", "country": "Australia", "year": 2018, "rating": 4.2, "review": "Sample Barossa", "review_language_hint": "english"},
  {"id": "ws-5", "source": "winesensed", "normalized_grape": "sauvignon blanc", "normalized_region": "marlborough", "normalized_country": "new zealand", "grape": "Sauvignon Blanc", "region": "Marlborough", "country": "New Zealand", "year": 2022, "rating": 4.1, "review": "Sample SB", "review_language_hint": "english"},
  {"id": "ws-6", "source": "winesensed", "normalized_grape": "sangiovese", "normalized_region": "tuscany", "normalized_country": "italy", "grape": "Sangiovese", "region": "Tuscany", "country": "Italy", "year": 2019, "rating": 4.0, "review": "Sample Tuscany", "review_language_hint": "italian"},
  {"id": "ws-7", "source": "winesensed", "normalized_grape": "nero d'avola", "normalized_region": "sicily", "normalized_country": "italy", "grape": "Nero d'Avola", "region": "Sicily", "country": "Italy", "year": 2020, "rating": 3.9, "review": "Sample Sicily", "review_language_hint": "italian"},
  {"id": "ws-8", "source": "winesensed", "normalized_grape": "pinot noir", "normalized_region": "burgundy", "normalized_country": "france", "grape": "Pinot Noir", "region": "Burgundy", "country": "France", "year": 2019, "rating": 4.6, "review": "Sample Burgundy", "review_language_hint": "english"},
  {"id": "ws-9", "source": "winesensed", "normalized_grape": "merlot", "normalized_region": "bordeaux", "normalized_country": "france", "grape": "Merlot", "region": "Bordeaux", "country": "France", "year": 2017, "rating": 4.2, "review": "Sample Merlot", "review_language_hint": "english"},
  {"id": "ws-10", "source": "winesensed", "normalized_grape": "shiraz", "normalized_region": "barossa valley", "normalized_country": "australia", "grape": "Shiraz", "region": "Barossa Valley", "country": "Australia", "year": 2019, "rating": 4.5, "review": "Sample Barossa 2", "review_language_hint": "english"}
]
```

- [ ] **Step 3: Create `brand_library_sample.csv` (5 brands)**

File: `tests/fixtures/brand_library_sample.csv`

```csv
entity_type,entity_name,parent_country,parent_region,product_count,description_short_en,description_full_en
brand,Château Test,France,Bordeaux,15,Premium Bordeaux estate.,Château Test is a historic Pauillac estate producing classified-growth Cabernet-dominant blends with high oak influence and decades of cellaring potential.
brand,Test Napa Estate,USA,Napa Valley,12,Iconic Napa Valley producer.,Test Napa Estate has been producing Cabernet Sauvignon from the heart of Napa since 1970; the style is ripe, oak-driven, and built for aging.
brand,Test Australian Winery,Australia,Barossa Valley,18,Barossa Shiraz specialist.,A multi-generation Barossa Valley family producer known for old-vine Shiraz showing dark fruit, pepper, and chocolate.
brand,Test NZ Winery,New Zealand,Marlborough,8,Marlborough Sauvignon expert.,A boutique Marlborough producer focused on crisp, citrus-driven Sauvignon Blanc with herbaceous backbone.
brand,Obscure Sicilian Cantina,Italy,Sicily,2,,
```

- [ ] **Step 4: Verify all fixtures load**

```bash
.venv/bin/python3 -c "
import json, csv
print('SKUs:', len(json.load(open('tests/fixtures/wine_pilot_skus.json'))))
print('Winesensed:', len(json.load(open('tests/fixtures/winesensed_sample.json'))))
print('Brands:', sum(1 for _ in csv.DictReader(open('tests/fixtures/brand_library_sample.csv'))))
"
```

Expected output:
```
SKUs: 5
Winesensed: 10
Brands: 5
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/wine_pilot_skus.json tests/fixtures/winesensed_sample.json tests/fixtures/brand_library_sample.csv
git commit -m "test: fixtures for wine enrichment (5 SKUs, 10 winesensed, 5 brands)"
```

---

## Task 6: Evidence collector

**Files:**
- Create: `data/lib/enrichment/wine/evidence.py`
- Create: `tests/test_wine_enrichment_evidence.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_evidence.py`

```python
"""Unit tests for data/lib/enrichment/wine/evidence.py."""
from __future__ import annotations

import json
from pathlib import Path
import pytest

from data.lib.enrichment.wine import evidence as ev

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SKUS = json.load(open(FIXTURE_DIR / "wine_pilot_skus.json"))
WINESENSED = json.load(open(FIXTURE_DIR / "winesensed_sample.json"))
import csv
BRAND_LIB = list(csv.DictReader(open(FIXTURE_DIR / "brand_library_sample.csv")))


def make_collector():
    """Build an EvidenceCollector seeded with fixture data + empty critic_scores."""
    return ev.EvidenceCollector(
        winesensed_records=WINESENSED,
        brand_library=BRAND_LIB,
        critic_scores_by_sku={},  # empty for these tests
    )


class TestWinesensedMatching:
    def test_tight_match_grape_and_region(self):
        c = make_collector()
        matches = c._find_winesensed_matches(grape="Cabernet Sauvignon", region="Bordeaux", country="France", limit=5)
        assert len(matches) == 2  # ws-1 and ws-2
        assert all(m.match_type == "tight" for m in matches)

    def test_loose_match_grape_only(self):
        c = make_collector()
        # Cab Sauv grape; obscure region not in fixtures
        matches = c._find_winesensed_matches(grape="Cabernet Sauvignon", region="Some Other Region", country="USA", limit=5)
        # Should match ws-3 (Napa Cab Sauv) via loose grape-only
        assert any(m.record_id == "ws-3" for m in matches)
        assert any(m.match_type == "loose" for m in matches)

    def test_country_fallback(self):
        c = make_collector()
        # Unknown grape, but region+country match Italy/Sicily
        matches = c._find_winesensed_matches(grape="ObscureGrape", region="Sicily", country="Italy", limit=5)
        # ws-7 matches by region+country
        assert any(m.record_id == "ws-7" for m in matches)


class TestQualityTier:
    def test_tier_a_two_tight_matches(self):
        c = make_collector()
        bordeaux_sku = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        assert evidence.quality_tier == "A"  # 2 tight Winesensed + Tier-1-equivalent brand library

    def test_tier_c_no_winesensed_no_brand(self):
        c = make_collector()
        # Brand library has Sicily entry but with empty description fields (Tier-3-equivalent)
        sicily_sku = next(s for s in SKUS if s["sku"] == "FX-SICILIAN-001")
        evidence = c.collect_evidence(sicily_sku["sku"], sicily_sku)
        # Sicily has 1 Winesensed match (loose by country) — tier B
        assert evidence.quality_tier in ("B", "C")


class TestEvidenceHash:
    def test_hash_is_stable(self):
        c = make_collector()
        bordeaux_sku = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        e1 = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        e2 = c.collect_evidence(bordeaux_sku["sku"], bordeaux_sku)
        assert e1.evidence_hash == e2.evidence_hash

    def test_hash_changes_with_critic_scores(self):
        sku_data = {"sku": "TEST-1", "name": "Test", "brand": "Test", "grape_variety": "Cabernet Sauvignon", "region": "Bordeaux", "country": "France", "classification": "Red Wine", "vintage": "2020", "price": 1000, "bottle_size": "750ml", "alcohol": "13%", "subregion": ""}
        c1 = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={})
        c2 = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={
            "TEST-1": [{"critic": "James Suckling", "score": 95.0, "score_max": 100, "vintage": "2020"}]
        })
        e1 = c1.collect_evidence("TEST-1", sku_data)
        e2 = c2.collect_evidence("TEST-1", sku_data)
        assert e1.evidence_hash != e2.evidence_hash  # adding a critic score changes the hash


class TestCriticScoresTierBoost:
    def test_two_critic_scores_yields_tier_a(self):
        sku_data = {"sku": "TEST-1", "name": "Test", "brand": "Unknown", "grape_variety": "Unknown", "region": "Unknown", "country": "Unknown", "classification": "Red Wine", "vintage": "2020", "price": 1000, "bottle_size": "750ml", "alcohol": "", "subregion": ""}
        c = ev.EvidenceCollector(winesensed_records=[], brand_library=[], critic_scores_by_sku={
            "TEST-1": [
                {"critic": "James Suckling", "score": 95.0, "score_max": 100, "vintage": "2020"},
                {"critic": "Wine Advocate", "score": 92.0, "score_max": 100, "vintage": "2020"},
            ]
        })
        e = c.collect_evidence("TEST-1", sku_data)
        assert e.quality_tier == "A"  # ≥2 critic scores → Tier A
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_evidence.py -v
```

Expected: ImportError (module missing).

- [ ] **Step 3: Implement evidence.py**

File: `data/lib/enrichment/wine/evidence.py`

```python
"""Per-SKU evidence collection for wine enrichment.

Pure functions. Collector reads pre-loaded data structures (no I/O at call time);
driver loads the inputs once and constructs the collector.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from typing import Literal

from data.lib.enrichment.wine import taxonomies


@dataclass(frozen=True)
class WinesensedMatch:
    record_id: str
    year: int | None
    region: str
    grape: str
    rating: float
    review_text: str
    match_type: Literal["tight", "loose", "country"]


@dataclass(frozen=True)
class BrandDescription:
    name: str
    tier: str
    desc_short: str
    desc_full: str


@dataclass(frozen=True)
class CriticScore:
    critic: str
    score: float
    score_max: float
    vintage: str | None
    tasting_year: int | None


@dataclass(frozen=True)
class Evidence:
    sku: str
    facts: dict
    winesensed_matches: tuple[WinesensedMatch, ...]
    brand_description: BrandDescription | None
    heuristic_profile: str
    critic_scores: tuple[CriticScore, ...]
    quality_tier: Literal["A", "B", "C"]
    evidence_hash: str


def _normalize(value: str | None) -> str:
    return (value or "").strip().lower()


def _brand_tier_from_count(product_count: int | str) -> str:
    """Match enrich_s1/s2/s3 conventions: S1 = ≥10, S2 = 3-9, S3 = ≤2."""
    try:
        n = int(product_count)
    except (ValueError, TypeError):
        return "S3"
    if n >= 10:
        return "S1"
    if n >= 3:
        return "S2"
    return "S3"


class EvidenceCollector:
    """Builds an Evidence object per SKU from pre-loaded source data.

    Construct once at driver start (loading Winesensed records, brand library,
    and critic_scores). Then call collect_evidence(sku, row) per SKU.
    """

    def __init__(
        self,
        winesensed_records: list[dict],
        brand_library: list[dict],
        critic_scores_by_sku: dict[str, list[dict]],
    ):
        self.winesensed = winesensed_records
        self.brand_lib_by_name = {
            (r.get("entity_name") or "").strip().lower(): r
            for r in brand_library
            if (r.get("entity_type") or "") == "brand"
        }
        self.critic_scores_by_sku = critic_scores_by_sku

    def _find_winesensed_matches(
        self, grape: str, region: str, country: str, limit: int = 5
    ) -> list[WinesensedMatch]:
        g, r, c = _normalize(grape), _normalize(region), _normalize(country)
        if not g and not r and not c:
            return []

        tight, loose, country_only = [], [], []
        for rec in self.winesensed:
            ng = (rec.get("normalized_grape") or "").lower()
            nr = (rec.get("normalized_region") or "").lower()
            nc = (rec.get("normalized_country") or "").lower()
            if g and ng == g and r and nr == r:
                tight.append(rec)
            elif g and ng == g:
                loose.append(rec)
            elif c and nc == c and r and nr == r:
                country_only.append(rec)

        tight.sort(key=lambda x: -float(x.get("rating") or 0))
        loose.sort(key=lambda x: -float(x.get("rating") or 0))
        country_only.sort(key=lambda x: -float(x.get("rating") or 0))

        out: list[WinesensedMatch] = []
        for rec in tight:
            out.append(self._build_match(rec, "tight"))
            if len(out) >= limit:
                return out
        # Only add loose if we have <2 tight matches
        if len([m for m in out if m.match_type == "tight"]) < 2:
            for rec in loose:
                if rec.get("id") in {m.record_id for m in out}:
                    continue
                out.append(self._build_match(rec, "loose"))
                if len(out) >= limit:
                    return out
        # Only add country-only if we still have no grape matches
        if not any(m.match_type in ("tight", "loose") for m in out):
            for rec in country_only:
                out.append(self._build_match(rec, "country"))
                if len(out) >= limit:
                    return out

        return out

    def _build_match(self, rec: dict, match_type: str) -> WinesensedMatch:
        return WinesensedMatch(
            record_id=rec.get("id", ""),
            year=rec.get("year"),
            region=rec.get("region", ""),
            grape=rec.get("grape", ""),
            rating=float(rec.get("rating") or 0),
            review_text=(rec.get("review") or "")[:300],
            match_type=match_type,  # type: ignore[arg-type]
        )

    def _find_brand_description(self, brand: str) -> BrandDescription | None:
        if not brand:
            return None
        rec = self.brand_lib_by_name.get(brand.strip().lower())
        if not rec:
            return None
        tier = _brand_tier_from_count(rec.get("product_count", "0"))
        return BrandDescription(
            name=rec.get("entity_name", ""),
            tier=tier,
            desc_short=rec.get("description_short_en", "") or "",
            desc_full=rec.get("description_full_en", "") or "",
        )

    def _critic_scores_for(self, sku: str) -> list[CriticScore]:
        rows = self.critic_scores_by_sku.get(sku, [])
        # Sort by tasting_year DESC nulls last, then score DESC
        sorted_rows = sorted(
            rows,
            key=lambda r: (-(r.get("tasting_year") or 0), -float(r.get("score") or 0)),
        )
        return [
            CriticScore(
                critic=str(r.get("critic", "")),
                score=float(r.get("score") or 0),
                score_max=float(r.get("score_max") or 100),
                vintage=r.get("vintage"),
                tasting_year=r.get("tasting_year"),
            )
            for r in sorted_rows[:6]
        ]

    def _quality_tier(
        self,
        winesensed_matches: list[WinesensedMatch],
        brand_desc: BrandDescription | None,
        critic_scores: list[CriticScore],
    ) -> Literal["A", "B", "C"]:
        tight = sum(1 for m in winesensed_matches if m.match_type == "tight")
        any_winesensed = len(winesensed_matches) > 0
        has_brand = brand_desc is not None and (brand_desc.desc_short or brand_desc.desc_full)
        is_tier1 = brand_desc is not None and brand_desc.tier == "S1"

        # Tier A
        if tight >= 2:
            return "A"
        if tight >= 1 and is_tier1:
            return "A"
        if len(critic_scores) >= 2:
            return "A"
        # Tier B
        if any_winesensed:
            return "B"
        if has_brand:
            return "B"
        if len(critic_scores) >= 1:
            return "B"
        # Tier C
        return "C"

    def collect_evidence(self, sku: str, products_row: dict) -> Evidence:
        grape = products_row.get("grape_variety", "") or ""
        # Take only the first grape if comma-separated
        primary_grape = grape.split(",")[0].strip() if grape else ""
        region = products_row.get("region", "") or ""
        country = products_row.get("country", "") or ""

        ws_matches = self._find_winesensed_matches(primary_grape, region, country)
        brand_desc = self._find_brand_description(products_row.get("brand", "") or "")
        heuristic = taxonomies.heuristic_for(
            primary_grape, region, products_row.get("classification", "") or ""
        )
        scores = self._critic_scores_for(sku)
        tier = self._quality_tier(ws_matches, brand_desc, scores)

        facts = {
            "name": products_row.get("name", "") or "",
            "brand": products_row.get("brand", "") or "",
            "vintage": products_row.get("vintage", "") or "",
            "bottle_size": products_row.get("bottle_size", "") or "",
            "country": country,
            "region": region,
            "subregion": products_row.get("subregion", "") or "",
            "classification": products_row.get("classification", "") or "",
            "grape_variety_raw": grape,
            "price": products_row.get("price", 0),
            "alcohol": products_row.get("alcohol", "") or "",
        }

        # Evidence hash — stable across runs given same inputs
        hash_input = json.dumps({
            "facts": facts,
            "winesensed_ids": [m.record_id for m in ws_matches],
            "brand_match": brand_desc.name if brand_desc else None,
            "brand_desc_short": brand_desc.desc_short if brand_desc else None,
            "heuristic": heuristic,
            "critic_scores": [(s.critic, s.score, s.score_max, s.vintage) for s in scores],
        }, sort_keys=True)
        evidence_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

        return Evidence(
            sku=sku,
            facts=facts,
            winesensed_matches=tuple(ws_matches),
            brand_description=brand_desc,
            heuristic_profile=heuristic,
            critic_scores=tuple(scores),
            quality_tier=tier,
            evidence_hash=evidence_hash,
        )
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_evidence.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/wine/evidence.py tests/test_wine_enrichment_evidence.py
git commit -m "feat(wine_enrichment): evidence collector (5 grounding sources + tier classification)"
```

---

## Task 7: Prompt builder

**Files:**
- Create: `data/lib/enrichment/wine/prompt.py`
- Create: `tests/test_wine_enrichment_prompt.py`
- Create: `data/lib/enrichment/shared/taxonomies/food_pairing.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_prompt.py`

```python
"""Unit tests for data/lib/enrichment/wine/prompt.py."""
from __future__ import annotations

import json
from pathlib import Path

from data.lib.enrichment.wine import evidence as ev
from data.lib.enrichment.wine import prompt as pr
from data.lib.enrichment.shared.taxonomies import food_pairing


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
SKUS = json.load(open(FIXTURE_DIR / "wine_pilot_skus.json"))
WINESENSED = json.load(open(FIXTURE_DIR / "winesensed_sample.json"))
import csv
BRAND_LIB = list(csv.DictReader(open(FIXTURE_DIR / "brand_library_sample.csv")))


def _make_evidence(sku_obj):
    fp_taxonomy = food_pairing.load_default()
    collector = ev.EvidenceCollector(
        winesensed_records=WINESENSED,
        brand_library=BRAND_LIB,
        critic_scores_by_sku={},
    )
    return collector.collect_evidence(sku_obj["sku"], sku_obj)


class TestPromptInjection:
    def test_system_includes_controlled_vocab(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "wine_body" in system
        assert "Light" in system and "Full" in system
        assert "grape_blend_type" in system
        assert "Bordeaux Red Blend" in system
        assert "Conventional" in system  # production styles
        assert "Grilled red meat" in system  # food taxonomy

    def test_user_message_includes_product_facts(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "FX-BORDEAUX-001" in user
        assert "Bordeaux" in user
        assert "Cabernet Sauvignon" in user

    def test_user_message_includes_winesensed_when_present(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "Winesensed" in user or "winesensed" in user
        assert "ws-1" in user or "ws-2" in user  # cited record IDs

    def test_user_message_includes_brand_library_when_present(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        evidence = _make_evidence(bordeaux)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        assert "Brand library" in user or "brand library" in user
        assert "Pauillac" in user or "Château Test" in user

    def test_critic_scores_section_when_empty(self):
        sicily = next(s for s in SKUS if s["sku"] == "FX-SICILIAN-001")
        evidence = _make_evidence(sicily)
        system, user, prompt_hash = pr.build_prompt(evidence, food_pairing.load_default())
        # Empty critic_scores → section should be either absent or note empty
        assert "critic scores" in user.lower() or "Expert critic" in user
        # Should NOT contain hallucinated score text
        assert "James Suckling: 95" not in user


class TestPromptHash:
    def test_hash_is_stable_for_same_evidence(self):
        bordeaux = next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001")
        e = _make_evidence(bordeaux)
        _, _, h1 = pr.build_prompt(e, food_pairing.load_default())
        _, _, h2 = pr.build_prompt(e, food_pairing.load_default())
        assert h1 == h2

    def test_hash_only_depends_on_template_not_evidence(self):
        """Two different SKUs build different prompts (different user msgs)
        but prompt_hash is the TEMPLATE+TAXONOMY hash, not the per-SKU content."""
        bordeaux = _make_evidence(next(s for s in SKUS if s["sku"] == "FX-BORDEAUX-001"))
        napa = _make_evidence(next(s for s in SKUS if s["sku"] == "FX-NAPACAB-001"))
        _, _, h1 = pr.build_prompt(bordeaux, food_pairing.load_default())
        _, _, h2 = pr.build_prompt(napa, food_pairing.load_default())
        assert h1 == h2  # same prompt template + same taxonomy → same hash
```

- [ ] **Step 2: Write shared/taxonomies/food_pairing.py first (prompt depends on it)**

File: `data/lib/enrichment/shared/taxonomies/food_pairing.py`

```python
"""Loader for food-pairing-taxonomy.json."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FoodCategory:
    id: str
    label: str
    group: str
    wine_style_hint: tuple[str, ...]
    examples: str


@dataclass(frozen=True)
class FoodTaxonomy:
    version: str
    categories: tuple[FoodCategory, ...]

    @property
    def labels(self) -> set[str]:
        return {c.label for c in self.categories}

    def prompt_block(self) -> str:
        """Render the taxonomy as a string for inclusion in the system prompt."""
        lines = []
        current_group: str | None = None
        for c in self.categories:
            if c.group != current_group:
                lines.append(f"\n{c.group}:")
                current_group = c.group
            hint = " / ".join(c.wine_style_hint)
            lines.append(f"  - {c.label} (e.g. {c.examples}; pairs with {hint})")
        return "\n".join(lines)


DEFAULT_PATH = Path(__file__).resolve().parents[4] / "db" / "food-pairing-taxonomy.json"


def load(path: Path | None = None) -> FoodTaxonomy:
    p = path or DEFAULT_PATH
    raw = json.loads(p.read_text())
    cats = tuple(
        FoodCategory(
            id=c["id"],
            label=c["label"],
            group=c["group"],
            wine_style_hint=tuple(c.get("wine_style_hint", [])),
            examples=c.get("examples", ""),
        )
        for c in raw["categories"]
    )
    return FoodTaxonomy(version=raw["version"], categories=cats)


# Cache for module-level reuse
_DEFAULT: FoodTaxonomy | None = None


def load_default() -> FoodTaxonomy:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = load()
    return _DEFAULT
```

- [ ] **Step 3: Implement prompt.py**

File: `data/lib/enrichment/wine/prompt.py`

```python
"""Prompt builder + hashing for wine enrichment.

Pure functions. Builds (system, user, prompt_hash). prompt_hash is the
sha256 of (PROMPT_TEMPLATE_VERSION + system_text); it does NOT include
the per-SKU user_text — that goes into evidence_hash separately. Together
they form the cache key (sku, prompt_hash, evidence_hash).
"""
from __future__ import annotations

import hashlib

from data.lib.enrichment.wine import taxonomies
from data.lib.enrichment.wine.evidence import Evidence
from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy

PROMPT_TEMPLATE_VERSION = "1.0.0"


def _system_prompt(food_tax: FoodTaxonomy) -> str:
    body_enum = " | ".join(taxonomies.BODY_VALUES)
    acid_enum = " | ".join(taxonomies.ACIDITY_VALUES)
    tannin_enum = " | ".join(taxonomies.TANNIN_VALUES)
    blend_enum = " | ".join(taxonomies.BLEND_TYPES)
    prod_enum = " | ".join(taxonomies.PRODUCTION_STYLES)

    return f"""You are an expert sommelier writing structured taxonomy data for a premium Thai online retailer (Wine-Now). Write in third-party expert voice — NEVER use "we" or "our". Output ONLY valid JSON matching the schema below; no preamble.

CONTROLLED VOCABULARY (use ONLY these exact values):
- wine_body: {body_enum}
- wine_acidity: {acid_enum}
- wine_tannin: {tannin_enum}
- grape_blend_type: {blend_enum}
- wine_production_style (multiselect): {prod_enum}
- food_matching: pick 3-6 EXACT labels from FOOD PAIRING TAXONOMY below

OUTPUT JSON SCHEMA:
{{
  "wine_body": "...",
  "wine_acidity": "...",
  "wine_tannin": "...",
  "grape_variety": ["..."],
  "grape_blend_type": "...",
  "wine_production_style": ["..."],
  "flavor_tags": ["5 to 10 short tasting notes"],
  "food_matching": ["3 to 6 labels from taxonomy"],
  "desc_en_short": "<=160 char hook",
  "full_description": "<p>200-1200 char HTML (only p/br/strong/em/ul/li)</p>",
  "confidence": 0.0-1.0,
  "confidence_notes": "...",
  "citations": {{
    "winesensed_record_ids": ["..."],
    "brand_library_match": "...",
    "grape_source": "products.grape_variety",
    "critic_scores": ["James Suckling: 95", "..."]
  }}
}}

WINESENSED LICENSE RULE (critical):
- Winesensed records (when shown below) are STRUCTURAL grounding ONLY.
- Cite IDs in citations.winesensed_record_ids when they anchored a choice.
- DO NOT quote, paraphrase, or restate Winesensed review text in flavor_tags,
  desc_en_short, or full_description.
- DO NOT attribute opinions to specific Winesensed reviewers.
- All customer-facing prose must be wholly original, from your own wine knowledge.

CRITIC SCORES RULE:
- Use scores (when shown) as calibration anchors — higher scores → more premium language.
- DO NOT invent scores. DO NOT reproduce any critic's tasting-note prose.
- Cite which scores anchored your judgement in citations.critic_scores.

FOOD PAIRING TAXONOMY:
{food_tax.prompt_block()}

Honesty: if evidence is thin, lower confidence (<0.7) and say so in confidence_notes."""


def _user_message(evidence: Evidence) -> str:
    facts = evidence.facts
    lines = [
        "# Product facts",
        f"SKU: {evidence.sku}",
        f"Name: {facts['name']}",
        f"Brand: {facts['brand']}",
        f"Country: {facts['country']}  •  Region: {facts['region']}",
    ]
    if facts.get("subregion"):
        lines.append(f"Subregion: {facts['subregion']}")
    lines.append(f"Classification: {facts['classification']}")
    lines.append(f"Grape variety (raw): {facts['grape_variety_raw']}")
    lines.append(f"Vintage: {facts['vintage']}  •  Size: {facts['bottle_size']}  •  Price: {facts['price']} THB")
    if facts.get("alcohol"):
        lines.append(f"Alcohol: {facts['alcohol']}")

    lines.append("\n# Evidence — Winesensed real-world tasting notes (STRUCTURAL GROUNDING; do not quote)")
    if evidence.winesensed_matches:
        for m in evidence.winesensed_matches:
            yr = f" ({m.year})" if m.year else ""
            lines.append(f"[{m.record_id}] {yr} {m.grape}, {m.region} (rating {m.rating}, match={m.match_type})")
            lines.append(f"  review-excerpt-for-grounding-only: {m.review_text}")
    else:
        lines.append("(no Winesensed matches)")

    lines.append("\n# Evidence — Brand library")
    if evidence.brand_description and (evidence.brand_description.desc_short or evidence.brand_description.desc_full):
        bd = evidence.brand_description
        lines.append(f"{bd.name} (tier {bd.tier}):")
        if bd.desc_short:
            lines.append(f"  Short: {bd.desc_short}")
        if bd.desc_full:
            lines.append(f"  Full: {bd.desc_full[:600]}")
    else:
        lines.append("(no brand library entry)")

    lines.append("\n# Evidence — Taxonomy heuristic")
    lines.append(evidence.heuristic_profile)

    lines.append("\n# Evidence — Expert critic scores")
    if evidence.critic_scores:
        for s in evidence.critic_scores:
            yr = f" ({s.tasting_year})" if s.tasting_year else ""
            vt = f" [vintage {s.vintage}]" if s.vintage else ""
            lines.append(f"{s.critic}: {s.score}/{int(s.score_max)}{yr}{vt}")
        lines.append("(Calibration only — do NOT invent scores; do NOT reproduce critic prose; cite which scores anchored your judgement in citations.critic_scores.)")
    else:
        lines.append("(no critic scores recorded)")

    lines.append("\n# Your task")
    lines.append("Produce the matrix JSON for this SKU per the schema in the system prompt.")
    lines.append("Cite which evidence anchored each major choice in `citations`.")
    lines.append("If evidence conflicts, state the conflict in `confidence_notes` and lower confidence.")
    lines.append("Output ONLY JSON, no preamble.")
    return "\n".join(lines)


def build_prompt(evidence: Evidence, food_tax: FoodTaxonomy) -> tuple[str, str, str]:
    """Returns (system_text, user_text, prompt_hash).

    prompt_hash = sha256(template_version + system_text). It is stable across SKUs
    given the same template + taxonomy. Per-SKU drift comes from evidence_hash.
    """
    system = _system_prompt(food_tax)
    user = _user_message(evidence)
    hash_input = f"{PROMPT_TEMPLATE_VERSION}\n{system}"
    prompt_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    return system, user, prompt_hash
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_prompt.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/shared/taxonomies/food_pairing.py data/lib/enrichment/wine/prompt.py tests/test_wine_enrichment_prompt.py
git commit -m "feat(wine_enrichment): prompt builder + food-pairing loader"
```

---

## Task 8: Validator

**Files:**
- Create: `data/lib/enrichment/wine/validator.py`
- Create: `tests/test_wine_enrichment_validator.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_validator.py`

```python
"""Unit tests for data/lib/enrichment/wine/validator.py."""
from __future__ import annotations

from data.lib.enrichment.wine import validator as v
from data.lib.enrichment.wine.evidence import Evidence, WinesensedMatch
from data.lib.enrichment.shared.taxonomies import food_pairing


FOOD_TAX = food_pairing.load_default()


def _good_response() -> dict:
    return {
        "wine_body": "Medium-Full",
        "wine_acidity": "Medium",
        "wine_tannin": "Medium-High",
        "grape_variety": ["Cabernet Sauvignon", "Merlot"],
        "grape_blend_type": "Bordeaux Red Blend",
        "wine_production_style": ["Conventional"],
        "flavor_tags": ["Blackcurrant", "Cedar", "Tobacco", "Dark Cherry", "Vanilla"],
        "food_matching": ["Grilled red meat", "Aged hard cheese", "Lamb dishes"],
        "desc_en_short": "Classic Bordeaux blend with cedar and dark fruit.",
        "full_description": "<p>A polished, age-worthy red showing dark fruit, fine tannin, and cedar notes from oak.</p>",
        "confidence": 0.9,
        "confidence_notes": "Strong evidence.",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None, "grape_source": "products.grape_variety", "critic_scores": []},
    }


def _empty_evidence() -> Evidence:
    return Evidence(
        sku="TEST-1",
        facts={},
        winesensed_matches=(),
        brand_description=None,
        heuristic_profile="",
        critic_scores=(),
        quality_tier="C",
        evidence_hash="",
    )


class TestHappyPath:
    def test_clean_response_passes(self):
        r = _good_response()
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "passed"
        assert result.repaired_json == r


class TestVocabRepair:
    def test_medium_heavy_body_repairs(self):
        r = _good_response()
        r["wine_body"] = "Medium-Heavy"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["wine_body"] == "Medium-Full"

    def test_invalid_body_rejects(self):
        r = _good_response()
        r["wine_body"] = "Effervescent"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"

    def test_blend_gsm_repairs(self):
        r = _good_response()
        r["grape_blend_type"] = "GSM"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["grape_blend_type"] == "Rhône South Blend (GSM)"


class TestFoodMatching:
    def test_unknown_food_label_drops(self):
        r = _good_response()
        r["food_matching"] = ["Grilled red meat", "Hovercraft eels"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        # Unknown one is dropped; remaining is still ≥3? No, only 1 remains → rejected
        assert result.outcome == "rejected" or result.outcome == "repaired"


class TestHallucinatedCitations:
    def test_winesensed_id_not_in_evidence_strips(self):
        r = _good_response()
        r["citations"]["winesensed_record_ids"] = ["fake-id-999"]
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "repaired"
        assert result.repaired_json["citations"]["winesensed_record_ids"] == []

    def test_real_winesensed_id_passes(self):
        evidence = Evidence(
            sku="TEST-1", facts={}, brand_description=None,
            winesensed_matches=(
                WinesensedMatch(record_id="ws-1", year=2020, region="Bordeaux", grape="Cab", rating=4.5, review_text="x", match_type="tight"),
            ),
            heuristic_profile="", critic_scores=(), quality_tier="B", evidence_hash="",
        )
        r = _good_response()
        r["citations"]["winesensed_record_ids"] = ["ws-1"]
        result = v.validate(r, evidence, FOOD_TAX)
        assert result.outcome == "passed"


class TestLengthChecks:
    def test_desc_short_too_long_rejects(self):
        r = _good_response()
        r["desc_en_short"] = "x" * 250
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome in ("repaired", "rejected")

    def test_full_description_too_short_rejects(self):
        r = _good_response()
        r["full_description"] = "<p>short</p>"
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"


class TestConfidenceRange:
    def test_confidence_out_of_range_rejects(self):
        r = _good_response()
        r["confidence"] = 1.5
        result = v.validate(r, _empty_evidence(), FOOD_TAX)
        assert result.outcome == "rejected"
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_validator.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement validator.py**

File: `data/lib/enrichment/wine/validator.py`

```python
"""Validate Haiku JSON output against schema + controlled vocabulary."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from data.lib.enrichment.wine import taxonomies
from data.lib.enrichment.wine.evidence import Evidence
from data.lib.enrichment.shared.taxonomies.food_pairing import FoodTaxonomy

ALLOWED_HTML_TAGS = {"p", "br", "strong", "em", "ul", "li"}
HTML_TAG_RE = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>")


@dataclass
class ValidationResult:
    outcome: Literal["passed", "repaired", "rejected"]
    repaired_json: dict
    issues: list[str] = field(default_factory=list)
    can_retry: bool = False  # only meaningful when outcome == 'rejected'


def _strip_disallowed_html(s: str) -> tuple[str, bool]:
    """Return (cleaned, was_modified). Strips disallowed tags but keeps inner text."""
    modified = False
    def _replace(m: re.Match) -> str:
        nonlocal modified
        tag = m.group(1).lower()
        if tag in ALLOWED_HTML_TAGS:
            return m.group(0)
        modified = True
        return ""
    return HTML_TAG_RE.sub(_replace, s), modified


def validate(response_json: dict, evidence: Evidence, food_tax: FoodTaxonomy) -> ValidationResult:
    if not isinstance(response_json, dict):
        return ValidationResult("rejected", {}, ["response is not a JSON object"], can_retry=True)

    repaired = dict(response_json)  # shallow copy; we'll mutate as needed
    issues: list[str] = []
    repaired_count = 0

    # Required fields
    required = {
        "wine_body", "wine_acidity", "wine_tannin",
        "grape_variety", "grape_blend_type", "wine_production_style",
        "flavor_tags", "food_matching",
        "desc_en_short", "full_description",
        "confidence", "citations",
    }
    missing = required - set(repaired.keys())
    if missing:
        return ValidationResult("rejected", repaired, [f"missing required fields: {sorted(missing)}"], can_retry=True)

    # Vocab fields with fuzzy repair
    def _check_or_repair(field_name: str, value, valid_set, repair_fn):
        nonlocal repaired_count
        if value in valid_set:
            return value
        if repair_fn:
            fixed = repair_fn(value)
            if fixed is not None:
                issues.append(f"{field_name} repaired: {value!r} -> {fixed!r}")
                repaired_count += 1
                return fixed
        issues.append(f"{field_name} out of vocab: {value!r}")
        return None

    body = _check_or_repair("wine_body", repaired["wine_body"], set(taxonomies.BODY_VALUES), taxonomies.repair_body)
    if body is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_body"] = body

    acid = _check_or_repair("wine_acidity", repaired["wine_acidity"], set(taxonomies.ACIDITY_VALUES), taxonomies.repair_acidity)
    if acid is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_acidity"] = acid

    tannin = _check_or_repair("wine_tannin", repaired["wine_tannin"], set(taxonomies.TANNIN_VALUES), taxonomies.repair_tannin)
    if tannin is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["wine_tannin"] = tannin

    blend = _check_or_repair("grape_blend_type", repaired["grape_blend_type"], set(taxonomies.BLEND_TYPES), taxonomies.repair_blend_type)
    if blend is None:
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["grape_blend_type"] = blend

    # production styles — multiselect, drop unknowns
    prod_in = repaired.get("wine_production_style") or []
    if not isinstance(prod_in, list):
        return ValidationResult("rejected", repaired, ["wine_production_style must be a list"], can_retry=True)
    prod_valid = [p for p in prod_in if p in taxonomies.PRODUCTION_STYLES]
    if len(prod_valid) != len(prod_in):
        issues.append(f"dropped invalid production styles: {set(prod_in) - set(prod_valid)}")
        repaired_count += 1
    repaired["wine_production_style"] = prod_valid

    # flavor_tags: count 5-10, items ≤30 chars
    flavor = repaired.get("flavor_tags") or []
    if not isinstance(flavor, list):
        return ValidationResult("rejected", repaired, ["flavor_tags must be a list"], can_retry=True)
    flavor = [str(x)[:30].strip() for x in flavor if str(x).strip()]
    if len(flavor) < 5 or len(flavor) > 10:
        issues.append(f"flavor_tags count {len(flavor)} not in [5, 10]")
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["flavor_tags"] = flavor

    # food_matching: must be subset of food taxonomy labels; 3-6 items
    food_in = repaired.get("food_matching") or []
    if not isinstance(food_in, list):
        return ValidationResult("rejected", repaired, ["food_matching must be a list"], can_retry=True)
    food_labels = food_tax.labels
    food_valid = []
    for f in food_in:
        if f in food_labels:
            food_valid.append(f)
        else:
            # Fuzzy match: case-insensitive direct match
            ci_match = next((l for l in food_labels if l.lower() == str(f).lower()), None)
            if ci_match:
                food_valid.append(ci_match)
                issues.append(f"food_matching repaired: {f!r} -> {ci_match!r}")
                repaired_count += 1
            else:
                issues.append(f"food_matching dropped (not in taxonomy): {f!r}")
                repaired_count += 1
    if len(food_valid) < 3 or len(food_valid) > 6:
        issues.append(f"food_matching count {len(food_valid)} not in [3, 6]")
        return ValidationResult("rejected", repaired, issues, can_retry=True)
    repaired["food_matching"] = food_valid

    # desc_en_short length
    desc = str(repaired.get("desc_en_short") or "").strip()
    if len(desc) > 200:
        return ValidationResult("rejected", repaired, [f"desc_en_short {len(desc)} > 200"], can_retry=True)
    if len(desc) > 160:
        # Truncate at last word before 160
        truncated = desc[:160].rsplit(" ", 1)[0]
        repaired["desc_en_short"] = truncated
        issues.append(f"desc_en_short truncated to {len(truncated)} chars")
        repaired_count += 1
    elif len(desc) == 0:
        return ValidationResult("rejected", repaired, ["desc_en_short is empty"], can_retry=True)

    # full_description length + HTML safety
    full = str(repaired.get("full_description") or "")
    if len(full) < 200 or len(full) > 1200:
        return ValidationResult("rejected", repaired, [f"full_description length {len(full)} not in [200,1200]"], can_retry=True)
    cleaned_full, html_modified = _strip_disallowed_html(full)
    if html_modified:
        repaired["full_description"] = cleaned_full
        issues.append("full_description stripped disallowed HTML tags")
        repaired_count += 1

    # citation integrity — winesensed
    citations = repaired.get("citations") or {}
    if not isinstance(citations, dict):
        return ValidationResult("rejected", repaired, ["citations must be an object"], can_retry=True)
    valid_ws_ids = {m.record_id for m in evidence.winesensed_matches}
    cited_ws = citations.get("winesensed_record_ids") or []
    if not isinstance(cited_ws, list):
        cited_ws = []
        repaired_count += 1
    bad_ws = [x for x in cited_ws if x not in valid_ws_ids]
    if bad_ws:
        citations["winesensed_record_ids"] = [x for x in cited_ws if x in valid_ws_ids]
        issues.append(f"stripped hallucinated winesensed IDs: {bad_ws}")
        repaired_count += 1

    # citation integrity — brand
    brand_cited = citations.get("brand_library_match")
    if brand_cited and (evidence.brand_description is None or brand_cited != evidence.brand_description.name):
        citations["brand_library_match"] = None
        issues.append(f"stripped hallucinated brand citation: {brand_cited!r}")
        repaired_count += 1

    repaired["citations"] = citations

    # confidence
    conf = repaired.get("confidence")
    try:
        conf_f = float(conf)
    except (ValueError, TypeError):
        return ValidationResult("rejected", repaired, [f"confidence not numeric: {conf!r}"], can_retry=True)
    if not (0.0 <= conf_f <= 1.0):
        return ValidationResult("rejected", repaired, [f"confidence out of [0,1]: {conf_f}"], can_retry=True)
    repaired["confidence"] = conf_f

    outcome: Literal["passed", "repaired"] = "passed" if repaired_count == 0 else "repaired"
    return ValidationResult(outcome=outcome, repaired_json=repaired, issues=issues)
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_validator.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/wine/validator.py tests/test_wine_enrichment_validator.py
git commit -m "feat(wine_enrichment): validator with vocab repair + citation integrity"
```

---

## Task 9: Scoring

**Files:**
- Create: `data/lib/enrichment/wine/scoring.py`
- Create: `tests/test_wine_enrichment_scoring.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_scoring.py`

```python
"""Unit tests for data/lib/enrichment/wine/scoring.py."""
from __future__ import annotations

import pytest
from data.lib.enrichment.wine import scoring as s


class TestFormula:
    def test_tier_a_passed_high_conf(self):
        assert s.final_confidence(0.95, "A", "passed") == pytest.approx(0.95)

    def test_tier_b_repaired_mid_conf(self):
        result = s.final_confidence(0.90, "B", "repaired")
        # 0.90 * 0.90 * 0.95 = 0.7695
        assert result == pytest.approx(0.7695, abs=0.001)

    def test_tier_c_passed_low_conf(self):
        result = s.final_confidence(0.80, "C", "passed")
        # 0.80 * 0.75 * 1.0 = 0.60
        assert result == pytest.approx(0.60, abs=0.001)

    def test_retried_validator(self):
        result = s.final_confidence(0.95, "A", "failed_then_retried")
        # 0.95 * 1.0 * 0.85 = 0.8075
        assert result == pytest.approx(0.8075, abs=0.001)


class TestRouting:
    def test_above_threshold_direct_write(self):
        assert s.should_direct_write(0.86, threshold=0.85) is True

    def test_at_threshold_direct_write(self):
        assert s.should_direct_write(0.85, threshold=0.85) is True

    def test_below_threshold_csv_only(self):
        assert s.should_direct_write(0.84, threshold=0.85) is False


class TestBounds:
    def test_clamps_to_zero(self):
        result = s.final_confidence(-0.1, "A", "passed")
        assert result == 0.0

    def test_clamps_to_one(self):
        result = s.final_confidence(1.5, "A", "passed")
        assert result == 1.0
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_scoring.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement scoring.py**

File: `data/lib/enrichment/wine/scoring.py`

```python
"""Confidence scoring + direct-write threshold."""
from __future__ import annotations

from typing import Literal


_TIER_MULTIPLIER: dict[str, float] = {"A": 1.00, "B": 0.90, "C": 0.75}
_VALIDATOR_MULTIPLIER: dict[str, float] = {
    "passed": 1.00,
    "repaired": 0.95,
    "failed_then_retried": 0.85,
}

DEFAULT_THRESHOLD = 0.85


def final_confidence(
    ai_confidence: float,
    tier: Literal["A", "B", "C"],
    validator_outcome: Literal["passed", "repaired", "failed_then_retried"],
) -> float:
    """Compute final confidence in [0,1] from the three signals."""
    ai = max(0.0, min(1.0, float(ai_confidence)))
    tier_m = _TIER_MULTIPLIER.get(tier, 0.75)
    val_m = _VALIDATOR_MULTIPLIER.get(validator_outcome, 0.85)
    return max(0.0, min(1.0, ai * tier_m * val_m))


def should_direct_write(final_conf: float, threshold: float = DEFAULT_THRESHOLD) -> bool:
    return final_conf >= threshold
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_scoring.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/wine/scoring.py tests/test_wine_enrichment_scoring.py
git commit -m "feat(wine_enrichment): scoring formula + direct-write threshold"
```

---

## Task 10: Anthropic client wrapper

**Files:**
- Create: `data/lib/enrichment/shared/client.py`
- Create: `tests/test_wine_enrichment_client.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_client.py`

```python
"""Unit tests for data/lib/enrichment/shared/client.py."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from data.lib.enrichment.shared import client as c


class TestCostEstimate:
    def test_haiku_cost_calc(self):
        usage = MagicMock(input_tokens=1200, output_tokens=600, cache_read_input_tokens=500)
        # input not-cached = 1200 - 500 = 700; output = 600; cache_read = 500
        cost_usd = c._estimate_cost_usd(usage, model="claude-haiku-4-5-20251001")
        # input 700 * $1/1M + cached 500 * $0.10/1M + output 600 * $5/1M
        # = 0.0007 + 0.00005 + 0.003 = 0.00375
        assert cost_usd == pytest.approx(0.00375, abs=0.0001) if False else (abs(cost_usd - 0.00375) < 0.0001)


class TestGenerateMocked:
    @patch("data.lib.enrichment.shared.client.anthropic.Anthropic")
    def test_generate_returns_response(self, mock_anthropic_class):
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_resp = MagicMock()
        mock_resp.content = [MagicMock(text='{"wine_body":"Full"}')]
        mock_resp.model = "claude-haiku-4-5-20251001"
        mock_resp.usage = MagicMock(input_tokens=1000, output_tokens=500, cache_read_input_tokens=0)
        mock_client.messages.create.return_value = mock_resp

        client = c.AnthropicClient(api_key="fake-key", model="claude-haiku-4-5-20251001")
        result = client.generate(system="sys", user="usr", max_tokens=1500)

        assert result.text == '{"wine_body":"Full"}'
        assert result.model == "claude-haiku-4-5-20251001"
        assert result.tokens_in == 1000
        assert result.tokens_out == 500
        assert result.cost_usd > 0


import pytest
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_client.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement client.py**

File: `data/lib/enrichment/shared/client.py`

```python
"""Anthropic SDK wrapper with retries + cost tracking."""
from __future__ import annotations

import time
from dataclasses import dataclass

import anthropic


# Per-million-token USD pricing for Claude Haiku 4.5 (as of 2026 spec date).
# input: $1, output: $5, cached: $0.10
_PRICING_USD_PER_MILLION: dict[str, tuple[float, float, float]] = {
    "claude-haiku-4-5-20251001": (1.0, 5.0, 0.10),
    "claude-haiku-4-5": (1.0, 5.0, 0.10),
    # Add Sonnet/Opus if model is overridden via CLI flag
    "claude-sonnet-4-6": (3.0, 15.0, 0.30),
    "claude-opus-4-7": (15.0, 75.0, 1.50),
}

# USD → THB approx conversion (configurable in env or CLI later)
USD_TO_THB = 35.0


@dataclass
class GenerationResult:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    cost_thb: float


def _estimate_cost_usd(usage, model: str) -> float:
    in_price, out_price, cache_price = _PRICING_USD_PER_MILLION.get(model, (1.0, 5.0, 0.10))
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    in_total = getattr(usage, "input_tokens", 0) or 0
    out_total = getattr(usage, "output_tokens", 0) or 0
    fresh_in = max(0, in_total - cached)
    return (
        fresh_in * in_price / 1_000_000
        + cached * cache_price / 1_000_000
        + out_total * out_price / 1_000_000
    )


class AnthropicClient:
    def __init__(self, api_key: str, model: str = "claude-haiku-4-5-20251001"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def generate(
        self,
        system: str,
        user: str,
        max_tokens: int = 1500,
        temperature: float = 0.1,
        max_retries: int = 3,
    ) -> GenerationResult:
        last_err: Exception | None = None
        for attempt in range(max_retries):
            try:
                resp = self.client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                    messages=[{"role": "user", "content": user}],
                )
                text = resp.content[0].text if resp.content else ""
                cost_usd = _estimate_cost_usd(resp.usage, resp.model)
                return GenerationResult(
                    text=text,
                    model=resp.model,
                    tokens_in=getattr(resp.usage, "input_tokens", 0) or 0,
                    tokens_out=getattr(resp.usage, "output_tokens", 0) or 0,
                    cost_usd=cost_usd,
                    cost_thb=cost_usd * USD_TO_THB,
                )
            except (anthropic.RateLimitError, anthropic.APIStatusError) as e:
                last_err = e
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise RuntimeError(f"unreachable") from last_err
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_client.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/shared/client.py tests/test_wine_enrichment_client.py
git commit -m "feat(wine_enrichment): Anthropic client wrapper with retries + cost tracking"
```

---

## Task 11: Cache module (Supabase-backed)

**Files:**
- Create: `data/lib/enrichment/shared/cache.py`
- Create: `tests/test_wine_enrichment_cache.py`

- [ ] **Step 1: Write failing tests with mocked HTTP**

File: `tests/test_wine_enrichment_cache.py`

```python
"""Unit tests for data/lib/enrichment/shared/cache.py.

Mocks the Supabase REST HTTP layer with `responses` would be ideal, but to avoid
adding a dep we mock urllib.request directly.
"""
from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

from data.lib.enrichment.shared import cache as ca


class TestCacheLookupMiss:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_miss_returns_none(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b"[]"
        mock_resp.status = 200
        mock_urlopen.return_value = mock_resp

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        result = client.lookup(sku="WX-1", prompt_hash="ph", evidence_hash="eh")
        assert result is None


class TestCacheLookupHit:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_hit_returns_row(self, mock_urlopen):
        row = {
            "id": "abc-123", "sku": "WX-1", "category": "wine",
            "prompt_hash": "ph", "evidence_hash": "eh",
            "response_json": {"wine_body": "Full"}, "model": "haiku",
            "tokens_in": 100, "tokens_out": 50, "cost_thb": 0.1,
            "confidence": 0.9, "validation_status": "passed",
        }
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = json.dumps([row]).encode("utf-8")
        mock_resp.status = 200
        mock_urlopen.return_value = mock_resp

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        result = client.lookup(sku="WX-1", prompt_hash="ph", evidence_hash="eh")
        assert result is not None
        assert result["sku"] == "WX-1"
        assert result["response_json"]["wine_body"] == "Full"


class TestCacheWrite:
    @patch("data.lib.enrichment.shared.cache.urllib.request.urlopen")
    def test_write_supersedes_and_inserts(self, mock_urlopen):
        # Two HTTP calls expected: PATCH supersede then POST insert
        def side_effect(req, timeout=None):
            m = MagicMock()
            m.__enter__.return_value = m
            m.read.return_value = b"[]"
            m.status = 200
            return m
        mock_urlopen.side_effect = side_effect

        client = ca.CacheClient(supabase_url="https://x.supabase.co", api_key="k")
        client.write(
            sku="WX-1", category="wine",
            prompt_hash="ph", evidence_hash="eh",
            prompt_text="...", response_json={"wine_body": "Full"},
            response_raw="x", model="haiku",
            tokens_in=100, tokens_out=50, cost_thb=0.1,
            confidence=0.9, validation_status="passed", validation_issues=[],
        )
        # Verify both HTTP calls were made
        assert mock_urlopen.call_count >= 2
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_cache.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement cache.py**

File: `data/lib/enrichment/shared/cache.py`

```python
"""Supabase enrichment_cache R/W via PostgREST HTTP."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CacheClient:
    def __init__(self, supabase_url: str, api_key: str):
        self.url = supabase_url.rstrip("/")
        self.api_key = api_key

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def lookup(self, sku: str, prompt_hash: str, evidence_hash: str) -> dict[str, Any] | None:
        """Return the active cached row for (sku, prompt_hash, evidence_hash) or None."""
        params = {
            "sku": f"eq.{sku}",
            "prompt_hash": f"eq.{prompt_hash}",
            "evidence_hash": f"eq.{evidence_hash}",
            "superseded_at": "is.null",
            "select": "id,sku,category,prompt_hash,evidence_hash,response_json,model,tokens_in,tokens_out,cost_thb,confidence,validation_status,validation_issues",
            "limit": "1",
        }
        qs = urllib.parse.urlencode(params)
        url = f"{self.url}/rest/v1/enrichment_cache?{qs}"
        req = urllib.request.Request(url, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data[0] if data else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache lookup failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

    def write(
        self,
        sku: str,
        category: str,
        prompt_hash: str,
        evidence_hash: str,
        prompt_text: str,
        response_json: dict,
        response_raw: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        cost_thb: float,
        confidence: float,
        validation_status: str,
        validation_issues: list,
    ) -> str:
        """Supersede any active row for this SKU then INSERT a new active row.

        Returns the new row's id (uuid).
        """
        # Step 1: supersede any active prior row(s) for this SKU.
        supersede_url = f"{self.url}/rest/v1/enrichment_cache?sku=eq.{urllib.parse.quote(sku)}&superseded_at=is.null"
        supersede_body = json.dumps({"superseded_at": "now()"}).encode("utf-8")
        req = urllib.request.Request(
            supersede_url,
            data=supersede_body,
            method="PATCH",
            headers=self._headers({"Prefer": "return=minimal"}),
        )
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache supersede failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

        # Step 2: insert new row.
        insert_url = f"{self.url}/rest/v1/enrichment_cache"
        new_row = {
            "sku": sku,
            "category": category,
            "prompt_hash": prompt_hash,
            "evidence_hash": evidence_hash,
            "prompt_text": prompt_text,
            "response_json": response_json,
            "response_raw": response_raw,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_thb": cost_thb,
            "confidence": confidence,
            "validation_status": validation_status,
            "validation_issues": validation_issues,
        }
        body = json.dumps(new_row).encode("utf-8")
        req = urllib.request.Request(
            insert_url,
            data=body,
            method="POST",
            headers=self._headers({"Prefer": "return=representation"}),
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data[0]["id"] if data else ""
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"cache insert failed: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_cache.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/shared/cache.py tests/test_wine_enrichment_cache.py
git commit -m "feat(wine_enrichment): Supabase enrichment_cache R/W with supersede chain"
```

---

## Task 12: Output module (Supabase write + CSV append)

**Files:**
- Create: `data/lib/enrichment/wine/output.py`
- Create: `tests/test_wine_enrichment_output.py`

- [ ] **Step 1: Write failing tests**

File: `tests/test_wine_enrichment_output.py`

```python
"""Unit tests for data/lib/enrichment/wine/output.py."""
from __future__ import annotations

import csv
import io
from unittest.mock import patch, MagicMock

from data.lib.enrichment.wine import output as o


def _good_response() -> dict:
    return {
        "wine_body": "Full",
        "wine_acidity": "Medium",
        "wine_tannin": "High",
        "grape_variety": ["Cabernet Sauvignon"],
        "grape_blend_type": "Single Varietal",
        "wine_production_style": ["Conventional"],
        "flavor_tags": ["Blackcurrant", "Cedar", "Tobacco", "Dark Cherry", "Vanilla"],
        "food_matching": ["Grilled red meat", "Lamb dishes", "Aged hard cheese"],
        "desc_en_short": "Bold structured Cabernet.",
        "full_description": "<p>" + ("Bold structured Cab. " * 15) + "</p>",
        "confidence": 0.9,
        "confidence_notes": "Strong.",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None, "grape_source": "", "critic_scores": []},
    }


class TestCsvRow:
    def test_row_contains_all_required_fields(self):
        row = o.build_csv_row(
            sku="WX-1", response=_good_response(),
            final_confidence=0.91, tier="A",
            cache_id="abc-123",
            current_values={"wine_body": "Medium", "food_matching": "Old value"},
            enrichment_note="haiku tier A",
            model="haiku",
            enriched_at="2026-05-12T15:00:00Z",
        )
        assert row["sku"] == "WX-1"
        assert row["confidence"] == 0.91
        assert row["confidence_tier"] == "A"
        assert "Cabernet Sauvignon" in row["grape_variety"]
        assert "|" in row["grape_variety"] or row["grape_variety"] == "Cabernet Sauvignon"
        assert row["grape_blend_type"] == "Single Varietal"
        assert row["wine_body"] == "Full"
        assert row["current_wine_body"] == "Medium"
        assert row["cache_id"] == "abc-123"


class TestRouting:
    @patch("data.lib.enrichment.wine.output.urllib.request.urlopen")
    def test_above_threshold_writes_to_supabase(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b"[]"
        mock_resp.status = 200
        mock_urlopen.return_value = mock_resp

        csv_buf = io.StringIO()
        writer = csv.DictWriter(csv_buf, fieldnames=o.CSV_COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        router = o.OutputRouter(
            supabase_url="https://x.supabase.co", api_key="k",
            csv_writer=writer, write_threshold=0.85,
        )
        router.route(
            sku="WX-1", products_id="prod-1", response=_good_response(),
            final_confidence=0.91, tier="A",
            cache_id="abc-123",
            current_values={},
            enrichment_note="haiku tier A",
            model="haiku-4-5", enriched_at="2026-05-12T15:00:00Z",
        )
        # Both Supabase PATCH + CSV write should have occurred
        assert mock_urlopen.called  # supabase call made
        # CSV got at least one row
        assert "WX-1" in csv_buf.getvalue()

    @patch("data.lib.enrichment.wine.output.urllib.request.urlopen")
    def test_below_threshold_csv_only(self, mock_urlopen):
        csv_buf = io.StringIO()
        writer = csv.DictWriter(csv_buf, fieldnames=o.CSV_COLUMNS, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        router = o.OutputRouter(
            supabase_url="https://x.supabase.co", api_key="k",
            csv_writer=writer, write_threshold=0.85,
        )
        router.route(
            sku="WX-2", products_id="prod-2", response=_good_response(),
            final_confidence=0.70, tier="C",
            cache_id="abc-456",
            current_values={},
            enrichment_note="haiku tier C",
            model="haiku-4-5", enriched_at="2026-05-12T15:00:00Z",
        )
        # Supabase should NOT have been called
        assert mock_urlopen.call_count == 0
        # But CSV got the row
        assert "WX-2" in csv_buf.getvalue()
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_wine_enrichment_output.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement output.py**

File: `data/lib/enrichment/wine/output.py`

```python
"""Output routing: Supabase products write (≥threshold) + CSV append (always).

Per §8 of the spec.
"""
from __future__ import annotations

import csv
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


# Per §14.1 of spec. Order matters — kept stable for downstream Magento import.
CSV_COLUMNS: list[str] = [
    "sku", "confidence", "confidence_tier",
    "wine_body", "wine_acidity", "wine_tannin",
    "grape_variety", "grape_blend_type", "wine_production_style",
    "flavor_tags", "food_matching",
    "desc_en_short", "full_description",
    "score_max", "score_summary",
    "enrichment_note",
    "current_wine_body", "current_food_matching", "current_full_description",
    "cache_id", "enriched_at", "enriched_by",
]


def _pipe(seq) -> str:
    if not seq:
        return ""
    return "|".join(str(x) for x in seq)


def build_csv_row(
    sku: str,
    response: dict,
    final_confidence: float,
    tier: str,
    cache_id: str,
    current_values: dict,
    enrichment_note: str,
    model: str,
    enriched_at: str,
    score_max: float | None = None,
    score_summary: str = "",
) -> dict:
    return {
        "sku": sku,
        "confidence": round(final_confidence, 3),
        "confidence_tier": tier,
        "wine_body": response.get("wine_body", ""),
        "wine_acidity": response.get("wine_acidity", ""),
        "wine_tannin": response.get("wine_tannin", ""),
        "grape_variety": _pipe(response.get("grape_variety", [])),
        "grape_blend_type": response.get("grape_blend_type", ""),
        "wine_production_style": _pipe(response.get("wine_production_style", [])),
        "flavor_tags": _pipe(response.get("flavor_tags", [])),
        "food_matching": _pipe(response.get("food_matching", [])),
        "desc_en_short": response.get("desc_en_short", ""),
        "full_description": response.get("full_description", ""),
        "score_max": score_max if score_max is not None else "",
        "score_summary": score_summary,
        "enrichment_note": enrichment_note,
        "current_wine_body": current_values.get("wine_body", ""),
        "current_food_matching": current_values.get("food_matching", ""),
        "current_full_description": (current_values.get("full_description") or "")[:200],
        "cache_id": cache_id,
        "enriched_at": enriched_at,
        "enriched_by": model,
    }


class OutputRouter:
    """Routes one enrichment result: Supabase write (if high-conf) + CSV (always)."""

    def __init__(
        self,
        supabase_url: str,
        api_key: str,
        csv_writer: csv.DictWriter,
        write_threshold: float = 0.85,
    ):
        self.url = supabase_url.rstrip("/")
        self.api_key = api_key
        self.csv_writer = csv_writer
        self.write_threshold = write_threshold

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def _write_to_products(self, products_id: str, response: dict, final_confidence: float, model: str, enrichment_note: str, enriched_at: str, score_max: float | None, score_summary: str) -> None:
        patch_url = f"{self.url}/rest/v1/products?id=eq.{urllib.parse.quote(products_id)}"
        payload = {
            "wine_body": response.get("wine_body"),
            "wine_acidity": response.get("wine_acidity"),
            "wine_tannin": response.get("wine_tannin"),
            "grape_variety": ", ".join(response.get("grape_variety", [])) or None,
            "grape_blend_type": response.get("grape_blend_type"),
            "wine_production_style": response.get("wine_production_style") or None,
            "flavor_tags": json.dumps(response.get("flavor_tags") or []),
            "food_matching": ", ".join(response.get("food_matching", [])) or None,
            "desc_en_short": response.get("desc_en_short"),
            "full_description": response.get("full_description"),
            "score_max": score_max,
            "score_summary": score_summary or None,
            "enrichment_confidence": round(final_confidence, 3),
            "enrichment_source": "ai_high_conf",
            "enrichment_note": enrichment_note,
            "enriched_at": enriched_at,
            "enriched_by": model,
        }
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"products write failed for {products_id}: {e.code} {e.read().decode('utf-8', errors='replace')[:200]}")

    def route(
        self,
        sku: str,
        products_id: str,
        response: dict,
        final_confidence: float,
        tier: str,
        cache_id: str,
        current_values: dict,
        enrichment_note: str,
        model: str,
        enriched_at: str,
        score_max: float | None = None,
        score_summary: str = "",
    ) -> bool:
        """Returns True if direct Supabase write happened, False if CSV-only."""
        wrote_supabase = False
        if final_confidence >= self.write_threshold and products_id:
            self._write_to_products(
                products_id, response, final_confidence, model,
                enrichment_note, enriched_at, score_max, score_summary,
            )
            wrote_supabase = True

        row = build_csv_row(
            sku=sku, response=response,
            final_confidence=final_confidence, tier=tier,
            cache_id=cache_id, current_values=current_values,
            enrichment_note=enrichment_note,
            model=model, enriched_at=enriched_at,
            score_max=score_max, score_summary=score_summary,
        )
        self.csv_writer.writerow(row)
        return wrote_supabase
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
.venv/bin/pytest tests/test_wine_enrichment_output.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add data/lib/enrichment/wine/output.py tests/test_wine_enrichment_output.py
git commit -m "feat(wine_enrichment): output router (Supabase + CSV)"
```

---

## Task 13: CLI driver

**Files:**
- Create: `data/enrich_wines.py`
- Create: `tests/test_enrich_wines.py`

- [ ] **Step 1: Write integration test**

File: `tests/test_enrich_wines.py`

```python
"""Integration test for data/enrich_wines.py using the 5-SKU fixture."""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIVER = REPO_ROOT / "data" / "enrich_wines.py"


def test_dry_run_succeeds_with_fixture():
    """--dry-run mode + --skus-file pointing at the fixture: no API call needed."""
    result = subprocess.run(
        [
            sys.executable, str(DRIVER),
            "--dry-run",
            "--skus-file", str(REPO_ROOT / "tests" / "fixtures" / "wine_pilot_skus.json"),
            "--winesensed-file", str(REPO_ROOT / "tests" / "fixtures" / "winesensed_sample.json"),
            "--brand-library-file", str(REPO_ROOT / "tests" / "fixtures" / "brand_library_sample.csv"),
            "--no-supabase",
            "--limit", "5",
        ],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    # Driver should print one line per SKU + summary
    assert "FX-BORDEAUX-001" in result.stdout
    assert "Cache hits" in result.stdout or "would call Haiku" in result.stdout
```

- [ ] **Step 2: Run and confirm fail**

```bash
.venv/bin/pytest tests/test_enrich_wines.py -v
```

Expected: FileNotFoundError (driver missing).

- [ ] **Step 3: Implement driver**

File: `data/enrich_wines.py`

```python
#!/usr/bin/env python3
"""Wine enrichment CLI driver.

See docs/superpowers/specs/2026-05-12-wine-enrichment-design.md
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.enrichment.shared.client import AnthropicClient, USD_TO_THB
from data.lib.enrichment.shared.cache import CacheClient
from data.lib.enrichment.shared.taxonomies import food_pairing
from data.lib.enrichment.wine import evidence as ev
from data.lib.enrichment.wine import prompt as pr
from data.lib.enrichment.wine import validator as val
from data.lib.enrichment.wine import scoring as sc
from data.lib.enrichment.wine.output import OutputRouter, CSV_COLUMNS

DEFAULT_PRODUCTS_FILE = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_WINESENSED_FILE = REPO_ROOT / "data" / "db" / "external-winesensed-records.json"
DEFAULT_BRAND_LIBRARY_FILE = REPO_ROOT / "data" / "brand_description_library.csv"
DEFAULT_EXPORTS_DIR = REPO_ROOT / "data" / "exports"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def fetch_critic_scores(supabase_url: str, api_key: str, skus: list[str]) -> dict[str, list[dict]]:
    """Fetch critic_scores rows for the given SKUs. Returns {sku: [rows]}."""
    if not skus or not supabase_url:
        return {}
    out: dict[str, list[dict]] = defaultdict(list)
    CHUNK = 100
    for i in range(0, len(skus), CHUNK):
        batch = skus[i : i + CHUNK]
        ids = ",".join(f'"{s}"' for s in batch)
        params = {"sku": f"in.({ids})", "select": "sku,critic,score,score_max,vintage,tasting_year"}
        qs = urllib.parse.urlencode(params, safe='",()')
        url = f"{supabase_url.rstrip('/')}/rest/v1/critic_scores?{qs}"
        req = urllib.request.Request(url, headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"WARN: critic_scores fetch failed: {e}", file=sys.stderr)
            return {}
        for r in rows:
            out[r["sku"]].append(r)
    return dict(out)


def select_skus(
    products: list[dict], priority: str, tier: list[int] | None, limit: int, sku_filter: list[str] | None
) -> list[dict]:
    WINE_CLS = {"Red Wine", "White Wine", "Rose Wine", "Sparkling Wine", "Dessert Wine"}
    wines = [p for p in products if p.get("classification") in WINE_CLS]
    if sku_filter:
        sf = set(sku_filter)
        return [p for p in wines if p.get("sku") in sf][:limit]

    # Tier filter (S1 ≥10 wines/brand, S2 = 3-9)
    if tier:
        from collections import Counter
        brand_counts = Counter(p.get("brand", "") for p in wines)
        s1 = {b for b, n in brand_counts.items() if n >= 10}
        s2 = {b for b, n in brand_counts.items() if 3 <= n <= 9}
        allow = set()
        if 1 in tier: allow |= s1
        if 2 in tier: allow |= s2
        wines = [p for p in wines if p.get("brand", "") in allow]

    if priority == "popularity":
        wines.sort(key=lambda p: -(float(p.get("popularity_score") or 0)))
    return wines[:limit]


def compute_score_aggregates(scores: list[dict]) -> tuple[float | None, str]:
    """Compute (score_max, score_summary 'JS 95 · WA 92 · WS 90')."""
    if not scores:
        return None, ""
    # Normalize all to /100 for max
    normalized = []
    raw_pairs = []
    for s in scores:
        score = float(s.get("score") or 0)
        sm = float(s.get("score_max") or 100)
        critic = str(s.get("critic", ""))
        normalized.append(score * 100 / sm if sm > 0 else 0)
        raw_pairs.append((critic, score))
    score_max = max(normalized) if normalized else None
    # Summary uses critic abbreviations
    abbrev = {
        "James Suckling": "JS", "Wine Advocate": "WA", "Wine Spectator": "WS",
        "Decanter": "DEC", "Jancis Robinson": "JR", "Vinous": "VIN",
        "Wine Enthusiast": "WE", "Burghound": "BH",
    }
    parts = [f"{abbrev.get(c, c[:3].upper())} {int(s) if s == int(s) else s}" for c, s in raw_pairs[:4]]
    return round(score_max, 1) if score_max is not None else None, " · ".join(parts)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Wine enrichment pipeline.")
    p.add_argument("--priority", choices=["popularity", "all"], default="popularity")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--tier", type=int, action="append", choices=[1, 2])
    p.add_argument("--write-threshold", type=float, default=0.85)
    p.add_argument("--model", default="claude-haiku-4-5-20251001")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--no-supabase", action="store_true")
    p.add_argument("--sku", action="append", dest="skus")
    p.add_argument("--csv-output", type=Path)
    p.add_argument("--products-file", type=Path, default=DEFAULT_PRODUCTS_FILE)
    p.add_argument("--skus-file", type=Path,
                   help="Override products source: load fixture JSON file with SKU records.")
    p.add_argument("--winesensed-file", type=Path, default=DEFAULT_WINESENSED_FILE)
    p.add_argument("--brand-library-file", type=Path, default=DEFAULT_BRAND_LIBRARY_FILE)
    args = p.parse_args(argv)

    # Env
    env = load_env(REPO_ROOT / ".env.local")
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    supabase_key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    anthropic_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    # Load product source — either products.json or a fixture
    source_path = args.skus_file or args.products_file
    if not source_path.exists():
        print(f"ERROR: products source not found: {source_path}", file=sys.stderr)
        return 1
    products = json.loads(source_path.read_text())
    if isinstance(products, dict):
        products = products.get("records", [])

    # Select SKUs
    selected = select_skus(products, args.priority, args.tier, args.limit, args.skus)
    if not selected:
        print("No SKUs to process.")
        return 0
    print(f"Selected {len(selected)} SKUs for processing.")

    # Load grounding sources
    winesensed_records = []
    if args.winesensed_file.exists():
        winesensed_records = json.loads(args.winesensed_file.read_text())
    brand_library = []
    if args.brand_library_file.exists():
        with args.brand_library_file.open() as f:
            brand_library = list(csv.DictReader(f))

    # Fetch critic_scores from Supabase for selected SKUs (skip if --no-supabase)
    critic_scores_by_sku: dict[str, list[dict]] = {}
    if not args.no_supabase and supabase_url and supabase_key:
        critic_scores_by_sku = fetch_critic_scores(
            supabase_url, supabase_key, [s["sku"] for s in selected]
        )

    # Build collectors
    collector = ev.EvidenceCollector(
        winesensed_records=winesensed_records,
        brand_library=brand_library,
        critic_scores_by_sku=critic_scores_by_sku,
    )
    food_tax = food_pairing.load_default()
    cache_client = None
    if not args.no_supabase and supabase_url and supabase_key and not args.no_cache:
        cache_client = CacheClient(supabase_url=supabase_url, api_key=supabase_key)

    haiku = None
    if not args.dry_run:
        if not anthropic_key:
            print("ERROR: ANTHROPIC_API_KEY missing.", file=sys.stderr)
            return 1
        haiku = AnthropicClient(api_key=anthropic_key, model=args.model)

    # Open CSV
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    csv_path = args.csv_output or (DEFAULT_EXPORTS_DIR / f"wine-enrichment-{timestamp}.csv")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_file = csv_path.open("w", encoding="utf-8-sig", newline="\r\n")
    csv_writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS, quoting=csv.QUOTE_ALL)
    csv_writer.writeheader()

    router = OutputRouter(
        supabase_url=supabase_url, api_key=supabase_key,
        csv_writer=csv_writer, write_threshold=args.write_threshold,
    )

    # Loop
    stats = {"cache_hits": 0, "api_calls": 0, "supabase_writes": 0, "csv_only": 0, "validation_failures": 0, "by_tier": {"A": 0, "B": 0, "C": 0}}
    total_cost_thb = 0.0
    for i, sku_row in enumerate(selected, start=1):
        sku = sku_row["sku"]
        evidence = collector.collect_evidence(sku, sku_row)
        stats["by_tier"][evidence.quality_tier] += 1
        system, user, prompt_hash = pr.build_prompt(evidence, food_tax)

        cached = None
        if cache_client:
            try:
                cached = cache_client.lookup(sku=sku, prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash)
            except Exception as e:
                print(f"WARN: cache lookup failed for {sku}: {e}", file=sys.stderr)

        if cached:
            response = cached["response_json"]
            validation_status = cached.get("validation_status", "passed")
            stats["cache_hits"] += 1
            cache_id = cached["id"]
            cost_thb = 0.0
        else:
            if args.dry_run:
                print(f"[{i}/{len(selected)}] {sku}  tier={evidence.quality_tier}  [dry-run] would call Haiku (~{len(user.split())*1.3:.0f} tokens user)")
                continue
            gen = haiku.generate(system=system, user=user, max_tokens=1500, temperature=0.1)
            stats["api_calls"] += 1
            total_cost_thb += gen.cost_thb
            cost_thb = gen.cost_thb
            # Parse JSON
            try:
                # Best-effort: extract first {...} block
                raw = gen.text
                start = raw.find("{")
                end = raw.rfind("}")
                response = json.loads(raw[start : end + 1])
            except Exception as e:
                print(f"[{i}/{len(selected)}] {sku}  PARSE FAIL: {e}", file=sys.stderr)
                stats["validation_failures"] += 1
                continue
            # Validate
            result = val.validate(response, evidence, food_tax)
            if result.outcome == "rejected" and result.can_retry:
                # Single retry with correction
                correction = f"\n\n[Correction required — your previous response had these issues: {result.issues}. Please regenerate following the schema exactly.]"
                gen2 = haiku.generate(system=system, user=user + correction, max_tokens=1500, temperature=0.1)
                total_cost_thb += gen2.cost_thb
                cost_thb += gen2.cost_thb
                stats["api_calls"] += 1
                try:
                    raw2 = gen2.text
                    response = json.loads(raw2[raw2.find("{") : raw2.rfind("}") + 1])
                    result = val.validate(response, evidence, food_tax)
                    if result.outcome == "rejected":
                        validation_status = "failed"
                    else:
                        validation_status = "failed_then_retried"
                except Exception:
                    stats["validation_failures"] += 1
                    continue
            elif result.outcome == "rejected":
                stats["validation_failures"] += 1
                continue
            else:
                validation_status = result.outcome  # passed | repaired
            response = result.repaired_json
            # Write cache
            if cache_client:
                try:
                    cache_id = cache_client.write(
                        sku=sku, category="wine",
                        prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                        prompt_text=user, response_json=response,
                        response_raw=gen.text, model=gen.model,
                        tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
                        cost_thb=cost_thb,
                        confidence=float(response.get("confidence", 0)),
                        validation_status=validation_status,
                        validation_issues=result.issues,
                    )
                except Exception as e:
                    print(f"WARN: cache write failed for {sku}: {e}", file=sys.stderr)
                    cache_id = ""
            else:
                cache_id = ""

        # Score
        ai_conf = float(response.get("confidence", 0))
        final_conf = sc.final_confidence(ai_conf, evidence.quality_tier, validation_status if cached else (validation_status if "validation_status" in locals() else "passed"))

        # Score aggregates
        score_max, score_summary = compute_score_aggregates(critic_scores_by_sku.get(sku, []))

        # Route (CSV + maybe Supabase)
        if not args.no_write:
            try:
                wrote = router.route(
                    sku=sku, products_id=sku_row.get("id", ""),
                    response=response, final_confidence=final_conf,
                    tier=evidence.quality_tier, cache_id=cache_id,
                    current_values=sku_row, enrichment_note=f"Haiku/{evidence.quality_tier}",
                    model=args.model, enriched_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                    score_max=score_max, score_summary=score_summary,
                )
                if wrote:
                    stats["supabase_writes"] += 1
                else:
                    stats["csv_only"] += 1
            except Exception as e:
                print(f"WARN: route failed for {sku}: {e}", file=sys.stderr)

        decision = "DIRECT WRITE" if final_conf >= args.write_threshold else "CSV ONLY"
        print(f"[{i}/{len(selected)}] {sku}  tier={evidence.quality_tier}  ai_conf={ai_conf:.2f}  final={final_conf:.2f}  → {decision}  (THB {cost_thb:.4f})")

    csv_file.close()

    # Summary
    print()
    print("───── Run summary ─────")
    print(f"SKUs processed:           {len(selected)}")
    print(f"  Cache hits:             {stats['cache_hits']}")
    print(f"  API calls:              {stats['api_calls']}")
    print(f"  Supabase direct writes: {stats['supabase_writes']}")
    print(f"  CSV-only:               {stats['csv_only']}")
    print(f"  Validation failures:    {stats['validation_failures']}")
    print(f"Cost (this run):          THB {total_cost_thb:.2f}")
    print(f"By evidence tier:         A: {stats['by_tier']['A']}  B: {stats['by_tier']['B']}  C: {stats['by_tier']['C']}")
    print(f"\n  ✓ {csv_path.name}: {len(selected)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the integration test**

```bash
.venv/bin/pytest tests/test_enrich_wines.py -v
```

Expected: passes.

- [ ] **Step 5: Also run the full unit suite to confirm nothing regressed**

```bash
.venv/bin/pytest tests/test_wine_enrichment_*.py tests/test_enrich_wines.py -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add data/enrich_wines.py tests/test_enrich_wines.py
git commit -m "feat(wine_enrichment): CLI driver + integration test"
```

---

## Task 14: Add exports directory to gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add to .gitignore**

Append:
```
# Wine enrichment per-run CSV exports
data/exports/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore data/exports/ (per-run CSV outputs)"
```

---

## Task 15: Manual pilot run + smoke check

**Files:** none (verification only).

- [ ] **Step 1: Dry-run on top 5 by popularity**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python3 data/enrich_wines.py --limit 5 --priority popularity --dry-run
```

Expected:
- Prints "Selected 5 SKUs"
- One `[dry-run] would call Haiku` line per SKU
- No API spend, no Supabase writes.

- [ ] **Step 2: Real pilot run on top 50**

```bash
.venv/bin/python3 data/enrich_wines.py --limit 50 --priority popularity
```

Expected:
- Prints one line per SKU showing tier, confidence, routing decision
- Run summary at end with cost (target ≤ THB 10 total ≈ $0.30 USD)
- Both `data/exports/wine-enrichment-*.csv` written and Supabase products + enrichment_cache rows updated.

- [ ] **Step 3: Spot-check 5 outputs**

```bash
.venv/bin/python3 -c "
import csv, sys
from pathlib import Path
csv_files = sorted(Path('data/exports').glob('wine-enrichment-*.csv'))
if not csv_files: sys.exit('No CSV found')
latest = csv_files[-1]
rows = list(csv.DictReader(open(latest, encoding='utf-8-sig')))
print(f'CSV: {latest.name}  ({len(rows)} rows)')
for r in rows[:5]:
    print(f'  {r[\"sku\"]}  conf={r[\"confidence\"]}  tier={r[\"confidence_tier\"]}  body={r[\"wine_body\"]}  food={r[\"food_matching\"][:50]}')
"
```

Expected: 5 rows printed with plausible body/food/conf values.

- [ ] **Step 4: Confirm enrichment_cache populated**

```bash
SUPABASE_URL=$(grep "^NEXT_PUBLIC_SUPABASE_URL" .env.local | cut -d'=' -f2 | tr -d "'\"")
SUPABASE_KEY=$(grep "^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" .env.local | cut -d'=' -f2 | tr -d "'\"")
curl -s "$SUPABASE_URL/rest/v1/enrichment_cache?limit=3&select=sku,model,tokens_in,tokens_out,cost_thb,confidence,validation_status&order=created_at.desc" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" | python3 -m json.tool
```

Expected: 3 most recent rows.

- [ ] **Step 5: Re-run to confirm cache hits**

```bash
.venv/bin/python3 data/enrich_wines.py --limit 50 --priority popularity
```

Expected: Run summary shows `Cache hits: 50`, `API calls: 0`, `Cost: THB 0.00`.

- [ ] **Step 6:** No commit needed; this task is verification.

---

## Task 16: Frontend & doc updates

**Files:**
- Modify: `app/api/explore/products/route.ts`
- Modify: `PRODUCT_DATA_API.md`

- [ ] **Step 1: Extend explore SELECT_FIELDS**

In `app/api/explore/products/route.ts`, add to the `SELECT_FIELDS` array (alongside `flavor_tags`, `food_matching`, etc.):

```typescript
  "grape_blend_type",
  "wine_production_style",
  "score_max",
  "score_summary",
  "desc_en_short",
```

- [ ] **Step 2: Verify dev server still serves explore API**

```bash
# In a separate terminal if not already running:
.venv/bin/python3 -c "print('keep this terminal free for npm run dev')"
# Or start: npm run dev
# Then:
curl -s "http://localhost:3000/api/explore/products?country=Australia&region=Barossa%20Valley&page=1&limit=3" | python3 -m json.tool | head -30
```

Expected: JSON returns including the new fields when populated.

- [ ] **Step 3: Update PRODUCT_DATA_API.md**

Append to the Field Ownership Matrix:

```markdown
| `grape_blend_type`, `wine_production_style`, `desc_en_short`, `full_description`, `flavor_tags`, `food_matching`, `wine_body`, `wine_acidity`, `wine_tannin`, `score_max`, `score_summary`, `enrichment_confidence`, `enrichment_source`, `enrichment_note`, `enriched_at`, `enriched_by` | **PIM** (wine enrichment pipeline) | `data/enrich_wines.py` (see docs/superpowers/specs/2026-05-12-wine-enrichment-design.md) |
```

And add a brief section explaining the wine pipeline + CSV export workflow (link to spec for full detail).

- [ ] **Step 4: Commit**

```bash
git add app/api/explore/products/route.ts PRODUCT_DATA_API.md
git commit -m "feat(explore): expose grape_blend_type/production_style/score_max + doc wine pipeline"
```

---

## Final verification

- [ ] **Step 1: Run full test suite**

```bash
.venv/bin/pytest tests/test_wine_enrichment_*.py tests/test_enrich_wines.py -v
```

Expected: all tests pass (~40-50 test cases total).

- [ ] **Step 2: Confirm clean git state**

```bash
git status
```

Expected: clean working tree (all wine-enrichment changes committed).

---

## Notes for the executing engineer

1. **TDD discipline** — every code task starts with a failing test. Don't skip.
2. **One subagent per task** — paste the full task text to each subagent.
3. **Supabase migration is manual** (Task 2 Step 2) — paste the SQL into Supabase Dashboard. The user has done this pattern before (popularity columns migration in May 2026).
4. **Anthropic API costs ~$0.25 for the 50-SKU pilot** (Task 15 Step 2). Don't run the full 5,000 SKU batch in this implementation — leave that for the human after they review pilot output.
5. **Cache is idempotent** — re-runs are free. Task 15 Step 5 confirms this works.
6. **Spec is the source of truth** — `docs/superpowers/specs/2026-05-12-wine-enrichment-design.md`. If any task description disagrees with the spec, the spec wins. Flag the discrepancy.
