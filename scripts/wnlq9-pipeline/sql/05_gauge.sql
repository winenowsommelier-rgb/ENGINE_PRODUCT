-- bs_gauge.tsv — PIM sensory levels, normalised.
-- sku~body~tannin~acidity~sweetness~peat, each 1-5 (sweetness 1-4), 0 = absent.
--
-- The catalog uses two vocabularies for the same axis (Light..Full and
-- Low..High) so both are folded onto one scale. Sweetness stays on four steps
-- because the source only distinguishes four; stretching it to five would
-- invent precision.
--
-- NOTE: acidity and tannin are populated on spirits too, where they are a
-- default rather than a measurement — a gin has no grape-skin tannin. The build
-- decides which gauges are meaningful per category (bsdata.GAUGES_FOR); this
-- query just reports what the PIM holds.
with lv(w,n) as (values ('Light',1),('Low',1),('Medium-Light',2),('Medium',3),
                        ('Medium-Full',4),('Medium-High',4),('Full',5),('High',5)),
     sw(w,n) as (values ('Dry',1),('Off-Dry',2),('Medium-Sweet',3),('Sweet',4)),
     pt(w,n) as (values ('light',2),('medium',3),('heavy',5))
select z.sku || '~' || z.b || '~' || z.t || '~' || z.a || '~' || z.s || '~' || z.pk as line
from (
  select p.sku,
    coalesce((select n from lv where lv.w = p.body),0)       b,
    coalesce((select n from lv where lv.w = p.tannin),0)     t,
    coalesce((select n from lv where lv.w = p.acidity),0)    a,
    coalesce((select n from sw where sw.w = p.sweetness),0)  s,
    coalesce((select n from pt where pt.w = p.peat_level),0) pk
  from products p
  where p.is_active = 1 and p.sku = any(:skus)) z
where z.b + z.t + z.a + z.s + z.pk > 0
order by z.sku;
