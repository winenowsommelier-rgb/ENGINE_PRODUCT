# Magento Catalog Data Quality

Generated: 2026-06-10T15:46:59.694Z

## Recommendation

Do not update all active items in one Magento import. Import the conservative ready batch first, then work through the review queue.

## Current Catalog

- Active items: 6017
- Ready for Magento: 3517 (58.5%)
- Review or hold: 2500
- Latest item update in source: 2026-06-02T14:04:44Z

## Field Coverage

- Substantial description (100+ characters): 4157 (69.1%)
- Short description (50+ characters): 4157 (69.1%)
- Country: 5996 (99.7%)
- Region: 5357 (89%)
- Subregion: 4175 (69.4%)

## Main Blockers

- description_missing_or_too_short: 1860
- short_description_missing_or_too_short: 1860
- beverage_region_missing: 159
- beverage_country_missing: 12

## Main Warnings

- missing_subregion: 1159
- region_equals_subregion: 753
- stale_update_over_45_days: 8

## Cleanup Priority

- High priority (recent sales): 972
- Medium priority (stock on hand): 12
- Low priority: 1516

Top review categories:

- Wine product: 802
- Red Wine: 616
- White Wine: 238
- Whisky: 137
- Glassware: 96
- Rose Wine: 92
- Liqueur: 87
- Sake/Shochu: 79
- Rum: 46
- Brandy: 45

## Export Notes

- The Magento-ready CSV only contains content and geography columns. It does not update price or stock.
- Geography is exported into independent taxonomy columns: `country`, `region`, and `subregion`.
- The legacy combined `region_wine` field is intentionally excluded.
- Missing subregion is a warning, not an automatic blocker, because many valid products only have region-level geography.
