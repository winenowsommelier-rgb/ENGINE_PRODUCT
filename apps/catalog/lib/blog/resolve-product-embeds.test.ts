// apps/catalog/lib/blog/resolve-product-embeds.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProductEmbeds } from './resolve-product-embeds';
import type { PublicProduct } from '@/lib/types';

const makeProduct = (sku: string): PublicProduct =>
  ({ sku, name: `Product ${sku}`, price: 1000 } as unknown as PublicProduct);

const products = [makeProduct('WN0001'), makeProduct('WN0002'), makeProduct('WS0001')];

describe('resolveProductEmbeds', () => {
  it('returns map of matched SKUs', () => {
    const html = '<p>Try this <!-- product: WN0001 --> with dinner.</p>';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(1);
    expect(map.get('WN0001')?.name).toBe('Product WN0001');
  });

  it('handles multiple embeds', () => {
    const html = '<!-- product: WN0001 --> and <!-- product: WS0001 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(2);
    expect(map.has('WN0001')).toBe(true);
    expect(map.has('WS0001')).toBe(true);
  });

  it('silently skips unmatched SKUs', () => {
    const html = '<!-- product: ZZ9999 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(0);
  });

  it('is case-insensitive for SKU matching', () => {
    const html = '<!-- product: wn0001 -->';
    const map = resolveProductEmbeds(html, products);
    expect(map.size).toBe(1);
  });

  it('returns empty map when no embeds', () => {
    const map = resolveProductEmbeds('<p>No embeds here.</p>', products);
    expect(map.size).toBe(0);
  });
});
