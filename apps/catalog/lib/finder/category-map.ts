import type { PublicProduct } from '@/lib/types';
import { groupForProduct, typeForProduct, type CategoryGroup } from '@/lib/category-groups';
import { isInStock } from '@/lib/utils';
import { PRICE_TIERS } from '@/lib/price-tiers';
import type { Answers, FinderCategory } from './answers';

interface CatRule { group: CategoryGroup; match?: (p: PublicProduct) => boolean; }

const ctype = (p: PublicProduct) => typeForProduct(p).trim().toLowerCase();

// SKU prefix is the reliable gin signal: 72/169 in-stock gins (Tanqueray, Gordon's,
// Gilbey's...) are mis-tagged 'Wine product', not 'Gin'. SKU LGN* mirrors groupForProduct,
// which already trusts the prefix over classification. category_type is the fallback only.
const isGin = (p: PublicProduct) =>
  (p.sku ?? '').toUpperCase().startsWith('LGN') || ctype(p) === 'gin';

// Sub-type matches use the canonical SKU-derived category_type (typeForProduct), not the
// unreliable `classification` field. Canonical wine types: "Red Wine", "White Wine",
// "Sparkling & Champagne". Group membership is still gated by groupForProduct upstream.
export const CATEGORY_MAP: Record<FinderCategory, CatRule> = {
  red:       { group: 'Wine', match: (p) => ctype(p) === 'red wine' },
  white:     { group: 'Wine', match: (p) => ctype(p) === 'white wine' },
  sparkling: { group: 'Wine', match: (p) => ctype(p) === 'sparkling & champagne' },
  whisky:    { group: 'Whisky' },
  gin:       { group: 'Spirits', match: (p) => isGin(p) },
  spirits:   { group: 'Spirits', match: (p) => !isGin(p) },
  sake:      { group: 'Sake & Asian' },
};

/** Hard, safe pre-filter (spec §5): category membership + in-stock + budget tier. */
export function finderPrefilter(products: PublicProduct[], a: Answers): PublicProduct[] {
  const rule = CATEGORY_MAP[a.category];
  // Budget is the index 0..4 INTO PRICE_TIERS. tierById takes string ids, NOT '0'..'4' — index access is correct.
  const tier = a.budget != null ? PRICE_TIERS[a.budget] : undefined;
  return products.filter((p) => {
    if (!isInStock(p.is_in_stock)) return false;
    if (groupForProduct(p) !== rule.group) return false;
    if (rule.match && !rule.match(p)) return false;
    if (tier) {
      if (typeof p.price !== 'number' || Number.isNaN(p.price)) return false;
      if (p.price < tier.min || p.price >= tier.max) return false;
    }
    return true;
  });
}
