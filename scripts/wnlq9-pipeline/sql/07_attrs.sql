-- Product attributes for the ranking, which now happens in Python because the
-- sales data lives in a sheet rather than in this database.
-- sku, name, price, country, margin, score, catalog_only
select p.sku,
       regexp_replace(p.name,'\s+',' ','g')                        as name,
       coalesce(p.special_price, p.price)::int                     as price,
       coalesce(p.country,'')                                      as country,
       coalesce(round(p.margin_thb)::int, 0)                       as margin,
       coalesce(p.score_max::int, 0)                               as score,
       (coalesce(p.custom_stock_status,'') = 'CATALOG')            as catalog_only
from products p
where p.is_active = 1 and p.price > 0
order by p.sku;
