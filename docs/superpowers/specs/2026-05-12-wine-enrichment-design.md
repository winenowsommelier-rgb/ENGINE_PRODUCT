# Wine Enrichment Pipeline — Design Spec

**Date:** 2026-05-12
**Status:** Approved, pending implementation plan
**Owner:** WNLQ9 / Engine Product team
**Source of truth for:** AI-driven wine sensory matrix + description + grape + food pairing enrichment with caching and review-gated writes.

---

## 1. Goal

Build an AI-driven enrichment pipeline that, for every wine SKU:

1. Gathers grounding evidence (Winesensed research data + curated brand library + grape/region heuristics).
2. Calls Anthropic Claude Haiku 4.5 with a structured prompt and a controlled vocabulary.
3. Validates the JSON response against strict schemas (body/acidity/tannin enums, grape blend type, food-pairing taxonomy).
4. Computes a final confidence score from three signals (AI self-assessment × evidence-tier × validator outcome).
5. Caches the full call (prompt + response + cost) in Supabase so re-runs cost ~$0.
6. Routes high-confidence outputs (≥0.85) directly to the `products` table; low-confidence outputs to a staged `enrichment_proposals` table for human review.

The pipeline replaces the current manually-copied, unvalidated product matrix data with consistent, evidence-grounded, AI-generated content backed by full audit trail.

## 2. Scope

**In scope (this spec — Wine category v1):**
- 8 enriched fields per wine SKU:
  - `wine_body`, `wine_acidity`, `wine_tannin` (4-value enums)
  - `grape_variety` (normalized multiselect, names with optional percentages)
  - `grape_blend_type` (7-value select)
  - `wine_production_style` (7-value multiselect)
  - `flavor_tags` (5–10 items)
  - `food_matching` (3–6 items from `food-pairing-taxonomy.json`)
  - `desc_en_short` (≤160 chars)
  - `full_description` (200–1200 chars, simple HTML)
- Two new Supabase tables: `enrichment_cache`, `enrichment_proposals`.
- Three new product columns: `grape_blend_type`, `wine_production_style`, plus `enrichment_confidence`/`enriched_at`/`enriched_by` audit fields.
- One curated food-pairing taxonomy file (`data/db/food-pairing-taxonomy.json`).
- Batch CLI driver (`data/enrich_wines.py`) with `--dry-run`, `--limit`, `--priority`, `--tier`, `--write-threshold`, `--no-cache`, `--no-write`, `--sku` flags.
- Per-category Python library structure (`data/lib/enrichment/wine/` + shared `data/lib/enrichment/shared/`) to anticipate spirits/beer/sake categories later.
- Unit + integration tests; pilot run of 50 SKUs (~$0.25) before any scale-up.

**Out of scope (future phases):**
- Spirits, beer, sake enrichment (separate spec per category; shared lib re-used).
- TypeScript admin UI for reviewing staged proposals (manual SQL `UPDATE enrichment_proposals SET status='approved' WHERE …` for v1).
- API endpoint `/api/products/{id}/enrich` for one-off re-runs from a future admin button (Phase 2).
- Multi-provider abstraction (OpenAI, Gemini). Haiku 4.5 only for v1.
- Image generation or label scanning.
- Wine production-style enrichment via label data; v1 infers from brand/producer context only.

## 3. Decisions recorded

Locked during brainstorming (2026-05-11 → 2026-05-12).

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Matrix scope | Wine sensory matrix only (Option A) + category-by-category architecture | Wines are 60% of catalog; matrix vocabulary is mature. Architecture supports future spirits/beer. |
| Q2 | Output routing | Hybrid confidence-gated (Option C): ≥0.85 → direct write; <0.85 → staged for review | Fast wins on confident cases; human eyes on uncertain cases. |
| Q3 | Trigger model | Batch script (Option A) first; API endpoint (Option D) Phase 2 | Matches existing enrichment pipeline pattern; admin UI doesn't yet exist. |
| Q4 | Evidence cache | Supabase `enrichment_cache` table (Option C) | Fast indexed lookup; no git bloat; queryable for cost auditing. |
| Q5 | SKU prioritization | Top sellers by `popularity_score` (Option A); 50-SKU pilot first | Highest customer-visible ROI; popularity data already exists. |
| Q6 | Model + cost | Claude Haiku 4.5 for all 7,103 wines (~$64 full catalog, ~$26 S1+S2, ~$0.25 pilot) | User chose Haiku for cost; grounding compensates for model tier. |
| Q7 | Grounding sources | Winesensed + brand library + taxonomy heuristics (Option B) | Best balance of grounding density vs prompt cost. |
| Q8 | Grape-style structure | A + B: `grape_blend_type` (select) AND `wine_production_style` (multiselect) | Two orthogonal axes; both useful Magento facets. |

## 4. Architecture

### 4.1 File structure (new)

```
data/lib/enrichment/
├── __init__.py
├── shared/
│   ├── __init__.py
│   ├── client.py            # Anthropic SDK wrapper (retries, cost calc)
│   ├── cache.py             # Supabase enrichment_cache R/W
│   └── taxonomies/
│       ├── __init__.py
│       └── food_pairing.py  # loads data/db/food-pairing-taxonomy.json
└── wine/
    ├── __init__.py
    ├── evidence.py          # Per-SKU evidence collector
    ├── prompt.py            # Prompt builder + JSON output schema
    ├── validator.py         # Schema + controlled-vocab validation
    ├── scoring.py           # Final confidence formula
    ├── proposals.py         # Direct-write vs staged routing
    └── taxonomies.py        # Blend types, production styles, body/acidity/tannin enums

data/enrich_wines.py         # CLI driver (~80 lines)

data/db/food-pairing-taxonomy.json    # ~40 curated food categories

data/migrations/2026-05-12_wine_enrichment.sql
                                      # Migration: 3 new product columns + 2 new tables

tests/test_wine_enrichment_evidence.py
tests/test_wine_enrichment_prompt.py
tests/test_wine_enrichment_validator.py
tests/test_wine_enrichment_scoring.py
tests/test_wine_enrichment_cache.py
tests/test_wine_enrichment_proposals.py
tests/test_enrich_wines.py
tests/fixtures/wine_pilot_skus.json   # 5-SKU offline fixture
```

### 4.2 File structure (modified)

- `app/api/explore/products/route.ts` — extend `SELECT_FIELDS` to include `grape_blend_type`, `wine_production_style`.
- `PRODUCT_DATA_API.md` — document the new fields + pipeline + manual-review workflow.

### 4.3 Approach

Pure Python batch pipeline with a thin CLI driver. Lib modules are pure functions (no I/O at the module level), driver does all I/O and orchestration. Matches the existing `build_product_images.py` + `data/lib/product_naming.py` pattern. Subagent-driven TDD during implementation: each lib module is a self-contained task.

## 5. Output schema

### 5.1 Haiku JSON contract (one response per SKU)

```json
{
  "wine_body":            "Medium-Full",
  "wine_acidity":         "Medium",
  "wine_tannin":          "Medium-High",
  "grape_variety":        ["Cabernet Sauvignon", "Merlot", "Petit Verdot"],
  "grape_blend_type":     "Bordeaux Blend",
  "wine_production_style": ["Conventional"],
  "flavor_tags":          ["Blackcurrant", "Cedar", "Tobacco", "Dark Cherry", "Vanilla"],
  "food_matching":        ["Grilled red meat", "Aged hard cheese", "Dark chocolate"],
  "desc_en_short":        "Iconic Napa Cabernet from Robert Mondavi — bold structure, classic Bordeaux varietals, age-worthy elegance.",
  "full_description":     "<p>...</p>",
  "confidence":           0.92,
  "confidence_notes":     "Strong Winesensed grounding (4 records), Tier-1 brand match.",
  "citations": {
    "winesensed_record_ids": ["winesensed-1469676-..."],
    "brand_library_match":   "Robert Mondavi (S1)",
    "grape_source":          "products.grape_variety"
  }
}
```

### 5.2 Controlled vocabularies

| Field | Allowed values |
|---|---|
| `wine_body` | Light · Medium · Medium-Full · Full |
| `wine_acidity` | Low · Medium · Medium-High · High |
| `wine_tannin` | Low · Medium · Medium-High · High |
| `grape_blend_type` | Single Varietal · Bordeaux Blend · Rhône Blend (GSM) · Champagne Blend · Field Blend · Proprietary Blend · Unknown Blend |
| `wine_production_style` | Conventional · Natural · Biodynamic · Organic · Orange · Pet-Nat · Vegan |
| `food_matching` items | 40 entries — see §10 (food pairing taxonomy) |

### 5.3 New `products` columns

| Column | Type | Notes |
|---|---|---|
| `grape_blend_type` | text | Select. Indexed for Magento facet. |
| `wine_production_style` | text[] | Multiselect. GIN-indexed. |
| `enrichment_confidence` | numeric(4,3) | Last enrichment confidence. |
| `enrichment_source` | text | Provenance: `'ai_high_conf'`, `'ai_proposal_approved'`, etc. |
| `enrichment_note` | text | Compact summary stamped on direct write (model + tier + evidence brief). |
| `enriched_at` | timestamptz | Last enrichment timestamp. |
| `enriched_by` | text | Model id (e.g. `claude-haiku-4-5-20251001`). |

`desc_en_short`, `enrichment_source`, and `enrichment_note` may already exist on `products` — migration is idempotent (`ADD COLUMN IF NOT EXISTS`).

### 5.4 New `enrichment_cache` table

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | |
| `sku` | text | Loosely FK → products.sku. |
| `category` | text | `'wine'` (extensible). |
| `prompt_hash` | text | sha256 of prompt template (catches template drift). |
| `evidence_hash` | text | sha256 of evidence content (catches evidence drift). |
| `prompt_text` | text | Full prompt sent. |
| `response_json` | jsonb | Parsed Haiku JSON. |
| `response_raw` | text | Verbatim text response. |
| `model` | text | e.g. `claude-haiku-4-5-20251001`. |
| `tokens_in` | integer | |
| `tokens_out` | integer | |
| `cost_thb` | numeric(10,4) | |
| `confidence` | numeric(4,3) | Final confidence after scoring (§7). |
| `validation_status` | text | `passed` / `repaired` / `failed_then_retried` / `failed`. |
| `validation_issues` | jsonb | Array of repair/issue notes. |
| `created_at` | timestamptz default now() | |
| `superseded_at` | timestamptz | Non-null when newer row replaces this one. |

**Indexes:**
- `UNIQUE (sku, prompt_hash, evidence_hash) WHERE superseded_at IS NULL` — cache-hit lookup AND enforces at-most-one active row per (sku, prompt, evidence) at the DB level. Supersede must run inside the same transaction as a new insert.
- `(created_at)` — daily activity queries.

### 5.5 New `enrichment_proposals` table

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | |
| `sku` | text | |
| `category` | text | `'wine'`. |
| `field_name` | text | `wine_body`, `flavor_tags`, etc. |
| `proposed_value` | jsonb | What the AI suggests. |
| `current_value` | jsonb | Current value (for diff UI). |
| `confidence` | numeric(4,3) | Inherited from cache row. |
| `cache_id` | uuid FK → enrichment_cache(id) | Audit trail. |
| `status` | text | `pending` / `approved` / `rejected` / `superseded`. |
| `reviewer` | text | Null until reviewed. |
| `reviewed_at` | timestamptz | |
| `created_at` | timestamptz default now() | |

**Index:** `(status) WHERE status = 'pending'` — drives the future review UI.

One AI call produces multiple proposal rows (one per field). Fine-grained acceptance: reviewer can approve `wine_body` while rejecting `food_matching`.

### 5.6 Magento attribute mapping

For Magento sync:

| Supabase column | Magento attribute code | Type | Options source |
|---|---|---|---|
| `grape_variety` | `wine_grape_variety` | multiselect | Dynamic from distinct catalog values. |
| `grape_blend_type` | `wine_grape_blend_type` | select | Static (7 options from §5.2). |
| `wine_production_style` | `wine_production_style` | multiselect | Static (7 options from §5.2). |
| `wine_body` | `wine_body` | select | Static (4 options). |
| `wine_acidity` | `wine_acidity` | select | Static (4 options). |
| `wine_tannin` | `wine_tannin` | select | Static (4 options). |
| `flavor_tags` | `wine_flavor_tags` | multiselect | Dynamic (top-N curated from catalog). |
| `food_matching` | `wine_food_pairing` | multiselect | Static from `food-pairing-taxonomy.json`. |

## 6. Evidence collection

`data/lib/enrichment/wine/evidence.py`. Pure function: `collect_evidence(sku, products_row) → Evidence`.

### 6.1 Sources

1. **Product facts** — `name, brand, vintage, country, region, subregion, classification, grape_variety_raw, price, alcohol, bottle_size` from `data/db/products.json` (or live Supabase row).
2. **Winesensed records** — `data/db/external-winesensed-records.json` (5,000 records, mostly Italian wines; CC BY-NC-ND research license used for *grounding only*, never copied verbatim into customer-facing fields).
3. **Brand description library** — `data/brand_description_library.csv` with `description_short_en`, `description_full_en`, and tier S1/S2/S3.
4. **Taxonomy heuristics** — typical grape+region profiles encoded in `taxonomies.py` (~40 common combos: Barossa Shiraz, Burgundy Pinot Noir, Napa Cab, etc., plus grape-only and classification-only fallbacks).

### 6.2 Winesensed matching algorithm

`find_winesensed_matches(grape, region, country, limit=5) → list[WinesensedMatch]`:

1. **Tight match (primary)** — records where `normalized_grape == grape.lower() AND normalized_region == region.lower()`. Rank by `rating DESC`.
2. **Loose match (fallback if <2 tight)** — records where `normalized_grape == grape.lower()` (any region). Rank by `rating DESC`, deduped against tight matches.
3. **Country fallback (only if 0 grape matches)** — records where `normalized_country == country.lower() AND normalized_region == region.lower()`. Rank by `rating DESC`.

Each match contains `record_id, year, region, grape, rating, review_text (first 300 chars), match_type`.

### 6.3 Evidence quality tier

| Tier | Trigger | Multiplier (§7) |
|---|---|---|
| **A — gold** | ≥2 tight Winesensed matches, OR (≥1 tight + brand-library Tier-1) | 1.00 |
| **B — silver** | ≥1 Winesensed match (any type), OR brand library entry (any tier) | 0.90 |
| **C — bronze** | Heuristics only | 0.75 |

### 6.4 Evidence hash

`evidence_hash = sha256(json.dumps({facts, winesensed_record_ids, brand_match, heuristic_profile}, sort_keys=True))`. Used in §8 to detect cache validity.

## 7. Prompt + Haiku + validation

### 7.1 Prompt structure

**System prompt (~250 tokens, cached via Anthropic prompt-cache `cache_control`):**

- Role definition: expert sommelier, third-party voice, JSON-only output.
- Controlled vocabulary block (body/acidity/tannin/blend-type/production-style enums).
- Food-pairing taxonomy block (~400 tokens, also cached).

**User message (~1,200 tokens per SKU):**

- `# Product facts` — SKU, name, brand, geography, classification, grape, vintage, price.
- `# Evidence — Winesensed real-world tasting notes` — up to 5 matched records.
- `# Evidence — Brand library` — short + full curated brand description (if present).
- `# Evidence — Taxonomy heuristic` — typical profile string.
- `# Your task` — produce matrix JSON with citations; be honest about confidence.

### 7.2 Anthropic call

```python
client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=1500,
    system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": user_message}],
    temperature=0.3,
)
```

Retry policy: 3 attempts with exponential backoff (1s, 2s, 4s) on 429/5xx. Hard fail on 401/400.

### 7.3 Validator checks (in order)

1. **JSON parses.** Fallback: extract substring between first `{` and last `}`.
2. **Required fields present.**
3. **Controlled-vocab values.** Fuzzy repair table for common AI variants (e.g. `Medium-Heavy` → `Medium-Full`). Food tags fuzzy-matched (case-insensitive, Levenshtein ≤ 2) against taxonomy `label` values.
4. **Counts.** `flavor_tags` 5–10, `food_matching` 3–6.
5. **Lengths.** `desc_en_short` ≤ 160 chars; `full_description` 200–1200 chars.
6. **HTML safety.** Only `p, br, strong, em, ul, li` allowed in `full_description`; everything else stripped.
7. **Citation integrity.** Every cited `winesensed_record_id` must exist in `evidence.winesensed_matches`. Action on hallucinated ID: **strip** the bad ID from the `citations.winesensed_record_ids` array, mark validation outcome `repaired`, add a note to `validation_issues`. The rest of the response is still used (the hallucinated citation doesn't poison the matrix).
8. **Confidence range.** Must be in [0, 1].

### 7.4 Validation outcomes

| Outcome | Trigger | Action |
|---|---|---|
| `passed` | All checks pass cleanly | Proceed to cache + routing. |
| `repaired` | Minor issues fixed (vocab fuzzy match, HTML clean-up) | Proceed; log repairs. Multiplier 0.95 in §8. |
| `failed_then_retried` | Required one re-prompt with correction instructions | Proceed if retry passed. Multiplier 0.85. |
| `failed` | Re-prompt also failed | Skip SKU; cache row written with `validation_status='failed'` for audit. |

### 7.5 Cost per SKU (Haiku 4.5)

| Component | Tokens | Rate | Cost |
|---|---|---|---|
| Cached input (system + food taxonomy) | ~650 | $0.10/1M | ~$0.00007 |
| Fresh input (evidence + facts) | ~1,200 | $1/1M | $0.0012 |
| Output (JSON) | ~600 | $5/1M | $0.003 |
| **Baseline** | | | **~$0.0042** |
| Re-prompt overhead (10% of calls) | | | +$0.0008 avg |
| **Realistic** | | | **~$0.005** |

## 8. Cache + proposals routing

### 8.1 Cache flow per SKU

```
collect_evidence(sku) → Evidence (with evidence_hash)
                 │
                 ▼
   cache.lookup(sku, prompt_hash, evidence_hash) → cached_row | None
                 │
        ┌────────┴────────┐
        ▼                 ▼
     HIT (cached)       MISS
        │                 │
        │            client.generate → validator.validate
        │                 │
        │            cache.write (supersedes any prior active row)
        │                 │
        └────────┬────────┘
                 ▼
         response_json available
                 │
                 ▼
         scoring.combine → final_confidence
                 │
                 ▼
         proposals.route (direct write vs staged)
```

### 8.2 Cache supersede

Before inserting a new row for an SKU, mark the previous active row's `superseded_at = now()`. Append-only history; never delete.

### 8.3 Proposals routing

```python
def route(sku, response_json, final_confidence, cache_id, threshold=0.85):
    if final_confidence >= threshold:
        write_to_products(sku, fields_from_response(response_json),
                          enrichment_source='ai_high_conf',
                          enrichment_confidence=final_confidence,
                          enriched_by=model_id,
                          enriched_at=now())
    else:
        for field, proposed in fields_from_response(response_json).items():
            current = read_products_field(sku, field)
            insert_proposal(sku, field, proposed, current,
                           final_confidence, cache_id)
```

Approving a proposal triggers the same `write_to_products` path.

### 8.4 Idempotence

- Re-running on the same SKU with unchanged evidence → cache hit → zero new API spend → no new proposals.
- Running with `--no-cache` → fresh API call → new cache row supersedes old.
- Bumping prompt template version → `prompt_hash` changes → every cache row becomes stale → next run re-prompts.

## 9. Confidence scoring + direct-write threshold

`data/lib/enrichment/wine/scoring.py`.

### 9.1 Formula

```
final_confidence = ai_confidence × tier_multiplier × validator_multiplier
```

| Signal | Source | Values |
|---|---|---|
| AI confidence | `response_json.confidence` | base (0–1) |
| Evidence tier | from §6.3 | A=1.00 · B=0.90 · C=0.75 |
| Validator outcome | from §7.4 | passed=1.00 · repaired=0.95 · failed_then_retried=0.85 |

### 9.2 Direct-write threshold

**Default 0.85.** Configurable via `--write-threshold N` CLI flag.

- `final ≥ 0.85` → direct write to `products`.
- `final < 0.85` → staged in `enrichment_proposals`.

### 9.3 Audit fields stamped on direct write

- `enrichment_source` = `'ai_high_conf'`
- `enrichment_confidence` = `final`
- `enrichment_note` = compact summary (e.g. `"Haiku 4.5 / tier A / 4 winesensed records / Mondavi brand"`)
- `enriched_at`, `enriched_by`

### 9.4 Per-field threshold flexibility

v1 ships with a single threshold. If pilot shows uneven quality, a per-field threshold dict can be added to `taxonomies.py` (e.g. `desc_en_short`: 0.75, `grape_blend_type`: 0.90) without changing the scoring engine.

## 10. Food pairing taxonomy

`data/db/food-pairing-taxonomy.json` — 40 curated categories in 10 groups. AI MUST select from this list.

### 10.1 Schema

```json
{
  "version": "1.0.0",
  "last_updated": "2026-05-12",
  "categories": [
    {
      "id": "grilled_red_meat",
      "label": "Grilled red meat",
      "group": "Red Meat",
      "wine_style_hint": ["Full red", "Medium-Full red"],
      "examples": "steak, ribeye, T-bone, beef short ribs"
    }
  ]
}
```

### 10.2 Categories (40 entries in 10 groups)

| Group | Categories |
|---|---|
| **Red Meat** (5) | Grilled red meat · Lamb dishes · Game meats · Beef stew & braised · Charcuterie & cured meats |
| **Poultry & Pork** (3) | Roast chicken · Duck (breast/confit) · Pork dishes |
| **Seafood** (5) | Grilled fish · Oily fish (salmon, tuna) · Shellfish (lobster, crab, prawn) · Oysters & raw seafood · Sushi & sashimi |
| **Pasta & Risotto** (3) | Tomato-based pasta · Cream-based pasta & risotto · Pesto & oil-based pasta |
| **Cheese** (4) | Soft fresh cheese · Aged hard cheese · Blue cheese · Goat cheese |
| **Vegetables** (3) | Grilled vegetables · Leafy salads · Mushroom dishes |
| **Asian** (6) | Thai food (spicy & sour) · Chinese cuisine · Japanese cuisine · Korean BBQ · Indian curry · Vietnamese cuisine |
| **Other Dishes** (5) | Pizza & flatbreads · Mexican & Tex-Mex · Tapas & small plates · BBQ & smoky grills · Mediterranean cuisine |
| **Desserts** (3) | Dark chocolate · Fruit desserts · Creamy desserts & pastries |
| **Casual** (3) | Apéritif & hors d'oeuvres · Cocktail snacks · Easy weekday dinners |

### 10.3 Why this list

- Match how Thai/Asian premium-wine customers describe meals.
- Each category carries a `wine_style_hint` to bias AI selection appropriately (an off-dry Riesling pairs more naturally with `Thai food (spicy & sour)` than `Grilled red meat`).
- Examples ground the AI on what each category covers.
- 3–6 tag count per SKU enforces real recommendations vs lazy multi-listing.

## 11. CLI + observability

`data/enrich_wines.py` — ~80 lines.

### 11.1 Flags

```
--priority {popularity, brand_tier_s1, brand_tier_s2, all}  default: popularity
--limit N                                                    default: 50
--tier {1, 2}        # repeatable: `--tier 1 --tier 2` selects S1 ∪ S2 brands.
                     # argparse `action='append'`. Omit for no tier filter.
--write-threshold N                                          default: 0.85
--model MODEL                                                default: claude-haiku-4-5-20251001
--dry-run            # no API calls
--no-cache           # bypass enrichment_cache (force fresh)
--no-write           # call + validate + cache but no product/proposal writes
--sku SKU [--sku SKU ...]  # specific SKUs only
--review-staged      # print pending proposals (read-only)
```

### 11.2 Per-SKU stdout

```
[12/50] WRW0066AC  Robert Mondavi NV Cab Sauvignon
  tier=A  ai_conf=0.94  validator=passed  final=0.94  →  DIRECT WRITE  ($0.0048)
```

### 11.3 Run summary (printed every 10 SKUs and at end)

```
───── Run summary ─────
SKUs processed:           50
  Cache hits:             8
  API calls:              42
  Direct writes:          37
  Staged proposals:       11
  Validation failures:    2
Cost (this run):          $0.21
By evidence tier:         A: 32  B: 14  C: 4
Top staged SKUs:          WRW2106AC (0.71), WSP1140AE (0.68), ...

  ✓ enrichment_cache:        50 new rows written
  ✓ products:                37 rows updated
  ✓ enrichment_proposals:    11 rows inserted
```

## 12. Testing strategy

### 12.1 Unit tests (`tests/test_wine_enrichment_*.py`)

One per module, fully offline (mocks Anthropic SDK):

- `test_evidence.py` — Winesensed match selection, tier classification, evidence hash stability.
- `test_prompt.py` — Prompt builder injects all evidence; stable prompt hash.
- `test_validator.py` — Vocab repair (`Medium-Heavy` → `Medium-Full`), reject out-of-vocab food tags, reject hallucinated winesensed IDs, HTML sanitization.
- `test_scoring.py` — Multiplier math, threshold routing, edge cases.
- `test_cache.py` — Hit/miss/supersede behaviour (sqlite in-memory mock for Supabase).
- `test_proposals.py` — Direct-write vs staged routing, multi-field proposals from one response.

Each ~30–100 lines.

### 12.2 Integration test (`tests/test_enrich_wines.py`)

5-SKU fixture (`tests/fixtures/wine_pilot_skus.json` — Bordeaux Cru, Napa Cab, Aussie Shiraz, NZ Sauv Blanc, obscure Sicilian).

Runs driver with `--no-write` and a mocked Anthropic client returning canned JSON. Asserts cache rows written, validation outcomes, scoring math, proposal routing.

### 12.3 Manual pilot

```
python3 data/enrich_wines.py --limit 50 --priority popularity --dry-run   # confirm selection
python3 data/enrich_wines.py --limit 50 --priority popularity              # ~$0.25, ~5min
# → eyeball 10 random enrichment_cache.response_json rows
# → eyeball 5 enrichment_proposals rows
# → manually approve/reject 5 proposals via SQL
python3 data/enrich_wines.py --limit 500                                   # if pilot OK, ~$2.50
python3 data/enrich_wines.py --tier 1 --tier 2 --limit 5000                # full S1+S2 ~$26
```

### 12.4 Run order

```
pytest tests/test_wine_enrichment_*.py -v          # ~5s, must pass
pytest tests/test_enrich_wines.py -v               # ~5s
python3 data/enrich_wines.py --limit 50 --dry-run  # ~10s, free
python3 data/enrich_wines.py --limit 50            # ~5min, ~$0.25
                                                    # manual eyeball pass
python3 data/enrich_wines.py --priority popularity --limit 1000
python3 data/enrich_wines.py --tier 1 --tier 2 --limit 5000
```

## 13. Future work (tracked, not part of this spec)

1. **Spirits enrichment** — separate spec; reuses `data/lib/enrichment/shared/` + new `data/lib/enrichment/spirits/`.
2. **TypeScript admin UI** for reviewing staged proposals (`/admin/enrichment-review`).
3. **API endpoint** `/api/products/{id}/enrich` triggered from product admin page "Regenerate" button.
4. **Multi-provider fallback** — call GPT-4o-mini or Gemini Flash for cross-validation on low-confidence SKUs.
5. **Per-field thresholds** — if pilot shows uneven quality, per-field threshold config in `taxonomies.py`.
6. **Wine production-style enrichment via label data** — image-based label parsing for `Organic/Biodynamic/Natural` certifications.
7. **Food pairing taxonomy v2** — granular Asian subcuisines (Hot pot, Dim sum, Bistro classics) if pilot shows demand.
8. **Magento attribute auto-sync** — push the static option lists to Magento programmatically rather than manual admin import.

## 14. Open items deferred to plan

Pure implementation details, decided during writing-plans:

- Exact Python class names for evidence/prompt/validator/scoring/cache/proposals modules.
- Specific column types for jsonb fields (jsonb vs text[] for `flavor_tags`).
- Whether `desc_en_short` already exists on `products` (migration is idempotent regardless).
- Exact set of "common known combos" in `taxonomies.heuristic_for()` (initial ~40, expand from pilot).
- Anthropic SDK version pinning in `requirements.txt`.
