import type { PublicProduct } from '@/lib/types';
import { groupForProduct, type CategoryGroup } from '@/lib/category-groups';
import { isInStock } from '@/lib/utils';
import { PRICE_TIERS } from '@/lib/price-tiers';
import type { Answers, FinderCategory } from './answers';

interface CatRule { group: CategoryGroup; classMatch?: (classification: string | undefined) => boolean; }

const firstSeg = (c?: string) => (c ?? '').split('|')[0].trim().toLowerCase();

export const CATEGORY_MAP: Record<FinderCategory, CatRule> = {
  red:       { group: 'Wine', classMatch: (c) => firstSeg(c) === 'red wine' },
  white:     { group: 'Wine', classMatch: (c) => firstSeg(c) === 'white wine' },
  sparkling: { group: 'Wine', classMatch: (c) => ['champagne','sparkling wine'].includes(firstSeg(c)) },
  whisky:    { group: 'Whisky' },
  gin:       { group: 'Spirits', classMatch: (c) => firstSeg(c) === 'gin' },
  spirits:   { group: 'Spirits', classMatch: (c) => firstSeg(c) !== 'gin' },
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
    if (rule.classMatch && !rule.classMatch(p.classification)) return false;
    if (tier) {
      if (typeof p.price !== 'number' || Number.isNaN(p.price)) return false;
      if (p.price < tier.min || p.price >= tier.max) return false;
    }
    return true;
  });
}
