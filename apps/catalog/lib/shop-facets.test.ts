import { describe, it, expect } from 'vitest';
import { shopFacets } from './shop-facets';
import { applyShopQuery } from './shop-query';
const mk = (sku: string, name: string) => ({ sku, name, country: 'France', is_in_stock: '1' }) as any;
const products = [
  mk('A', 'Chablis Grand Cru'),
  mk('B', 'Chianti DOCG'),
  mk('C', 'Yellow Tail Shiraz'),
];
describe('shopFacets.designations', () => {
  it('lists derived designations with counts, drops products with none', () => {
    const f = shopFacets(products, {});
    const labels = f.designations.map((o) => o.value);
    expect(labels).toContain('Grand Cru');
    expect(labels).toContain('DOCG');
    expect(labels).not.toContain('');
  });
  it('facet count for a designation == grid total when that designation is selected', () => {
    const f = shopFacets(products, {});
    const gc = f.designations.find((o) => o.value === 'Grand Cru')!;
    const grid = applyShopQuery(products, { designation: 'Grand Cru' });
    expect(gc.count).toBe(grid.total);
  });
  it('orders by canonical specificity (DOCG before DOC, not by count)', () => {
    const set = [mk('A','Wine DOC'), mk('B','Wine DOC 2'), mk('C','Wine DOCG')];
    const labels = shopFacets(set, {}).designations.map((o) => o.value);
    expect(labels.indexOf('DOCG')).toBeLessThan(labels.indexOf('DOC'));
  });
});
