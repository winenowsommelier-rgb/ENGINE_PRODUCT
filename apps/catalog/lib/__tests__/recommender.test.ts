import { describe, it, expect } from 'vitest';
import { getRecommendations, precomputeRecommendations } from '@/lib/recommender';

const base = { sku:'A', name:'A', region:'Bordeaux', grape_variety:'Cabernet',
  country:'France', classification:'Red Wine', food_matching:'Beef, Lamb', price:1600, is_in_stock:true } as any;
const pool = [
  base,
  { ...base, sku:'B', name:'B', price:1700 },
  { ...base, sku:'C', name:'C', region:'Napa', country:'USA', food_matching:'Beef', price:1800 },
  { ...base, sku:'D', name:'D', region:'X', grape_variety:'Y', country:'Z', classification:'Gin', food_matching:'Fish', price:50000 },
  { ...base, sku:'E', name:'E', is_in_stock:false },
];

describe('getRecommendations', () => {
  it('returns up to 4, excludes self and OOS, no dupes', () => {
    const recs = getRecommendations(base, pool);
    expect(recs.length).toBeLessThanOrEqual(4);
    expect(recs.find(r => r.sku === 'A')).toBeUndefined();
    expect(recs.find(r => r.sku === 'E')).toBeUndefined();
    expect(new Set(recs.map(r => r.sku)).size).toBe(recs.length);
  });
  it('ranks the most-similar product first', () => {
    expect(getRecommendations(base, pool)[0].sku).toBe('B');
  });
  it('a far-out-of-band product (price 50000, no shared attrs) ranks last or is dropped', () => {
    const recs = getRecommendations(base, pool);
    const dIdx = recs.findIndex(r => r.sku === 'D');
    expect(dIdx === -1 || dIdx === recs.length - 1).toBe(true);
  });
  it('food_matching overlap is counted (case-insensitive, comma-split)', () => {
    const p1 = { ...base, sku:'P1', region:'z', grape_variety:'z', country:'z', classification:'z', price:999999, food_matching:'beef, lamb' };
    const p2 = { ...base, sku:'P2', region:'z', grape_variety:'z', country:'z', classification:'z', price:999999, food_matching:'Fish' };
    const recs = getRecommendations(base, [base, p1, p2]);
    expect(recs[0].sku).toBe('P1');
  });
});

describe('precomputeRecommendations', () => {
  it('returns a Map<sku, sku[]> covering in-stock products', () => {
    const map = precomputeRecommendations(pool);
    expect(map.get('A')).toBeDefined();
    expect(Array.isArray(map.get('A'))).toBe(true);
    expect(map.get('A')!.length).toBeLessThanOrEqual(4);
    expect(map.get('A')).not.toContain('A');
    expect(map.get('A')).not.toContain('E');
  });

  // Pins the accepted region-bucketing approximation — see precomputeRecommendations
  // docblock. If this fails after a refactor, the perf/parity tradeoff changed
  // intentionally-or-not; re-decide, don't just update the assertion.
  it('does NOT surface a cross-region high-scorer (region-bucketing approximation)', () => {
    // Subject product P, region "Bordeaux".
    const P = { ...base, sku:'P', region:'Bordeaux', grape_variety:'Merlot',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000 };

    // Five MORE in-stock products in P's OWN region bucket (Bordeaux), so the
    // in-region pool reaches >= MIN_POOL (MAX_RECS + 1 = 5 incl. P) and the
    // classification/country/global widening chain is NOT triggered. These share
    // ONLY region with P (+3) and nothing else, so each scores exactly 3.
    const inRegion = ['R1','R2','R3','R4','R5'].map((sku) => ({
      ...base, sku, region:'Bordeaux', grape_variety:'none', country:'none',
      classification:'none', food_matching:'', price:999999, is_in_stock:true,
    }));

    // A cross-region candidate that WOULD outscore the in-region items in a full
    // scan: shares grape_variety (+2) + country (+1) + classification (+1) +
    // food "Beef" (+1) + price band (+1) = score 6 > 3, but it lives in region
    // "Napa", a DIFFERENT bucket, so bucketing must never merge it into P's pool.
    const crossRegion = { ...base, sku:'X', region:'Napa', grape_variety:'Merlot',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:true };

    const map = precomputeRecommendations([P, ...inRegion, crossRegion]);
    const recsForP = map.get('P')!;

    // The approximation is pinned: X is NOT recommended even though it would win a
    // full scan. P's recs come only from its region bucket (the R* items).
    expect(recsForP).not.toContain('X');
    expect(recsForP.every((sku) => sku.startsWith('R'))).toBe(true);
  });

  // Tiny region bucket forces the widening chain. We can't observe the bounded
  // global slice from outside, so instead we assert the INVARIANTS still hold
  // after widening: <= MAX_RECS results, all valid in-stock non-self skus.
  it('a product with a tiny region bucket still returns <= 4 valid in-stock non-self skus', () => {
    // Subject T is alone in its region "Solo" — region bucket has only T itself,
    // so widening (classification -> country -> global fallback) must kick in.
    const T = { ...base, sku:'T', region:'Solo', grape_variety:'Syrah',
      country:'France', classification:'Red Wine', food_matching:'Beef', price:1000 };
    // Other in-stock products in different regions but sharing classification/
    // country with T so widening can find eligible neighbours.
    const others = ['N1','N2','N3','N4','N5','N6'].map((sku, i) => ({
      ...base, sku, region:`Reg${i}`, grape_variety:'Syrah', country:'France',
      classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:true,
    }));
    const oos = { ...base, sku:'OOS', region:'Reg9', country:'France',
      classification:'Red Wine', food_matching:'Beef', price:1000, is_in_stock:false };

    const allProducts = [T, ...others, oos];
    const map = precomputeRecommendations(allProducts);
    const recsForT = map.get('T')!;
    const inStockSkus = new Set(others.map((o) => o.sku)); // valid recommendable skus

    expect(recsForT.length).toBeGreaterThan(0); // widening produced neighbours
    expect(recsForT.length).toBeLessThanOrEqual(4); // bounded by MAX_RECS
    expect(new Set(recsForT).size).toBe(recsForT.length); // no dupes
    expect(recsForT).not.toContain('T'); // never self
    expect(recsForT).not.toContain('OOS'); // never out-of-stock
    expect(recsForT.every((sku) => inStockSkus.has(sku))).toBe(true); // only valid in-stock skus
  });

  // is_in_stock undefined => treated as unavailable in BOTH directions:
  // (a) the product gets no recs computed (absent from the map), and
  // (b) it is never recommended TO any other product.
  it('a product with is_in_stock undefined gets no recs and is never recommended', () => {
    const ghost = { ...base, sku:'GHOST', is_in_stock: undefined };
    const inStockTwin = { ...base, sku:'TWIN', price:1650 }; // would otherwise match
    const map = precomputeRecommendations([base, inStockTwin, ghost]);

    // (a) GHOST is not in the map (no recs computed for an unavailable product).
    expect(map.has('GHOST')).toBe(false);

    // (b) GHOST is never recommended to anyone else.
    for (const recs of map.values()) {
      expect(recs).not.toContain('GHOST');
    }
  });
});
