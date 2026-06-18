import { describe, it, expect } from 'vitest';
import { getAllProducts, getProductBySku, PUBLIC_FIELDS, toPublicProduct } from '@/lib/catalog-data';

describe('catalog loader', () => {
  const all = getAllProducts();
  it('loads every product from the export', () => { expect(all.length).toBeGreaterThan(11000); });
  it('every product exposes only allowlisted keys', () => {
    for (const p of all.slice(0, 200))
      for (const k of Object.keys(p)) expect(PUBLIC_FIELDS).toContain(k);
  });
  it('looks up a known SKU', () => {
    expect(getProductBySku('WRW2106AC')?.sku).toBe('WRW2106AC');
  });
  it('returns undefined for unknown SKU', () => {
    expect(getProductBySku('NOPE-DOES-NOT-EXIST')).toBeUndefined();
  });
  it('price + image populated for the vast majority', () => {
    const withImg = all.filter(p => p.image_url);
    expect(withImg.length).toBeGreaterThan(11000);
  });

  // DATA-INTEGRITY INVARIANT (CLAUDE.md Rule 6): the raw export stores is_in_stock
  // as a STRING "0"/"1" or null. The loader MUST normalize it to a real boolean so
  // plain-truthiness consumers (the recommender) are correct. Regression guard for
  // the bug where out-of-stock "0" products were treated as in-stock (truthy string).
  it('normalizes is_in_stock to a real boolean for EVERY product (never a string)', () => {
    const offenders = all.filter(p => typeof p.is_in_stock !== 'boolean');
    expect(offenders.length).toBe(0);
  });

  // Real-data shape: the export has both "0" (out) and "1" (in) rows. After the
  // load-time normalization there must be a meaningful population of each boolean.
  it('produces both in-stock (true) and out-of-stock (false) products from real data', () => {
    const inStockCount = all.filter(p => p.is_in_stock === true).length;
    const outOfStockCount = all.filter(p => p.is_in_stock === false).length;
    expect(inStockCount).toBeGreaterThan(1000);  // ~5,655 "1" rows
    expect(outOfStockCount).toBeGreaterThan(1000); // ~5,683 "0" + 98 null rows
  });
});

// Unit-level proof that toPublicProduct coerces the raw "0"/"1"/null shape to a
// real boolean (no dependency on the 26 MB export).
describe('toPublicProduct is_in_stock normalization', () => {
  it('"0" -> false, "1" -> true, null -> false', () => {
    expect(toPublicProduct({ sku: 'X', is_in_stock: '0' }).is_in_stock).toBe(false);
    expect(toPublicProduct({ sku: 'X', is_in_stock: '1' }).is_in_stock).toBe(true);
    expect(toPublicProduct({ sku: 'X', is_in_stock: null }).is_in_stock).toBe(false);
  });
  it('preserves a value that is already a real boolean', () => {
    expect(toPublicProduct({ sku: 'X', is_in_stock: true }).is_in_stock).toBe(true);
    expect(toPublicProduct({ sku: 'X', is_in_stock: false }).is_in_stock).toBe(false);
  });
});
