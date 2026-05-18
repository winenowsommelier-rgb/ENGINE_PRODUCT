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
6. **Writes high-confidence outputs (≥0.85) to the Supabase `products` table** (powering the live `/explore` site).
7. **Exports all outputs — every confidence tier — to a Magento-ready CSV** which the team reviews in spreadsheet form (edit / approve / drop rows) before manual upload to Magento. The CSV review IS the human-in-the-loop step; no separate proposal-review UI is built.

The pipeline replaces the current manually-copied, unvalidated product matrix data with consistent, evidence-grounded, AI-generated content backed by full audit trail.

**Success metric: better customer experience.** Validated, accurate data enables:

- **(a) Validated filter facets in Magento** — grape blend, body, food pairing, production style — so customers can find wines that match what they want.
- **(b) Higher-quality PDP descriptions** — short hooks + full descriptions written in a consistent expert sommelier voice.
- **(c) Richer recommendations on `/explore`** — body/tannin/food matrix unlock "wines like this" and "wines for this meal" suggestions.

**On the source of wine knowledge.** Claude Haiku 4.5's prior wine knowledge — encoded from its training data (producer websites, critic reviews, Vivino-style aggregations, wine blogs, academic texts) — is the **primary intelligence source** for matrix and description generation. The three explicit grounding sources (Winesense, brand library, taxonomy heuristics) serve to **anchor Claude to SKU-specific truth and prevent hallucination**, not to be the sole source of facts. This is why a ~5,000-record Italian-heavy Winesense dataset is sufficient as one of three anchors for a 6,375-wine catalog — it's a quality gate, not a coverage primary.

## 2. Scope

**In scope (this spec — Wine category v1):**

10 customer-facing output fields per wine SKU, plus `confidence` + `citations` metadata:

- `wine_body`, `wine_acidity`, `wine_tannin` (4-value enums)
- `grape_variety` (normalized multiselect, names with optional percentages)
- `grape_blend_type` (12-value select — see §5.2)
- `wine_production_style` (multiselect **tag-bag**; mixes farming/winemaking/dietary axes — see §5.2)
- `flavor_tags` (5–10 items)
- `food_matching` (3–6 items from `food-pairing-taxonomy.json`)
- `desc_en_short` (≤160 chars)
- `full_description` (200–1200 chars, simple HTML)
- Two new Supabase tables: `enrichment_cache` (audit trail) and `critic_scores` (sommelier-curated numeric scores from major critics — facts, not prose).
- One Magento-ready CSV export per run (`data/exports/wine-enrichment-{timestamp}.csv`) — the human review + Magento-upload interface.
- Five new product columns: `grape_blend_type`, `wine_production_style`, `score_max` (top critic score for facet filtering), `score_summary` (formatted PDP display), plus `enrichment_confidence`/`enriched_at`/`enriched_by` audit fields.
- One curated food-pairing taxonomy file (`data/db/food-pairing-taxonomy.json`).
- Batch CLI driver (`data/enrich_wines.py`) with `--dry-run`, `--limit`, `--priority`, `--tier`, `--write-threshold`, `--no-cache`, `--no-write`, `--sku` flags.
- Per-category Python library structure (`data/lib/enrichment/wine/` + shared `data/lib/enrichment/shared/`) to anticipate spirits/beer/sake categories later.
- Unit + integration tests; pilot run of 50 SKUs (~$0.25) before any scale-up.

**Out of scope (future phases):**
- Spirits, beer, sake enrichment (separate spec per category; shared lib re-used).
- TypeScript admin UI for inline re-enrichment from product admin page — the CSV review flow in §14 is v1's human-in-the-loop. Only build a UI later if spreadsheet review proves too slow.
- API endpoint `/api/products/{id}/enrich` for one-off re-runs from a future admin button (Phase 2).
- Multi-provider abstraction (OpenAI, Gemini). Haiku 4.5 only for v1.
- Image generation or label scanning.
- Wine production-style enrichment via label data; v1 infers from brand/producer context only.

## 3. Decisions recorded

Locked during brainstorming (2026-05-11 → 2026-05-12).

| # | Decision | Choice | Rationale |
|---|---|---|---|
| Q1 | Matrix scope | Wine sensory matrix only (Option A) + category-by-category architecture | Wines are 60% of catalog; matrix vocabulary is mature. Architecture supports future spirits/beer. |
| Q2 | Output routing | Hybrid confidence-gated: ≥0.85 → direct write to Supabase (`/explore` live); **all SKUs → CSV export for manual Magento upload** (the spreadsheet IS the review step). Staged-proposals table dropped after expert review on 2026-05-18. | Fast wins on confident cases; user's existing spreadsheet workflow becomes the human-in-the-loop. |
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
    ├── output.py            # Routes: high-conf → Supabase products write; all → CSV append
    └── taxonomies.py        # Blend types, production styles, body/acidity/tannin enums

data/enrich_wines.py         # CLI driver (~80 lines)

data/db/food-pairing-taxonomy.json    # 43 curated food categories

data/exports/                          # Per-run CSVs land here, gitignored
   wine-enrichment-{timestamp}.csv     # Magento-ready export (see §14)

data/migrations/2026-05-12_wine_enrichment.sql
                                      # Migration: 5 new product columns
                                      #   + 2 new tables (enrichment_cache, critic_scores)

data/db/critic_scores_seed.csv        # Optional sommelier-curated starter rows
                                      # (can be empty for v1; manual entry over time)

tests/test_wine_enrichment_evidence.py
tests/test_wine_enrichment_prompt.py
tests/test_wine_enrichment_validator.py
tests/test_wine_enrichment_scoring.py
tests/test_wine_enrichment_cache.py
tests/test_wine_enrichment_output.py
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
  "grape_blend_type":     "Bordeaux Red Blend",
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
| `grape_blend_type` (12 values) | Single Varietal · Bordeaux Red Blend · Bordeaux White Blend · Rhône North Blend · Rhône South Blend (GSM) · Champagne Blend · Super Tuscan · Port-Style Blend · Sherry-Style Blend · Field Blend · Proprietary Blend · Unknown Blend |
| `wine_production_style` (multiselect tag-bag) | Conventional · Natural · Biodynamic · Organic · Orange · Pet-Nat · Vegan |

**Note on `wine_production_style`:** This is a multiselect **tag-bag**, not a single category. The 7 values mix three orthogonal axes — **farming method** (Conventional / Organic / Biodynamic), **winemaking method** (Conventional / Natural / Orange / Pet-Nat), and **dietary** (Vegan). A single wine can legitimately carry multiple tags (e.g. `["Organic", "Pet-Nat", "Vegan"]`). Magento facet behaviour: a single multi-select attribute returns the union of all wines holding ANY of the selected tags — by-design intersection-flavoured behaviour requires the customer to multi-select. Document this in the customer-facing facet UI as a "Production tags" facet, not "Wine style".
| `food_matching` items | 43 entries — see §10 (food pairing taxonomy) |

### 5.3 New `products` columns

| Column | Type | Notes |
|---|---|---|
| `grape_blend_type` | text | Select. Indexed for Magento facet. |
| `wine_production_style` | text[] | Multiselect. GIN-indexed. |
| `score_max` | numeric(4,1) | Top critic score across `critic_scores` table for this SKU. Indexed for Magento "rated 90+" facet. **Derived** — recomputed on every enrichment run from `critic_scores`. |
| `score_summary` | text | Formatted PDP display, e.g. `"JS 95 · WA 92 · WS 90"`. **Derived** — recomputed on every enrichment run. |
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

### 5.5 New `critic_scores` table

Sommelier-curated **scores only** (numeric facts, not copyrighted prose). The table starts empty and accumulates rows over time via manual entry. Re-running enrichment after new rows are added invalidates the cache (because `evidence_hash` changes) and produces refreshed AI outputs that incorporate the new scores. The AI uses scores as calibration grounding; it must NEVER quote or paraphrase any critic's review prose.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid PK | |
| `sku` | text | FK loosely → products.sku. |
| `critic` | text | Critic name. Suggested controlled set (no enum to allow future additions): `James Suckling` · `Wine Advocate` · `Wine Spectator` · `Decanter` · `Jancis Robinson` · `Vinous` · `Wine Enthusiast` · `Burghound`. |
| `score` | numeric(4,1) | The number itself, e.g. `95.0`, `92.5`. |
| `score_max` | numeric(4,1) DEFAULT 100 | Score scale max — usually 100; Jancis Robinson uses 20. |
| `vintage` | text | Optional. Match score to a specific vintage if relevant; null = vintage-agnostic. |
| `tasting_year` | integer | Optional. When the critic tasted/published. |
| `source_url` | text | Citation link (best-practice attribution). |
| `notes` | text | Internal sommelier notes — NEVER displayed customer-facing. |
| `added_by` | text | Who entered the row. |
| `added_at` | timestamptz default now() | |

**Indexes:**

- `(sku)` — fast evidence lookup during enrichment.
- `(critic, score)` — for "top wines by Suckling" type queries.

**Legal note.** Per Feist v. Rural Telephone (1991), facts aren't copyrightable. A critic's score is a fact about what they published. Storing the number + attribution is legally clean and analogous to "the temperature in London yesterday was 18°C." We do NOT store any of the critic's prose (descriptions, tasting notes, justifications) — those ARE copyrighted.

### 5.6 Output routing — CSV-as-review (no proposals table)

**Decision (2026-05-18 expert review):** the staged-proposals UI track was dropped. Reason: the team's existing Magento-upload workflow is CSV-based — that CSV is a natural review interface. Building a separate proposal-review UI would be dead weight unless someone commits to reviewing 1,000+ rows in it weekly. The CSV column listing all confidence scores is the simpler, lower-friction alternative.

**Routing now:**

- **All SKUs** → row appended to per-run CSV at `data/exports/wine-enrichment-{timestamp}.csv` with `confidence` column. Team reviews in spreadsheet, edits as needed, uploads to Magento manually.
- **High-confidence SKUs (≥0.85)** → also written to Supabase `products` table so the live `/explore` site benefits immediately without waiting for Magento upload.

See §14 for the CSV column contract.

### 5.6 Magento attribute mapping

For Magento sync:

| Supabase column | Magento attribute code | Type | Options source |
|---|---|---|---|
| `grape_variety` | `wine_grape_variety` | multiselect | Dynamic from distinct catalog values. |
| `grape_blend_type` | `wine_grape_blend_type` | select | Static (12 options from §5.2). |
| `wine_production_style` | `wine_production_style` | multiselect | Static (7 options from §5.2). |
| `wine_body` | `wine_body` | select | Static (4 options). |
| `wine_acidity` | `wine_acidity` | select | Static (4 options). |
| `wine_tannin` | `wine_tannin` | select | Static (4 options). |
| `flavor_tags` | `wine_flavor_tags` | multiselect | Dynamic (top-N curated from catalog). |
| `food_matching` | `wine_food_pairing` | multiselect | Static from `food-pairing-taxonomy.json`. |
| `score_max` | `wine_critic_score_max` | decimal | Numeric, indexed — drives "rated 90+" facet. |
| `score_summary` | `wine_critic_scores_display` | text | Pre-formatted string for PDP display. |

## 6. Evidence collection

`data/lib/enrichment/wine/evidence.py`. Pure function: `collect_evidence(sku, products_row) → Evidence`.

### 6.1 Sources

1. **Product facts** — `name, brand, vintage, country, region, subregion, classification, grape_variety_raw, price, alcohol, bottle_size` from `data/db/products.json` (or live Supabase row).
2. **Winesensed records** — `data/db/external-winesensed-records.json` (5,000 records, mostly Italian wines; CC BY-NC-ND research license used for *grounding only*, never copied verbatim into customer-facing fields).
3. **Brand description library** — `data/brand_description_library.csv` with `description_short_en`, `description_full_en`, and tier S1/S2/S3.
4. **Taxonomy heuristics** — typical grape+region profiles encoded in `taxonomies.py` (~40 common combos: Barossa Shiraz, Burgundy Pinot Noir, Napa Cab, etc., plus grape-only and classification-only fallbacks).
5. **Critic scores** (NEW v1) — rows from `critic_scores` table for this SKU, ordered by `tasting_year DESC`. Used as numerical anchors only — the AI sees "James Suckling: 95, Wine Advocate: 92" and calibrates intensity / age-worthiness / quality language accordingly. **The AI never sees critic prose** because we don't store any. Empty table → this source contributes nothing; pipeline falls back gracefully.

### 6.2 Winesensed matching algorithm

`find_winesensed_matches(grape, region, country, limit=5) → list[WinesensedMatch]`:

1. **Tight match (primary)** — records where `normalized_grape == grape.lower() AND normalized_region == region.lower()`. Rank by `rating DESC`.
2. **Loose match (fallback if <2 tight)** — records where `normalized_grape == grape.lower()` (any region). Rank by `rating DESC`, deduped against tight matches.
3. **Country fallback (only if 0 grape matches)** — records where `normalized_country == country.lower() AND normalized_region == region.lower()`. Rank by `rating DESC`.

Each match contains `record_id, year, region, grape, rating, review_text (first 300 chars), match_type`.

### 6.3 Evidence quality tier

| Tier | Trigger | Multiplier (§7) |
|---|---|---|
| **A — gold** | ≥2 tight Winesensed matches, OR (≥1 tight + brand-library Tier-1), OR **≥2 critic scores in `critic_scores` for this SKU** | 1.00 |
| **B — silver** | ≥1 Winesensed match (any type), OR brand library entry (any tier), OR **≥1 critic score** | 0.90 |
| **C — bronze** | Heuristics only — no Winesensed, no brand library, no critic scores | 0.75 |

**Critic scores act as a tier upgrade signal** — a SKU with 0 Winesensed matches but 3 critic scores becomes Tier A, lifting its final confidence and increasing the chance of direct write. This is the high-leverage payoff of the curated scores library: every score the sommelier team enters lifts that SKU's enrichment quality on the next run.

**Realistic tier distribution caveat.** The Winesensed dataset is 4,897 / 5,000 (98%) Italian wines. For your catalog of ~6,375 wines:

- **Italian wines** (~5% of catalog) — likely Tier A.
- **Non-Italian wines with a Tier-1 brand library entry** (likely ~25% of catalog) — likely Tier B.
- **Long-tail non-Italian wines** (likely ~70% of catalog) — likely Tier C (heuristics only).

This means **Tier C will dominate** for the full-catalog run. The 0.75 multiplier on Tier C ensures most of those are CSV-only (no Supabase write) rather than auto-published to `/explore`, which is the desired safety behaviour — they still appear in the CSV for spreadsheet review and Magento upload. Pilot results will confirm or refine these proportions; if Tier C is too punitive, raise multiplier from 0.75 → 0.80 after evidence quality is measured.

### 6.4 Evidence hash

`evidence_hash = sha256(json.dumps({facts, winesensed_record_ids, brand_match, heuristic_profile}, sort_keys=True))`. Used in §8 to detect cache validity.

## 7. Prompt + Haiku + validation

### 7.1 Prompt structure

**System prompt (~350 tokens, cached via Anthropic prompt-cache `cache_control`):**

- Role definition: expert sommelier, third-party voice, JSON-only output. Customer-facing descriptions must be wholly original prose generated by Claude from its own knowledge.
- Controlled vocabulary block (body/acidity/tannin/blend-type/production-style enums).
- Food-pairing taxonomy block (~400 tokens, also cached).
- **License-safe usage rule for Winesensed evidence** (verbatim text injected into system prompt):

  > Winesensed records are provided as STRUCTURAL grounding ONLY:
  >
  > - Use them to confirm that the grape+region combination is plausible and the rating range looks normal.
  > - You MAY cite a Winesensed record ID in `citations.winesensed_record_ids` when its grape/region anchors your judgement.
  > - You MUST NOT quote, paraphrase, or restate Winesensed review text in `flavor_tags`, `desc_en_short`, or `full_description`.
  > - You MUST NOT attribute opinions to specific Winesensed reviewers.
  > - Generate all customer-facing prose from your own wine knowledge (training data on producer websites, critic vocabulary, classical wine literature). The Winesensed dataset is research-licensed (CC BY-NC-ND 4.0) and any direct restatement is not permitted.

**User message (~1,200 tokens per SKU):**

- `# Product facts` — SKU, name, brand, geography, classification, grape, vintage, price.
- `# Evidence — Winesensed real-world tasting notes` — up to 5 matched records.
- `# Evidence — Brand library` — short + full curated brand description (if present).
- `# Evidence — Taxonomy heuristic` — typical profile string.
- `# Evidence — Expert critic scores` (NEW) — pipe-formatted list, e.g. `"James Suckling: 95 (2021) · Wine Advocate: 92 (2020) · Wine Spectator: 90 (2021)"`. Up to 6 most recent scores. Empty line if no scores exist for this SKU. Instruction line included: *"Calibration only — do NOT invent scores; do NOT reproduce any critic's tasting-note prose; cite which scores anchored your judgement in `citations.critic_scores`."*
- `# Your task` — produce matrix JSON with citations; be honest about confidence.

### 7.2 Anthropic call

```python
client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=1500,
    system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": user_message}],
    temperature=0.1,
)
```

**Temperature 0.1** (not 0.3) — for structured classification + JSON shape, low temperature reduces validator-fail / repair rates significantly. Reserve higher temperature for creative-only fields if we ever split the call.

Retry policy: 3 attempts with exponential backoff (1s, 2s, 4s) on 429/5xx. Hard fail on 401/400.

### 7.3 Validator checks (in order)

1. **JSON parses.** Fallback: extract substring between first `{` and last `}`.
2. **Required fields present.**
3. **Controlled-vocab values.** Fuzzy repair table for common AI variants (e.g. `Medium-Heavy` → `Medium-Full`). Food tags fuzzy-matched (case-insensitive, Levenshtein ≤ 2) against taxonomy `label` values.
4. **Counts.** `flavor_tags` 5–10, `food_matching` 3–6.
5. **Lengths.** `desc_en_short` ≤ 160 chars; `full_description` 200–1200 chars.
6. **HTML safety.** Only `p, br, strong, em, ul, li` allowed in `full_description`; everything else stripped.
7. **Citation integrity.**
   - Every cited `winesensed_record_id` must exist in `evidence.winesensed_matches`. Action on hallucinated ID: **strip** the bad ID from the `citations.winesensed_record_ids` array, mark validation outcome `repaired`, add a note to `validation_issues`. The rest of the response is still used (the hallucinated citation doesn't poison the matrix).
   - If `citations.brand_library_match` is non-null, it must match `evidence.brand_description.name` (or be `None`). Action on mismatch: **null out** the field, mark `repaired`, log the mismatch in `validation_issues`. Catches AI inventing producer relationships.
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

## 8. Cache + output routing

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
         output.route (Supabase write + CSV append; see §8.3)
```

### 8.2 Cache supersede

Before inserting a new row for an SKU, mark the previous active row's `superseded_at = now()`. Append-only history; never delete.

### 8.3 Output routing (CSV-as-review)

```python
def route(sku, response_json, final_confidence, cache_id, csv_writer, threshold=0.85):
    fields = fields_from_response(response_json)

    # Conditional Supabase write — only high-confidence rows reach the live /explore site
    if final_confidence >= threshold:
        write_to_products(sku, fields,
                          enrichment_source='ai_high_conf',
                          enrichment_confidence=final_confidence,
                          enriched_by=model_id,
                          enriched_at=now())

    # Always append to CSV — every SKU enriched, with confidence column,
    # for spreadsheet review + manual Magento upload (see §14).
    csv_writer.writerow(build_csv_row(sku, fields, final_confidence, cache_id,
                                       current_values=read_products_row(sku)))
```

The CSV row carries the `confidence` column, the `cache_id` for audit lookup, and every current value alongside the proposed value (diff-style). The team sorts/filters the CSV in a spreadsheet — focusing first on rows below threshold — edits anything they disagree with, drops rows they want to skip, then uploads the file to Magento via the existing manual Magento import.

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
- `final < 0.85` → CSV-only (no Supabase write); appears in the CSV with low confidence for spreadsheet review. See §14.

### 9.3 Audit fields stamped on direct write

- `enrichment_source` = `'ai_high_conf'`
- `enrichment_confidence` = `final`
- `enrichment_note` = compact summary (e.g. `"Haiku 4.5 / tier A / 4 winesensed records / Mondavi brand"`)
- `enriched_at`, `enriched_by`

### 9.4 Per-field threshold flexibility

v1 ships with a single threshold. If pilot shows uneven quality, a per-field threshold dict can be added to `taxonomies.py` (e.g. `desc_en_short`: 0.75, `grape_blend_type`: 0.90) without changing the scoring engine.

## 10. Food pairing taxonomy

`data/db/food-pairing-taxonomy.json` — 43 curated categories in 10 groups. AI MUST select from this list.

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

### 10.2 Categories (43 entries in 10 groups)

| Group | Categories |
|---|---|
| **Red Meat** (6) | Grilled red meat · Lamb dishes · Game meats · Beef stew & braised · Charcuterie & cured meats · Pâté & terrine |
| **Poultry & Pork** (3) | Roast chicken · Duck (breast/confit) · Pork dishes |
| **Seafood** (5) | Grilled fish · Oily fish (salmon, tuna) · Shellfish (lobster, crab, prawn) · Oysters & raw seafood · Sushi & sashimi |
| **Pasta, Rice & Grains** (3) | Tomato-based pasta · Cream-based pasta & risotto · Pesto & oil-based pasta |
| **Cheese** (4) | Soft fresh cheese · Aged hard cheese · Blue cheese · Goat cheese |
| **Vegetables** (3) | Grilled vegetables · Leafy salads · Mushroom dishes |
| **Asian** (8) | Thai food (spicy & sour) · Chinese cuisine · Japanese cuisine · Korean BBQ · Indian curry · Vietnamese cuisine · Hot pot & Shabu Shabu · Dim Sum |
| **Other Dishes** (5) | Pizza & flatbreads · Mexican & Tex-Mex · Tapas & small plates · BBQ & smoky grills · Mediterranean cuisine |
| **Desserts** (3) | Dark chocolate · Fruit desserts · Creamy desserts & pastries |
| **Casual** (3) | Apéritif & hors d'oeuvres · Cocktail snacks · Comfort food (pasta bakes, casseroles, roasts) |

**Total: 43 categories** (up from 40). Notable changes from v0:

- **Pasta & Risotto → Pasta, Rice & Grains** (risotto is rice, not pasta — original name was a misnomer).
- **Pâté & terrine** added (classic wine pairing missing from v0).
- **Hot pot & Shabu Shabu** + **Dim Sum** added (high-relevance for Thai/Asian customer base).
- **"Easy weekday dinners"** (vague to AI) → **"Comfort food (pasta bakes, casseroles, roasts)"** (concrete examples for grounding).

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
--no-write           # call + validate + cache but no Supabase writes / no CSV
--no-supabase        # skip Supabase products writes; CSV-only mode
--sku SKU [--sku SKU ...]  # specific SKUs only
--csv-output PATH    # explicit CSV path; default: data/exports/wine-enrichment-{timestamp}.csv
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
  Supabase direct writes: 37  (final_confidence ≥ 0.85)
  CSV-only (no Supabase): 13  (final_confidence < 0.85)
  Validation failures:    2
Cost (this run):          $0.21
By evidence tier:         A: 32  B: 14  C: 4
Lowest-confidence SKUs:   WRW2106AC (0.71), WSP1140AE (0.68), ...

  ✓ enrichment_cache:        50 new rows written
  ✓ products (Supabase):     37 rows updated
  ✓ data/exports/wine-enrichment-2026-05-18T15:00Z.csv:  50 rows written
```

## 12. Testing strategy

### 12.1 Unit tests (`tests/test_wine_enrichment_*.py`)

One per module, fully offline (mocks Anthropic SDK):

- `test_evidence.py` — Winesensed match selection, tier classification, evidence hash stability.
- `test_prompt.py` — Prompt builder injects all evidence; stable prompt hash.
- `test_validator.py` — Vocab repair (`Medium-Heavy` → `Medium-Full`), reject out-of-vocab food tags, reject hallucinated winesensed IDs, HTML sanitization.
- `test_scoring.py` — Multiplier math, threshold routing, edge cases.
- `test_cache.py` — Hit/miss/supersede behaviour (sqlite in-memory mock for Supabase).
- `test_output.py` — Direct-write threshold gating, CSV row construction, diff-column population, multi-field output from one response.

Each ~30–100 lines.

### 12.2 Integration test (`tests/test_enrich_wines.py`)

5-SKU fixture (`tests/fixtures/wine_pilot_skus.json` — Bordeaux Cru, Napa Cab, Aussie Shiraz, NZ Sauv Blanc, obscure Sicilian).

Runs driver with `--no-write` and a mocked Anthropic client returning canned JSON. Asserts cache rows written, validation outcomes, scoring math, proposal routing.

### 12.3 Manual pilot

```
python3 data/enrich_wines.py --limit 50 --priority popularity --dry-run   # confirm selection
python3 data/enrich_wines.py --limit 50 --priority popularity              # ~$0.25, ~5min
# → open data/exports/wine-enrichment-*.csv in Numbers/Excel
# → sort by confidence ascending; eyeball the 5-10 lowest-confidence rows
# → spot-check 3 high-confidence rows for quality
# → save edited CSV; upload to Magento manually if quality looks good
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
2. **TypeScript admin UI** for inline re-enrichment from product admin page — would replace today's CSV → Magento workflow only if the team finds spreadsheet review too slow. Not building proactively.
3. **API endpoint** `/api/products/{id}/enrich` triggered from product admin page "Regenerate" button.
4. **Multi-provider fallback** — call GPT-4o-mini or Gemini Flash for cross-validation on low-confidence SKUs.
5. **Per-field thresholds** — if pilot shows uneven quality, per-field threshold config in `taxonomies.py`.
6. **Wine production-style enrichment via label data** — image-based label parsing for `Organic/Biodynamic/Natural` certifications.
7. **Magento attribute auto-sync** — push the static option lists to Magento programmatically rather than manual admin import.
8. **Phase 2 grounding expansion** — driven by pilot evidence, not speculation. If pilot reveals classes of SKUs with persistent low confidence (e.g. Australian boutique producers, very recent vintages, obscure Greek wines), evaluate:
   - Expand `brand_description_library.csv` via curated team additions + earlier AI-assisted research passes (cheapest, most controllable).
   - Expand taxonomy heuristic combos in `taxonomies.py` (catch more grape+region tail cases).
   - **Expand `critic_scores` table coverage** — v1 ships the schema + AI prompt slot empty; sommelier team manually enters rows over time. Each row added boosts that SKU's evidence tier on the next re-run.
   - License a paid critic-data feed (e.g. Wine-Searcher / Vivino API) — automated bulk score ingestion if manual entry is too slow.
   - Selective producer-website scraping for high-priority brands only (robots.txt-respecting, rate-limited, focused — never a blanket crawler).
   Decide per gap class after the pilot, not in advance.

9. **Critic-prose review library (separate from critic_scores)** — store the verbatim prose of expert tasting notes for internal AI grounding only (never displayed verbatim customer-facing). Requires either curated manual entry (legally clean as internal research) OR a licensed feed. NOT pursued in v1 because the scores alone (§5.5) carry ~80% of the value at zero copyright risk.

## 14. Magento CSV export contract

The pipeline writes one CSV per run at `data/exports/wine-enrichment-{timestamp}.csv`. This file is the human-review interface AND the Magento upload artifact. The team opens it in Excel/Numbers/Google Sheets, sorts by `confidence`, eyeballs flagged rows, edits in place, drops rows they want to skip, and uploads the trimmed file to Magento via the existing manual Magento product CSV import.

### 14.1 CSV columns (in order)

| Column | Source | Purpose |
|---|---|---|
| `sku` | products.sku | Primary key — must match an existing Magento product. |
| `confidence` | scoring.combine | 0–1; **sort by this column ascending to surface review-worthy rows first.** |
| `confidence_tier` | scoring | `A` / `B` / `C` — quick visual filter. |
| `wine_body` | Haiku output | Magento attribute value (one of 4 enums). |
| `wine_acidity` | Haiku output | one of 4 enums. |
| `wine_tannin` | Haiku output | one of 4 enums. |
| `grape_variety` | Haiku output | Pipe-delimited string `"Cabernet Sauvignon|Merlot|Petit Verdot"` (Magento multiselect import format). |
| `grape_blend_type` | Haiku output | one of 12 enums. |
| `wine_production_style` | Haiku output | Pipe-delimited (multiselect). Empty when `Conventional`-only and you don't want to clutter Magento. |
| `flavor_tags` | Haiku output | Pipe-delimited. |
| `food_matching` | Haiku output | Pipe-delimited; values must match `food-pairing-taxonomy.json` labels. |
| `desc_en_short` | Haiku output | ≤160 chars. |
| `full_description` | Haiku output | HTML (escaped for CSV). |
| `score_max` | derived from `critic_scores` | Top critic score (e.g. `95.0`); empty when no scores exist for SKU. For Magento "rated 90+" facet. |
| `score_summary` | derived from `critic_scores` | Formatted PDP display, e.g. `"JS 95 · WA 92 · WS 90"`. |
| `enrichment_note` | scoring | `"Haiku 4.5 / tier A / 4 winesensed records / Mondavi brand"` — explains *why* this confidence. |
| `current_wine_body` | products.wine_body (live) | Side-by-side diff column for review. |
| `current_food_matching` | products.food_matching (live) | Side-by-side diff column for review. |
| `current_full_description` | products.full_description (live) | Side-by-side diff column for review. |
| `cache_id` | enrichment_cache.id | Audit trail — paste this into Supabase to see the full prompt + response. |
| `enriched_at` | now() | ISO timestamp. |
| `enriched_by` | model id | `claude-haiku-4-5-...`. |

### 14.2 CSV write conventions

- UTF-8 with BOM (Excel-friendly).
- Quoting: `csv.QUOTE_ALL` — every field quoted, no ambiguity on commas/newlines in descriptions.
- Line endings: `\r\n` (Magento expects Windows-style; Excel preserves these).
- Empty cells: empty string, not `null`/`None`.
- Pipe-delimited multiselect: `value1|value2|value3` (Magento's native CSV multiselect format).

### 14.3 Sample review workflow

1. **Run:** `python3 data/enrich_wines.py --limit 50 --priority popularity`
2. **Open:** `data/exports/wine-enrichment-2026-05-18T15:00Z.csv` in Numbers / Excel
3. **Sort** ascending by `confidence` column
4. **Eyeball** top ~20 rows (low-confidence) — edit any field you disagree with
5. **Spot-check** 5 random high-confidence rows to confirm quality
6. **Delete rows** you want to skip (e.g., a SKU about to be delisted)
7. **Save as** `wine-enrichment-2026-05-18-reviewed.csv`
8. **Upload** to Magento admin → System → Import → Products → CSV. Magento's "Update only" mode applies the new attribute values without touching prices/stock.

### 14.4 Why this beats a custom review UI

- **Zero new tools to learn** — team already lives in spreadsheets.
- **Built-in bulk editing** — find/replace across 1,000 rows is a Cmd-F away.
- **Reviewer's choice of platform** — Numbers / Excel / Google Sheets, all work the same.
- **No deployment maintenance** — one Python writer, no React app, no auth.
- **Magento format is the output natively** — no second export step.

## 15. Open items deferred to plan

Pure implementation details, decided during writing-plans:

- Exact Python class names for evidence/prompt/validator/scoring/cache/output modules.
- Specific column types for jsonb fields (jsonb vs text[] for `flavor_tags`).
- Whether `desc_en_short` already exists on `products` (migration is idempotent regardless).
- Exact set of "common known combos" in `taxonomies.heuristic_for()` (initial ~40, expand from pilot).
- Anthropic SDK version pinning in `requirements.txt`.
