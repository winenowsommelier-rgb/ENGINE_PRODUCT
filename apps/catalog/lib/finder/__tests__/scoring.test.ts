import { describe, it, expect } from 'vitest';
import { scoreProducts, bodyLadderDistance } from '@/lib/finder/scoring';
import type { Answers } from '@/lib/finder/answers';

const P = (o: any) => ({ price: 1500, is_in_stock: true, classification: 'Red Wine', ...o });

describe('bodyLadderDistance (5-level ordinal)', () => {
  it('exact = 0 steps', () => expect(bodyLadderDistance('Full','Full')).toBe(0));
  it('adjacent = 1 step', () => expect(bodyLadderDistance('Full','Medium-Full')).toBe(1));
  it('far = 4 steps', () => expect(bodyLadderDistance('Full','Light')).toBe(4));
  it('unknown value = null (no score)', () => expect(bodyLadderDistance('Full','???')).toBeNull());
});

describe('scoreProducts', () => {
  const ans = (o: Partial<Answers>): Answers => ({ category:'red', ...o } as Answers);

  it('ranks the exact-body match above a far one', () => {
    const pool = [P({sku:'WRWfar', wine_body:'Light'}), P({sku:'WRWexact', wine_body:'Full'})];
    const out = scoreProducts(ans({axis1:'bold'}), pool as any); // bold → Full
    expect(out.products[0].sku).toBe('WRWexact');
  });

  it('a "No preference" (no axis1) contributes 0 → both present, neither boosted by body', () => {
    const pool = [P({sku:'WRWa', wine_body:'Full', price:2000}), P({sku:'WRWb', wine_body:'Light', price:1000})];
    const out = scoreProducts(ans({}), pool as any);
    expect(out.products.map(p=>p.sku)).toContain('WRWa');
  });

  it('minimum-results guarantee: returns ≥4 even when nothing matches deeply, flagged degraded', () => {
    const pool = Array.from({length:6},(_,i)=>P({sku:`WRW${i}`, wine_body:undefined}));
    const res = scoreProducts(ans({axis1:'bold', flavorChips:['oak']}), pool as any);
    expect(res.products.length).toBeGreaterThanOrEqual(4);
    expect(res.degraded).toBe(true); // nothing cleared the quality threshold → honest-label flag
  });

  it('a genuine deep match is NOT degraded', () => {
    const pool = [P({sku:'WRW1', wine_body:'Full'}), P({sku:'WRW2', wine_body:'Light'}),
                  P({sku:'WRW3', wine_body:'Medium-Full'}), P({sku:'WRW4', wine_body:'Full'})];
    const res = scoreProducts(ans({axis1:'bold'}), pool as any);
    expect(res.degraded).toBe(false);
  });

  it('never returns duplicates or out-of-stock', () => {
    const pool = [P({sku:'WRW1'}), P({sku:'WRW1'}), P({sku:'WRW9', is_in_stock:false})];
    const res = scoreProducts(ans({}), pool as any);
    expect(new Set(res.products.map(p=>p.sku)).size).toBe(res.products.length);
    expect(res.products.some(p=>p.sku==='WRW9')).toBe(false);
  });
});
