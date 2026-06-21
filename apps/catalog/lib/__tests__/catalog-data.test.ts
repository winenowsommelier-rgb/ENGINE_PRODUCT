import { describe, it, expect } from 'vitest';
import { toPublicProduct, PUBLIC_FIELDS, getAllProducts } from '@/lib/catalog-data';
import { compareRecommended } from '@/lib/recommended-rank';

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
    expect(pub.is_in_stock).toBe(true);
    expect(pub.currency).toBe('THB');
  });
  it('copies null-valued safe fields as null (does NOT drop them)', () => {
    // Regression guard: toPublicProduct uses `!== undefined`, so an explicit null is a real
    // value and must survive. Do NOT switch to `!= null`.
    const pub = toPublicProduct({ sku: 'X', name: 'Y', price: 1, region: null } as any);
    expect('region' in pub).toBe(true);
    expect((pub as any).region).toBeNull();
  });
  it('emits ONLY the derived popularity_tier when raw has no other safe fields', () => {
    // Regression guard (updated 2026-06-22): toPublicProduct now ALWAYS attaches the
    // coarse, client-safe popularity_tier (defaulting to 0), so the projection of a raw
    // row with no other allowlisted field is { popularity_tier: 0 }, not {}. The internal
    // popularity_rank/margin_pct/id are still structurally impossible to leak — only the
    // derived tier is added, never the raw popularity_score. See the dedicated
    // 'toPublicProduct — popularity_tier' block below.
    const pub = toPublicProduct({ margin_pct: 42, id: 7, popularity_rank: 3 } as any);
    expect(Object.keys(pub)).toEqual(['popularity_tier']);
    expect(pub.popularity_tier).toBe(0);
    expect((pub as any).margin_pct).toBeUndefined();
    expect((pub as any).popularity_rank).toBeUndefined();
  });
  it('exposes flavor_tags_canonical on projected products', () => {
    const withCanon = getAllProducts().find(p => (p as any).flavor_tags_canonical?.length);
    expect(withCanon, 'at least one product has canonical flavor tags').toBeTruthy();
    expect(Array.isArray((withCanon as any).flavor_tags_canonical)).toBe(true);
  });
});

describe('toPublicProduct — popularity_tier', () => {
  it('sets popularity_tier from the passed bucket and NEVER leaks popularity_score', () => {
    const pub = toPublicProduct(
      { sku: 'A', name: 'A', price: 100, popularity_score: 0.9, is_in_stock: true } as any,
      2,
    );
    expect(pub.popularity_tier).toBe(2);
    expect((pub as any).popularity_score).toBeUndefined();
  });
  it('defaults popularity_tier to 0 when no bucket passed', () => {
    const pub = toPublicProduct({ sku: 'A', name: 'A', price: 100 } as any);
    expect(pub.popularity_tier).toBe(0);
  });
  it('popularity_tier is in the allowlist (only-allowlisted-keys invariant holds)', () => {
    expect(PUBLIC_FIELDS).toContain('popularity_tier');
  });
});

describe('getAllProducts — Recommended order + no score leak', () => {
  const all = getAllProducts();
  it('NO public product carries popularity_score / popularity_rank', () => {
    for (const p of all) {
      expect((p as any).popularity_score).toBeUndefined();
      expect((p as any).popularity_rank).toBeUndefined();
    }
  });
  it('is globally sorted so no in-stock product appears after an out-of-stock one', () => {
    let seenOutOfStock = false;
    for (const p of all) {
      const inStock = p.is_in_stock === true;
      if (!inStock) seenOutOfStock = true;
      else expect(seenOutOfStock, `in-stock ${p.sku} appears after an out-of-stock product`).toBe(false);
    }
  });
  it('within the in-stock block, a tier-2 product never appears after a tier-0 product', () => {
    let seenTier0 = false;
    for (const p of all) {
      if (p.is_in_stock !== true) break;
      if (p.popularity_tier === 0) seenTier0 = true;
      if (p.popularity_tier === 2) {
        expect(seenTier0, `tier-2 ${p.sku} appears after a tier-0 in-stock product`).toBe(false);
      }
    }
  });
});
