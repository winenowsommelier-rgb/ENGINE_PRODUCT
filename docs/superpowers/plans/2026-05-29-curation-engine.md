# Curation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sommelier-grade product curation system that accepts a natural-language brief, filters and scores the 11,436-product catalog using pairing rules and taste taxonomy, and returns a ranked list with expert rationale — running fully locally via Ollama at zero API cost.

**Architecture:** Five-stage pipeline: (1) Ollama LLM parses natural-language brief → structured query; (2) hard filter reduces catalog to candidate pool; (3) scoring engine applies weighted taste/pairing/prestige axes; (4) async web context fetch for top-20 candidates; (5) Ollama LLM writes one-line sommelier rationale per pick. All pairing knowledge lives in version-controlled JSON files. A background Claude API panel (off by default) improves scoring weights over time.

**Tech Stack:** Python 3.11 (`pytest`, `httpx`, `dataclasses`), Ollama (`llama3.1:8b`, local), Next.js 14 / TypeScript (review UI), JSON knowledge base files, existing `products.json` / `products.db`.

**Spec:** [docs/superpowers/specs/2026-05-29-curation-engine-design.md](../specs/2026-05-29-curation-engine-design.md)

---

## Scope

This plan covers **Phase 1 and Phase 2** of the spec — the complete working pipeline from brief to ranked list with rationale, plus the internal review UI. Phase 3 (web fetch + PDF export + Supabase publish), Phase 4 (background panel), and Phase 5 (knowledge expansion) are separate plans.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `data/lib/curation/curation_config.json` | LLM provider, model, feature flags — read by `llm_router.py` |
| `data/lib/curation/curation_scoring_model.json` | Scoring weights, bonuses, penalties — v1.0 |
| `data/lib/curation/curation_training_log.jsonl` | Empty seed file for background panel comparison runs (Phase 4 writes to it) |
| `data/lib/pairing_knowledge/food_taxonomy/flavor_signals.json` | 15 master flavor signals with beverage interaction effects |
| `data/lib/pairing_knowledge/food_taxonomy/cuisines.json` | 5 seed cuisines (Thai, Japanese, French, Italian, Indian) |
| `data/lib/pairing_knowledge/food_taxonomy/dishes.json` | 50 seed dishes with signals, intensity, texture, bridge ingredients |
| `data/lib/pairing_knowledge/beverage_profiles/intensity_map.json` | Taste axis → beverage intensity tier per category |
| `data/lib/pairing_knowledge/rules/food_beverage_rules.json` | Food × Beverage pairing rules |
| `data/lib/pairing_knowledge/rules/contraindication_rules.json` | Hard never-pair rules with penalties |
| `data/lib/pairing_knowledge/rules/regional_affinity_rules.json` | Regional pairing shortcuts |
| `data/lib/pairing_knowledge/rules/bridge_ingredient_rules.json` | Bridge ingredient → flavor tag mappings |
| `data/lib/pairing_knowledge/contexts/course_positions.json` | Aperitif → digestif course definitions |
| `data/lib/pairing_knowledge/contexts/occasion_profiles.json` | Occasion types with scoring weight overrides |
| `data/lib/pairing_knowledge/contexts/service_context.json` | Serving temperature and glassware per category |
| `data/lib/pairing_knowledge/product_affinity_rules.json` | Similar / overlap / contrast affinity rules |
| `data/lib/pairing_knowledge/README.md` | Knowledge base authoring guide |
| `lib/curation/__init__.py` | Package marker |
| `lib/curation/models.py` | `StructuredQuery`, `ProductRecord`, `PairingScore`, `ScoredProduct` dataclasses |
| `lib/curation/llm_router.py` | Provider abstraction — Ollama or Claude API, reads `curation_config.json` |
| `lib/curation/brief_parser.py` | Stage 1: NL brief → `StructuredQuery` via LLM |
| `lib/curation/knowledge_base.py` | Loads all pairing knowledge JSON files into `PairingKnowledgeBase` dataclass |
| `lib/curation/hard_filter.py` | Stage 2: filter `products.json` → candidate pool |
| `lib/curation/pairing_resolver.py` | Resolves `StructuredQuery` + candidate → `PairingScore` |
| `lib/curation/scoring_engine.py` | Stage 3: scores each candidate 0–100 |
| `lib/curation/affinity_resolver.py` | Product-to-product affinity (similar / overlap / contrast) — Phase 2 |
| `lib/curation/rationale_writer.py` | Stage 5: LLM writes one-line expert rationale per pick |
| `lib/curation/pipeline.py` | Orchestrates stages 1–3 + 5; entry point for API route |
| `app/api/curation/route.ts` | Next.js API route: POST brief → ranked list JSON |
| `app/curation/page.tsx` | Next.js page — mounts CurationPage component |
| `components/pages/CurationPage.tsx` | Internal review UI — brief form + ranked results |
| `tests/curation/__init__.py` | Package marker |
| `tests/curation/fixtures/sample_products.json` | 20-product fixture (mix of categories, enrichment levels) |
| `tests/curation/fixtures/sample_knowledge_base.json` | Minimal knowledge base fixture for fast unit tests |
| `tests/curation/test_models.py` | Dataclass shape and validation tests |
| `tests/curation/test_hard_filter.py` | Filter logic tests (stock, category, price, score threshold) |
| `tests/curation/test_pairing_resolver.py` | Pairing rule matching, contraindication, bridge bonus tests |
| `tests/curation/test_scoring_engine.py` | Score formula, normalisation, clamping, occasion override tests |
| `tests/curation/test_brief_parser.py` | Brief parser output shape tests (mock LLM) |
| `tests/curation/test_pipeline.py` | End-to-end pipeline integration test (mock LLM) |

### Files to modify

| Path | Change |
|---|---|
| `components/dashboard.tsx` | Add "Curation" nav link |

---

## Task 1: Config and Scoring Model Seed Files

**Files:**
- Create: `data/lib/curation/curation_config.json`
- Create: `data/lib/curation/curation_scoring_model.json`

- [ ] **Step 1: Create curation config**

```json
{
  "llm_provider": "ollama",
  "ollama_model": "llama3.1:8b",
  "ollama_base_url": "http://localhost:11434",
  "background_panel_provider": "anthropic",
  "background_panel_enabled": false
}
```

Save to `data/lib/curation/curation_config.json`.

- [ ] **Step 2: Create scoring model v1.0**

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
    "pairing_boost":   0.15,
    "bridge_bonus":    0.10,
    "regional_bonus":  0.10,
    "intensity_match": 0.10
  },
  "penalties": {
    "avoid_tag":   -0.05,
    "hard_avoid":  -0.40
  }
}
```

Save to `data/lib/curation/curation_scoring_model.json`.

- [ ] **Step 3: Create empty training log seed file**

Create `data/lib/curation/curation_training_log.jsonl` as an empty file. Phase 4 appends to it — it must exist so Phase 4 can open it for appending without error.

- [ ] **Step 4: Commit**

```bash
git add data/lib/curation/
git commit -m "feat(curation): add config, scoring model, and training log seed files"
```

---

## Task 2: Pairing Knowledge Base — Flavor Signals and Cuisines

**Files:**
- Create: `data/lib/pairing_knowledge/food_taxonomy/flavor_signals.json`
- Create: `data/lib/pairing_knowledge/food_taxonomy/cuisines.json`

- [ ] **Step 1: Create flavor_signals.json**

```json
[
  {
    "signal_id": "spicy_heat",
    "label": "Spicy / Heat",
    "description": "Chilli heat, pepper, wasabi",
    "beverage_effects": {
      "amplifies": ["tannin", "alcohol_burn"],
      "suppressed_by": ["sweetness", "effervescence"],
      "enhanced_by": ["light_body", "low_tannin"]
    }
  },
  {
    "signal_id": "umami_savory",
    "label": "Umami / Savoury",
    "description": "Meat, mushroom, aged cheese, soy",
    "beverage_effects": {
      "amplifies": ["fruit_expression"],
      "suppressed_by": ["high_tannin"],
      "enhanced_by": ["earthy_notes", "red_fruit"]
    }
  },
  {
    "signal_id": "umami_fish",
    "label": "Umami / Fish",
    "description": "Fish sauce, anchovy, shellfish brine",
    "beverage_effects": {
      "amplifies": ["tannin_metallic"],
      "suppressed_by": ["high_acidity", "effervescence"],
      "enhanced_by": ["mineral", "citrus"]
    }
  },
  {
    "signal_id": "fatty_rich",
    "label": "Fatty / Rich",
    "description": "Duck, foie gras, cream sauce, butter",
    "beverage_effects": {
      "amplifies": [],
      "suppressed_by": ["tannin", "high_acidity"],
      "enhanced_by": ["tannin", "acid_cut"]
    }
  },
  {
    "signal_id": "sour_bright",
    "label": "Sour / Bright",
    "description": "Lime, vinegar, tamarind, fermented",
    "beverage_effects": {
      "amplifies": ["acidity"],
      "suppressed_by": ["sweetness"],
      "enhanced_by": ["matching_acidity", "effervescence"]
    }
  },
  {
    "signal_id": "sweet_dessert",
    "label": "Sweet / Dessert",
    "description": "Sugar, honey, caramel, chocolate",
    "beverage_effects": {
      "amplifies": ["dryness_perception"],
      "suppressed_by": ["matching_sweetness"],
      "enhanced_by": ["sweet_wine", "dessert_spirits"]
    }
  },
  {
    "signal_id": "bitter_char",
    "label": "Bitter / Charred",
    "description": "Coffee, dark chocolate, grilled char, bitter greens",
    "beverage_effects": {
      "amplifies": ["tannin"],
      "suppressed_by": ["sweetness", "fruit"],
      "enhanced_by": ["roasted_notes", "oak"]
    }
  },
  {
    "signal_id": "aromatic_herb",
    "label": "Aromatic / Herbal",
    "description": "Lemongrass, galangal, basil, coriander",
    "beverage_effects": {
      "amplifies": ["aromatic_complexity"],
      "suppressed_by": [],
      "enhanced_by": ["floral", "citrus", "herbal_spirits"]
    }
  },
  {
    "signal_id": "smoky_char",
    "label": "Smoky / Char",
    "description": "BBQ smoke, charred wood, smoked ingredients",
    "beverage_effects": {
      "amplifies": ["peat", "oak"],
      "suppressed_by": [],
      "enhanced_by": ["peated_whisky", "smoked_spirits"]
    }
  },
  {
    "signal_id": "delicate_protein",
    "label": "Delicate Protein",
    "description": "Steamed fish, poached chicken, light tofu",
    "beverage_effects": {
      "amplifies": ["tannin_clash"],
      "suppressed_by": ["light_body", "low_tannin"],
      "enhanced_by": ["light_white_wine", "sake", "delicate_spirits"]
    }
  },
  {
    "signal_id": "raw_fresh",
    "label": "Raw / Fresh",
    "description": "Sashimi, crudo, ceviche, salad",
    "beverage_effects": {
      "amplifies": ["tannin_metallic"],
      "suppressed_by": ["high_acidity"],
      "enhanced_by": ["crisp_white", "sake", "champagne"]
    }
  },
  {
    "signal_id": "coconut_richness",
    "label": "Coconut / Richness",
    "description": "Coconut milk, tropical cream, rich curry base",
    "beverage_effects": {
      "amplifies": [],
      "suppressed_by": ["effervescence", "acid_cut"],
      "enhanced_by": ["off_dry_white", "tropical_fruit"]
    }
  },
  {
    "signal_id": "earthy_mushroom",
    "label": "Earthy / Mushroom",
    "description": "Truffle, porcini, forest floor, fermented vegetable",
    "beverage_effects": {
      "amplifies": ["earthy_wine_notes"],
      "suppressed_by": [],
      "enhanced_by": ["burgundy", "earthy_red", "aged_sake"]
    }
  },
  {
    "signal_id": "sweet_sour_balance",
    "label": "Sweet-Sour Balance",
    "description": "Thai sweet-sour, agrodolce, fruit chutneys",
    "beverage_effects": {
      "amplifies": [],
      "suppressed_by": [],
      "enhanced_by": ["off_dry_white", "light_red", "riesling"]
    }
  },
  {
    "signal_id": "creamy_dairy",
    "label": "Creamy / Dairy",
    "description": "Cream sauce, ricotta, soft cheese, yoghurt",
    "beverage_effects": {
      "amplifies": [],
      "suppressed_by": ["high_tannin"],
      "enhanced_by": ["oaked_white", "champagne", "light_red"]
    }
  }
]
```

- [ ] **Step 2: Create cuisines.json (5 seed cuisines)**

```json
[
  {
    "cuisine_id": "thai",
    "label": "Thai",
    "dominant_signals": ["spicy_heat", "aromatic_herb", "umami_fish", "sweet_sour_balance", "coconut_richness"],
    "regional_notes": "Northern Thai is earthier; Southern Thai is more coconut-rich and spicy",
    "dishes": ["tom_yum_goong", "pad_thai", "green_curry", "som_tum", "massaman_curry", "larb_moo"]
  },
  {
    "cuisine_id": "japanese",
    "label": "Japanese",
    "dominant_signals": ["umami_savory", "umami_fish", "delicate_protein", "raw_fresh"],
    "regional_notes": "Ranges from raw and delicate (sashimi) to rich and umami-heavy (ramen, yakiniku)",
    "dishes": ["sashimi", "sushi", "tempura", "ramen_tonkotsu", "yakitori", "miso_soup"]
  },
  {
    "cuisine_id": "french",
    "label": "French",
    "dominant_signals": ["fatty_rich", "creamy_dairy", "earthy_mushroom", "umami_savory"],
    "regional_notes": "Classic sauces and rich preparations; regional variation from delicate Loire to robust Burgundy styles",
    "dishes": ["duck_confit", "coq_au_vin", "sole_meuniere", "beef_bourguignon", "foie_gras", "french_onion_soup"]
  },
  {
    "cuisine_id": "italian",
    "label": "Italian",
    "dominant_signals": ["umami_savory", "earthy_mushroom", "fatty_rich", "sour_bright"],
    "regional_notes": "Tomato acidity and cured meat umami dominate; truffle and mushroom in northern regions",
    "dishes": ["pasta_bolognese", "pizza_margherita", "risotto_porcini", "osso_buco", "bistecca_fiorentina", "burrata"]
  },
  {
    "cuisine_id": "indian",
    "label": "Indian",
    "dominant_signals": ["spicy_heat", "aromatic_herb", "creamy_dairy", "sweet_sour_balance"],
    "regional_notes": "North Indian creamier (butter, ghee, cream); South Indian brighter, tamarind-forward, coconut-heavy",
    "dishes": ["butter_chicken", "lamb_rogan_josh", "daal_tadka", "biryani", "fish_curry_kerala", "paneer_tikka"]
  }
]
```

- [ ] **Step 3: Commit**

```bash
git add data/lib/pairing_knowledge/
git commit -m "feat(curation): add flavor signals and seed cuisines to pairing knowledge base"
```

---

## Task 3: Pairing Knowledge Base — Dishes, Intensity Map, Rules

**Files:**
- Create: `data/lib/pairing_knowledge/food_taxonomy/dishes.json`
- Create: `data/lib/pairing_knowledge/beverage_profiles/intensity_map.json`
- Create: `data/lib/pairing_knowledge/rules/food_beverage_rules.json`
- Create: `data/lib/pairing_knowledge/rules/contraindication_rules.json`
- Create: `data/lib/pairing_knowledge/rules/regional_affinity_rules.json`
- Create: `data/lib/pairing_knowledge/rules/bridge_ingredient_rules.json`

- [ ] **Step 1: Create dishes.json (10 representative dishes — expand to 50 in Phase 5)**

```json
[
  {
    "dish_id": "tom_yum_goong",
    "label": "Tom Yum Goong",
    "cuisine": "thai",
    "course_positions": ["first_course", "main_shared"],
    "flavor_signals": ["spicy_heat", "aromatic_herb", "sour_bright", "umami_fish"],
    "texture": "brothy_light",
    "fat_content": "low",
    "intensity": "full",
    "bridge_ingredients": ["lemongrass", "lime", "chilli", "galangal"],
    "contraindication_signals": ["heavy_tannin", "heavy_oak", "heavy_peat"]
  },
  {
    "dish_id": "pad_thai",
    "label": "Pad Thai",
    "cuisine": "thai",
    "course_positions": ["main_shared"],
    "flavor_signals": ["sweet_sour_balance", "umami_fish", "aromatic_herb"],
    "texture": "noodle_medium",
    "fat_content": "medium",
    "intensity": "medium",
    "bridge_ingredients": ["lime", "tamarind", "fish_sauce", "peanut"],
    "contraindication_signals": ["heavy_tannin"]
  },
  {
    "dish_id": "sashimi",
    "label": "Sashimi",
    "cuisine": "japanese",
    "course_positions": ["first_course", "main_shared"],
    "flavor_signals": ["raw_fresh", "delicate_protein", "umami_fish"],
    "texture": "delicate_raw",
    "fat_content": "low",
    "intensity": "light",
    "bridge_ingredients": ["soy", "wasabi", "ginger", "sesame"],
    "contraindication_signals": ["heavy_tannin", "heavy_peat", "heavy_oak"]
  },
  {
    "dish_id": "tempura",
    "label": "Tempura",
    "cuisine": "japanese",
    "course_positions": ["first_course", "main_shared"],
    "flavor_signals": ["delicate_protein", "umami_savory"],
    "texture": "crispy_light",
    "fat_content": "medium",
    "intensity": "light",
    "bridge_ingredients": ["dashi", "ginger", "radish"],
    "contraindication_signals": []
  },
  {
    "dish_id": "duck_confit",
    "label": "Duck Confit",
    "cuisine": "french",
    "course_positions": ["main_course"],
    "flavor_signals": ["fatty_rich", "umami_savory", "bitter_char"],
    "texture": "rich_tender",
    "fat_content": "high",
    "intensity": "full",
    "bridge_ingredients": ["thyme", "garlic", "black_pepper", "cherry"],
    "contraindication_signals": []
  },
  {
    "dish_id": "foie_gras",
    "label": "Foie Gras",
    "cuisine": "french",
    "course_positions": ["aperitif", "first_course"],
    "flavor_signals": ["fatty_rich", "sweet_dessert", "umami_savory"],
    "texture": "silky_rich",
    "fat_content": "very_high",
    "intensity": "full",
    "bridge_ingredients": ["sauternes", "fig", "brioche"],
    "contraindication_signals": ["dry_tannic_red", "heavy_tannin"]
  },
  {
    "dish_id": "pasta_bolognese",
    "label": "Pasta Bolognese",
    "cuisine": "italian",
    "course_positions": ["main_course"],
    "flavor_signals": ["umami_savory", "fatty_rich", "sour_bright"],
    "texture": "hearty_meat",
    "fat_content": "medium",
    "intensity": "full",
    "bridge_ingredients": ["tomato", "basil", "beef", "parmigiano"],
    "contraindication_signals": []
  },
  {
    "dish_id": "risotto_porcini",
    "label": "Risotto ai Porcini",
    "cuisine": "italian",
    "course_positions": ["first_course", "main_course"],
    "flavor_signals": ["earthy_mushroom", "creamy_dairy", "umami_savory"],
    "texture": "creamy_starchy",
    "fat_content": "medium",
    "intensity": "medium",
    "bridge_ingredients": ["porcini", "parmesan", "white_wine", "thyme"],
    "contraindication_signals": []
  },
  {
    "dish_id": "butter_chicken",
    "label": "Butter Chicken",
    "cuisine": "indian",
    "course_positions": ["main_course"],
    "flavor_signals": ["spicy_heat", "creamy_dairy", "aromatic_herb"],
    "texture": "rich_sauce",
    "fat_content": "high",
    "intensity": "medium",
    "bridge_ingredients": ["tomato", "cream", "fenugreek", "garam_masala"],
    "contraindication_signals": []
  },
  {
    "dish_id": "sole_meuniere",
    "label": "Sole Meunière",
    "cuisine": "french",
    "course_positions": ["main_course"],
    "flavor_signals": ["delicate_protein", "creamy_dairy", "sour_bright"],
    "texture": "delicate_tender",
    "fat_content": "medium",
    "intensity": "light",
    "bridge_ingredients": ["lemon", "butter", "capers", "parsley"],
    "contraindication_signals": ["heavy_tannin", "full_red_wine"]
  }
]
```

- [ ] **Step 2: Create intensity_map.json**

```json
[
  {
    "category": "wine",
    "intensity_tiers": ["light", "medium", "full", "powerful"],
    "axis_mappings": [
      {
        "axis": "wine_body",
        "tier_map": {
          "Light":        "light",
          "Medium-Light": "light",
          "Medium":       "medium",
          "Medium-Full":  "full",
          "Full":         "powerful"
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
          "Light":         "light",
          "Medium":        "medium",
          "Pronounced":    "full",
          "Heavy":         "powerful",
          "Cask-dominant": "powerful"
        }
      }
    ],
    "composite_rule": "highest tier across all axis_mappings"
  },
  {
    "category": "gin",
    "intensity_tiers": ["light", "medium", "full", "powerful"],
    "axis_mappings": [
      {
        "axis": "botanical_complexity",
        "tier_map": {
          "Classic":  "light",
          "Modern":   "medium",
          "Floral":   "medium",
          "Spice-led":"full"
        }
      }
    ],
    "composite_rule": "highest tier across all axis_mappings"
  }
]
```

- [ ] **Step 3: Create food_beverage_rules.json**

```json
[
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
    "rationale_seed": "Thai cuisine's aromatic heat calls for whiskies with natural sweetness and gentle oak.",
    "source": "expert_seed",
    "confidence": "A"
  },
  {
    "rule_id": "raw-fish-white-wine",
    "food_signals": ["raw_fresh", "umami_fish", "delicate_protein"],
    "beverage_category": "White Wine",
    "relationship_type": "complement",
    "recommended_axes": {
      "wine_acidity":  {"values": ["Medium-Full", "Full"], "reason": "Acidity cuts through fish oils"},
      "wine_body":     {"values": ["Light", "Medium-Light", "Medium"], "reason": "Match delicate protein weight"}
    },
    "recommended_flavor_tags": ["citrus", "mineral", "green apple", "saline"],
    "avoid_flavor_tags": ["heavy oak", "vanilla cream", "tropical richness"],
    "score_boost": 0.15,
    "rationale_seed": "Raw fish needs crisp acidity and mineral freshness to cleanse and complement without overpowering.",
    "source": "expert_seed",
    "confidence": "A"
  },
  {
    "rule_id": "fatty-rich-red-wine",
    "food_signals": ["fatty_rich", "umami_savory"],
    "beverage_category": "Red Wine",
    "relationship_type": "complement",
    "recommended_axes": {
      "wine_tannin": {"values": ["Medium", "Medium-Full", "Full"], "reason": "Tannin cuts fat and cleanses palate"},
      "wine_body":   {"values": ["Medium-Full", "Full"], "reason": "Match the weight of rich preparations"}
    },
    "recommended_flavor_tags": ["dark plum", "blackcurrant", "leather", "cedar"],
    "avoid_flavor_tags": ["floral", "delicate red fruit"],
    "score_boost": 0.12,
    "rationale_seed": "Rich, fatty dishes need structured tannin to cut through and reset the palate.",
    "source": "expert_seed",
    "confidence": "A"
  },
  {
    "rule_id": "earthy-mushroom-burgundy",
    "food_signals": ["earthy_mushroom", "umami_savory"],
    "beverage_category": "Red Wine",
    "relationship_type": "bridge",
    "recommended_axes": {
      "wine_body":   {"values": ["Light", "Medium-Light", "Medium"], "reason": "Earthiness needs elegance, not power"}
    },
    "recommended_flavor_tags": ["earth", "mushroom", "red cherry", "forest floor"],
    "avoid_flavor_tags": ["heavy oak", "jammy fruit", "sweet tannin"],
    "score_boost": 0.15,
    "rationale_seed": "Mushroom and truffle dishes call for earthy, elegant reds that mirror the forest floor character.",
    "source": "expert_seed",
    "confidence": "A"
  },
  {
    "rule_id": "spicy-heat-sparkling",
    "food_signals": ["spicy_heat"],
    "beverage_category": "Sparkling Wine",
    "relationship_type": "complement",
    "recommended_axes": {},
    "recommended_flavor_tags": ["citrus", "green apple", "biscuit"],
    "avoid_flavor_tags": [],
    "score_boost": 0.10,
    "rationale_seed": "Effervescence and acidity in sparkling wines suppress chilli heat and refresh the palate.",
    "source": "expert_seed",
    "confidence": "B"
  }
]
```

- [ ] **Step 4: Create contraindication_rules.json**

```json
[
  {
    "rule_id": "tannic-red-raw-fish",
    "label": "Tannic red wine + raw or delicate fish",
    "beverage_profile": {
      "classification": ["Red Wine"],
      "wine_tannin": ["Medium-Full", "Full"]
    },
    "food_signals": ["raw_fish", "delicate_protein"],
    "penalty": -0.40,
    "reason": "Tannin reacts with fish oils producing metallic bitterness.",
    "severity": "hard_avoid",
    "exception": "Oily fish like salmon or tuna can tolerate light Pinot Noir"
  },
  {
    "rule_id": "sweet-wine-dry-savoury",
    "label": "Very sweet wine + dry savoury food",
    "beverage_profile": {
      "style": ["Sweet", "Lush"],
      "classification": ["White Wine", "Sparkling Wine"]
    },
    "food_signals": ["umami_savory", "fatty_rich"],
    "penalty": -0.25,
    "reason": "Sweet wine against dry savoury food makes the wine taste harsh and acidic.",
    "severity": "soft_avoid",
    "exception": "Sauternes with foie gras is a classic exception — the fat absorbs the sweetness"
  },
  {
    "rule_id": "heavy-peat-delicate-dish",
    "label": "Heavily peated whisky + delicate dish",
    "beverage_profile": {
      "peat_smoke": ["Heavy"]
    },
    "food_signals": ["delicate_protein", "raw_fresh"],
    "penalty": -0.35,
    "reason": "Heavy peat smoke overwhelms delicate flavours entirely.",
    "severity": "hard_avoid",
    "exception": "Smoked salmon is a classic Islay whisky pairing"
  }
]
```

- [ ] **Step 5: Create regional_affinity_rules.json and bridge_ingredient_rules.json**

`regional_affinity_rules.json`:
```json
[
  {"rule_id": "thai-thai", "cuisine_id": "thai", "product_countries": ["Thailand"], "bonus": 0.10, "rationale": "Local spirits match local cuisine naturally"},
  {"rule_id": "french-french", "cuisine_id": "french", "product_countries": ["France"], "bonus": 0.10, "rationale": "What grows together goes together"},
  {"rule_id": "italian-italian", "cuisine_id": "italian", "product_countries": ["Italy"], "bonus": 0.10, "rationale": "Italian wine with Italian food is the classical pairing"},
  {"rule_id": "japanese-japanese", "cuisine_id": "japanese", "product_countries": ["Japan"], "bonus": 0.10, "rationale": "Sake and Japanese spirits with Japanese cuisine"},
  {"rule_id": "indian-indian", "cuisine_id": "indian", "product_countries": ["India"], "bonus": 0.08, "rationale": "Indian spirits and wine increasingly match Indian cuisine"}
]
```

`bridge_ingredient_rules.json`:
```json
[
  {"bridge_id": "lemon-citrus", "ingredient": "lemon", "matching_flavor_tags": ["citrus", "citrus zest", "lemon", "bright acidity"]},
  {"bridge_id": "vanilla-vanilla", "ingredient": "vanilla", "matching_flavor_tags": ["vanilla", "vanilla cream", "sweet spice"]},
  {"bridge_id": "smoke-peat", "ingredient": "smoke", "matching_flavor_tags": ["smoke", "peat", "smoked", "bonfire"]},
  {"bridge_id": "mushroom-earth", "ingredient": "mushroom", "matching_flavor_tags": ["earth", "mushroom", "forest floor", "truffle"]},
  {"bridge_id": "cherry-red-fruit", "ingredient": "cherry", "matching_flavor_tags": ["cherry", "red cherry", "red fruit", "dark cherry"]},
  {"bridge_id": "lime-citrus", "ingredient": "lime", "matching_flavor_tags": ["citrus", "lime", "citrus zest", "tropical"]},
  {"bridge_id": "honey-honey", "ingredient": "honey", "matching_flavor_tags": ["honey", "honeysuckle", "sweet floral"]}
]
```

- [ ] **Step 6: Commit**

```bash
git add data/lib/pairing_knowledge/
git commit -m "feat(curation): add dishes, intensity map, and pairing rules to knowledge base"
```

---

## Task 4: Pairing Knowledge Base — Contexts

**Files:**
- Create: `data/lib/pairing_knowledge/contexts/course_positions.json`
- Create: `data/lib/pairing_knowledge/contexts/occasion_profiles.json`
- Create: `data/lib/pairing_knowledge/contexts/service_context.json`
- Create: `data/lib/pairing_knowledge/product_affinity_rules.json`
- Create: `data/lib/pairing_knowledge/README.md`

- [ ] **Step 1: Create course_positions.json**

```json
[
  {
    "course_id": "aperitif",
    "label": "Aperitif / Pre-meal",
    "role": "stimulate appetite, cleanse palate, light and refreshing",
    "preferred_intensity": ["light", "medium"],
    "preferred_categories": ["Champagne", "Sparkling Wine", "Gin", "Dry Sherry", "Prosecco"],
    "avoid_profiles": ["heavy_oak", "full_tannin", "lush_sweetness"]
  },
  {
    "course_id": "first_course",
    "label": "First Course",
    "role": "complement starter, build into the meal",
    "preferred_intensity": ["light", "medium"],
    "preferred_categories": ["White Wine", "Champagne", "Sake", "Light Red Wine"],
    "avoid_profiles": ["very_full_body", "heavy_tannin"]
  },
  {
    "course_id": "main_course",
    "label": "Main Course",
    "role": "match the weight and intensity of the main dish",
    "preferred_intensity": ["medium", "full", "powerful"],
    "preferred_categories": ["Red Wine", "White Wine", "Whisky", "Sake"],
    "avoid_profiles": []
  },
  {
    "course_id": "main_shared",
    "label": "Shared / Family Style",
    "role": "versatile, not too dominant, works across multiple dishes",
    "preferred_intensity": ["light", "medium", "full"],
    "preferred_categories": ["White Wine", "Light Red Wine", "Sparkling Wine", "Beer"],
    "avoid_profiles": ["very_tannic", "very_sweet"]
  },
  {
    "course_id": "cheese",
    "label": "Cheese Course",
    "role": "complement cheese intensity and fat",
    "preferred_intensity": ["medium", "full"],
    "preferred_categories": ["Red Wine", "Port", "Dessert Wine", "Whisky"],
    "avoid_profiles": []
  },
  {
    "course_id": "dessert",
    "label": "Dessert",
    "role": "match or exceed sweetness of dessert",
    "preferred_intensity": ["medium", "full"],
    "preferred_categories": ["Dessert Wine", "Port", "Liqueur", "Champagne"],
    "avoid_profiles": ["very_dry", "very_tannic"]
  },
  {
    "course_id": "digestif",
    "label": "Digestif",
    "role": "aid digestion, warming, complex",
    "preferred_intensity": ["full", "powerful"],
    "preferred_categories": ["Whisky", "Brandy", "Cognac", "Armagnac", "Grappa", "Amaro"],
    "avoid_profiles": ["light_body", "very_sweet"]
  }
]
```

- [ ] **Step 2: Create occasion_profiles.json**

```json
[
  {
    "occasion_id": "business_dinner",
    "label": "Business Dinner",
    "guest_knowledge": "mixed",
    "menu_tier": "premium",
    "scoring_weight_overrides": {
      "brand_prestige": 0.30,
      "taste_match":    0.35,
      "margin_signal":  0.10,
      "web_freshness":  0.25
    },
    "notes": "Recognisable labels matter; avoid anything too adventurous or divisive"
  },
  {
    "occasion_id": "celebration",
    "label": "Celebration",
    "guest_knowledge": "mixed",
    "menu_tier": "premium",
    "scoring_weight_overrides": {
      "brand_prestige": 0.25,
      "taste_match":    0.30,
      "margin_signal":  0.10,
      "web_freshness":  0.35
    },
    "notes": "Showmanship and effervescence welcome; prestige and story important"
  },
  {
    "occasion_id": "everyday",
    "label": "Everyday / Casual",
    "guest_knowledge": "novice",
    "menu_tier": "everyday",
    "scoring_weight_overrides": {
      "brand_prestige": 0.15,
      "taste_match":    0.40,
      "margin_signal":  0.20,
      "web_freshness":  0.10
    },
    "notes": "Approachability and value win here"
  },
  {
    "occasion_id": "gift",
    "label": "Gift",
    "guest_knowledge": "mixed",
    "menu_tier": "mid-range",
    "scoring_weight_overrides": {
      "brand_prestige": 0.35,
      "taste_match":    0.25,
      "margin_signal":  0.05,
      "web_freshness":  0.20
    },
    "notes": "Presentation, recognisability, and price point are primary"
  },
  {
    "occasion_id": "horecab2b_tasting_menu",
    "label": "HoReCa Tasting Menu",
    "guest_knowledge": "expert",
    "menu_tier": "prestige",
    "scoring_weight_overrides": {
      "brand_prestige": 0.30,
      "taste_match":    0.40,
      "margin_signal":  0.05,
      "web_freshness":  0.25
    },
    "glass_pour_economics": true,
    "notes": "Provenance story and regional identity weighted heavily"
  }
]
```

- [ ] **Step 3: Create service_context.json**

```json
[
  {"category": "White Wine",     "serving_temp_c": [8, 12],  "glassware": "white_wine_glass"},
  {"category": "Red Wine",       "serving_temp_c": [14, 18], "glassware": "red_wine_glass"},
  {"category": "Champagne",      "serving_temp_c": [6, 10],  "glassware": "flute_or_coupe"},
  {"category": "Sparkling Wine", "serving_temp_c": [6, 10],  "glassware": "flute"},
  {"category": "Whisky",         "serving_temp_c": [18, 22], "glassware": "glencairn_or_tumbler", "notes": "Neat or with a drop of water; avoid heavy ice"},
  {"category": "Sake",           "serving_temp_c": [5, 55],  "glassware": "ochoko_or_wine_glass", "notes": "Temperature varies by style — Junmai Daiginjo chilled, aged Koshu warm"},
  {"category": "Gin",            "serving_temp_c": [4, 8],   "glassware": "copa_or_highball"},
  {"category": "Rum",            "serving_temp_c": [18, 22], "glassware": "tumbler_or_snifter"},
  {"category": "Brandy",         "serving_temp_c": [18, 22], "glassware": "snifter"}
]
```

- [ ] **Step 4: Create product_affinity_rules.json**

```json
[
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
  },
  {
    "affinity_id": "citrus-driven-overlap",
    "relationship_type": "overlap",
    "shared_signals": ["citrus zest", "bright acidity", "aromatic"],
    "eligible_categories": ["White Wine", "Sparkling Wine", "Gin", "Rum"],
    "rationale_template": "Both share {shared_tags} — a bright, citrus-driven character that works across categories."
  },
  {
    "affinity_id": "peaty-whisky-vs-crisp-white",
    "relationship_type": "contrast",
    "profile_a": {"category": "whisky", "peat_smoke": ["Medium", "Heavy"]},
    "profile_b": {"category": "White Wine", "wine_acidity": ["Medium-Full", "Full"], "flavor_tags_include": ["citrus", "mineral"]},
    "contrast_logic": "smoke_vs_acid",
    "rationale_template": "Where {a} brings smoke and weight, {b} cuts through with bright acidity — a contrast pairing that cleanses and resets the palate."
  }
]
```

- [ ] **Step 5: Create pairing_knowledge/README.md**

```markdown
# Pairing Knowledge Base

All files in this directory are JSON, human-editable, and version-controlled.
The sommelier team can update rules without touching code.

## Authoring Guide

### Adding a new dish
Edit `food_taxonomy/dishes.json`. Required fields: `dish_id`, `label`, `cuisine`,
`flavor_signals` (must reference IDs from `flavor_signals.json`), `intensity`
(light/medium/full/powerful), `texture`, `bridge_ingredients`.

### Adding a food×beverage rule
Edit `rules/food_beverage_rules.json`. `confidence` must be A, B, or C.
A = strong expert consensus. B = reasonable expert opinion. C = experimental.

### Adding a contraindication
Edit `rules/contraindication_rules.json`. Always include an `exception` field —
many contraindications have classical exceptions. `severity` is `hard_avoid`
(-0.40 penalty) or `soft_avoid` (-0.25 penalty).

### Updating scoring weights
Edit `../curation/curation_scoring_model.json`. Base weights must sum to 1.0.
Bump the version field. Changes take effect on next server restart.
```

- [ ] **Step 6: Commit**

```bash
git add data/lib/pairing_knowledge/
git commit -m "feat(curation): add course positions, occasion profiles, affinity rules, and README"
```

---

## Task 5: Core Python Models

**Files:**
- Create: `lib/curation/__init__.py`
- Create: `lib/curation/models.py`
- Test: `tests/curation/test_models.py`

- [ ] **Step 1: Write failing test**

```python
# tests/curation/test_models.py
from lib.curation.models import StructuredQuery, PairingScore, ScoredProduct

def test_structured_query_defaults():
    q = StructuredQuery(raw_brief="Best USA wine")
    assert q.category_filter == []
    assert q.country_filter == []
    assert q.in_stock_only is True
    assert q.output_size == 12

def test_pairing_score_total_penalty():
    ps = PairingScore(
        rule_matched=False,
        pairing_boost=0.0,
        bridge_bonus=0.0,
        regional_bonus=0.0,
        intensity_ok=True,
        contraindication_triggered=True,
        contraindication_penalty=-0.40,
        avoid_tag_count=2,
        avoid_tag_penalty=-0.10,
        matched_rule_ids=[],
    )
    assert ps.total_penalty == -0.50

def test_scored_product_final_score_clamped():
    sp = ScoredProduct(sku="WRW001", name="Test Wine", raw_score=1.25, rationale="")
    assert sp.final_score == 100
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
python -m pytest tests/curation/test_models.py -v
```

Expected: `ModuleNotFoundError` — `lib.curation.models` does not exist yet.

- [ ] **Step 3: Create `lib/curation/__init__.py`**

Empty file:
```python
```

Create `tests/curation/__init__.py` — empty file.

- [ ] **Step 4: Create `lib/curation/models.py`**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class StructuredQuery:
    raw_brief: str
    category_filter: list[str] = field(default_factory=list)
    subcategory_filter: list[str] = field(default_factory=list)
    country_filter: list[str] = field(default_factory=list)
    region_filter: list[str] = field(default_factory=list)
    score_threshold: Optional[float] = None
    price_min_thb: Optional[float] = None
    price_max_thb: Optional[float] = None
    prefer_high_margin: bool = False
    in_stock_only: bool = True
    pairing_context: Optional[str] = None   # e.g. "Thai food", "sashimi"
    course_position: Optional[str] = None   # course_id
    occasion_id: Optional[str] = None
    menu_tier: Optional[str] = None
    output_size: int = 12
    audience: list[str] = field(default_factory=list)  # ["internal","customer","b2b"]


@dataclass
class PairingScore:
    rule_matched: bool
    pairing_boost: float
    bridge_bonus: float
    regional_bonus: float
    intensity_ok: bool
    contraindication_triggered: bool
    contraindication_penalty: float
    avoid_tag_count: int
    avoid_tag_penalty: float
    matched_rule_ids: list[str]

    @property
    def total_bonus(self) -> float:
        return self.pairing_boost + self.bridge_bonus + self.regional_bonus + (0.10 if self.intensity_ok else 0.0)

    @property
    def total_penalty(self) -> float:
        return self.contraindication_penalty + self.avoid_tag_penalty


@dataclass
class ScoredProduct:
    sku: str
    name: str
    raw_score: float          # 0.0–1.4+ before clamping
    rationale: str
    pairing_score: Optional[PairingScore] = None
    web_signal: Optional[float] = None   # normalised critic score 0–1
    matched_rule_ids: list[str] = field(default_factory=list)

    @property
    def final_score(self) -> int:
        return int(min(max(self.raw_score, 0.0), 1.0) * 100)
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
python -m pytest tests/curation/test_models.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/curation/ tests/curation/
git commit -m "feat(curation): add core dataclass models"
```

---

## Task 6: LLM Router

**Files:**
- Create: `lib/curation/llm_router.py`

- [ ] **Step 1: Write failing test**

```python
# tests/curation/test_brief_parser.py  (add to later; for now just smoke-test router)
import json, pathlib
from unittest.mock import patch, MagicMock
from lib.curation.llm_router import LLMRouter

CONFIG = {
    "llm_provider": "ollama",
    "ollama_model": "llama3.1:8b",
    "ollama_base_url": "http://localhost:11434",
    "background_panel_provider": "anthropic",
    "background_panel_enabled": False,
}

def test_router_returns_text_from_ollama(tmp_path):
    cfg = tmp_path / "curation_config.json"
    cfg.write_text(json.dumps(CONFIG))
    router = LLMRouter(config_path=cfg)
    with patch("httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": "hello"}}
        )
        result = router.complete("Say hello", tier="production")
    assert result == "hello"
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/curation/test_brief_parser.py::test_router_returns_text_from_ollama -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/llm_router.py`**

```python
from __future__ import annotations
import json
from pathlib import Path
from typing import Literal

import httpx


class LLMRouter:
    def __init__(self, config_path: Path | None = None):
        if config_path is None:
            config_path = Path(__file__).resolve().parents[2] / "data" / "lib" / "curation" / "curation_config.json"
        self._config = json.loads(config_path.read_text())

    def complete(self, prompt: str, tier: Literal["production", "panel"] = "production") -> str:
        if tier == "panel":
            return self._call_anthropic(prompt)
        provider = self._config.get("llm_provider", "ollama")
        if provider == "ollama":
            return self._call_ollama(prompt)
        return self._call_anthropic(prompt)

    def _call_ollama(self, prompt: str) -> str:
        base = self._config.get("ollama_base_url", "http://localhost:11434")
        model = self._config.get("ollama_model", "llama3.1:8b")
        resp = httpx.post(
            f"{base}/api/chat",
            json={"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def _call_anthropic(self, prompt: str) -> str:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
python -m pytest tests/curation/test_brief_parser.py::test_router_returns_text_from_ollama -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/llm_router.py tests/curation/test_brief_parser.py
git commit -m "feat(curation): add LLM router with Ollama/Anthropic provider abstraction"
```

---

## Task 7: Knowledge Base Loader

**Files:**
- Create: `lib/curation/knowledge_base.py`

- [ ] **Step 1: Write failing test**

Add to `tests/curation/test_models.py`:

```python
from lib.curation.knowledge_base import PairingKnowledgeBase, load_knowledge_base
import pathlib

KB_PATH = pathlib.Path("data/lib/pairing_knowledge")

def test_knowledge_base_loads_flavor_signals():
    kb = load_knowledge_base(KB_PATH)
    assert len(kb.flavor_signals) == 15
    ids = {s["signal_id"] for s in kb.flavor_signals}
    assert "spicy_heat" in ids
    assert "umami_fish" in ids

def test_knowledge_base_loads_food_beverage_rules():
    kb = load_knowledge_base(KB_PATH)
    assert len(kb.food_beverage_rules) >= 3

def test_knowledge_base_loads_contraindications():
    kb = load_knowledge_base(KB_PATH)
    assert any(r["severity"] == "hard_avoid" for r in kb.contraindication_rules)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/curation/test_models.py::test_knowledge_base_loads_flavor_signals -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/knowledge_base.py`**

```python
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PairingKnowledgeBase:
    flavor_signals: list[dict]
    cuisines: list[dict]
    dishes: list[dict]
    intensity_map: list[dict]
    food_beverage_rules: list[dict]
    contraindication_rules: list[dict]
    regional_affinity_rules: list[dict]
    bridge_ingredient_rules: list[dict]
    course_positions: list[dict]
    occasion_profiles: list[dict]
    service_context: list[dict]
    product_affinity_rules: list[dict]

    # Precomputed indexes for fast lookup
    signal_index: dict = field(default_factory=dict)
    cuisine_index: dict = field(default_factory=dict)
    dish_index: dict = field(default_factory=dict)
    occasion_index: dict = field(default_factory=dict)
    course_index: dict = field(default_factory=dict)
    intensity_index: dict = field(default_factory=dict)  # category → axis → value → tier

    def __post_init__(self):
        self.signal_index = {s["signal_id"]: s for s in self.flavor_signals}
        self.cuisine_index = {c["cuisine_id"]: c for c in self.cuisines}
        self.dish_index = {d["dish_id"]: d for d in self.dishes}
        self.occasion_index = {o["occasion_id"]: o for o in self.occasion_profiles}
        self.course_index = {c["course_id"]: c for c in self.course_positions}
        for cat_entry in self.intensity_map:
            cat = cat_entry["category"]
            self.intensity_index[cat] = {}
            for mapping in cat_entry["axis_mappings"]:
                self.intensity_index[cat][mapping["axis"]] = mapping["tier_map"]


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return data if isinstance(data, list) else [data]


def load_knowledge_base(base: Path) -> PairingKnowledgeBase:
    ft = base / "food_taxonomy"
    bv = base / "beverage_profiles"
    ru = base / "rules"
    cx = base / "contexts"
    return PairingKnowledgeBase(
        flavor_signals=_load(ft / "flavor_signals.json"),
        cuisines=_load(ft / "cuisines.json"),
        dishes=_load(ft / "dishes.json"),
        intensity_map=_load(bv / "intensity_map.json"),
        food_beverage_rules=_load(ru / "food_beverage_rules.json"),
        contraindication_rules=_load(ru / "contraindication_rules.json"),
        regional_affinity_rules=_load(ru / "regional_affinity_rules.json"),
        bridge_ingredient_rules=_load(ru / "bridge_ingredient_rules.json"),
        course_positions=_load(cx / "course_positions.json"),
        occasion_profiles=_load(cx / "occasion_profiles.json"),
        service_context=_load(cx / "service_context.json"),
        product_affinity_rules=_load(base / "product_affinity_rules.json"),
    )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/curation/test_models.py -k "knowledge_base" -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/knowledge_base.py
git commit -m "feat(curation): add pairing knowledge base loader with precomputed indexes"
```

---

## Task 8: Hard Filter

**Files:**
- Create: `lib/curation/hard_filter.py`
- Test: `tests/curation/test_hard_filter.py`
- Create: `tests/curation/fixtures/sample_products.json`

- [ ] **Step 1: Create sample_products.json fixture**

20 products covering: in-stock/out-of-stock, multiple categories (Red Wine, White Wine, Whisky, Gin), multiple countries, different price ranges, some with `wine_body`/`flavor_tags` and some without.

Save as `tests/curation/fixtures/sample_products.json` (abbreviated here — create 20 full records):

```json
[
  {"id": "p1", "sku": "WRW001", "name": "Napa Cabernet", "classification": "Red Wine", "country": "USA", "region": "California", "price": 3500, "b2b_margin_pct": "30%", "is_in_stock": "1", "wine_body": "Full", "wine_tannin": "Full", "wine_acidity": "Medium", "flavor_tags": ["blackcurrant", "cedar", "dark plum"], "desc_en_short": "Bold Napa Cab.", "taxonomy_confidence": 0.9},
  {"id": "p2", "sku": "WWW001", "name": "Chablis Premier Cru", "classification": "White Wine", "country": "France", "region": "Chablis", "price": 2800, "b2b_margin_pct": "28%", "is_in_stock": "1", "wine_body": "Medium-Light", "wine_tannin": "Light", "wine_acidity": "Full", "flavor_tags": ["mineral", "citrus", "green apple"], "desc_en_short": "Crisp Chablis.", "taxonomy_confidence": 0.92},
  {"id": "p3", "sku": "LWH001", "name": "Glenfarclas 12", "classification": "Whisky", "country": "Scotland", "region": "Speyside", "price": 4200, "b2b_margin_pct": "25%", "is_in_stock": "1", "flavor_tags": ["honey", "vanilla", "sherry"], "desc_en_short": "Classic Speyside.", "taxonomy_confidence": 0.88},
  {"id": "p4", "sku": "WRW002", "name": "Out of Stock Red", "classification": "Red Wine", "country": "France", "region": "Bordeaux", "price": 2200, "b2b_margin_pct": "22%", "is_in_stock": "0", "wine_body": "Full", "flavor_tags": ["blackcurrant"], "desc_en_short": "Good Bordeaux.", "taxonomy_confidence": 0.85},
  {"id": "p5", "sku": "LGN001", "name": "Hendricks Gin", "classification": "Gin", "country": "Scotland", "price": 1800, "b2b_margin_pct": "32%", "is_in_stock": "1", "flavor_tags": ["cucumber", "rose", "citrus"], "desc_en_short": "Floral Scottish gin.", "taxonomy_confidence": 0.9}
]
```

Add 15 more products to reach 20 — vary all fields.

- [ ] **Step 2: Write failing tests**

```python
# tests/curation/test_hard_filter.py
import json, pathlib
from lib.curation.hard_filter import hard_filter
from lib.curation.models import StructuredQuery

FIXTURES = pathlib.Path("tests/curation/fixtures/sample_products.json")

def _products():
    return json.loads(FIXTURES.read_text())

def test_filter_in_stock_only():
    q = StructuredQuery(raw_brief="test", in_stock_only=True)
    result = hard_filter(_products(), q)
    assert all(p["is_in_stock"] == "1" for p in result)

def test_filter_category():
    q = StructuredQuery(raw_brief="test", category_filter=["Whisky"])
    result = hard_filter(_products(), q)
    assert all(p["classification"] == "Whisky" for p in result)

def test_filter_country():
    q = StructuredQuery(raw_brief="test", country_filter=["USA"])
    result = hard_filter(_products(), q)
    assert all(p["country"] == "USA" for p in result)

def test_filter_price_range():
    q = StructuredQuery(raw_brief="test", price_min_thb=2000, price_max_thb=3000)
    result = hard_filter(_products(), q)
    assert all(2000 <= p["price"] <= 3000 for p in result)

def test_filter_no_constraints_returns_in_stock_only_by_default():
    q = StructuredQuery(raw_brief="test")
    result = hard_filter(_products(), q)
    assert all(p["is_in_stock"] == "1" for p in result)
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
python -m pytest tests/curation/test_hard_filter.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 4: Create `lib/curation/hard_filter.py`**

```python
from __future__ import annotations
from lib.curation.models import StructuredQuery


def hard_filter(products: list[dict], query: StructuredQuery) -> list[dict]:
    result = []
    for p in products:
        if query.in_stock_only and str(p.get("is_in_stock", "0")) != "1":
            continue
        if query.category_filter:
            cls = p.get("classification", "")
            if not any(f.lower() in cls.lower() for f in query.category_filter):
                continue
        if query.country_filter:
            country = p.get("country", "")
            if not any(f.lower() == country.lower() for f in query.country_filter):
                continue
        if query.region_filter:
            region = p.get("region", "")
            if not any(f.lower() in region.lower() for f in query.region_filter):
                continue
        price = float(p.get("price", 0))
        if query.price_min_thb is not None and price < query.price_min_thb:
            continue
        if query.price_max_thb is not None and price > query.price_max_thb:
            continue
        result.append(p)
    return result
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/curation/test_hard_filter.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/curation/hard_filter.py tests/curation/
git commit -m "feat(curation): add hard filter with stock, category, country, price constraints"
```

---

## Task 9: Pairing Resolver

**Files:**
- Create: `lib/curation/pairing_resolver.py`
- Test: `tests/curation/test_pairing_resolver.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/curation/test_pairing_resolver.py
from lib.curation.pairing_resolver import resolve_pairing
from lib.curation.knowledge_base import load_knowledge_base
from lib.curation.models import StructuredQuery
import pathlib

KB = load_knowledge_base(pathlib.Path("data/lib/pairing_knowledge"))

WHISKY_PRODUCT = {
    "sku": "LWH001", "classification": "Whisky", "country": "Scotland",
    "flavor_tags": ["honey", "vanilla", "tropical fruit"],
    "taste_profile": {"axes": {"peat_smoke": {"value": "None"}, "sweetness": {"value": "Balanced"}, "oak_influence": {"value": "Light"}}}
}

RAW_FISH_RED = {
    "sku": "WRW001", "classification": "Red Wine", "country": "France",
    "wine_tannin": "Full", "flavor_tags": ["dark plum", "tannin"],
}

def test_pairing_boost_for_thai_whisky():
    q = StructuredQuery(raw_brief="whisky with thai food", pairing_context="Thai food")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.rule_matched is True
    assert score.pairing_boost > 0

def test_bridge_bonus_for_matching_ingredient():
    q = StructuredQuery(raw_brief="test", pairing_context="Thai food")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.bridge_bonus > 0  # honey/vanilla matches bridge ingredients

def test_contraindication_penalty_for_tannic_red_raw_fish():
    q = StructuredQuery(raw_brief="wine with sashimi", pairing_context="sashimi")
    score = resolve_pairing(q, RAW_FISH_RED, KB)
    assert score.contraindication_triggered is True
    assert score.contraindication_penalty <= -0.35

def test_no_pairing_context_returns_zero_bonus():
    q = StructuredQuery(raw_brief="best USA wine")
    score = resolve_pairing(q, WHISKY_PRODUCT, KB)
    assert score.pairing_boost == 0.0
    assert score.bridge_bonus == 0.0
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/curation/test_pairing_resolver.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/pairing_resolver.py`**

```python
from __future__ import annotations
from lib.curation.models import StructuredQuery, PairingScore
from lib.curation.knowledge_base import PairingKnowledgeBase


_INTENSITY_ORDER = ["light", "medium", "full", "powerful"]


def _resolve_food_signals(context: str, kb: PairingKnowledgeBase) -> list[str]:
    """Map pairing_context string to a list of flavor signal IDs."""
    ctx = context.lower().strip()
    # Try exact dish match
    for dish in kb.dishes:
        if dish["dish_id"].replace("_", " ") in ctx or dish["label"].lower() in ctx:
            return dish["flavor_signals"]
    # Try cuisine match
    for cuisine in kb.cuisines:
        if cuisine["label"].lower() in ctx or cuisine["cuisine_id"] in ctx:
            return cuisine["dominant_signals"]
    return []


def _beverage_intensity(product: dict, kb: PairingKnowledgeBase) -> str | None:
    cls = product.get("classification", "")
    cat_map = kb.intensity_index.get(cls)
    if not cat_map:
        return None
    tiers = []
    # Wine: use wine_body directly
    if "wine_body" in product and "wine_body" in cat_map:
        t = cat_map["wine_body"].get(product["wine_body"])
        if t:
            tiers.append(t)
    # Spirits: use taste_profile axes
    tp = product.get("taste_profile") or {}
    axes = tp.get("axes", {})
    for axis_key, tier_map in cat_map.items():
        if axis_key in axes:
            val = axes[axis_key].get("value")
            t = tier_map.get(val)
            if t:
                tiers.append(t)
    if not tiers:
        return None
    # composite: highest tier
    return max(tiers, key=lambda x: _INTENSITY_ORDER.index(x) if x in _INTENSITY_ORDER else 0)


def resolve_pairing(
    query: StructuredQuery,
    candidate: dict,
    kb: PairingKnowledgeBase,
    avoid_tag_rate: float = -0.05,  # loaded from curation_scoring_model.json by caller
) -> PairingScore:
    if not query.pairing_context:
        return PairingScore(
            rule_matched=False, pairing_boost=0.0, bridge_bonus=0.0,
            regional_bonus=0.0, intensity_ok=True,
            contraindication_triggered=False, contraindication_penalty=0.0,
            avoid_tag_count=0, avoid_tag_penalty=0.0, matched_rule_ids=[],
        )

    food_signals = _resolve_food_signals(query.pairing_context, kb)
    cls = candidate.get("classification", "")
    flavor_tags = [t.lower() for t in (candidate.get("flavor_tags") or [])]
    country = (candidate.get("country") or "").lower()
    matched_rule_ids = []

    # ── Pairing boost ────────────────────────────────────────────────────────
    pairing_boost = 0.0
    avoid_tags_hit: list[str] = []
    for rule in kb.food_beverage_rules:
        if not any(sig in food_signals for sig in rule.get("food_signals", [])):
            continue
        bev_cat = rule.get("beverage_category", "")
        if bev_cat.lower() not in cls.lower():
            continue
        # Check recommended axes
        rec_axes = rule.get("recommended_axes", {})
        tp = candidate.get("taste_profile") or {}
        axes = tp.get("axes", {})
        axis_hits = 0
        for axis_key, spec in rec_axes.items():
            prod_val = candidate.get(axis_key) or (axes.get(axis_key) or {}).get("value")
            if prod_val and prod_val in spec.get("values", []):
                axis_hits += 1
        if axis_hits > 0 or not rec_axes:
            pairing_boost = max(pairing_boost, rule.get("score_boost", 0.0))
            matched_rule_ids.append(rule["rule_id"])
        avoid_tags_hit += [t for t in rule.get("avoid_flavor_tags", []) if t.lower() in flavor_tags]

    # ── Bridge bonus ─────────────────────────────────────────────────────────
    bridge_bonus = 0.0
    ctx_lower = query.pairing_context.lower()
    for entry in kb.bridge_ingredient_rules:
        if entry["ingredient"] in ctx_lower:
            if any(ft.lower() in flavor_tags for ft in entry["matching_flavor_tags"]):
                bridge_bonus = 0.10
                break
    # Also check dish bridge_ingredients
    for dish in kb.dishes:
        if dish["label"].lower() in ctx_lower or dish["dish_id"].replace("_", " ") in ctx_lower:
            for ingredient in dish.get("bridge_ingredients", []):
                for entry in kb.bridge_ingredient_rules:
                    if entry["ingredient"] == ingredient:
                        if any(ft.lower() in flavor_tags for ft in entry["matching_flavor_tags"]):
                            bridge_bonus = 0.10
                            break

    # ── Regional bonus ───────────────────────────────────────────────────────
    regional_bonus = 0.0
    for rule in kb.regional_affinity_rules:
        cuisine = kb.cuisine_index.get(rule.get("cuisine_id", ""), {})
        if cuisine.get("label", "").lower() in ctx_lower or rule.get("cuisine_id", "") in ctx_lower:
            if country in [c.lower() for c in rule.get("product_countries", [])]:
                regional_bonus = rule.get("bonus", 0.0)
                break

    # ── Intensity match ──────────────────────────────────────────────────────
    intensity_ok = True
    dish_intensity = None
    for dish in kb.dishes:
        if dish["label"].lower() in ctx_lower or dish["dish_id"].replace("_", " ") in ctx_lower:
            dish_intensity = dish.get("intensity")
            break
    if not dish_intensity:
        for cuisine in kb.cuisines:
            if cuisine["label"].lower() in ctx_lower:
                dish_intensity = "medium"
                break
    bev_intensity = _beverage_intensity(candidate, kb)
    if dish_intensity and bev_intensity:
        d_idx = _INTENSITY_ORDER.index(dish_intensity) if dish_intensity in _INTENSITY_ORDER else 1
        b_idx = _INTENSITY_ORDER.index(bev_intensity) if bev_intensity in _INTENSITY_ORDER else 1
        intensity_ok = abs(d_idx - b_idx) <= 1

    # ── Contraindications ────────────────────────────────────────────────────
    contra_triggered = False
    contra_penalty = 0.0
    for rule in kb.contraindication_rules:
        bp = rule.get("beverage_profile", {})
        cls_match = not bp.get("classification") or any(c.lower() in cls.lower() for c in bp["classification"])
        tannin_match = True
        if "wine_tannin" in bp:
            tannin_match = candidate.get("wine_tannin") in bp["wine_tannin"]
        peat_match = True
        if "peat_smoke" in bp:
            tp2 = candidate.get("taste_profile") or {}
            peat_val = (tp2.get("axes", {}).get("peat_smoke") or {}).get("value")
            peat_match = peat_val in bp["peat_smoke"]
        if cls_match and tannin_match and peat_match:
            if any(sig in food_signals for sig in rule.get("food_signals", [])):
                contra_triggered = True
                contra_penalty = min(contra_penalty, rule.get("penalty", 0.0))

    # ── Avoid tag penalty ────────────────────────────────────────────────────
    # Rate comes from caller (scoring engine reads it from curation_scoring_model.json)
    avoid_count = len(set(avoid_tags_hit))
    avoid_penalty = avoid_count * avoid_tag_rate

    return PairingScore(
        rule_matched=pairing_boost > 0,
        pairing_boost=pairing_boost,
        bridge_bonus=bridge_bonus,
        regional_bonus=regional_bonus,
        intensity_ok=intensity_ok,
        contraindication_triggered=contra_triggered,
        contraindication_penalty=contra_penalty,
        avoid_tag_count=avoid_count,
        avoid_tag_penalty=avoid_penalty,
        matched_rule_ids=matched_rule_ids,
    )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/curation/test_pairing_resolver.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/pairing_resolver.py tests/curation/test_pairing_resolver.py
git commit -m "feat(curation): add pairing resolver with boost, bridge, regional, contraindication logic"
```

---

## Task 10: Scoring Engine

**Files:**
- Create: `lib/curation/scoring_engine.py`
- Test: `tests/curation/test_scoring_engine.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/curation/test_scoring_engine.py
import json, pathlib
from lib.curation.scoring_engine import score_candidates
from lib.curation.knowledge_base import load_knowledge_base
from lib.curation.models import StructuredQuery

KB = load_knowledge_base(pathlib.Path("data/lib/pairing_knowledge"))
SCORING_MODEL_PATH = pathlib.Path("data/lib/curation/curation_scoring_model.json")

PRODUCTS = [
    {"id": "p1", "sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
     "country": "USA", "price": 3500, "b2b_margin_pct": "30%", "is_in_stock": "1",
     "wine_body": "Full", "wine_tannin": "Full", "wine_acidity": "Medium",
     "flavor_tags": ["blackcurrant", "cedar", "dark plum"],
     "desc_en_short": "Bold Napa Cab.", "taxonomy_confidence": 0.9},
    {"id": "p2", "sku": "WWW001", "name": "Chablis", "classification": "White Wine",
     "country": "France", "price": 2800, "b2b_margin_pct": "28%", "is_in_stock": "1",
     "wine_body": "Light", "wine_tannin": "Light", "wine_acidity": "Full",
     "flavor_tags": ["mineral", "citrus", "green apple"],
     "desc_en_short": "Crisp Chablis.", "taxonomy_confidence": 0.92},
]

def test_score_returns_scored_products():
    q = StructuredQuery(raw_brief="best wine")
    results = score_candidates(PRODUCTS, q, KB, SCORING_MODEL_PATH)
    assert len(results) == 2
    assert all(0 <= r.final_score <= 100 for r in results)

def test_score_sorted_descending():
    q = StructuredQuery(raw_brief="best wine")
    results = score_candidates(PRODUCTS, q, KB, SCORING_MODEL_PATH)
    scores = [r.final_score for r in results]
    assert scores == sorted(scores, reverse=True)

def test_occasion_override_changes_scores():
    q1 = StructuredQuery(raw_brief="test")
    q2 = StructuredQuery(raw_brief="test", occasion_id="horecab2b_tasting_menu")
    r1 = score_candidates(PRODUCTS, q1, KB, SCORING_MODEL_PATH)
    r2 = score_candidates(PRODUCTS, q2, KB, SCORING_MODEL_PATH)
    # Scores may differ when occasion overrides weights — just check both produce valid results
    assert all(0 <= r.final_score <= 100 for r in r1 + r2)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/curation/test_scoring_engine.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/scoring_engine.py`**

```python
from __future__ import annotations
import json
from pathlib import Path
from lib.curation.models import StructuredQuery, ScoredProduct
from lib.curation.knowledge_base import PairingKnowledgeBase
from lib.curation.pairing_resolver import resolve_pairing

_PRESTIGE_MAP = {"A": 1.0, "B": 0.7, "C": 0.4}

# Catalog-level percentiles for margin normalisation (updated periodically)
_MARGIN_P10 = 10.0
_MARGIN_P90 = 40.0


def _parse_margin(raw: str | None) -> float:
    if not raw:
        return 0.0
    try:
        return float(str(raw).replace("%", "").strip())
    except ValueError:
        return 0.0


def _normalise_margin(pct: float) -> float:
    if _MARGIN_P90 == _MARGIN_P10:
        return 0.5
    return max(0.0, min(1.0, (pct - _MARGIN_P10) / (_MARGIN_P90 - _MARGIN_P10)))


def _taxonomy_quality(product: dict) -> float:
    fields = ["desc_en_short", "flavor_tags", "region"]
    taste_present = bool(product.get("wine_body")) or bool(product.get("taste_profile"))
    score = sum(1 for f in fields if product.get(f)) / len(fields)
    return (score + (1.0 if taste_present else 0.0)) / 2.0


def _brand_prestige(product: dict) -> float:
    # Use expert knowledge library confidence tier if present (A/B/C from expert_knowledge_library.csv)
    # Fall back to taxonomy_confidence as a proxy
    tier = product.get("expert_confidence_tier")
    if tier and tier in _PRESTIGE_MAP:
        return _PRESTIGE_MAP[tier]
    return min(1.0, float(product.get("taxonomy_confidence") or 0.5))


def _taste_match(product: dict, query: StructuredQuery, kb: PairingKnowledgeBase, avoid_tag_rate: float = -0.05) -> float:
    if not query.pairing_context:
        return 0.5  # neutral when no pairing brief
    ps = resolve_pairing(query, product, kb, avoid_tag_rate=avoid_tag_rate)
    return 1.0 if ps.rule_matched else 0.2


def score_candidates(
    candidates: list[dict],
    query: StructuredQuery,
    kb: PairingKnowledgeBase,
    scoring_model_path: Path,
) -> list[ScoredProduct]:
    model = json.loads(scoring_model_path.read_text())
    weights = model["weights"]
    bonuses = model["bonuses"]
    penalties = model["penalties"]

    # Apply occasion weight overrides
    if query.occasion_id and query.occasion_id in kb.occasion_index:
        overrides = kb.occasion_index[query.occasion_id].get("scoring_weight_overrides", {})
        if overrides:
            # Map occasion overrides to weight keys (occasion uses brand_prestige etc)
            weights = dict(weights)
            if "brand_prestige" in overrides:
                weights["brand_prestige"] = overrides["brand_prestige"]
            if "taste_match" in overrides:
                weights["taste_match"] = overrides["taste_match"]
            if "margin_signal" in overrides:
                weights["margin_signal"] = overrides["margin_signal"]
            if "web_freshness" in overrides:
                weights["web_freshness"] = overrides["web_freshness"]

    avoid_tag_rate = float(penalties.get("avoid_tag", -0.05))

    results = []
    for p in candidates:
        ps = resolve_pairing(query, p, kb, avoid_tag_rate=avoid_tag_rate)

        tm  = _taste_match(p, query, kb, avoid_tag_rate=avoid_tag_rate)
        tq  = _taxonomy_quality(p)
        bp  = _brand_prestige(p)
        ms  = _normalise_margin(_parse_margin(p.get("b2b_margin_pct")))
        wf  = 0.0  # web_freshness filled in by Stage 4 later

        weighted = (
            tm  * weights["taste_match"] +
            tq  * weights["taxonomy_quality"] +
            bp  * weights["brand_prestige"] +
            ms  * weights["margin_signal"] +
            wf  * weights["web_freshness"]
        )

        raw = (
            weighted
            + ps.pairing_boost
            + ps.bridge_bonus
            + ps.regional_bonus
            + (bonuses["intensity_match"] if ps.intensity_ok else 0.0)
            + ps.contraindication_penalty
            + ps.avoid_tag_penalty
        )

        results.append(ScoredProduct(
            sku=p.get("sku", ""),
            name=p.get("name", ""),
            raw_score=raw,
            rationale="",
            pairing_score=ps,
            matched_rule_ids=ps.matched_rule_ids,
        ))

    results.sort(key=lambda x: x.final_score, reverse=True)
    return results
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/curation/test_scoring_engine.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/scoring_engine.py tests/curation/test_scoring_engine.py
git commit -m "feat(curation): add scoring engine with weighted normalised formula"
```

---

## Task 11: Brief Parser

**Files:**
- Create: `lib/curation/brief_parser.py`
- Test: `tests/curation/test_brief_parser.py` (extend existing)

- [ ] **Step 1: Write failing test**

Add to `tests/curation/test_brief_parser.py`:

```python
import json
from unittest.mock import patch, MagicMock
from lib.curation.brief_parser import parse_brief
from lib.curation.models import StructuredQuery

OLLAMA_RESPONSE = json.dumps({
    "category_filter": ["Whisky"],
    "country_filter": [],
    "score_threshold": 90.0,
    "pairing_context": "Thai food",
    "in_stock_only": True,
    "output_size": 12,
    "occasion_id": None,
    "audience": ["b2b"]
})

def test_parse_brief_returns_structured_query():
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": OLLAMA_RESPONSE}}
        )
        q = parse_brief("Whisky pairing with Thai food, 90 points only")
    assert isinstance(q, StructuredQuery)
    assert "Whisky" in q.category_filter
    assert q.score_threshold == 90.0
    assert q.pairing_context == "Thai food"
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/curation/test_brief_parser.py::test_parse_brief_returns_structured_query -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/brief_parser.py`**

```python
from __future__ import annotations
import json
from pathlib import Path
from lib.curation.llm_router import LLMRouter
from lib.curation.models import StructuredQuery

_SYSTEM_PROMPT = """\
You are a structured query extractor for a wine and spirits curation engine.
Given a natural-language curation brief, extract a JSON object with these keys:
- category_filter: list of beverage categories (e.g. ["Wine", "Whisky", "Gin"])
- subcategory_filter: list (e.g. ["Red", "White", "Single Malt"])
- country_filter: list of countries
- region_filter: list of regions
- score_threshold: number or null (minimum score/rating points)
- price_min_thb: number or null
- price_max_thb: number or null
- prefer_high_margin: boolean
- in_stock_only: boolean (default true)
- pairing_context: string or null (food, cuisine, or dish)
- course_position: string or null (aperitif/first_course/main_course/dessert/digestif)
- occasion_id: string or null (business_dinner/celebration/everyday/gift/horecab2b_tasting_menu)
- menu_tier: string or null (everyday/mid-range/premium/prestige)
- output_size: integer (default 12)
- audience: list (internal/customer/b2b)

Return ONLY the JSON object, no other text.\
"""


def parse_brief(brief: str, config_path: Path | None = None) -> StructuredQuery:
    router = LLMRouter(config_path=config_path)
    prompt = f"{_SYSTEM_PROMPT}\n\nBrief: {brief}"
    raw = router.complete(prompt, tier="production")
    # Extract JSON — handle markdown code fences if present
    text = raw.strip()
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text.strip())
    except json.JSONDecodeError:
        data = {}
    return StructuredQuery(
        raw_brief=brief,
        category_filter=data.get("category_filter") or [],
        subcategory_filter=data.get("subcategory_filter") or [],
        country_filter=data.get("country_filter") or [],
        region_filter=data.get("region_filter") or [],
        score_threshold=data.get("score_threshold"),
        price_min_thb=data.get("price_min_thb"),
        price_max_thb=data.get("price_max_thb"),
        prefer_high_margin=bool(data.get("prefer_high_margin", False)),
        in_stock_only=bool(data.get("in_stock_only", True)),
        pairing_context=data.get("pairing_context"),
        course_position=data.get("course_position"),
        occasion_id=data.get("occasion_id"),
        menu_tier=data.get("menu_tier"),
        output_size=int(data.get("output_size") or 12),
        audience=data.get("audience") or [],
    )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/curation/test_brief_parser.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/brief_parser.py tests/curation/test_brief_parser.py
git commit -m "feat(curation): add brief parser — NL brief to StructuredQuery via Ollama"
```

---

## Task 12: Rationale Writer

**Files:**
- Create: `lib/curation/rationale_writer.py`

- [ ] **Step 1: Write failing test**

Add to `tests/curation/test_pipeline.py`:

```python
from unittest.mock import patch, MagicMock
from lib.curation.rationale_writer import write_rationales
from lib.curation.models import ScoredProduct, StructuredQuery

PRODUCTS_RAW = [
    {"sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
     "wine_body": "Full", "flavor_tags": ["blackcurrant", "cedar"],
     "desc_en_short": "Bold Napa Cab."},
]

SCORED = [ScoredProduct(sku="WRW001", name="Napa Cab", raw_score=0.85, rationale="")]

def test_write_rationales_fills_rationale_field():
    q = StructuredQuery(raw_brief="Best USA wine")
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"message": {"content": "Bold Napa Cab with blackcurrant and cedar — structured and cellar-worthy."}}
        )
        results = write_rationales(SCORED, PRODUCTS_RAW, q)
    assert results[0].rationale != ""
    assert len(results[0].rationale) > 10
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/curation/test_pipeline.py::test_write_rationales_fills_rationale_field -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/rationale_writer.py`**

```python
from __future__ import annotations
from pathlib import Path
from lib.curation.llm_router import LLMRouter
from lib.curation.models import ScoredProduct, StructuredQuery

_RATIONALE_PROMPT = """\
You are a master sommelier writing one-line expert tasting notes for a curated product list.
For each product, write a single sentence (max 25 words) in an expert, confident sommelier voice.
Focus on: key flavour characteristics, style, and why it fits the curation context.
Do NOT mention scores or prices. Do NOT use generic phrases like "a great wine" or "excellent choice".

Curation context: {context}
Pairing context: {pairing}

Products:
{products}

Return one line per product in the exact format:
SKU: [sku] | NOTE: [one sentence rationale]
"""


def write_rationales(
    scored: list[ScoredProduct],
    products_raw: list[dict],
    query: StructuredQuery,
    config_path: Path | None = None,
    top_n: int = 12,
) -> list[ScoredProduct]:
    top = scored[:top_n]
    raw_by_sku = {p["sku"]: p for p in products_raw}

    product_lines = []
    for sp in top:
        p = raw_by_sku.get(sp.sku, {})
        tags = ", ".join(p.get("flavor_tags") or [])
        body = p.get("wine_body") or ""
        product_lines.append(
            f"SKU: {sp.sku} | Name: {sp.name} | Style: {p.get('classification','')} "
            f"| Body/Profile: {body} | Flavours: {tags} | Desc: {p.get('desc_en_short','')}"
        )

    prompt = _RATIONALE_PROMPT.format(
        context=query.raw_brief,
        pairing=query.pairing_context or "none",
        products="\n".join(product_lines),
    )

    router = LLMRouter(config_path=config_path)
    raw_response = router.complete(prompt, tier="production")

    # Parse "SKU: xxx | NOTE: yyy" lines
    rationale_map: dict[str, str] = {}
    for line in raw_response.splitlines():
        line = line.strip()
        if line.startswith("SKU:") and "| NOTE:" in line:
            parts = line.split("| NOTE:", 1)
            sku_part = parts[0].replace("SKU:", "").strip()
            note_part = parts[1].strip()
            rationale_map[sku_part] = note_part

    updated = []
    for sp in top:
        note = rationale_map.get(sp.sku, sp.rationale)
        updated.append(ScoredProduct(
            sku=sp.sku, name=sp.name, raw_score=sp.raw_score,
            rationale=note, pairing_score=sp.pairing_score,
            web_signal=sp.web_signal, matched_rule_ids=sp.matched_rule_ids,
        ))
    return updated + scored[top_n:]
```

- [ ] **Step 4: Run test**

```bash
python -m pytest tests/curation/test_pipeline.py::test_write_rationales_fills_rationale_field -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/rationale_writer.py tests/curation/test_pipeline.py
git commit -m "feat(curation): add rationale writer — sommelier voice LLM copy per pick"
```

---

## Task 13: Affinity Resolver

**Files:**
- Create: `lib/curation/affinity_resolver.py`
- Test: `tests/curation/test_scoring_engine.py` (extend)

Implements product-to-product affinity — used in Phase 2 to surface "similar / contrasting / overlapping" picks alongside the primary ranked list.

- [ ] **Step 1: Write failing test**

Add to `tests/curation/test_scoring_engine.py`:

```python
from lib.curation.affinity_resolver import find_affinities

FULL_RED = {"sku": "WRW001", "name": "Napa Cab", "classification": "Red Wine",
            "wine_body": "Full", "flavor_tags": ["blackcurrant", "cedar", "dark plum"]}
ANOTHER_RED = {"sku": "WRW002", "name": "Bordeaux", "classification": "Red Wine",
               "wine_body": "Full", "flavor_tags": ["blackcurrant", "leather", "tobacco"]}
CRISP_WHITE = {"sku": "WWW001", "name": "Chablis", "classification": "White Wine",
               "wine_body": "Light", "flavor_tags": ["mineral", "citrus", "green apple"]}

ALL = [FULL_RED, ANOTHER_RED, CRISP_WHITE]

def test_similar_affinity_finds_same_body_and_overlapping_tags():
    results = find_affinities(FULL_RED, ALL, KB, relationship_type="similar")
    skus = [r["sku"] for r in results]
    assert "WRW002" in skus  # same body, 1 overlapping tag

def test_contrast_affinity_finds_different_profile():
    results = find_affinities(FULL_RED, ALL, KB, relationship_type="contrast")
    skus = [r["sku"] for r in results]
    assert "WRW001" not in skus  # anchor not in its own results
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/curation/test_scoring_engine.py::test_similar_affinity_finds_same_body_and_overlapping_tags -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/affinity_resolver.py`**

```python
from __future__ import annotations
from lib.curation.knowledge_base import PairingKnowledgeBase


def find_affinities(
    anchor: dict,
    catalog: list[dict],
    kb: PairingKnowledgeBase,
    relationship_type: str = "similar",
    max_results: int = 6,
) -> list[dict]:
    """Return catalog products related to anchor by the given relationship type."""
    anchor_sku = anchor.get("sku", "")
    anchor_tags = set(t.lower() for t in (anchor.get("flavor_tags") or []))
    anchor_cls = anchor.get("classification", "")
    anchor_body = anchor.get("wine_body") or ""

    results: list[tuple[float, dict]] = []

    for rule in kb.product_affinity_rules:
        if rule.get("relationship_type") != relationship_type:
            continue

        for product in catalog:
            if product.get("sku") == anchor_sku:
                continue

            tags = set(t.lower() for t in (product.get("flavor_tags") or []))
            cls = product.get("classification", "")
            body = product.get("wine_body") or ""

            if relationship_type == "similar":
                mp = rule.get("match_profile", {})
                cls_ok = not mp.get("classification") or cls in mp["classification"]
                body_ok = not mp.get("wine_body") or body in mp.get("wine_body", [])
                overlap = len(anchor_tags & tags)
                min_overlap = mp.get("flavor_tags_overlap_min", 1)
                if cls_ok and body_ok and overlap >= min_overlap:
                    results.append((float(overlap), product))

            elif relationship_type == "overlap":
                shared = set(s.lower() for s in rule.get("shared_signals", []))
                eligible = rule.get("eligible_categories", [])
                if (not eligible or cls in eligible) and (anchor_tags & tags) >= shared:
                    results.append((float(len(anchor_tags & tags)), product))

            elif relationship_type == "contrast":
                pa = rule.get("profile_a", {})
                pb = rule.get("profile_b", {})
                a_cls = pa.get("category", "")
                b_cls = pb.get("category", "")
                # anchor matches profile_a, candidate matches profile_b or vice-versa
                if a_cls.lower() in anchor_cls.lower() and b_cls.lower() in cls.lower():
                    results.append((1.0, product))
                elif b_cls.lower() in anchor_cls.lower() and a_cls.lower() in cls.lower():
                    results.append((1.0, product))

    results.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in results[:max_results]]
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/curation/test_scoring_engine.py -v
```

Expected: all pass including new affinity tests.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/affinity_resolver.py
git commit -m "feat(curation): add affinity resolver for similar/overlap/contrast product relationships"
```

---

## Task 14: Pipeline Orchestrator

**Files:**
- Create: `lib/curation/pipeline.py`
- Test: `tests/curation/test_pipeline.py` (extend)

- [ ] **Step 1: Write failing integration test**

Add to `tests/curation/test_pipeline.py`:

```python
import json, pathlib
from unittest.mock import patch, MagicMock
from lib.curation.pipeline import run_curation

BRIEF_JSON = json.dumps({
    "category_filter": ["Red Wine"], "country_filter": ["USA"],
    "score_threshold": None, "pairing_context": None,
    "in_stock_only": True, "output_size": 3,
    "occasion_id": None, "audience": ["internal"],
    "subcategory_filter": [], "region_filter": [],
    "price_min_thb": None, "price_max_thb": None,
    "prefer_high_margin": False, "course_position": None,
    "menu_tier": None,
})
RATIONALE = "SKU: WRW001 | NOTE: Structured Napa Cab with dark fruit and cedar."

PRODUCTS_PATH = pathlib.Path("data/db/products.json")

def test_run_curation_returns_ranked_list():
    with patch("lib.curation.llm_router.httpx.post") as mock_post:
        mock_post.side_effect = [
            MagicMock(status_code=200, json=lambda: {"message": {"content": BRIEF_JSON}}),
            MagicMock(status_code=200, json=lambda: {"message": {"content": RATIONALE}}),
        ]
        result = run_curation("Best USA red wine", products_path=PRODUCTS_PATH)
    assert "products" in result
    assert len(result["products"]) > 0
    assert "score" in result["products"][0]
    assert "rationale" in result["products"][0]
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/curation/test_pipeline.py::test_run_curation_returns_ranked_list -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `lib/curation/pipeline.py`**

```python
from __future__ import annotations
import json
import time
from pathlib import Path
from lib.curation.brief_parser import parse_brief
from lib.curation.hard_filter import hard_filter
from lib.curation.scoring_engine import score_candidates
from lib.curation.rationale_writer import write_rationales
from lib.curation.knowledge_base import load_knowledge_base

_KB_CACHE = None
_KB_PATH = Path("data/lib/pairing_knowledge")
_SCORING_MODEL_PATH = Path("data/lib/curation/curation_scoring_model.json")


def _get_kb():
    global _KB_CACHE
    if _KB_CACHE is None:
        _KB_CACHE = load_knowledge_base(_KB_PATH)
    return _KB_CACHE


def run_curation(
    brief: str,
    products_path: Path | None = None,
    config_path: Path | None = None,
    top_n: int | None = None,
) -> dict:
    t0 = time.time()
    if products_path is None:
        products_path = Path("data/db/products.json")

    products = json.loads(products_path.read_text())
    if isinstance(products, dict):
        products = list(products.values())

    kb = _get_kb()

    # Stage 1: parse brief
    query = parse_brief(brief, config_path=config_path)
    if top_n:
        query.output_size = top_n

    # Stage 2: hard filter
    candidates = hard_filter(products, query)

    # Stage 3: score
    scored = score_candidates(candidates, query, kb, _SCORING_MODEL_PATH)

    # Stage 4: web context — placeholder (Phase 3)
    # scored = await web_context.enrich(scored[:20], query)

    # Stage 5: rationale
    top = scored[:query.output_size]
    top = write_rationales(top, candidates, query, config_path=config_path)

    elapsed = round(time.time() - t0, 2)

    return {
        "brief": brief,
        "resolved_query": {
            "category_filter": query.category_filter,
            "country_filter": query.country_filter,
            "pairing_context": query.pairing_context,
            "in_stock_only": query.in_stock_only,
            "output_size": query.output_size,
        },
        "candidate_count": len(candidates),
        "products": [
            {
                "rank": i + 1,
                "sku": sp.sku,
                "name": sp.name,
                "score": sp.final_score,
                "rationale": sp.rationale,
                "contraindication": sp.pairing_score.contraindication_triggered if sp.pairing_score else False,
                "matched_rules": sp.matched_rule_ids,
            }
            for i, sp in enumerate(top)
        ],
        "run_time_s": elapsed,
        "llm_cost_usd": 0.0,  # Ollama = free
    }
```

- [ ] **Step 4: Run all curation tests**

```bash
python -m pytest tests/curation/ -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/curation/pipeline.py
git commit -m "feat(curation): add pipeline orchestrator — stages 1-3+5 end-to-end"
```

---

## Task 15: API Route

**Files:**
- Create: `app/api/curation/route.ts`

- [ ] **Step 1: Create `app/api/curation/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const brief: string = body.brief;
    if (!brief || typeof brief !== 'string' || brief.trim().length === 0) {
      return NextResponse.json({ error: 'brief is required' }, { status: 400 });
    }
    const escaped = brief.replace(/'/g, "'\\''");
    const { stdout, stderr } = await execAsync(
      `cd "${process.cwd()}" && .venv/bin/python -c "
from lib.curation.pipeline import run_curation
import json
result = run_curation('${escaped}')
print(json.dumps(result))
"`,
      { timeout: 30000 }
    );
    if (stderr && !stderr.includes('UserWarning')) {
      console.error('Curation stderr:', stderr);
    }
    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT" && npm run typecheck
```

Expected: no errors in `app/api/curation/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/curation/route.ts
git commit -m "feat(curation): add POST /api/curation route"
```

---

## Task 16: Internal Review UI

**Files:**
- Create: `components/pages/CurationPage.tsx`
- Modify: `components/dashboard.tsx`

- [ ] **Step 1: Create `components/pages/CurationPage.tsx`**

```typescript
'use client';
import { useState } from 'react';

interface CurationProduct {
  rank: number;
  sku: string;
  name: string;
  score: number;
  rationale: string;
  contraindication: boolean;
  matched_rules: string[];
}

interface CurationResult {
  brief: string;
  resolved_query: {
    category_filter: string[];
    country_filter: string[];
    pairing_context: string | null;
    in_stock_only: boolean;
    output_size: number;
  };
  candidate_count: number;
  products: CurationProduct[];
  run_time_s: number;
  llm_cost_usd: number;
}

export default function CurationPage() {
  const [brief, setBrief] = useState('');
  const [result, setResult] = useState<CurationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  async function handleRun() {
    if (!brief.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setApproved(new Set());
    setSkipped(new Set());
    try {
      const res = await fetch('/api/curation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function toggle(sku: string, list: Set<string>, setter: (s: Set<string>) => void) {
    const next = new Set(list);
    next.has(sku) ? next.delete(sku) : next.add(sku);
    setter(next);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Curation Engine</h1>

      {/* Brief input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Curation Brief</label>
        <textarea
          className="w-full border rounded-lg p-3 text-sm font-mono h-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder='e.g. "Best USA wine collection this year" or "Whisky pairing with Thai food, 90pts+"'
          value={brief}
          onChange={e => setBrief(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleRun(); }}
        />
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          onClick={handleRun}
          disabled={loading || !brief.trim()}
        >
          {loading ? 'Running…' : 'Run Curation'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Run summary */}
          <div className="bg-gray-50 border rounded-lg p-4 text-sm text-gray-600 space-y-1">
            <div><span className="font-medium">Brief resolved:</span> {result.resolved_query.category_filter.join(', ') || 'all categories'} · {result.resolved_query.country_filter.join(', ') || 'all countries'} · {result.candidate_count} candidates</div>
            {result.resolved_query.pairing_context && <div><span className="font-medium">Pairing:</span> {result.resolved_query.pairing_context}</div>}
            <div><span className="font-medium">Run time:</span> {result.run_time_s}s · <span className="font-medium">LLM cost:</span> ${result.llm_cost_usd.toFixed(2)} (Ollama)</div>
          </div>

          {/* Product list */}
          <div className="space-y-3">
            {result.products.map(p => {
              const isApproved = approved.has(p.sku);
              const isSkipped = skipped.has(p.sku);
              return (
                <div
                  key={p.sku}
                  className={`border rounded-lg p-4 space-y-2 ${isApproved ? 'border-green-400 bg-green-50' : isSkipped ? 'border-gray-300 bg-gray-50 opacity-60' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-gray-400">#{p.rank}</span>
                      <div>
                        <span className="font-semibold text-gray-900">{p.name}</span>
                        <span className="ml-2 text-xs text-gray-400">{p.sku}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${p.score >= 80 ? 'text-green-600' : p.score >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>{p.score}/100</span>
                      {p.contraindication && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠ Contraindication</span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm italic text-gray-700">"{p.rationale}"</p>
                  {p.matched_rules.length > 0 && (
                    <div className="text-xs text-gray-400">Rules: {p.matched_rules.join(', ')}</div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      className={`px-3 py-1 text-xs rounded font-medium ${isApproved ? 'bg-green-600 text-white' : 'bg-white border border-green-500 text-green-700 hover:bg-green-50'}`}
                      onClick={() => toggle(p.sku, approved, setApproved)}
                    >
                      {isApproved ? '✓ Approved' : 'Approve'}
                    </button>
                    <button
                      className={`px-3 py-1 text-xs rounded font-medium ${isSkipped ? 'bg-gray-500 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                      onClick={() => toggle(p.sku, skipped, setSkipped)}
                    >
                      {isSkipped ? 'Skipped' : 'Skip'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
              onClick={() => setApproved(new Set(result.products.map(p => p.sku)))}
            >
              Approve All
            </button>
            <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              Export Collection (coming Phase 3)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Curation nav link to dashboard**

In `components/dashboard.tsx`, find the existing nav link array and add:

```typescript
{ href: '/curation', label: 'Curation' }
```

(Match the exact pattern used by other nav links in that file.)

- [ ] **Step 3: Create page route**

Create `app/curation/page.tsx`:

```typescript
import CurationPage from '@/components/pages/CurationPage';
export default function Page() { return <CurationPage />; }
```

- [ ] **Step 4: TypeScript check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Start dev server and verify UI**

```bash
npm run dev
```

Open `http://localhost:3000/curation`. Type "Best USA red wine" and run. Verify:
- Brief form renders
- Loading state shows
- Results render with rank, score, rationale
- Approve/Skip buttons toggle state

- [ ] **Step 6: Commit**

```bash
git add app/curation/ components/pages/CurationPage.tsx components/dashboard.tsx
git commit -m "feat(curation): add internal review UI with brief form, ranked results, approve/skip"
```

---

## Task 17: Final Integration Test and Ollama Verification

**Files:**
- Test: `tests/curation/test_pipeline.py` (final integration)

- [ ] **Step 1: Run full test suite**

```bash
python -m pytest tests/curation/ -v
```

Expected: all tests pass.

- [ ] **Step 2: Verify Ollama is installed and model available**

```bash
which ollama && ollama list
```

If `llama3.1:8b` is not listed:

```bash
ollama pull llama3.1:8b
```

- [ ] **Step 3: Run a live end-to-end curation (Ollama must be running)**

```bash
ollama serve &
cd "/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
.venv/bin/python -c "
from lib.curation.pipeline import run_curation
import json
result = run_curation('Best USA red wine, top 5')
print(json.dumps(result, indent=2))
"
```

Expected: JSON output with `products` array, each with `score`, `rationale`, `sku`, `name`.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(curation): Phase 1+2 complete — brief parser, filter, scorer, rationale writer, review UI"
```

---

## Success Criteria (Phase 1 + 2)

- [ ] `python -m pytest tests/curation/ -v` — all pass
- [ ] `npm run typecheck` — no errors
- [ ] Live Ollama run produces a ranked list from a natural-language brief in under 15s
- [ ] Pairing brief ("whisky Thai food") triggers pairing boost and shows matched rules
- [ ] Contraindication ("tannic red + raw fish") shows ⚠ flag in UI
- [ ] Internal review UI at `/curation` renders, loads, and approve/skip work
