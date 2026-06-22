import { describe, it, expect } from 'vitest';
import { REGION_CENTROIDS, centroidFor } from '@/lib/explore/region-centroids';
import { LENS_GROUPS, lensCount, shopHref } from '@/lib/explore/map-data';
import { loadExploreMapData } from '@/lib/explore/map-data.server';
import { CENTROIDS as MJS_CENTROIDS } from '@/scripts/gen-explore-map-data.mjs';
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
  // Regression guard: shopHref must NOT emit inStock=1. The map counts all
  // beverages (in-stock + OOS), so the /shop grid must show all stock too, or the
  // count != grid. inStock=1 was removed in lockstep with dropping the in-stock
  // filter in gen-explore-map-data.mjs aggregate(). bev=1 stays (group axis).
  it('emits bev=1 (NO inStock) + region NAME + parent country + group (not slug)', () => {
    const href = shopHref(bordeaux, 'wine');
    expect(href.startsWith('/shop?')).toBe(true);
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('bev')).toBe('1');
    expect(qs.get('inStock')).toBeNull();
    expect(qs.get('region')).toBe('Bordeaux');
    expect(qs.get('country')).toBe('France');
    expect(qs.get('group')).toBe('Wine');
  });
  it('lens=all omits the group param but KEEPS bev=1 (and still no inStock)', () => {
    const qs = new URLSearchParams(shopHref(bordeaux, 'all').split('?')[1]);
    expect(qs.get('group')).toBeNull();
    expect(qs.get('bev')).toBe('1');
    expect(qs.get('inStock')).toBeNull();
    expect(qs.get('region')).toBe('Bordeaux');
  });
});

describe('loadExploreMapData', () => {
  it('loads the generated file and returns curated regions + countries', () => {
    const data = loadExploreMapData();
    expect(Array.isArray(data.regions)).toBe(true);
    expect(data.regions.length).toBeGreaterThan(0);
    expect(data.countries.length).toBeGreaterThan(0);
    for (const r of data.regions) {
      expect(typeof r.lat).toBe('number');
      expect(r.country.length).toBeGreaterThan(0);
    }
  });
});

describe('centroid parity (TS module vs .mjs inline copy)', () => {
  it('the two hand-maintained centroid tables agree on keys + lat/lng', () => {
    expect(Object.keys(MJS_CENTROIDS).sort()).toEqual(Object.keys(REGION_CENTROIDS).sort());
    for (const k of Object.keys(REGION_CENTROIDS)) {
      expect(MJS_CENTROIDS[k].lat).toBe(REGION_CENTROIDS[k].lat);
      expect(MJS_CENTROIDS[k].lng).toBe(REGION_CENTROIDS[k].lng);
    }
  });
});
