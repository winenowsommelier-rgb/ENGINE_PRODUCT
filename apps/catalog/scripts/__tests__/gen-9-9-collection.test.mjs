import { describe, it, expect } from 'vitest';
import { parseMoney, parsePercent, computeDiscountPct } from '../gen-9-9-collection.mjs';

describe('parseMoney', () => {
  it('strips commas and quotes, returns a number', () => {
    expect(parseMoney('"2,349"')).toBe(2349);
    expect(parseMoney('2349')).toBe(2349);
    expect(parseMoney('959')).toBe(959);
  });

  it('returns null for #REF! or empty', () => {
    expect(parseMoney('#REF!')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('parses "9%" to 9', () => {
    expect(parsePercent('9%')).toBe(9);
    expect(parsePercent('20%')).toBe(20);
  });

  it('returns null for #REF! or empty', () => {
    expect(parsePercent('#REF!')).toBeNull();
    expect(parsePercent('')).toBeNull();
  });
});

describe('computeDiscountPct', () => {
  it('recomputes from regular/promo price, rounded', () => {
    expect(computeDiscountPct(2585, 2349)).toBe(9); // (2585-2349)/2585 = 9.13% -> 9
    expect(computeDiscountPct(9800, 7799)).toBe(20);
  });

  it('returns 0 when promoPrice >= regularPrice or prices missing', () => {
    expect(computeDiscountPct(1000, 1000)).toBe(0);
    expect(computeDiscountPct(1000, 1200)).toBe(0);
    expect(computeDiscountPct(null, 1000)).toBe(0);
  });
});
