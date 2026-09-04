-- bs_story.tsv — the provenance line and the two rarity percentiles.
-- sku~region~designation~top_sales_pct~top_critic_pct
-- The percentiles are read out of reputation_summary, which is otherwise a grab
-- bag (400 rows hold only a critic's name, 138 hold only "Brut."), so only
-- these two patterns are extracted and everything else in that field ignored.
select p.sku || '~' || coalesce(left(p.region,26),'')
    || '~' || coalesce(left(p.designation,16),'')
    || '~' || coalesce(substring(p.reputation_summary from 'Top ([0-9]+)% by sales'),'')
    || '~' || coalesce(substring(p.reputation_summary from 'top ([0-9]+)% of their reviews'),'') as line
from products p
where p.is_active = 1 and p.sku = any(:skus)
  and (coalesce(p.region,'') <> '' or coalesce(p.designation,'') <> ''
       or p.reputation_summary ~ 'Top [0-9]+% by sales'
       or p.reputation_summary ~ 'top [0-9]+% of their reviews')
order by p.sku;
