import { getAllProducts } from '../catalog-data';
import { applyShopQuery, matchesFilters } from '../shop-query';
import { regionsFor, accessorySubCategoriesFor } from '../facets';

describe('facet count consistent with grid total (context-aware invariant)', () => {
  const all = getAllProducts();

  it('every region facet under group=Wine: count subset of grid, and grid >= count', () => {
    // Input set for regionsFor = everything active EXCEPT region/subregion → here just group=Wine.
    const wine = all.filter((p) => matchesFilters(p, { group: 'Wine' }));
    const regions = regionsFor('', wine);
    expect(regions.length).toBeGreaterThan(0);

    // Spot-check the top few regions to keep the test fast.
    for (const { value, count } of regions.slice(0, 5)) {
      const params = { group: 'Wine', region: value };
      const grid = applyShopQuery(all, params);
      // region is now EXACT (matches the chip): facet count == grid total exactly.
      // Regression guard against the substring count-mismatch bug.
      expect(grid.total).toBe(count);
      const facetCounted = wine.filter((p) => (p.region ?? '').trim() === value);
      expect(facetCounted.length).toBe(count); // facet count is exact-value tally
      for (const p of facetCounted) {
        expect(matchesFilters(p, params)).toBe(true); // ...and all pass the grid
      }
    }
  });

  it('Accessories sub-category facet count EQUALS grid total (exact match, no substring)', () => {
    // class for Accessories matches accessoryCategoryForSku exactly (both grid + facet),
    // so this is a true equality — the strongest form of the invariant.
    const accessories = all.filter((p) => matchesFilters(p, { group: 'Accessories' }));
    const subs = accessorySubCategoriesFor(accessories);
    expect(subs.length).toBeGreaterThan(0);
    for (const { value, count } of subs) {
      const grid = applyShopQuery(all, { group: 'Accessories', class: value });
      expect(grid.total).toBe(count);
    }
  });
});
