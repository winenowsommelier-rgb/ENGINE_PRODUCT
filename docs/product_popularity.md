# Product sort: "Popular"

The Explore product sidebar ships a **Popular** sort toggle. It should be backed by sales demand, not enrichment queue priority.

The API reads `products.popularity_score` and sorts by:

1. `popularity_score desc nullslast`
2. `popularity_orders_90d desc nullslast`
3. `price desc nullslast`

Populate those fields from `marts.mart_pivot_base` with the migration function in `supabase/migrations/003_product_popularity.sql`.

## Recommended popularity inputs

Use these columns from `marts.mart_pivot_base`:

- `sku`
- `item_qty`
- `item_revenue_thb`
- `order_id`
- `created_at`
- `is_closed`

Then derive `base_product_code = sku[:-2]` so variants roll up into one product.

## Suggested formula

Compute for a rolling window (e.g. last 90 days):

- `qty_90d` = total units sold
- `orders_90d` = number of distinct orders containing the product
- `revenue_90d` = total revenue

Normalize each component to 0-1 (min-max or percentile), then:

`popularity_score = 0.50 * qty_norm + 0.30 * orders_norm + 0.20 * revenue_norm`

Sort descending by `popularity_score`.

The API also returns the raw inputs for each item:

- `popularity_score`
- `popularity_qty_90d`
- `popularity_orders_90d`
- `popularity_revenue_90d`
- `popularity_window_days`
- `popularity_synced_at`

## Refresh command

After applying the migration, run:

```sql
select * from refresh_product_popularity(90);
```

## SQL starter query

```sql
WITH base AS (
  SELECT
    LEFT(sku, LENGTH(sku) - 2) AS base_product_code,
    order_id,
    item_qty,
    item_revenue_thb,
    CAST(created_at AS DATE) AS order_date
  FROM marts.mart_pivot_base
  WHERE is_closed = 1
    AND CAST(created_at AS DATE) >= CURRENT_DATE - INTERVAL '90 days'
)
SELECT
  base_product_code,
  SUM(item_qty) AS qty_90d,
  COUNT(DISTINCT order_id) AS orders_90d,
  SUM(item_revenue_thb) AS revenue_90d
FROM base
GROUP BY 1;
```

## Why this is better than revenue-only sorting

Revenue-only favors expensive items with low movement. A blended score keeps true demand items near the top while still rewarding commercial impact.
