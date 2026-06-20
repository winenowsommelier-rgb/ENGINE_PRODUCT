import { shopFacets } from '../shop-facets';
import { getAllProducts } from '../catalog-data';

it('subCategories reflect the active group; regions reflect active country (context-aware)', () => {
  const all = getAllProducts();
  const f = shopFacets(all, { group: 'Wine', country: 'France' });
  expect(f.subCategories.every((o) => o.count > 0)).toBe(true);
  expect(f.subCategories.length).toBeGreaterThan(0);
  expect(f.regions.length).toBeGreaterThan(0);
  // no region selected yet → no sub-regions
  expect(f.subRegions).toEqual([]);
});

it('Accessories group yields accessory sub-categories (Glassware/Cigars/...)', () => {
  const all = getAllProducts();
  const f = shopFacets(all, { group: 'Accessories' });
  const values = f.subCategories.map((o) => o.value);
  expect(values).toEqual(expect.arrayContaining(['Glassware']));
});
