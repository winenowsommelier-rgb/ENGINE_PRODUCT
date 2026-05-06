-- Store sales-derived popularity metrics directly on products so API sorting stays simple.
-- Refresh from marts.mart_pivot_base after the sales mart updates.

alter table products
  add column if not exists sku_base text,
  add column if not exists popularity_score numeric(12,6),
  add column if not exists popularity_qty_90d numeric(14,3),
  add column if not exists popularity_orders_90d integer,
  add column if not exists popularity_revenue_90d numeric(14,2),
  add column if not exists popularity_window_days integer not null default 90,
  add column if not exists popularity_synced_at timestamptz;

update products
set sku_base = left(sku, greatest(length(sku) - 2, 0))
where sku_base is null
  and sku is not null;

create index if not exists products_popularity_sort_idx
  on products (popularity_score desc nulls last, popularity_orders_90d desc nulls last, price desc nulls last);

create or replace function refresh_product_popularity(window_days integer default 90)
returns table (
  updated_count integer,
  max_popularity_score numeric
)
language plpgsql
as $$
declare
  sync_time timestamptz := now();
begin
  with raw_sales as (
    select
      left(sku, greatest(length(sku) - 2, 0)) as base_product_code,
      order_id,
      coalesce(item_qty, 0)::numeric as item_qty,
      coalesce(item_revenue_thb, 0)::numeric as item_revenue_thb
    from marts.mart_pivot_base
    where is_closed = 1
      and sku is not null
      and created_at::date >= current_date - make_interval(days => window_days)
  ),
  rolled_up as (
    select
      base_product_code,
      sum(item_qty) as qty_90d,
      count(distinct order_id) as orders_90d,
      sum(item_revenue_thb) as revenue_90d
    from raw_sales
    where base_product_code <> ''
    group by 1
  ),
  bounds as (
    select
      nullif(max(qty_90d), 0) as max_qty,
      nullif(max(orders_90d), 0) as max_orders,
      nullif(max(revenue_90d), 0) as max_revenue
    from rolled_up
  ),
  scored as (
    select
      r.base_product_code,
      r.qty_90d,
      r.orders_90d,
      r.revenue_90d,
      (
        0.50 * coalesce(r.qty_90d / b.max_qty, 0) +
        0.30 * coalesce(r.orders_90d::numeric / b.max_orders::numeric, 0) +
        0.20 * coalesce(r.revenue_90d / b.max_revenue, 0)
      )::numeric(12,6) as popularity_score
    from rolled_up r
    cross join bounds b
  ),
  updated as (
    update products p
    set
      popularity_score = s.popularity_score,
      popularity_qty_90d = s.qty_90d,
      popularity_orders_90d = s.orders_90d,
      popularity_revenue_90d = s.revenue_90d,
      popularity_window_days = window_days,
      popularity_synced_at = sync_time
    from scored s
    where coalesce(p.sku_base, left(p.sku, greatest(length(p.sku) - 2, 0))) = s.base_product_code
    returning p.popularity_score
  )
  select count(*)::integer, max(popularity_score)
  into updated_count, max_popularity_score
  from updated;

  update products
  set
    popularity_score = null,
    popularity_qty_90d = null,
    popularity_orders_90d = null,
    popularity_revenue_90d = null,
    popularity_window_days = window_days,
    popularity_synced_at = sync_time
  where popularity_synced_at is distinct from sync_time;

  return next;
end;
$$;
