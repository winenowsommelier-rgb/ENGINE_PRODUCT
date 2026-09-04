import { describe, it, expect } from 'vitest';
import { parseMoney, parsePercent, computeDiscountPct, mapRow } from '../gen-9-9-collection.mjs';

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
