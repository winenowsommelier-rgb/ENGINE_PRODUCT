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
    P({ country: 'France', region: 'France', subregion: '' }),
    P({ country: 'USA', region: 'Napa Valley', subregion: '' }),
    P({ country: 'USA', region: 'Lodi', subregion: 'California' }),
    P({ country: 'Scotland', region: 'Highlands', subregion: '' }),
  ];
  it('regionsFor returns distinct regions with counts (zeroes omitted)', () => {
    expect(regionsFor('France', set.filter((p) => p.country === 'France'))).toEqual([
      { value: 'Bordeaux', count: 2 },
      { value: 'Burgundy', count: 1 },
    ]);
  });
  it('regionsFor keeps sub-AVA regions as their own chips (no collapse to the parent)', () => {
    // REGRESSION GUARD (2026-07-27): this previously asserted [California, Lodi],
    // i.e. the Napa Valley fixture row was rewritten to its parent 'California'.
    // That hierarchy collapse is why the explore map showed every USA wine as
    // California. 'Napa Valley' is now its own chip. 'California' gets NO chip
    // here: it is an ancestor with no products of its own in this set (the Lodi
    // row carries California as a *subregion*, not a region), and regionsFor
    // never invents a chip for an ancestor that holds no rows itself.
    expect(regionsFor('USA', set.filter((p) => p.country === 'USA'))).toEqual([
      { value: 'Lodi', count: 1 },
      { value: 'Napa Valley', count: 1 },
    ]);
  });
  it('regionsFor still applies SPELLING aliases (Scotland Highlands -> Highland)', () => {
    // Split out of the USA case above: it used to sit AFTER the (failing) USA
    // assertion in the same it block, so this path was never actually executed.
    expect(regionsFor('Scotland', set.filter((p) => p.country === 'Scotland'))).toEqual([
      { value: 'Highland', count: 1 },
    ]);
  });
  it('subRegionsFor returns distinct non-empty subregions with counts', () => {
    expect(subRegionsFor('Bordeaux', set.filter((p) => p.region === 'Bordeaux'))).toEqual([
      { value: 'Margaux', count: 1 },
      { value: 'Pauillac', count: 1 },
    ]);
  });
  it('subRegionsFor excludes values that belong at country or region level', () => {
    expect(subRegionsFor('Lodi', set.filter((p) => p.region === 'Lodi'))).toEqual([]);
  });
});
