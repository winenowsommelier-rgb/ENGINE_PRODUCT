import { describe, it, expect } from 'vitest';
import { baseCodeOf, buildBaseSkuMap } from '@/lib/co-purchase';
import { getCoPurchaseBonus, __resetForTest } from '@/lib/co-purchase';

describe('baseCodeOf', () => {
  it('strips a trailing variant-lot suffix', () => {
    expect(baseCodeOf('WRW6603AC')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it has no suffix', () => {
    expect(baseCodeOf('WRW6603')).toBe('WRW6603');
  });
  it('returns the sku unchanged if it does not match the 3-letter/4-digit pattern', () => {
    expect(baseCodeOf('WEIRD')).toBe('WEIRD');
  });
});

describe('buildBaseSkuMap', () => {
  const products = [
    { sku: 'WRW6603AC', name: 'A' },
    { sku: 'WRW6564GF', name: 'B' },
    { sku: 'WRW6564AA', name: 'C' },
    { sku: 'NOPREFIXMATCH', name: 'D' },
  ] as any;

  it('maps a base code to its live sku', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6603')).toEqual(['WRW6603AC']);
  });
  it('fans out a base code to 2 live sku variants', () => {
    const map = buildBaseSkuMap(products);
    expect(map.get('WRW6564')?.sort()).toEqual(['WRW6564AA', 'WRW6564GF']);
  });
  it('excludes codes with no live match (map has no entry for them)', () => {
    const map = buildBaseSkuMap(products);
    expect(map.has('NOP')).toBe(false);
  });
});

describe('BI file loading — graceful degradation', () => {
  it('getCoPurchaseBonus returns 0 when there is no co_order data for the subject', () => {
    const map = new Map<string, string[]>();
    expect(getCoPurchaseBonus('NOSUCHSKU0000', 'ALSONOTREAL0000', map)).toBe(0);
  });
});
