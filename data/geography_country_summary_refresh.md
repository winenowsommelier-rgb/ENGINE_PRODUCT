# Geography Country Lane Refresh

Refreshed from the current live baseline using:
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/geography_priority_queue.csv`
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/products.json`

## Current live baseline

- Live country gaps in geography queue: `1`
- Reviewed rows in this refresh pack: `1`
- Publish-safe rows: `1`
- Review-first rows: `0`

## Merge-now candidate

| SKU | Name | Proposed country | Confidence | Why it is live-safe |
|---|---|---|---|---|
| `AWC0138EN` | `Kadeka Steel Series One Temp Zone 121 Bottles (Silver)` | `Singapore` | `high` | The current live catalog already contains multiple sibling Kadeka wine-cellar SKUs with `country=Singapore`, and this row matches the same Kadeka family naming pattern even though the `brand` field is blank. |

## Evidence pattern used

- `AWC0135EN` -> `Kadeka Wine Cellar 20 Bottles Built-In Steel Series` -> `Singapore`
- `AWC0136EN` -> `Kadeka Wine Cellar 31 Bottles Built-In Steel Series` -> `Singapore`
- `AWC0137EN` -> `Kadeka Wine Cellar 45 Bottles Built-In Steel Series` -> `Singapore`
- `AWC0139EN` -> `Kadeka Wine Cellar 165 Bottles Free Standing Steel Series` -> `Singapore`
- `AWC0140EN` -> `Kadeka Wine Cellar 25 Bottles 54 Cans Free Standing Medley Series` -> `Singapore`

## Merge guidance

- Safe to merge this one row now.
- This refresh supersedes the older country-lane assumption that dozens of country gaps remained open.
- No other live country-gap rows are currently present in the refreshed geography queue.
