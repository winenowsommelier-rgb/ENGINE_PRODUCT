-- links_cache.tsv — real product URLs and base images.
-- Output: one row per product, 'sku|slug|image'.
--   slug  is relative to https://th.wine-now.com/ ; links.py swaps the host to
--         th.liq9.asia for L-prefix SKUs.
--   image is a media/catalog/product filename, sharded by its first two chars.
--         A leading '*' means the path broke that convention and is literal.
--         One product in 6,387 needs it.
select p.sku || '|' ||
       coalesce(replace(p.magento_item_url, 'https://th.wine-now.com/', ''), '') || '|' ||
       coalesce(
         case when split_part(p.image_url,'/',7) = left(split_part(p.image_url,'/',9),1)
               and split_part(p.image_url,'/',8) = substr(split_part(p.image_url,'/',9),2,1)
              then split_part(p.image_url,'/',9)
              else '*' || replace(p.image_url,
                                  'https://th.wine-now.com/media/catalog/product/', '')
         end, '') as line
from products p
where p.is_active = 1
order by p.sku;
