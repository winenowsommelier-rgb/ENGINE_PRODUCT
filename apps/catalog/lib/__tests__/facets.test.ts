import {
  subCategoriesFor, regionsFor, subRegionsFor, accessorySubCategoriesFor,
} from '../facets';
import type { PublicProduct } from '../types';

const P = (o: Partial<PublicProduct>): PublicProduct => ({ sku: 'W1', name: 'x', ...o } as PublicProduct);

// NOTE (10-group migration): subCategoriesFor now tallies the canonical category_type
// (typeForProduct), and group membership comes from groupForProduct (which prefers the
// backfilled category_group). Synthetic products therefore carry category_group/type, the
// same fields the real export backfills — classification is no longer consulted.
describe('subCategoriesFor', () => {
  it('returns canonical category_type values in the group, with counts, sorted, no zeroes', () => {
    const set = [
      P({ sku: 'WRW1', category_group: 'Wine', category_type: 'Red Wine' }),
      P({ sku: 'WRW2', category_group: 'Wine', category_type: 'Red Wine' }),
      P({ sku: 'WWW3', category_group: 'Wine', category_type: 'White Wine' }),
      P({ sku: 'LGN1', category_group: 'Spirits', category_type: 'Gin' }), // not Wine → excluded
    ];
    expect(subCategoriesFor('Wine', set)).toEqual([
      { value: 'Red Wine', count: 2 },
      { value: 'White Wine', count: 1 },
    ]);
  });
  it('empty input → []', () => {
    expect(subCategoriesFor('Wine', [])).toEqual([]);
  });
});

describe('accessorySubCategoriesFor', () => {
  it('groups accessories by accessoryCategoryForSku (canonical type) with counts; omits zero-count', () => {
    // In the 10-group model CIG -> Cigars group and WEV -> Events group are NO LONGER
    // accessories, so they are excluded here. Accessory sub-types now come straight from
    // the canonical typeFor: Bar Tools & Gifts / Glassware / Wine Coolers & Fridges.
    const set = [
      P({ sku: 'AWC100' }), P({ sku: 'AWC200' }), // Wine Coolers & Fridges x2
      P({ sku: 'GWN1' }),                          // Glassware x1
      P({ sku: 'ABA1' }),                          // Bar Tools & Gifts x1
      P({ sku: 'CIG1' }),                          // now Cigars GROUP → not an accessory → ignored
      P({ sku: 'WRW500' }),                        // not an accessory → ignored
    ];
    const out = accessorySubCategoriesFor(set);
    // tally() sorts by count DESC, then alphabetical: Wine Coolers (2) leads,
    // then the two count-1 entries fall back to A→Z. (Was alphabetical-only
    // before facet chips were re-ordered most-stocked-first.)
    expect(out).toEqual([
      { value: 'Wine Coolers & Fridges', count: 2 },
      { value: 'Bar Tools & Gifts', count: 1 },
      { value: 'Glassware', count: 1 },
    ]);
    expect(out).not.toContainEqual(expect.objectContaining({ value: 'Cigars' }));
  });
});

describe('regionsFor / subRegionsFor', () => {
  const set = [
    P({ country: 'France', region: 'Bordeaux', subregion: 'Pauillac' }),
    P({ country: 'France', region: 'Bordeaux', subregion: 'Margaux' }),
    P({ country: 'France', region: 'Burgundy', subregion: '' }),
  ];
  it('regionsFor returns distinct regions with counts (zeroes omitted)', () => {
    expect(regionsFor('France', set)).toEqual([
      { value: 'Bordeaux', count: 2 },
      { value: 'Burgundy', count: 1 },
    ]);
  });
  it('subRegionsFor returns distinct non-empty subregions with counts', () => {
    expect(subRegionsFor('Bordeaux', set.filter((p) => p.region === 'Bordeaux'))).toEqual([
      { value: 'Margaux', count: 1 },
      { value: 'Pauillac', count: 1 },
    ]);
  });
});
