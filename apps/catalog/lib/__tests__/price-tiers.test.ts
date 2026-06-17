import { describe, it, expect } from 'vitest';
import { formatPrice, tierForPrice, tierById, PRICE_TIERS } from '@/lib/price-tiers';

describe('formatPrice', () => {
  it('formats THB with ฿ and thousands separators', () => expect(formatPrice(1600)).toBe('฿1,600'));
  it('formats large numbers', () => expect(formatPrice(2460999)).toBe('฿2,460,999'));
  it('formats small numbers', () => expect(formatPrice(40)).toBe('฿40'));
  it('rounds to whole baht (no decimals)', () => expect(formatPrice(1599.5)).toBe('฿1,600'));
  it('handles 0 / null gracefully', () => {
    expect(formatPrice(0)).toBe('฿0');
    expect(formatPrice(null as any)).toBe('—'); // or some safe placeholder
  });
});

describe('price tiers', () => {
  it('has 5 brackets', () => expect(PRICE_TIERS.length).toBe(5));
  it('buckets 500 -> Under ฿1,000', () => expect(tierForPrice(500).label).toContain('Under'));
  it('buckets 20000 -> ฿15,000+', () => expect(tierForPrice(20000).label).toContain('15,000'));
  it('bracket edges are unambiguous (upper bound exclusive)', () => {
    // convention: [min, max) — upper bound exclusive
    expect(tierForPrice(1000).label).not.toContain('Under'); // 1000 is NOT "under 1000"
    expect(tierForPrice(2999).label).toContain('1,000');     // 2999 in 1,000-3,000
    expect(tierForPrice(3000).label).toContain('3,000');     // 3000 in 3,000-7,000, not 1,000-3,000
  });
  it('every tier has a stable id usable in URL query', () => {
    for (const t of PRICE_TIERS) expect(typeof t.id).toBe('string');
  });
});

describe('tierById', () => {
  it('resolves a known id', () => expect(tierById('3000-7000')?.label).toContain('3,000'));
  it('returns undefined for an unknown id', () => expect(tierById('nope')).toBeUndefined());
});
