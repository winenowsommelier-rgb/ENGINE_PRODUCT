# Curation Engine — Design Spec
**Date:** 2026-05-29
**Status:** Draft
**Branch:** feat/taste-taxonomy-v2

---

## 1. Overview

The Curation Engine is a sommelier-grade product curation system that accepts a natural-language brief from an internal staff member, sommelier, or B2B operator, and returns a ranked list of products with expert rationale — ready for internal review, customer-facing collections, or HoReCa/B2B proposals.

The system serves three audiences:
- **Internal team** — review and approve curated lists before publication
- **End customers** — browsable collections on the wine-now storefront
- **B2B / HoReCa professionals** — pairing guides, event proposals, tasting menu recommendations

---

## 2. Design Principles

- **Production path is deterministic and cheap** — hard filter + scoring rules run without LLM; LLM is used only for brief parsing and rationale copy
- **Local-first, zero API cost by default** — Ollama (`llama3.1:8b`) handles all production LLM calls; Claude API is reserved for the optional background training panel
- **Expert knowledge is data, not code** — pairing rules, scoring weights, and food taxonomy live in JSON files editable by the sommelier team without code changes
- **Hard avoids are explicit** — contraindication rules apply score penalties and flag products; they do not silently exclude
- **Background loop improves rules over time** — a virtual sommelier panel runs asynchronously after each production run, compares output, and surfaces scoring model improvements for human approval

---

## 3. The Brief Template

When a user submits a natural-language brief, the engine pre-populates a structured template for review before the pipeline runs. The user fills any gaps.

```
CURATION BRIEF
──────────────────────────────────────────────
Occasion / Theme:     [natural language input]
Category filter:      [Wine / Whisky / Gin / etc.]
Subcategory:          [Red / White / Single Malt / etc.]
Country / Region:     —
Score threshold:      ≥ ___ pts  (blank = no minimum)
Price range (THB):    ___ to ___
Margin preference:    Standard / Prefer high margin
Stock:                In-stock only  [ ]
Pairing context:      [food, cuisine, dish, or blank]
Course position:      [aperitif / first / main / cheese / dessert / digestif]
Occasion type:        [business dinner / celebration / gift / everyday / HoReCa tasting menu]
Menu tier:            [everyday / mid-range / premium / prestige]
Output size:          12  (default)
Audience:             [ ] Internal  [ ] Customer  [ ] B2B/HoReCa
──────────────────────────────────────────────
```

**Example 1:** "Best USA wine collection this year"
→ Category: Wine | Country: USA | In-stock | Top 12 | Audience: Customer + B2B

**Example 2:** "Whisky pairing with Thai food, 90 points only"
→ Category: Whisky | Score: ≥90 | Pairing: Thai food | Course: main/shared

---

## 4. Production Pipeline (Fast Path)

Five sequential stages. Total wall-clock: ~5–12s. Total LLM cost: $0 (Ollama).

### Stage 1 — Brief Parser (LLM call #1, Ollama)
- Input: natural-language brief
- Output: structured query object (filters, weights, pairing intent, audience)
- Model: `llama3.1:8b` via Ollama
- Est. tokens: ~1,000 | Est. time: <3s

### Stage 2 — Hard Filter
Applies must-pass rules against `products.json` / `products.db`:
- Stock status (if in-stock only)
- Category / country / region
- Score threshold (using `taxonomy_confidence` + `flavor_tags` completeness as proxy until critic scores are ingested)
- Price range (THB)
Output: candidate pool (typically 50–300 products)

### Stage 3 — Scoring Engine

Each component score is first normalised to a 0–1 float, then multiplied by its weight. Bonuses and penalties are additive absolute values applied after the weighted sum. The final raw value is clamped to [0, 1] then multiplied by 100 to yield a 0–100 integer score.

**Component normalisation:**

- `taste_axis_match` — fraction of recommended axis values matched (0–1); 0 if no pairing context
- `taxonomy_quality` — fraction of key enrichment fields populated: `desc_en_short`, `flavor_tags`, `wine_body`/`taste_profile`, `region` (0–1)
- `brand_prestige` — expert knowledge library confidence tier: A=1.0, B=0.7, C=0.4, absent=0.2
- `margin_signal` — `b2b_margin_pct` normalised against catalog 10th/90th percentile (0–1)
- `web_freshness` — critic score normalised: 100pts=1.0, 90pts=0.5, 85pts=0.2, not found=0

**Formula:**

```
weighted_sum = (taste_axis_match   × weights.taste_match)
             + (taxonomy_quality   × weights.taxonomy_quality)
             + (brand_prestige     × weights.brand_prestige)
             + (margin_signal      × weights.margin_signal)
             + (web_freshness      × weights.web_freshness)

raw_score = weighted_sum
          + (pairing_rule_matched  ? bonuses.pairing_boost  : 0)
          + (bridge_tag_matched    ? bonuses.bridge_bonus   : 0)
          + (regional_match        ? bonuses.regional_bonus : 0)
          + (intensity_within_1tier? bonuses.intensity_match: 0)
          - (avoid_tag_count       × abs(penalties.avoid_tag))
          - (hard_avoid_triggered  ? abs(penalties.hard_avoid) : 0)

final_score = clamp(raw_score, 0, 1) × 100  → integer 0–100
```

Occasion weight overrides (from `occasion_profiles.json`) replace the default `weights.*` values for that run — they do not stack additively.

Weights are loaded from `data/lib/curation/curation_scoring_model.json` — version-controlled and human-editable. Base weights must sum to 1.0; validated on load.

### Stage 4 — Web Context Fetch (async)
- Fetches current signals for top-20 candidates only
- Sources: critic scores (Wine Spectator, Decanter, Whisky Advocate), trend context, pairing authority
- Adjusts scores before final sort
- Capped at 20 fetches to keep latency under 10s total
- Non-blocking: if fetch fails, score proceeds without web signal

### Stage 5 — Rationale Writer (LLM call #2, Ollama)
- Input: top-N products with scores, taste axes, flavor tags, expert knowledge pack, pairing context, web signal
- Output: one-line expert rationale per product in sommelier voice
- Model: `llama3.1:8b` via Ollama
- Est. tokens: ~2,000 for 12 products | Est. time: <5s

---

## 5. LLM Provider Configuration

All LLM routing is controlled by a single config file:

```json
// data/lib/curation/curation_config.json
{
  "llm_provider": "ollama",
  "ollama_model": "llama3.1:8b",
  "ollama_base_url": "http://localhost:11434",
  "background_panel_provider": "anthropic",
  "background_panel_enabled": false
}
```

Provider abstraction in `lib/curation/llm_router.py` — switching between Ollama and Claude API requires only a config change, no code change.

### Local Setup (one-time)
```bash
brew install ollama
ollama pull llama3.1:8b   # ~4.7GB, runs fully offline
ollama serve
```

### Model Tier Routing

| Tier | Provider | Model | Use |
|---|---|---|---|
| 1 | None | — | Pure rules: filter + score (zero LLM) |
| 2 | Ollama | `llama3.1:8b` | Production: brief parser + rationale writer |
| 3 | Claude API | `claude-sonnet-4-6` | Background panel only (optional, off by default) |

---

## 6. Pairing Knowledge Base

Stored in `data/lib/pairing_knowledge/`. All files are JSON, human-editable, version-controlled.

### `pairing_resolver.py` Interface

Called by `scoring_engine.py` once per candidate, after the brief has been parsed into a `StructuredQuery`.

```python
def resolve_pairing(
    query: StructuredQuery,                # output of brief_parser
    candidate: ProductRecord,              # single product from candidate pool
    knowledge_base: PairingKnowledgeBase,  # loaded once at engine startup
) -> PairingScore:
    ...
```

`PairingScore` fields returned:

| Field | Type | Description |
|---|---|---|
| `rule_matched` | bool | Any food×beverage rule matched |
| `pairing_boost` | float | 0 or `bonuses.pairing_boost` |
| `bridge_bonus` | float | 0 or `bonuses.bridge_bonus` |
| `regional_bonus` | float | 0 or `bonuses.regional_bonus` |
| `intensity_ok` | bool | food_intensity within 1 tier of beverage_intensity |
| `contraindication_triggered` | bool | Any hard_avoid rule matched |
| `contraindication_penalty` | float | 0 or negative penalty value |
| `avoid_tag_count` | int | Number of avoid_flavor_tags found on product |
| `avoid_tag_penalty` | float | Cumulative avoid tag penalty |
| `matched_rule_ids` | list[str] | For rationale writer and audit log |

`PairingKnowledgeBase` is loaded from all JSON files at engine startup — not re-read per request.

### Directory Structure

```
data/lib/pairing_knowledge/
├── food_taxonomy/
│   ├── flavor_signals.json          # ~15 master signals
│   ├── cuisines.json                # ~20 cuisines → dominant signals
│   └── dishes.json                  # ~200+ dishes → cuisine + signals + texture + intensity
├── beverage_profiles/
│   └── intensity_map.json           # maps taste axes → beverage intensity tier
├── rules/
│   ├── food_beverage_rules.json     # Food × Beverage pairing rules
│   ├── contraindication_rules.json  # Hard never-pair rules
│   ├── regional_affinity_rules.json # What grows together goes together
│   └── bridge_ingredient_rules.json # Shared flavor bridge logic
├── contexts/
│   ├── course_positions.json        # aperitif → digestif
│   ├── occasion_profiles.json       # business dinner, celebration, gift, HoReCa...
│   └── service_context.json         # temperature, glassware, service style
├── product_affinity_rules.json      # Flavor × Flavor (similar / overlap / contrast)
└── README.md
```

### 6a. `intensity_map.json` Schema

Maps each beverage category's taste axis values to a 4-tier intensity scale used for food intensity matching.

```json
{
  "category": "wine",
  "intensity_tiers": ["light", "medium", "full", "powerful"],
  "axis_mappings": [
    {
      "axis": "wine_body",
      "tier_map": {
        "Light":         "light",
        "Medium-Light":  "light",
        "Medium":        "medium",
        "Medium-Full":   "full",
        "Full":          "powerful"
      }
    }
  ],
  "composite_rule": "highest tier across all axis_mappings"
},
{
  "category": "whisky",
  "intensity_tiers": ["light", "medium", "full", "powerful"],
  "axis_mappings": [
    {
      "axis": "peat_smoke",
      "tier_map": {
        "None":   "light",
        "Trace":  "light",
        "Light":  "medium",
        "Medium": "full",
        "Heavy":  "powerful"
      }
    },
    {
      "axis": "oak_influence",
      "tier_map": {
        "Light":          "light",
        "Medium":         "medium",
        "Pronounced":     "full",
        "Heavy":          "powerful",
        "Cask-dominant":  "powerful"
      }
    }
  ],
  "composite_rule": "highest tier across all axis_mappings"
}
```

Food `intensity` field on dishes uses the same 4-tier vocabulary: `light / medium / full / powerful`. Intensity match bonus applies when `abs(food_tier_index - beverage_tier_index) <= 1`.

---

### 6b. Food Taxonomy (Three-Tier)

**Tier 1 — Flavor Signals** (~15 master signals)

Each signal carries its beverage interaction effects:

```json
{
  "signal_id": "spicy_heat",
  "label": "Spicy / Heat",
  "description": "Chilli heat, pepper, wasabi — cuts through sweetness, clashes with tannin",
  "beverage_effects": {
    "amplifies": ["tannin", "alcohol_burn"],
    "suppressed_by": ["sweetness", "effervescence"],
    "enhanced_by": ["light_body", "low_tannin"]
  }
}
```

Master signals: `spicy_heat`, `umami_savory`, `umami_fish`, `fatty_rich`, `sour_bright`, `sweet_dessert`, `bitter_char`, `aromatic_herb`, `smoky_char`, `delicate_protein`, `raw_fresh`, `coconut_richness`, `earthy_mushroom`, `sweet_sour_balance`, `creamy_dairy`

**Tier 2 — Cuisine** (~20 cuisines)

```json
{
  "cuisine_id": "thai",
  "label": "Thai",
  "dominant_signals": ["spicy_heat", "aromatic_herb", "umami_fish", "sweet_sour_balance", "coconut_richness"],
  "regional_notes": "Northern Thai is earthier; Southern Thai is more coconut-rich and spicy",
  "dishes": ["tom_yum_goong", "pad_thai", "green_curry", "som_tum", "massaman_curry", "larb"]
}
```

**Tier 3 — Dish** (~200+ dishes)

```json
{
  "dish_id": "tom_yum_goong",
  "label": "Tom Yum Goong",
  "cuisine": "thai",
  "course_positions": ["first_course", "main_shared"],
  "flavor_signals": ["spicy_heat", "aromatic_herb", "sour_bright", "umami_fish"],
  "texture": "brothy_light",
  "fat_content": "low",
  "intensity": "high",
  "bridge_ingredients": ["lemongrass", "lime", "chilli", "galangal"],
  "seasonal_affinity": ["hot_season", "rainy_season"],
  "contraindication_signals": ["heavy_tannin", "heavy_oak", "heavy_peat"],
  "notes": "Very aromatic, high acid, high heat — needs a drink that tames heat without fighting the aromatics"
}
```

### 6b. Food × Beverage Rules

```json
{
  "rule_id": "spicy-heat-whisky",
  "food_signals": ["spicy_heat", "aromatic_herb"],
  "beverage_category": "whisky",
  "relationship_type": "complement",
  "recommended_axes": {
    "peat_smoke":    {"values": ["None", "Trace"], "reason": "Heavy peat amplifies chilli burn"},
    "sweetness":     {"values": ["Balanced", "Sweet"], "reason": "Sweetness tames capsaicin heat"},
    "oak_influence": {"values": ["Light", "Medium"], "reason": "Heavy oak adds bitter tannin clash"}
  },
  "recommended_flavor_tags": ["honey", "vanilla", "tropical fruit", "citrus zest"],
  "avoid_flavor_tags": ["heavy peat", "medicinal", "iodine", "dry tannin"],
  "score_boost": 0.15,
  "rationale_seed": "Thai cuisine's aromatic heat calls for whiskies with natural sweetness and gentle oak — enough complexity to match the dish, enough softness to avoid amplifying the spice.",
  "source": "expert_seed",
  "confidence": "A"
}
```

### 6c. Contraindication Rules

Hard never-pair rules — apply score penalties, never silently exclude:

```json
{
  "rule_id": "tannic-red-raw-fish",
  "label": "Tannic red wine + raw or delicate fish",
  "beverage_profile": {
    "classification": ["Red Wine"],
    "wine_tannin": ["Medium-Full", "Full"]
  },
  "food_signals": ["delicate_protein", "raw_fish", "low_fat"],
  "penalty": -0.40,
  "reason": "Tannin reacts with fish oils producing metallic bitterness that ruins both wine and dish.",
  "severity": "hard_avoid",
  "exception": "Oily fish like salmon or tuna can tolerate light Pinot Noir"
}
```

### 6d. Product Affinity Rules (Flavor × Flavor)

Three relationship types:

**Similar** — "find me something like this"
```json
{
  "affinity_id": "full-body-red-similarity",
  "relationship_type": "similar",
  "anchor_profile": {
    "classification": ["Red Wine"],
    "wine_body": ["Full", "Medium-Full"],
    "flavor_tags_include": ["dark plum", "blackcurrant", "oak spice"]
  },
  "match_profile": {
    "classification": ["Red Wine"],
    "wine_body": ["Full", "Medium-Full"],
    "flavor_tags_overlap_min": 2
  },
  "rationale_template": "Like {anchor}, {match} shares {shared_tags} with a {body} body and {style} finish."
}
```

**Overlap** — shared flavor tag network across categories
```json
{
  "affinity_id": "citrus-driven-overlap",
  "relationship_type": "overlap",
  "shared_signals": ["citrus zest", "bright acidity", "aromatic"],
  "eligible_categories": ["White Wine", "Sparkling Wine", "Gin", "Rum"],
  "rationale_template": "Both share {shared_tags} — a bright, citrus-driven character that works across categories."
}
```

**Contrast** — deliberately different but complementary
```json
{
  "affinity_id": "peaty-whisky-vs-crisp-white",
  "relationship_type": "contrast",
  "profile_a": {"category": "whisky", "peat_smoke": ["Medium", "Heavy"]},
  "profile_b": {"category": "White Wine", "wine_acidity": ["Medium-Full", "Full"], "flavor_tags_include": ["citrus", "mineral"]},
  "contrast_logic": "smoke_vs_acid",
  "rationale_template": "Where {a} brings smoke and weight, {b} cuts through with bright acidity — a contrast pairing that cleanses and resets the palate."
}
```

### 6e. Expert Pairing Dimensions

| Dimension | Implementation | Priority |
|---|---|---|
| Intensity matching | `food_intensity` must be within 1 tier of `beverage_intensity` | Critical |
| Course / meal position | `course_positions` on each dish; `preferred_intensity` per course | Critical |
| Bridge ingredient | `bridge_ingredients` on dish; overlap with `flavor_tags` on product → +0.10 bonus | High |
| Contraindication | Hard penalty rules in `contraindication_rules.json` | High |
| Texture & weight matching | `food_texture` + `beverage_cut_profile` (acid-cut / tannin-cut / effervescent / sweet-contrast) | High |
| Occasion & guest profile | `occasion_profiles.json` with scoring weight overrides per occasion | High |
| Regional affinity | Product country/region matches food cuisine → +0.10 bonus | Medium |
| Service temperature | `service_context.json` — serving temp ranges per category | Medium |
| Seasonal context | `seasonal_affinity` on dishes; optional signal in brief | Low (Wave 2) |

### 6f. Occasion Profiles

```json
{
  "occasion_id": "horecab2b_tasting_menu",
  "label": "HoReCa Tasting Menu",
  "guest_knowledge": "expert",
  "menu_tier": "prestige",
  "price_range_thb": [3000, 99999],
  "scoring_weight_overrides": {
    "brand_prestige": 0.30,
    "taste_match":    0.40,
    "margin_signal":  0.05,
    "web_freshness":  0.25
  },
  "glass_pour_economics": true,
  "notes": "Provenance story and regional identity weighted heavily at prestige level."
}
```

---

## 7. Scoring Model

Stored in `data/lib/curation/curation_scoring_model.json`. Human-editable, version-controlled.

```json
{
  "version": "1.0",
  "weights": {
    "taste_match":      0.35,
    "taxonomy_quality": 0.15,
    "brand_prestige":   0.20,
    "margin_signal":    0.10,
    "web_freshness":    0.20
  },
  "bonuses": {
    "pairing_boost":    0.15,
    "bridge_bonus":     0.10,
    "regional_bonus":   0.10,
    "intensity_match":  0.10
  },
  "penalties": {
    "avoid_tag":        -0.05,
    "hard_avoid":       -0.40
  }
}
```

Weights are validated to sum to 1.0 on load. Any change requires version bump.

---

## 8. Output Formats

### Internal Review View

```
CURATION RUN — [brief title]
─────────────────────────────────────────
Brief resolved: [resolved filters summary]
Scoring model: v1.0 | Web context: fetched for top 20
Run time: Xs | LLM: Ollama llama3.1:8b | Cost: $0.00
─────────────────────────────────────────
#1  [Product Name] — [Region]                Score: XX/100
    "[One-line expert rationale]"
    [Taste axes] | [Flavor tags]
    Price: X,XXX THB | Margin: XX% | Stock: X btls
    Web signal: [critic score if found]
    [Approve] [Skip] [Edit note]

[Approve all] [Export collection] [Export B2B PDF] [Send to Supabase]
```

### Customer Collection (JSON → Supabase)

```json
{
  "collection_id": "usa-best-2026",
  "title": "The Best of USA — Our Top 12 for 2026",
  "intro": "...",
  "products": [{"sku": "...", "rank": 1, "expert_note": "...", "score": 94}],
  "curated_by": "WineNow Sommelier Team",
  "status": "draft"
}
```

### B2B / HoReCa PDF Export
- Cover: occasion + client name + date
- Per product: name, vintage, region, expert note, pairing suggestion, price/bottle, price/glass (if menu tier), margin tier
- Sommelier sign-off line

---

## 9. Background Training Loop (D Path)

Runs asynchronously after each production run. Off by default — enabled per-run or on a schedule.

```
[PRODUCTION RUN completes]
  → saves: structured_query + Stage 2 candidate pool + production ranked list
        ↓
[BACKGROUND PANEL — Claude API, optional]
  Receives: SAME structured_query + SAME Stage 2 candidate pool as production run
  (panel does NOT re-run hard filter — it reasons over the same filtered set)
  3 LLM agents, independent reasoning, different personas:
  sommelier | chef | critic
  Each produces ranked top-12 from that candidate pool, with reasoning
  Panel votes → consensus list
        ↓
[COMPARISON ENGINE]
  Diff production list vs panel consensus
  Score: overlap %, rank correlation, rationale quality flags
  Flag any disagreement > 2 rank positions
        ↓
[TRAINING LOG]
  Append to data/lib/curation/curation_training_log.jsonl
  After 20 runs: auto-suggest weight adjustments
  Human approves before weights go live
        ↓
[PAIRING RULE IMPROVER]
  Panel consistently boosts product rules missed → flag as
  candidate new pairing rule
  Sommelier reviews flagged candidates weekly
```

Cost per background run: ~$0.10–0.30 (Claude API). Runs infrequently. After ~50 production runs, scoring model weights can be meaningfully tuned.

---

## 10. File Layout (new files only)

```
data/lib/curation/
├── curation_config.json            # LLM provider, model, feature flags
├── curation_scoring_model.json     # Weights, bonuses, penalties (v-controlled)
└── curation_training_log.jsonl     # Background panel comparison runs

data/lib/pairing_knowledge/
├── food_taxonomy/
│   ├── flavor_signals.json
│   ├── cuisines.json
│   └── dishes.json
├── beverage_profiles/
│   └── intensity_map.json
├── rules/
│   ├── food_beverage_rules.json
│   ├── contraindication_rules.json
│   ├── regional_affinity_rules.json
│   └── bridge_ingredient_rules.json
├── contexts/
│   ├── course_positions.json
│   ├── occasion_profiles.json
│   └── service_context.json
├── product_affinity_rules.json
└── README.md

lib/curation/
├── __init__.py
├── brief_parser.py                 # Stage 1: NL → structured query
├── hard_filter.py                  # Stage 2: candidate pool
├── scoring_engine.py               # Stage 3: score candidates
├── web_context.py                  # Stage 4: async critic/trend fetch
├── rationale_writer.py             # Stage 5: LLM rationale copy
├── llm_router.py                   # Provider abstraction (Ollama / Claude)
├── pairing_resolver.py             # Resolves food context → rules
├── affinity_resolver.py            # Product-to-product affinity
├── output_formatter.py             # Internal / Collection / PDF outputs
└── background_panel.py             # D path: virtual sommelier panel

app/api/curation/
└── route.ts                        # API endpoint for curation runs

components/pages/
└── CurationPage.tsx                # Internal review UI
```

---

## 11. Build Phases

### Phase 1 — Foundation

- `curation_config.json` — LLM provider config (must exist before `llm_router.py` can load)
- `data/lib/pairing_knowledge/` structure + seed data (5 cuisines, 50 dishes, 15 flavor signals, `intensity_map.json`)
- `curation_scoring_model.json` v1.0 with default weights
- `llm_router.py` — provider abstraction (reads `curation_config.json`)
- `brief_parser.py` — LLM call #1 (Ollama)
- `hard_filter.py` — filter against products.json

### Phase 2 — Scoring & Ranking
- `scoring_engine.py` — all scoring layers
- `pairing_resolver.py` + `affinity_resolver.py`
- `rationale_writer.py` — LLM call #2 (Ollama)
- `app/api/curation/route.ts` + `CurationPage.tsx` internal review UI

### Phase 3 — Web Context & Output
- `web_context.py` — async top-20 critic/trend fetch
- Customer collection JSON → Supabase sync
- B2B/HoReCa PDF export
- Approve → publish flow

### Phase 4 — Background Training Loop
- `background_panel.py` — virtual sommelier panel (Claude API)
- Comparison engine + `curation_training_log.jsonl`
- Scoring model update suggestion UI

### Phase 5 — Pairing Knowledge Expansion
- Expand to 20 cuisines, 200+ dishes
- Seasonal context, service temperature, glassware
- Product-to-product affinity network (full graph)

---

## 12. Success Criteria

- A sommelier can type a natural-language brief and receive a ranked, rationale-annotated product list in under 15 seconds at zero API cost
- Pairing briefs ("whisky + Thai food") produce results a working sommelier would agree with on first review
- Hard contraindications are never silently ignored — they surface with explanation
- The scoring model can be tuned by non-engineers (JSON file edit + version bump)
- After 50 production runs, background panel comparison data is sufficient to propose first scoring model weight update
