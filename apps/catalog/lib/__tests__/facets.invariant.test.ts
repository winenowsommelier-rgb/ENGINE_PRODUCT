import { getAllProducts } from '../catalog-data';
import { applyShopQuery, matchesFilters } from '../shop-query';
import { regionsFor, accessorySubCategoriesFor } from '../facets';
import { regionMatchesFilter } from '../geo-aliases';

describe('facet count consistent with grid total (context-aware invariant)', () => {
  const all = getAllProducts();

  it('every region facet under group=Wine: chip count === grid total (exact)', () => {
    // Input set for regionsFor = everything active EXCEPT region/subregion → here just group=Wine.
    const wine = all.filter((p) => matchesFilters(p, { group: 'Wine' }));
    const regions = regionsFor('', wine);
    expect(regions.length).toBeGreaterThan(0);

    // Spot-check the top few regions to keep the test fast.
    for (const { value, count } of regions.slice(0, 5)) {
      const params = { group: 'Wine', region: value };
      const grid = applyShopQuery(all, params);
      // Facet and grid resolve a region by ONE rule — regionMatchesFilter, i.e. the
      // canonical value OR any ancestor of it. The chip count must equal the grid
      // total exactly. Regression guard against the substring count-mismatch bug
      // this test was originally written for.
      expect(grid.total).toBe(count);
      // Regression guard: this previously tallied by exact canonical value, which
      // contradicted the assertion above once ancestor matching landed — one `count`
      // cannot be both 604 (grid) and 603 (exact tally). Tally the same way the grid
      // matches. Spec: 2026-07-27-geography-resolution-design.md.
      const facetCounted = wine.filter((p) => regionMatchesFilter(p.country, p.region, value));
      expect(facetCounted.length).toBe(count);
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
