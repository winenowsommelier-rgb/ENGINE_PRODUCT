-- Feed ages, written into feeds.json so the staleness gate has real numbers.
-- popularity_synced_at is deliberately reported as a MAX and a COUNT: on
-- 31 Aug 2026 it was set on 122 of 6,388 rows, which is how we know there is
-- no scheduled job rather than a job that failed once.
select
  max(popularity_synced_at)                               as popularity_as_of,
  count(*) filter (where popularity_synced_at is not null) as popularity_rows_stamped,
  max(synced_at)                                          as products_as_of,
  count(*) filter (where synced_at is not null)           as products_rows_stamped,
  max(updated_at)                                         as catalog_as_of,
  count(*)                                                as active_products,
  count(*) filter (where quantity_in_stock > 0)           as rows_with_stock
from products where is_active = 1;
