import { describe, it, expect } from 'vitest';
import { getPromo99, isPromo99Active } from '../promo-9-9';

describe('getPromo99 (reads the real generated data/promo_9_9_collection.json)', () => {
  it('returns the promo collection with a positive item count', () => {
    const promo = getPromo99();
    expect(promo).not.toBeNull();
    expect(promo!.slug).toBe('9-9-collection');
    expect(promo!.items.length).toBeGreaterThan(0);
  });
});

describe('isPromo99Active', () => {
  it('is true strictly before the cutoff', () => {
    expect(isPromo99Active(new Date('2026-09-09T23:59:58+07:00'))).toBe(true);
  });

  it('is false at and after the cutoff', () => {
    expect(isPromo99Active(new Date('2026-09-09T23:59:59+07:00'))).toBe(false);
    expect(isPromo99Active(new Date('2026-09-10T00:00:00+07:00'))).toBe(false);
  });

  it('is true well before the cutoff (e.g. today)', () => {
    expect(isPromo99Active(new Date('2026-09-04T12:00:00+07:00'))).toBe(true);
  });
});
