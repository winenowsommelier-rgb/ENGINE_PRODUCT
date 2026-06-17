import { describe, it, expect } from 'vitest';
import { toPublicProduct, PUBLIC_FIELDS } from '@/lib/catalog-data';

const RAW = {
  sku: 'WRW2106AC', name: 'Test Red', price: 1600, currency: 'THB',
  image_url: 'https://th.wine-now.com/x.jpg', is_in_stock: true,
  margin_pct: 42.5, b2b_margin_pct: 30, enrichment_confidence: 0.9,
};

describe('toPublicProduct', () => {
  it('only emits allowlisted keys', () => {
    const pub = toPublicProduct(RAW as any);
    for (const k of Object.keys(pub)) expect(PUBLIC_FIELDS).toContain(k);
  });
  it('NEVER includes margin/B2B/internal fields', () => {
    const pub = toPublicProduct(RAW as any) as unknown as Record<string, unknown>;
    expect(pub.margin_pct).toBeUndefined();
    expect(pub.b2b_margin_pct).toBeUndefined();
    expect(pub.enrichment_confidence).toBeUndefined();
  });
  it('preserves safe fields', () => {
    const pub = toPublicProduct(RAW as any);
    expect(pub.sku).toBe('WRW2106AC');
    expect(pub.price).toBe(1600);
  });
});
