import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { applyShopQuery } from '@/lib/shop-query';
import { lensPrimaryGroup } from '@/lib/explore/map-data';
import { loadExploreMapData } from '@/lib/explore/map-data.server';

const PEEK_KEYS = new Set(['sku', 'name', 'price', 'image_url']);

describe('explore-map invariant: panel count == /shop grid total', () => {
  const data = loadExploreMapData();
  const all = getAllProducts();

  it('every curated region: map total === /shop grid total for {bev:1,country,region} (STRICT)', () => {
    for (const r of data.regions) {
      // bev:1 (group axis) makes /shop count the SAME all-stock beverage subset the
      // generator counted. We deliberately do NOT pass inStock:1: the map counts
      // in-stock AND OOS beverages, and shopHref drops inStock:1 too, so the grid
      // must count both. Adding inStock:1 here would re-introduce the count != grid
      // gap (the map would show all stock; the grid would show only in-stock).
      const grid = applyShopQuery(all, { bev: '1', country: r.country, region: r.name });
      expect(grid.total, `count mismatch for ${r.name}`).toBe(r.total);
      expect(r.total).toBeGreaterThan(0);
    }
  });

  it('lens handoff group is a real /shop group for a represented lens', () => {
    const r = data.regions.find((x) => (x.countsByGroup['Wine'] ?? 0) > 0)!;
    const grid = applyShopQuery(all, { bev: '1', country: r.country, region: r.name, group: lensPrimaryGroup('wine')! });
    expect(grid.total).toBeGreaterThan(0);
  });

  it('NO peek carries a non-allowlisted (margin) field', () => {
    for (const r of data.regions) {
      for (const peek of r.peeks) {
        for (const k of Object.keys(peek)) expect(PEEK_KEYS.has(k)).toBe(true);
      }
    }
  });
});
