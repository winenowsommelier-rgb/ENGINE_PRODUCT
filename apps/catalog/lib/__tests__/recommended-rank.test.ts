import { describe, it, expect } from 'vitest';
import {
  popularityCutoffP75,
  popularityTier,
  compareRecommended,
} from '@/lib/recommended-rank';

/** Raw-row factory (mirrors the live export shape: is_in_stock as "0"/"1"/bool). */
function r(o: Record<string, unknown>): Record<string, unknown> {
  return { sku: 'x', name: 'x', price: 100, ...o };
}

describe('popularityCutoffP75', () => {
  it('is the 75th-percentile of SCORED (>0) rows only', () => {
    const rows = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => r({ popularity_score: s })),
      r({ popularity_score: 0 }),
      r({}),
    ];
    expect(popularityCutoffP75(rows)).toBe(6);
  });

  it('falls back to the max when fewer than 4 scored rows', () => {
    const rows = [r({ popularity_score: 0.2 }), r({ popularity_score: 0.9 })];
    expect(popularityCutoffP75(rows)).toBe(0.9);
  });

  it('returns Infinity when nothing is scored (no row reaches tier 2)', () => {
    expect(popularityCutoffP75([r({}), r({ popularity_score: 0 })])).toBe(Infinity);
  });
});

describe('popularityTier', () => {
  const cutoff = 6;
  it('0 for unscored / non-numeric / <= 0', () => {
    expect(popularityTier(undefined, cutoff)).toBe(0);
    expect(popularityTier(0, cutoff)).toBe(0);
    expect(popularityTier('5' as unknown, cutoff)).toBe(0);
  });
  it('2 for scored at/above cutoff', () => {
    expect(popularityTier(6, cutoff)).toBe(2);
    expect(popularityTier(9, cutoff)).toBe(2);
  });
  it('1 for scored below cutoff', () => {
    expect(popularityTier(0.001, cutoff)).toBe(1);
    expect(popularityTier(5.9, cutoff)).toBe(1);
  });
});

describe('compareRecommended (tuple order: stock → scored → score desc → price desc → name)', () => {
  it('in-stock sorts before out-of-stock regardless of score', () => {
    const inStockUnscored = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 10 });
    const outStockTopSeller = r({ sku: 'b', is_in_stock: '0', popularity_score: 1, price: 9999 });
    expect(compareRecommended(inStockUnscored, outStockTopSeller)).toBeLessThan(0);
  });

  it('within in-stock, scored sorts before unscored', () => {
    const scored = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.01, price: 10 });
    const unscored = r({ sku: 'b', is_in_stock: '1', popularity_score: 0, price: 9999 });
    expect(compareRecommended(scored, unscored)).toBeLessThan(0);
  });

  it('within scored, higher popularity sorts first', () => {
    const hi = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.9 });
    const lo = r({ sku: 'b', is_in_stock: '1', popularity_score: 0.1 });
    expect(compareRecommended(hi, lo)).toBeLessThan(0);
  });

  it('within unscored in-stock, higher price (premium) sorts first', () => {
    const premium = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 5000 });
    const cheap = r({ sku: 'b', is_in_stock: '1', popularity_score: 0, price: 100 });
    expect(compareRecommended(premium, cheap)).toBeLessThan(0);
  });

  it('breaks remaining ties by name A–Z (deterministic)', () => {
    const a = r({ sku: 'a', name: 'Alpha', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    const b = r({ sku: 'b', name: 'Beta', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    expect(compareRecommended(a, b)).toBeLessThan(0);
    expect(compareRecommended(b, a)).toBeGreaterThan(0);
  });

  it('a literal 0.0 score is treated as UNSCORED (not scored tier)', () => {
    const zero = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 100 });
    const scored = r({ sku: 'b', is_in_stock: '1', popularity_score: 0.0001, price: 100 });
    expect(compareRecommended(scored, zero)).toBeLessThan(0);
  });
});

describe('compareRecommended — integration & robustness', () => {
  const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

  it('full sort over a mixed fixture produces the exact expected ranking', () => {
    // One unambiguous ordering across every tier of the tuple:
    //   1. in-stock before out-of-stock (null/absent stock => out)
    //   2. scored before unscored (score === number > 0)
    //   3. score DESC   4. price DESC   5. name A–Z
    const rows = [
      // in-stock, scored (score DESC wins): 0.9 > 0.3
      r({ sku: 'IN_TOP', name: 'Bordeaux', is_in_stock: '1', popularity_score: 0.9, price: 100 }),
      r({ sku: 'IN_MID', name: 'Chianti', is_in_stock: '1', popularity_score: 0.3, price: 9999 }),
      // in-stock, unscored (price DESC wins): 5000 > 50
      r({ sku: 'IN_PREMIUM', name: 'Champagne', is_in_stock: '1', popularity_score: 0, price: 5000 }),
      r({ sku: 'IN_CHEAP', name: 'Soju', is_in_stock: '1', popularity_score: 0, price: 50 }),
      // in-stock, unscored, MISSING price -> NEGATIVE_INFINITY (ranks last among in-stock)
      r({ sku: 'IN_NOPRICE', name: 'Mystery', is_in_stock: '1', popularity_score: 0, price: undefined }),
      // out-of-stock, scored (beats out-of-stock unscored)
      r({ sku: 'OOS_SELLER', name: 'Rioja', is_in_stock: '0', popularity_score: 0.99, price: 200 }),
      // out-of-stock, unscored
      r({ sku: 'OOS_UNSCORED', name: 'Port', is_in_stock: '0', popularity_score: 0, price: 8000 }),
      // null stock -> treated as out-of-stock; unscored; cheapest of the OOS-unscored bucket,
      // so it sorts AFTER OOS_UNSCORED (8000 > 30).
      r({ sku: 'NULL_STOCK', name: 'Ghost', is_in_stock: null, popularity_score: 0, price: 30 }),
    ];

    const sorted = [...rows].sort(compareRecommended).map((x) => x.sku);
    expect(sorted).toEqual([
      'IN_TOP',       // in-stock, scored 0.9
      'IN_MID',       // in-stock, scored 0.3
      'IN_PREMIUM',   // in-stock, unscored, price 5000
      'IN_CHEAP',     // in-stock, unscored, price 50
      'IN_NOPRICE',   // in-stock, unscored, price -Inf
      'OOS_SELLER',   // out-of-stock, scored
      'OOS_UNSCORED', // out-of-stock, unscored, price 8000
      'NULL_STOCK',   // out-of-stock (null), unscored, price 30
    ]);
  });

  it('is antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a)) at each tier', () => {
    // differ only at the stock tier
    const inStock = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    const outStock = r({ sku: 'b', is_in_stock: '0', popularity_score: 0.5, price: 100 });
    expect(sign(compareRecommended(inStock, outStock))).toBe(
      -sign(compareRecommended(outStock, inStock)),
    );

    // differ only at the score tier (both in-stock, both scored, different score)
    const hi = r({ sku: 'a', is_in_stock: '1', popularity_score: 0.9, price: 100 });
    const lo = r({ sku: 'b', is_in_stock: '1', popularity_score: 0.1, price: 100 });
    expect(sign(compareRecommended(hi, lo))).toBe(-sign(compareRecommended(lo, hi)));

    // differ only at the price tier (both in-stock, both unscored, different price)
    const prem = r({ sku: 'a', is_in_stock: '1', popularity_score: 0, price: 5000 });
    const cheap = r({ sku: 'b', is_in_stock: '1', popularity_score: 0, price: 100 });
    expect(sign(compareRecommended(prem, cheap))).toBe(-sign(compareRecommended(cheap, prem)));
  });

  it('two unscored rows BOTH missing price fall through to name (no NaN)', () => {
    const zebra = r({ sku: 'z', name: 'Zebra', is_in_stock: '1', popularity_score: 0, price: undefined });
    const apple = r({ sku: 'a', name: 'Apple', is_in_stock: '1', popularity_score: 0, price: undefined });
    // price tie at -Inf on BOTH sides => must reach the name tiebreak, never NaN.
    expect(Number.isNaN(compareRecommended(zebra, apple))).toBe(false);
    expect(compareRecommended(apple, zebra)).toBeLessThan(0);
    expect(compareRecommended(zebra, apple)).toBeGreaterThan(0);
  });

  it('is transitive: x<y and y<z implies x<z across mixed tiers', () => {
    // x beats y on the stock tier; y beats z on the score tier.
    const x = r({ sku: 'x', name: 'Aaa', is_in_stock: '1', popularity_score: 0.5, price: 100 });
    const y = r({ sku: 'y', name: 'Bbb', is_in_stock: '0', popularity_score: 0.9, price: 100 });
    const z = r({ sku: 'z', name: 'Ccc', is_in_stock: '0', popularity_score: 0.1, price: 100 });
    expect(compareRecommended(x, y)).toBeLessThan(0);
    expect(compareRecommended(y, z)).toBeLessThan(0);
    expect(compareRecommended(x, z)).toBeLessThan(0);
  });
});
