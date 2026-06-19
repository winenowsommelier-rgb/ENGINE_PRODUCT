import { describe, it, expect } from 'vitest';
import { finderPrefilter } from '@/lib/finder/category-map';
import type { Answers } from '@/lib/finder/answers';

// groupForProduct resolves by SKU PREFIX first (W*=Wine, LWH=Whisky, L*=Spirits, G*=Accessories...).
// Fixtures MUST use realistic prefixes or the override mis-buckets them.
const P = (o: any) => ({ price: 1000, is_in_stock: true, ...o });
const POOL = [
  P({ sku:'WRW001', classification:'Red Wine' }),
  P({ sku:'WWW001', classification:'White Wine' }),
  P({ sku:'WSP001', classification:'Champagne' }),
  P({ sku:'LGN001', classification:'Gin' }),
  P({ sku:'LRM001', classification:'Rum' }),
  P({ sku:'LWH001', classification:'Whisky' }),
  P({ sku:'WRW999', classification:'Red Wine', is_in_stock:false }),
];
const ans = (o: Partial<Answers>): Answers => ({ category:'red', ...o } as Answers);

describe('finderPrefilter', () => {
  it('gin returns Gin only — NOT rum/vodka', () =>
    expect(finderPrefilter(POOL as any, ans({category:'gin'})).map(p=>p.sku)).toEqual(['LGN001']));
  it('spirits EXCLUDES gin', () =>
    expect(finderPrefilter(POOL as any, ans({category:'spirits'})).map(p=>p.sku)).toEqual(['LRM001']));
  it('sparkling returns Champagne, excludes still wine', () =>
    expect(finderPrefilter(POOL as any, ans({category:'sparkling'})).map(p=>p.sku)).toEqual(['WSP001']));
  it('red excludes white/sparkling', () =>
    expect(finderPrefilter(POOL as any, ans({category:'red'})).map(p=>p.sku)).toEqual(['WRW001']));
  it('always excludes out-of-stock', () =>
    expect(finderPrefilter(POOL as any, ans({category:'red'})).some(p=>p.sku==='WRW999')).toBe(false));
  it('budget index 0 (Under ฿1,000) excludes a ฿1,500 wine; budget 1 includes it', () => {
    const pool = [P({sku:'WRW010', classification:'Red Wine', price:500}),
                  P({sku:'WRW011', classification:'Red Wine', price:1500})];
    expect(finderPrefilter(pool as any, ans({category:'red', budget:0})).map(p=>p.sku)).toEqual(['WRW010']);
    expect(finderPrefilter(pool as any, ans({category:'red', budget:1})).map(p=>p.sku)).toEqual(['WRW011']);
  });
});
