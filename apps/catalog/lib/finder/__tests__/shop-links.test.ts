import { describe, it, expect } from 'vitest';
import { resolveOriginField, breadcrumbLinks, signatureChips, styleShopUrl } from '@/lib/finder/shop-links';
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
