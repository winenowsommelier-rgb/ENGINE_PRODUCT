# Geography Subregion Lane Refresh

Refreshed from the live baseline on 2026-04-22 using:
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/geography_priority_queue.csv`
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/geography_lanes_summary.json`
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json`

## Current live-safe split

- Total live subregion gap rows reviewed: `2012`
- `clear_fill_merge_now`: `11`
- `assess_later`: `1718`
- `wait_for_region`: `130`
- `likely_not_applicable`: `153`

## Important refresh result

The previous clear-fill pack is no longer safe to reuse. The refreshed live queue only supports `11` merge-now subregion fills, not the older larger clear-fill set built before the taxonomy normalization change.

`1` queue-marked `fill_clear` row(s) were downgraded to `assess_later` because the current live name and region do not expose a safely mergeable lower-level geography.

## Merge-now candidates

- `WRW3837AF` | `Delas  Saint Joseph Les Challeys Rouge` | region `Rhône Valley` -> proposed subregion `Saint-Joseph`
- `WRW5786DD` | `Le Clos du Serres  Saint-Jean Terrasses du Larzac` | region `Languedoc-Roussillon` -> proposed subregion `Terrasses du Larzac`
- `WRW6243FJ` | `Lucien Crochet  Sancerre La Croix Du Roy` | region `Loire valley` -> proposed subregion `Sancerre`
- `WWW0204AD` | `Domaine Laroche  Chablis Domaine Saint Martin AOC` | region `Burgundy` -> proposed subregion `Chablis`
- `WWW1085AF` | `Henri Bourgeois  Les Bonnes Bouches Sancerre Blanc` | region `Loire valley` -> proposed subregion `Sancerre`
- `WWW1115AD` | `E.Guigal  Saint Joseph Blanc AOC` | region `Rhône Valley` -> proposed subregion `Saint-Joseph`
- `WWW5072DJ` | `La Soufrandiere  Saint-Veran "la Combe DesRoches"` | region `Burgundy` -> proposed subregion `Saint-Veran`
- `WWW5112FJ` | `Lucien Crochet  Sancerre Blanc "Les Calcaires"` | region `Loire valley` -> proposed subregion `Sancerre`
- `WWW5406BN` | `William Fevre  Saint-Bris` | region `Burgundy` -> proposed subregion `Saint-Bris`
- `WRW3414AF` | `Delas  Cotes Du Rhone Saint Esprit Rouge` | region `Rhône Valley` -> proposed subregion `Cotes du Rhone`
- `WWW2026AF` | `Delas  Cotes Du Rhone Saint Esprit Blanc` | region `Rhône Valley` -> proposed subregion `Cotes du Rhone`

## Dominant assess-later patterns

Top assess-later regions:
- `South Australia`: `133` rows
- `Champagne`: `132` rows
- `South Eastern Australia`: `83` rows
- `Mendoza`: `81` rows
- `Bordeaux`: `78` rows
- `Marlborough`: `68` rows
- `Rhône Valley`: `66` rows
- `Colchagua Valley`: `63` rows
- `Languedoc-Roussillon`: `61` rows
- `Sicily`: `60` rows
- `Tuscany`: `57` rows
- `Piedmont`: `56` rows

Top subregion-gap classifications:
- `Red Wine`: `1047` rows
- `White Wine`: `488` rows
- `Champagne`: `132` rows
- `Sparkling Wine`: `101` rows
- `Rose Wine`: `48` rows
- `Gin`: `36` rows
- `Liqueur`: `31` rows
- `Dessert Wine`: `17` rows
- `Rum`: `17` rows
- `Fruit Wine`: `10` rows
- `Vodka`: `10` rows
- `Port Wine`: `9` rows

## Merge guidance

1. Merge only the `11` `clear_fill_merge_now` rows now.
2. Hold `1718` rows for later editorial or source-backed review.
3. Resolve `130` rows by filling region first.
4. Leave `153` rows out of the active subregion backlog unless the taxonomy model changes.

## Source lane summary cross-check

Live lane summary reported:
- `subregion_rows`: `2012`
- `subregion_fill_clear`: `12`
- `subregion_assess`: `1717`
- `subregion_wait_for_region`: `130`
- `subregion_likely_not_applicable`: `153`

This refresh keeps that structure, but tightens merge-now safety by requiring the subregion to be directly exposed by the current live product name or canonical geography wording.
