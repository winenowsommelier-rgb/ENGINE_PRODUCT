-- The product records behind whatever bs_rank.tsv holds.
-- sku~name~price~special~country~style~reputation~vintage~score~critic
-- A provisional vintage is emitted BLANK: never print a year we cannot confirm.
select p.sku || '~' || regexp_replace(p.name,'\s+',' ','g')
    || '~' || p.price::int
    || '~' || coalesce(p.special_price::int::text,'')
    || '~' || coalesce(p.country,'')
    || '~' || coalesce(left(split_part(p.variety,',',1),22),'')
    || '~' || coalesce(p.reputation_tier,'')
    || '~' || case when p.vintage_is_provisional then ''
                   else coalesce(p.vintage_year::text,'') end
    || '~' || coalesce(p.score_max::int::text,'')
    || '~' || coalesce((select c->>'critic'
                        from jsonb_array_elements((p.score_summary::jsonb)->'critics') c
                        where (c->>'score_value')::numeric = p.score_max limit 1),'') as line
from products p
where p.is_active = 1 and p.sku = any(:skus)
order by p.sku;
