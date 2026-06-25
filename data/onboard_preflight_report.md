# New-Product Onboarding — Pre-flight Report

**READ-ONLY.** This run wrote nothing to `products.db`. It selects the in-stock,
masterfile-only beverages that would be inserted, and is the Rule-10 sign-off
gate. No insert happens until you approve these numbers.

- Generated (UTC): 2026-06-25T07:38:33.169576+00:00
- Source CSV: `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`
- Target DB: `data/db/products.db` (opened read-only, mode=ro)
- enrichment_source stamp: `masterfile_onboard_2026-06-25`

## Headline

**498 candidate products** would be inserted.

## Selection rule

A candidate = SKU **not already** in `products` AND `is_in_stock == '1'` AND
resolver TYPE is a real beverage (not an accessory, not `Unknown`) AND both
`cost` and `price` parse to a number. Accessories are excluded silently;
everything else that is skipped is reported below.

## Report sections (counts)

| Section | Count | Meaning |
|---|---|---|
| candidates (n) | 498 | would be inserted |
| unknown_prefix | 0 | resolver TYPE = Unknown → skipped (need a SKU-prefix mapping first) |
| price_parse_failures | 0 | cost/price cell present but unparseable → skipped |
| missing_cost_or_price | 0 | cost/price cell blank → skipped |
| negative_margin | 0 | cost > price → **KEPT** as candidate, flagged for review |
| dup_skus | 5 | duplicate SKU rows in the CSV (last row won) |

## Candidate composition (resolver TYPE)

| TYPE | Candidates |
|---|---|
| Red Wine | 216 |
| White Wine | 80 |
| Liqueur | 60 |
| Sparkling & Champagne | 34 |
| Whisky | 20 |
| Sake / Shochu | 18 |
| Gin | 13 |
| Tequila | 13 |
| Rum | 12 |
| Rosé Wine | 9 |
| Brandy | 6 |
| Sweet/Dessert | 5 |
| Vodka | 4 |
| Umeshu | 3 |
| Grappa | 2 |
| Beer | 2 |
| Absinthe | 1 |

## Skipped — Unknown prefix (0)

_none_

## Skipped — price parse failures (0)

_none_

## Skipped — missing cost or price (0)

_none_

## Flagged — negative margin (cost > price), KEPT (0)

_none_

## Duplicate SKUs in CSV (5)

WRW5216AB, WRW5217AB, WRW5236CU, WRW5243CU, WRW5244CU

## Sample candidates (first 10)

| SKU | Name | TYPE | cost | price | margin_pct |
|---|---|---|---|---|---|
| LOT0034AB | Kozaemon  Shiroku Junmai Yuzu Sake (300 ml | Umeshu | 450.0 | 600.0 | 25.0 |
| LOT0035AB | Kozaemon  Shiroku Junmai Yuzu Sake (500 ml | Umeshu | 756.0 | 1000.0 | 24.4 |
| LOT0036AB | Kozaemon  Shiroku Junmai Yuzu Sake (1.8 L) | Umeshu | 2106.0 | 2600.0 | 19.0 |
| LGP0089HI | Antinori  Grappa Tignanello (500 ml) | Grappa | 3078.0 | 4500.0 | 31.6 |
| LGP0102BS | Fiasco Grappa Bottega Chianti Grappa (500  | Grappa | 841.5 | 1100.0 | 23.5 |
| LAB0019DB | L'Entete Absinthe Traditional (700 ml) | Absinthe | 2400.0 | 3200.0 | 25.0 |
| LBE0997AU | Brothers Cider Raspberry&Blackberry 500ml  | Beer | 1800.0 | 2269.0 | 20.67 |
| LBE0998AU | Brothers Cider Raspberry& Lime 500ml x 12 | Beer | 1800.0 | 2269.0 | 20.67 |
| LBD0018EQ | Camus  Cognac Extra Elegance (700 ml) | Brandy | 14725.0 | 20000.0 | 26.38 |
| LBD0235ES | Larsen VSOP Reserve (700 ml) | Brandy | 2299.07 | 2999.0 | 23.34 |

---

_Next step (Task 4): on your sign-off, the insert path writes these
498 rows to `products.db`, then refreshes `live_products_export.json`._
