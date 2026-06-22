import { describe, it, expect } from 'vitest';
import { aggregate, isInStockRaw } from '@/scripts/gen-explore-map-data.mjs';

const rows = [
  { sku: 'WIN1', name: 'A', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '1', price: 1000, image_url: 'a.jpg' },
  { sku: 'WIN2', name: 'B', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '0', price: 2000 }, // OOS — now COUNTED (map shows all stock)
  { sku: 'LIQ1', name: 'C', region: 'Bordeaux', country: 'France', category_group: 'Liqueur', is_in_stock: '1', price: 500 },
  { sku: 'ACC1', name: 'Fridge', region: 'Bordeaux', country: 'France', category_group: 'Accessories', is_in_stock: '1', price: 9000 }, // excluded group
];

describe('isInStockRaw (string "0"/"1" gotcha)', () => {
  it('treats "0" as out of stock (NOT truthy)', () => {
    expect(isInStockRaw('0')).toBe(false);
    expect(isInStockRaw('1')).toBe(true);
    expect(isInStockRaw(null)).toBe(false);
  });
});

describe('aggregate', () => {
  const { byRegion } = aggregate(rows, { excludeGroups: ['Accessories', 'Events', 'Cigars', 'Non-Alcoholic'] });
  const bdx = byRegion.get('Bordeaux');

  // Regression guard: the map counts ALL beverages (in-stock AND out-of-stock),
  // excluding only Accessories/Events/Cigars/Non-Alcoholic. The OOS WIN2 MUST be
  // counted — an earlier version filtered it out (in-stock only), which made the
  // map show ~half the catalogue. Do not re-add an in-stock filter here without
  // also restoring inStock=1 in shopHref (they move together for count == grid).
  it('counts all (in-stock + OOS) non-excluded products', () => {
    expect(bdx.total).toBe(3);                 // WIN1 + WIN2(OOS) + LIQ1 (ACC1 excluded)
    expect(bdx.countsByGroup.Wine).toBe(2);    // WIN1 + WIN2
    expect(bdx.countsByGroup.Liqueur).toBe(1);
    expect(bdx.countsByGroup.Accessories).toBeUndefined();
  });
  it('price range over all (in-stock + OOS) non-excluded', () => {
    expect(bdx.priceRange).toEqual({ min: 500, max: 2000 }); // WIN2 OOS @2000 now included
  });
  it('peeks carry ONLY allowlisted fields (margin-safe)', () => {
    const ALLOWED = new Set(['sku', 'name', 'price', 'image_url']);
    for (const peek of bdx.peeks) {
      for (const k of Object.keys(peek)) expect(ALLOWED.has(k), `unexpected key ${k}`).toBe(true);
      expect(peek).not.toHaveProperty('margin_pct');
      expect(peek).not.toHaveProperty('cost_price');
    }
  });
});
