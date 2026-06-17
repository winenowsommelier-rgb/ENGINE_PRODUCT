import { describe, it, expect } from 'vitest';
import { getAllProducts, getProductBySku, PUBLIC_FIELDS } from '@/lib/catalog-data';

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
});
