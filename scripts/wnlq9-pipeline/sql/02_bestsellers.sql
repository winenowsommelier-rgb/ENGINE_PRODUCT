-- bs_prod_<site>.tsv and the <site> rows of bs_rank.tsv.
-- :prefix is 'W%' for Wine-Now or 'L%' for LIQ9.
--
-- ORDERING, and this is the part not to change casually:
--   qty, orders, popularity_score, critic score, MARGIN, price
-- Margin is the last tie-break before price. It separates products that sold
-- the same and never lifts one over a product that sold more. A best-seller
-- list ordered by anything other than sales stops being a best-seller list.
--
-- Dedup is by family — name with the size parenthetical and any 19xx/20xx year
-- stripped — keeping the standard bottle, so four Clerc Milon vintages do not
-- stack in one band.
with base as (
  select p.*,
         case
           when :prefix = 'W%' then
             case left(p.sku,3) when 'WRW' then 'red' when 'WWW' then 'white'
                  when 'WSP' then 'sparkling' when 'WRS' then 'rose'
                  when 'WDW' then 'dessert' end
           else
             case left(p.sku,3) when 'LWH' then 'whisky' when 'LGN' then 'gin'
                  when 'LRM' then 'rum' when 'LTQ' then 'agave'
                  when 'LVK' then 'vodka' when 'LBD' then 'brandy'
                  when 'LSK' then 'sake' when 'LLQ' then 'liqueur' end
         end as typ,
         case when p.price < 1500 then 'b1' when p.price < 3000 then 'b2'
              when p.price < 5000 then 'b3' when p.price < 10000 then 'b4'
              else 'b5' end as band,
         regexp_replace(regexp_replace(regexp_replace(lower(p.name),'\([^)]*\)','','g'),
                        '\m(19|20)\d{2}\M','','g'),'[^a-z0-9]+',' ','g') as fam
  from products p
  where p.is_active = 1
    and p.sku like :prefix
    and p.price > 0
    -- catalog-only products are never sellable, so they never rank
    and coalesce(p.custom_stock_status,'') <> 'CATALOG'
    and p.popularity_qty_90d > 0
),
d as (
  select distinct on (fam) * from base
  order by fam,
           (case when bottle_size in ('750 ml','750ml','700 ml','700ml') then 0 else 1 end),
           popularity_qty_90d desc nulls last, margin_thb desc nulls last
),
r as (
  select 'band' as lens, band as seg, d.* from d
  union all select 'country', country, d.* from d
    where coalesce(country,'') <> ''
  union all select 'type', typ, d.* from d where typ is not null
),
ranked as (
  select lens, seg, sku,
         row_number() over (partition by lens, seg
           order by popularity_qty_90d desc nulls last,
                    popularity_orders_90d desc nulls last,
                    popularity_score      desc nulls last,
                    score_max             desc nulls last,
                    margin_thb            desc nulls last,
                    price                 desc) as rk
  from r
)
select lens, seg, rk, sku from ranked where rk <= 20 order by lens, seg, rk;
