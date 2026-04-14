# Expert Knowledge Library

This folder holds reusable expert knowledge packs for wine, spirits, beer, sake, and premium beverage retail taxonomy work.

The purpose of the library is to make the enrichment process:
- faster, by reducing repeated explanation work
- more consistent, by reusing approved expert wording
- more validated, by separating expert knowledge from source-validated product facts

## Design Principles

1. A knowledge pack is not the same thing as a product description.
2. Knowledge packs should be reusable across many products and taxonomy entities.
3. Knowledge packs can be expert-authored before full source validation, but they must carry explicit validation fields.
4. Product-level claims must still be validated against producer, importer, or other strong sources.

## Core Fields

- `pack_type`: `country`, `region`, `subregion`, `classification`, `brand`, `producer`, `style`, `grape`, `spirit_type`
- `canonical_name`: display name of the knowledge topic
- `parent_country`
- `parent_region`
- `scope`
- `knowledge_short_en`
- `knowledge_full_en`
- `signature_varieties_or_styles`
- `signature_regions_or_appellations`
- `house_or_category_traits`
- `use_cases`
- `validation_status`
- `confidence_level`
- `source_basis`
- `source_priority`
- `source_urls`
- `last_reviewed`
- `notes`

## Validation Levels

- `expert_seed`
  Knowledge-authored starter entry. Good for drafting and taxonomy work, but not enough for specific product claims on its own.

- `source_reviewed`
  Reviewed against strong category sources or official materials. Safe to reuse in taxonomy descriptions and high-level contextual copy.

- `producer_validated`
  Anchored in official producer or governing-body information where relevant. Safe for controlled product-context reuse.

## Recommended Usage

1. Use knowledge packs to draft taxonomy copy.
2. Use knowledge packs to accelerate product descriptions.
3. Do not use them as the only evidence for specific vintage, blend, ABV, aging, or limited-edition product facts.
4. Upgrade packs over time from `expert_seed` to `source_reviewed` or `producer_validated`.
