import {
  subCategoriesFor, regionsFor, subRegionsFor, accessorySubCategoriesFor,
} from '../facets';
import type { PublicProduct } from '../types';

const P = (o: Partial<PublicProduct>): PublicProduct => ({ sku: 'W1', name: 'x', ...o } as PublicProduct);

describe('subCategoriesFor', () => {
  it('returns first-segment classifications in the group, with counts, sorted, no zeroes', () => {
    const set = [
      P({ sku: 'W1', classification: 'Red Wine' }),
      P({ sku: 'W2', classification: 'Red Wine|Fruit Wine' }),
      P({ sku: 'W3', classification: 'White Wine' }),
      P({ sku: 'LG1', classification: 'Gin' }), // not Wine → excluded
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
  it('groups accessories by accessoryCategoryForSku with counts; omits zero-count categories', () => {
    const set = [
      P({ sku: 'AWC100' }), P({ sku: 'AWC200' }), // Wine Fridges & Coolers x2
      P({ sku: 'GWN1' }),                          // Glassware x1
      P({ sku: 'CIG1' }),                          // Cigars x1
      P({ sku: 'W500' }),                          // not an accessory → ignored
    ];
    const out = accessorySubCategoriesFor(set);
    expect(out).toEqual([
      { value: 'Cigars', count: 1 },
      { value: 'Glassware', count: 1 },
      { value: 'Wine Fridges & Coolers', count: 2 },
    ]);
    expect(out).not.toContainEqual(expect.objectContaining({ value: 'Bar Tools & Gifts' }));
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
