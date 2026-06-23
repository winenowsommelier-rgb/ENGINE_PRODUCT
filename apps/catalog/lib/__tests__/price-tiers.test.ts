import { describe, it, expect } from 'vitest';
import { formatPrice, resolveSale, tierForPrice, tierById, PRICE_TIERS } from '@/lib/price-tiers';

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

// resolveSale is PAYMENT-PATH logic: it decides whether the storefront shows a
// "discount". A false positive renders a fake/misleading deal. These tests lock
// in that a sale is ONLY surfaced for a genuine special_price < price, and that
// the percent is computed from the prices (never trusted from source data).
describe('resolveSale', () => {
  it('returns a sale when special_price is a genuine discount', () => {
    // WRW2107AC canary: ฿700 -> ฿648 = 7% off, save ฿52
    expect(resolveSale(700, 648)).toEqual({ special: 648, percentOff: 7, saveAmount: 52 });
  });
  it('rounds percent to nearest whole', () => {
    // 1899 -> 1838 = 3.21% -> 3
    expect(resolveSale(1899, 1838)?.percentOff).toBe(3);
  });
  it('returns null when there is no special_price (the common case, e.g. WSP1096AD)', () => {
    expect(resolveSale(2339, null)).toBeNull();
    expect(resolveSale(2339, undefined)).toBeNull();
  });
  it('returns null when special_price equals price (not a discount)', () => {
    expect(resolveSale(700, 700)).toBeNull();
  });
  it('returns null when special_price is HIGHER than price (bad source data, never a markup)', () => {
    expect(resolveSale(700, 900)).toBeNull();
  });
  it('returns null for zero/negative special_price', () => {
    expect(resolveSale(700, 0)).toBeNull();
    expect(resolveSale(700, -50)).toBeNull();
  });
  it('returns null for a sub-1% discount (rounds to no badge-worthy deal)', () => {
    // 0.4% off rounds to 0 — don't show a "0% off" badge
    expect(resolveSale(10000, 9970)).toBeNull();
  });
  it('returns null when the regular price itself is missing/NaN', () => {
    expect(resolveSale(null, 648)).toBeNull();
    expect(resolveSale(undefined, 648)).toBeNull();
    expect(resolveSale(NaN, 648)).toBeNull();
  });
});
