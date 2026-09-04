import { describe, it, expect } from 'vitest';
import { parseMoney, parsePercent, computeDiscountPct, mapRow, interleaveProportionally } from '../gen-9-9-collection.mjs';

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

describe('mapRow', () => {
  it('maps a normal row using the 9.9 price and price columns', () => {
    const row = { sku: 'LWH0474ES', '9.9 price': '"2,349"', price: '"2,585"' };
    expect(mapRow(row)).toEqual({
      sku: 'LWH0474ES', promoPrice: 2349, regularPrice: 2585, discountPct: 9,
    });
  });

  it('falls back to regular price with 0 discount on #REF! rows', () => {
    const row = { sku: 'LWH0233AA', '9.9 price': '#REF!', price: '"3,719"' };
    expect(mapRow(row)).toEqual({
      sku: 'LWH0233AA', promoPrice: 3719, regularPrice: 3719, discountPct: 0,
    });
  });

  it('returns null when sku is missing', () => {
    expect(mapRow({ sku: '', '9.9 price': '100', price: '200' })).toBeNull();
  });

  it('returns null when regular price cannot be parsed (no usable price at all)', () => {
    expect(mapRow({ sku: 'X', '9.9 price': '#REF!', price: '#REF!' })).toBeNull();
  });
});

describe('interleaveProportionally', () => {
  it('mixes two equal-length lists strictly alternating', () => {
    expect(interleaveProportionally(['a1', 'a2'], ['b1', 'b2'])).toEqual([
      'a1', 'b1', 'a2', 'b2',
    ]);
  });

  it('spreads a shorter list across a longer one instead of front-loading it', () => {
    const a = ['a1', 'a2']; // spirits: 2 items
    const b = ['b1', 'b2', 'b3', 'b4']; // wine: 4 items
    const merged = interleaveProportionally(a, b);
    expect(merged).toHaveLength(6);
    // Neither source's items should all cluster at one end: the first
    // half of the merged list must contain at least one item from "a".
    const firstHalf = merged.slice(0, 3);
    expect(firstHalf.some((x) => x.startsWith('a'))).toBe(true);
    // And the second half must still contain "b" items too (not just "a"
    // dumped at the front and "b" tailing off at the back).
    const secondHalf = merged.slice(3);
    expect(secondHalf.some((x) => x.startsWith('b'))).toBe(true);
  });

  it('preserves each list\'s internal relative order', () => {
    const merged = interleaveProportionally(['a1', 'a2', 'a3'], ['b1', 'b2']);
    const aOnly = merged.filter((x) => x.startsWith('a'));
    const bOnly = merged.filter((x) => x.startsWith('b'));
    expect(aOnly).toEqual(['a1', 'a2', 'a3']);
    expect(bOnly).toEqual(['b1', 'b2']);
  });

  it('handles one empty list by returning the other unchanged', () => {
    expect(interleaveProportionally([], ['b1', 'b2'])).toEqual(['b1', 'b2']);
    expect(interleaveProportionally(['a1', 'a2'], [])).toEqual(['a1', 'a2']);
  });

  it('does not front-load 85 spirits before any of 148 wines (realistic ratio)', () => {
    const spirits = Array.from({ length: 85 }, (_, i) => `L${i}`);
    const wine = Array.from({ length: 148 }, (_, i) => `W${i}`);
    const merged = interleaveProportionally(spirits, wine);
    expect(merged).toHaveLength(233);
    // The first 24 items (one grid page) must contain both categories.
    const firstPage = merged.slice(0, 24);
    const spiritsOnPage1 = firstPage.filter((x) => x.startsWith('L')).length;
    const wineOnPage1 = firstPage.filter((x) => x.startsWith('W')).length;
    expect(spiritsOnPage1).toBeGreaterThan(0);
    expect(wineOnPage1).toBeGreaterThan(0);
  });
});
