import { describe, it, expect } from 'vitest';
import { REGION_CENTROIDS, centroidFor } from '@/lib/explore/region-centroids';
import { LENS_GROUPS, lensCount, shopHref } from '@/lib/explore/map-data';
import type { MapRegion } from '@/lib/explore/types';

const bordeaux: MapRegion = {
  name: 'Bordeaux', slug: 'bordeaux', country: 'France', lat: 44.8, lng: -0.6,
  total: 323, countsByGroup: { Wine: 321, Liqueur: 2 },
  priceRange: { min: 890, max: 48000 }, peeks: [],
};

describe('region-centroids', () => {
  it('covers the high-depth no-coord regions (sake + Napa + Languedoc)', () => {
    for (const name of ['Niigata', 'Nagano', 'Hyogo', 'Napa Valley', 'Languedoc-Roussillon']) {
      const c = centroidFor(name);
      expect(c, `${name} must have a centroid`).toBeTruthy();
      expect(typeof c!.lat).toBe('number');
      expect(typeof c!.lng).toBe('number');
    }
  });

  it('lookup is case-insensitive and trims', () => {
    expect(centroidFor('  niigata ')).toEqual(centroidFor('Niigata'));
  });

  it('returns null for an unknown region', () => {
    expect(centroidFor('Nowhere-land')).toBeNull();
  });
});

describe('lens mapping', () => {
  it('all = total; wine = Wine group; each lens is exactly ONE group', () => {
    expect(lensCount(bordeaux, 'all')).toBe(323);
    expect(lensCount(bordeaux, 'wine')).toBe(321);
    // Spirits lens = ['Spirits'] ONLY (Liqueur is NOT folded in) — Bordeaux has no
    // Spirits group, so this is 0. Regression guard for the count==grid fix: folding
    // Liqueur into the Spirits lens made the drawer count diverge from the /shop grid
    // (drawer summed Spirits+Liqueur, grid filtered group=Spirits only).
    expect(lensCount(bordeaux, 'spirits')).toBe(0);
    expect(lensCount(bordeaux, 'whisky')).toBe(0);
  });
  it('every lens maps to exactly one group (count == single-group /shop grid)', () => {
    for (const groups of Object.values(LENS_GROUPS)) {
      expect(groups).toHaveLength(1);
    }
  });
  it('LENS_GROUPS maps sake to the catalog "Sake & Asian" group', () => {
    expect(LENS_GROUPS.sake).toContain('Sake & Asian');
  });
});

describe('shopHref', () => {
  it('emits bev=1 + inStock=1 + region NAME + parent country + group (not slug)', () => {
    const href = shopHref(bordeaux, 'wine');
    expect(href.startsWith('/shop?')).toBe(true);
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('bev')).toBe('1');
    expect(qs.get('inStock')).toBe('1');
    expect(qs.get('region')).toBe('Bordeaux');
    expect(qs.get('country')).toBe('France');
    expect(qs.get('group')).toBe('Wine');
  });
  it('lens=all omits the group param but KEEPS bev=1 AND inStock=1', () => {
    const qs = new URLSearchParams(shopHref(bordeaux, 'all').split('?')[1]);
    expect(qs.get('group')).toBeNull();
    expect(qs.get('bev')).toBe('1');
    expect(qs.get('inStock')).toBe('1');
    expect(qs.get('region')).toBe('Bordeaux');
  });
});
