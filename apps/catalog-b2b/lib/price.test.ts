import { describe, it, expect } from 'vitest';
import { formatPrice, wholesaleDiscountPct } from './price';

describe('formatPrice', () => {
  it('formats THB with symbol and thousands separators', () => {
    expect(formatPrice(1600)).toBe('฿1,600');
    expect(formatPrice(620, 'THB')).toBe('฿620');
  });
  it('rounds to whole units', () => {
    expect(formatPrice(699.5)).toBe('฿700');
  });
});

describe('wholesaleDiscountPct', () => {
  it('computes the % off RRP', () => {
    expect(wholesaleDiscountPct(700, 620)).toBe(11.4);
  });
  it('returns null when there is no RRP', () => {
    expect(wholesaleDiscountPct(undefined, 620)).toBeNull();
    expect(wholesaleDiscountPct(null, 620)).toBeNull();
  });
  it('returns null when b2b_price is not below RRP (never renders a fake discount)', () => {
    expect(wholesaleDiscountPct(600, 600)).toBeNull();
    expect(wholesaleDiscountPct(500, 600)).toBeNull();
  });
  it('returns null for a sub-1% difference', () => {
    expect(wholesaleDiscountPct(1000, 995)).toBeNull();
  });
});
