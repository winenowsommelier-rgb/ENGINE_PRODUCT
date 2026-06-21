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
