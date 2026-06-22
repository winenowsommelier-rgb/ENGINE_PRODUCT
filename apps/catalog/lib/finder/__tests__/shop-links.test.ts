import { describe, it, expect } from 'vitest';
import { resolveOriginField, breadcrumbLinks, signatureChips, styleShopUrl, styleShopParams } from '@/lib/finder/shop-links';
import { matchesFilters, type ShopParams } from '@/lib/shop-query';
import type { PublicProduct } from '@/lib/types';

const cat = [
  { region:'Bordeaux' }, { subregion:'Médoc' }, { subregion:'Barossa Valley' }, { country:'Japan' },
] as any as PublicProduct[];

describe('resolveOriginField', () => {
  it('Bordeaux → region', () => expect(resolveOriginField('Bordeaux', cat)).toEqual({ field:'region', value:'Bordeaux' }));
  it('Médoc → subregion', () => expect(resolveOriginField('Médoc', cat)).toEqual({ field:'subregion', value:'Médoc' }));
  it('Japan → country', () => expect(resolveOriginField('Japan', cat)).toEqual({ field:'country', value:'Japan' }));
  it('Barossa (absent) → null', () => expect(resolveOriginField('Barossa', cat)).toBeNull());
});

describe('link builders', () => {
  it('breadcrumb uses class= + resolved geo fields, omits appellation', () => {
    const links = breadcrumbLinks({ category:'red', country:'France', typicalRegion:'Médoc' } as any, cat);
    const medoc = links.find(l => l.label==='Médoc')!;
    expect(medoc.href).toContain('subregion=M'); // Médoc URL-encoded
    expect(links.some(l => l.href.includes('class='))).toBe(true);
    expect(links.every(l => !l.href.includes('appellation'))).toBe(true);
  });
  it('signature chips use FILTER-scale values, never tokens', () => {
    const chips = signatureChips({ category:'red', axis1:'bold', tannin:'firm' } as any);
    expect(chips.some(c => c.href.includes('body=Full'))).toBe(true);
    expect(chips.some(c => c.href.includes('tannin=High'))).toBe(true);
    expect(chips.some(c => c.href.includes('tannin=firm'))).toBe(false);
  });
  it('styleShopUrl has taste params, no geo constraint', () => {
    const url = styleShopUrl({ category:'red', axis1:'bold' } as any);
    expect(url).toContain('body=Full');
    expect(url).not.toContain('region=');
  });
});

// ---------------------------------------------------------------------------
// REAL-FILTER integration: prove the finder's styleShopUrl links are not dead.
//
// String-presence assertions (above) only prove `class=` appears in the URL;
// they would happily pass for a class value that matches ZERO products on /shop
// (the exact "Sparkling Wine" dead-link bug). Here we run each category's
// styleShopUrl through the SAME predicate the real /shop page uses
// (matchesFilters) against a representative product carrying the CANONICAL
// category_group/category_type, and assert it SURVIVES the filter.
// ---------------------------------------------------------------------------
describe('styleShopUrl links survive the real /shop filter (matchesFilters)', () => {
  // matchesFilters takes Next's searchParams shape (Record<string, string|string[]>).
  // styleShopUrl returns "/shop?key=val&..."; parse its querystring into that shape.
  const parse = (url: string): ShopParams =>
    Object.fromEntries(new URL('http://x' + url).searchParams) as ShopParams;

  it('sparkling canary: a Sparkling & Champagne product survives its own style link', () => {
    const p = {
      category_group: 'Wine',
      category_type: 'Sparkling & Champagne',
      sku: 'WSP1',
      is_in_stock: true,
      body: 'Full',
    } as any as PublicProduct;
    const params = parse(styleShopUrl({ category: 'sparkling', axis1: 'bold' } as any));
    expect(matchesFilters(p, params)).toBe(true);
  });

  it('red: a Red Wine product survives its own style link', () => {
    const p = {
      category_group: 'Wine',
      category_type: 'Red Wine',
      sku: 'WRD1',
      is_in_stock: true,
      body: 'Full',
    } as any as PublicProduct;
    const params = parse(styleShopUrl({ category: 'red', axis1: 'bold' } as any));
    expect(matchesFilters(p, params)).toBe(true);
  });

  it('gin: a Gin product survives its own style link', () => {
    const p = {
      category_group: 'Spirits',
      category_type: 'Gin',
      sku: 'GIN1',
      is_in_stock: true,
    } as any as PublicProduct;
    const params = parse(styleShopUrl({ category: 'gin' } as any));
    expect(matchesFilters(p, params)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// styleShopParams is the count contract: the "See all N in your style" count is
// allProducts.filter(p => matchesFilters(p, styleShopParams(answers))).length.
// For that count to equal the /shop grid the link lands on, styleShopParams must
// produce EXACTLY the params styleShopUrl encodes — and matchesFilters must read
// them. These guard that contract so the count can never silently drift from the
// link's destination (the original "See all 6" mismatch bug).
// ---------------------------------------------------------------------------
describe('styleShopParams == styleShopUrl querystring (count contract)', () => {
  const fromUrl = (url: string): Record<string, string> =>
    Object.fromEntries(new URL('http://x' + url).searchParams);

  for (const answers of [
    { category: 'red', axis1: 'bold', tannin: 'firm' },
    { category: 'sake', axis1: 'sweet' },
    { category: 'gin' },
  ] as any[]) {
    it(`params match the URL for ${JSON.stringify(answers)}`, () => {
      expect(styleShopParams(answers)).toEqual(fromUrl(styleShopUrl(answers)));
    });
  }

  it('count via matchesFilters(styleShopParams) finds the in-style products', () => {
    const products = [
      { category_group: 'Wine', category_type: 'Red Wine', sku: 'R1', body: 'Full' },
      { category_group: 'Wine', category_type: 'Red Wine', sku: 'R2', body: 'Light' },
      { category_group: 'Wine', category_type: 'White Wine', sku: 'W1', body: 'Full' },
    ] as any as PublicProduct[];
    const params = styleShopParams({ category: 'red', axis1: 'bold' } as any); // body=Full
    const count = products.filter((p) => matchesFilters(p, params)).length;
    expect(count).toBe(1); // only the Full-bodied Red Wine
  });
});
