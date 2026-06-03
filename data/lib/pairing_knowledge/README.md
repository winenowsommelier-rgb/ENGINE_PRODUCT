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
