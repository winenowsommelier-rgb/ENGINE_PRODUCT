import { describe, it, expect } from 'vitest';
import { isInStock } from '@/lib/utils';

describe('isInStock', () => {
  it('treats the real export string shape correctly', () => {
    // Live export stores "0"/"1" strings, NOT booleans.
    expect(isInStock('1')).toBe(true);
    expect(isInStock('0')).toBe(false);
  });

  it('handles booleans', () => {
    expect(isInStock(true)).toBe(true);
    expect(isInStock(false)).toBe(false);
  });

  it('handles numbers', () => {
    expect(isInStock(1)).toBe(true);
    expect(isInStock(0)).toBe(false);
  });

  it('treats null/undefined/empty as out of stock', () => {
    expect(isInStock(null)).toBe(false);
    expect(isInStock(undefined)).toBe(false);
    expect(isInStock('')).toBe(false);
  });

  it('handles textual booleans case-insensitively', () => {
    expect(isInStock('true')).toBe(true);
    expect(isInStock('FALSE')).toBe(false);
    expect(isInStock('No')).toBe(false);
  });
});
