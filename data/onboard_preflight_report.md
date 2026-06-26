# New-Product Onboarding — Pre-flight Report

**READ-ONLY.** This run wrote nothing to `products.db`. It selects the in-stock,
masterfile-only beverages that would be inserted, and is the Rule-10 sign-off
gate. No insert happens until you approve these numbers.

- Generated (UTC): 2026-06-25T08:16:02.155699+00:00
- Source CSV: `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`
- Target DB: `data/db/products.db` (opened read-only, mode=ro)
- enrichment_source stamp: `masterfile_onboard_2026-06-25`

## Headline

**0 candidate products** would be inserted.

## Selection rule

A candidate = SKU **not already** in `products` AND `is_in_stock == '1'` AND
resolver TYPE is a real beverage (not an accessory, not `Unknown`) AND both
`cost` and `price` parse to a number. Accessories are excluded silently;
everything else that is skipped is reported below.

## Report sections (counts)

| Section | Count | Meaning |
|---|---|---|
| candidates (n) | 0 | would be inserted |
| unknown_prefix | 0 | resolver TYPE = Unknown → skipped (need a SKU-prefix mapping first) |
| price_parse_failures | 0 | cost/price cell present but unparseable → skipped |
| missing_cost_or_price | 0 | cost/price cell blank → skipped |
| negative_margin | 0 | cost > price → **KEPT** as candidate, flagged for review |
| dup_skus | 5 | duplicate SKU rows in the CSV (last row won) |

## Candidate composition (resolver TYPE)

| TYPE | Candidates |
|---|---|


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


---

_Next step (Task 4): on your sign-off, the insert path writes these
0 rows to `products.db`, then refreshes `live_products_export.json`._
