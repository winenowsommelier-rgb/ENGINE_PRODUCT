// apps/catalog/lib/seo/region-blurb-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildRegionBlurb } from './region-blurb-builder';
import type { PublicProduct } from '@/lib/types';

const baseProduct = {
  sku: 'W1', name: 'P1', price: 5000, region: 'Bordeaux', country: 'France',
  variety: 'Cabernet Sauvignon', is_in_stock: true, category_group: 'Wine', category_type: 'Red Wine',
  score_summary: JSON.stringify({ critics: [{ critic: 'James Suckling', score_value: 98 }] }),
} as unknown as PublicProduct;

const cheapProduct = { ...baseProduct, sku: 'W2', name: 'P2', price: 800, variety: 'Merlot', score_summary: undefined } as unknown as PublicProduct;

describe('buildRegionBlurb', () => {
  it('returns null for regions with fewer than 10 products', () => {
    expect(buildRegionBlurb('Bordeaux', 'France', [baseProduct, cheapProduct])).toBeNull();
  });
  it('returns a string paragraph for regions with 10+ products', () => {
    const tenProducts = Array.from({ length: 10 }, (_, i) => ({ ...baseProduct, sku: `W${i}` })) as unknown as PublicProduct[];
    const result = buildRegionBlurb('Bordeaux', 'France', tenProducts);
    expect(typeof result).toBe('string');
    expect(result).toContain('Bordeaux');
    expect(result).toContain('France');
  });
  it('includes price range when products have prices', () => {
    const tenProducts = Array.from({ length: 10 }, (_, i) => ({
      ...(i % 2 === 0 ? baseProduct : cheapProduct), sku: `W${i}`,
    })) as unknown as PublicProduct[];
    const result = buildRegionBlurb('Bordeaux', 'France', tenProducts);
    expect(result).toMatch(/฿\d/);
  });
});
