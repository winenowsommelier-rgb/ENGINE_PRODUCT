import { describe, it, expect } from 'vitest';
import { aggregate, isInStockRaw, mergeKnowledge } from '@/scripts/gen-explore-map-data.mjs';
import { makeGeoResolver } from '../geo-resolve';
import { shopHref } from '../explore/map-data';

const rows = [
  { sku: 'WIN1', name: 'A', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '1', price: 1000, image_url: 'a.jpg' },
  { sku: 'WIN2', name: 'B', region: 'Bordeaux', country: 'France', category_group: 'Wine', is_in_stock: '0', price: 2000 }, // OOS — now COUNTED (map shows all stock)
  { sku: 'LIQ1', name: 'C', region: 'Bordeaux', country: 'France', category_group: 'Liqueur', is_in_stock: '1', price: 500 },
  { sku: 'ACC1', name: 'Fridge', region: 'Bordeaux', country: 'France', category_group: 'Accessories', is_in_stock: '1', price: 9000 }, // excluded group
];

describe('isInStockRaw (string "0"/"1" gotcha)', () => {
  it('treats "0" as out of stock (NOT truthy)', () => {
    expect(isInStockRaw('0')).toBe(false);
    expect(isInStockRaw('1')).toBe(true);
    expect(isInStockRaw(null)).toBe(false);
  });
});

describe('aggregate', () => {
  const { byRegion } = aggregate(rows, { excludeGroups: ['Accessories', 'Events', 'Cigars', 'Non-Alcoholic'] });
  const bdx = byRegion.get('Bordeaux');

  // Regression guard: the map counts ALL beverages (in-stock AND out-of-stock),
  // excluding only Accessories/Events/Cigars/Non-Alcoholic. The OOS WIN2 MUST be
  // counted — an earlier version filtered it out (in-stock only), which made the
  // map show ~half the catalogue. Do not re-add an in-stock filter here without
  // also restoring inStock=1 in shopHref (they move together for count == grid).
  it('counts all (in-stock + OOS) non-excluded products', () => {
    expect(bdx.total).toBe(3);                 // WIN1 + WIN2(OOS) + LIQ1 (ACC1 excluded)
    expect(bdx.countsByGroup.Wine).toBe(2);    // WIN1 + WIN2
    expect(bdx.countsByGroup.Liqueur).toBe(1);
    expect(bdx.countsByGroup.Accessories).toBeUndefined();
  });
  it('price range over all (in-stock + OOS) non-excluded', () => {
    expect(bdx.priceRange).toEqual({ min: 500, max: 2000 }); // WIN2 OOS @2000 now included
  });
  it('peeks carry ONLY allowlisted fields (margin-safe)', () => {
    const ALLOWED = new Set(['sku', 'name', 'price', 'image_url']);
    for (const peek of bdx.peeks) {
      for (const k of Object.keys(peek)) expect(ALLOWED.has(k), `unexpected key ${k}`).toBe(true);
      expect(peek).not.toHaveProperty('margin_pct');
      expect(peek).not.toHaveProperty('cost_price');
    }
  });
});

describe('mergeKnowledge', () => {
  it('attaches only allowlisted keys, skips empties and bogus', () => {
    const r = mergeKnowledge({ name: 'Bordeaux' },
      { grapes: ['Merlot'], tiers: [], attributes: { climate: 'maritime' }, citation: 'x', bogus: 1 });
    expect(r.knowledge).toEqual({ grapes: ['Merlot'], attributes: { climate: 'maritime' }, citation: 'x' });
    expect(r.knowledge.tiers).toBeUndefined();       // empty array dropped
    expect(r.knowledge.bogus).toBeUndefined();       // not spread
  });
  it('no-ops when knowledge is undefined', () => {
    expect(mergeKnowledge({ name: 'X' }, undefined).knowledge).toBeUndefined();
  });
});

// Key separator is a NUL byte — MUST match nodeKey() in the generator.
const SEP = String.fromCharCode(0);
const K = (country: string, name: string) => `${country}${SEP}${name}`;

const TEST_RESOLVER = makeGeoResolver({
  regions: [
    { name: 'California', latitude: 37.3, longitude: -119.0, slug: 'california' },
    { name: 'Oregon', latitude: 44.0, longitude: -120.5, slug: 'oregon' },
  ],
  subregions: [
    { name: 'Napa Valley', latitude: 38.5, longitude: -122.3, slug: 'napa-valley', parentSlug: 'california' },
  ],
  appellations: [],
});

describe('4-level aggregation — ownTotal vs inclusiveTotal', () => {
  const ROWS = [
    { sku: 'A', category_group: 'Wine', country: 'USA', region: 'California', subregion: 'Napa Valley', price: 100 },
    { sku: 'B', category_group: 'Wine', country: 'USA', region: 'California', subregion: 'Napa Valley', price: 200 },
    { sku: 'C', category_group: 'Wine', country: 'USA', region: 'California', subregion: '', price: 50 },
    { sku: 'D', category_group: 'Wine', country: 'USA', region: 'Oregon', subregion: '', price: 75 },
  ];

  it('a row increments ownTotal at EXACTLY ONE node', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const sumOwn = [...nodes.values()].reduce((n, a) => n + a.ownTotal, 0);
    expect(sumOwn).toBe(ROWS.length);
  });

  it('California ownTotal excludes Napa; inclusiveTotal includes it', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const ca = nodes.get(K('USA', 'California'));
    expect(ca.ownTotal).toBe(1);
    expect(ca.inclusiveTotal).toBe(3);
  });

  it('the Napa node is parented to California BY KEY', () => {
    // Guards the subtree assertion below from being vacuous: with a wrong parentKey
    // the children filter matches nothing and every node trivially passes.
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    const napa = nodes.get(K('USA', 'Napa Valley'));
    expect(napa.parentKey).toBe(K('USA', 'California'));
    expect(napa.ownTotal).toBe(2);
  });

  it('inclusiveTotal === ownTotal + sum(children) for every node', () => {
    const { nodes } = aggregate(ROWS, { resolver: TEST_RESOLVER });
    for (const [, n] of nodes) {
      const kids = [...nodes.values()].filter((c) => c.parentKey === n.key);
      const expected = n.ownTotal + kids.reduce((s, c) => s + c.inclusiveTotal, 0);
      expect(n.inclusiveTotal, `subtree mismatch at ${n.name}`).toBe(expected);
    }
  });

  it('an unresolvable subregion rolls up to its parent — no row is dropped', () => {
    const rows = [...ROWS, {
      sku: 'E', category_group: 'Wine', country: 'USA',
      region: 'California', subregion: 'Nonexistent AVA', price: 10,
    }];
    const { nodes, unresolved } = aggregate(rows, { resolver: TEST_RESOLVER });
    const sumOwn = [...nodes.values()].reduce((n, a) => n + a.ownTotal, 0);
    expect(sumOwn).toBe(rows.length);
    expect(nodes.get(K('USA', 'California')).ownTotal).toBe(2);
    expect(unresolved.get('Nonexistent AVA')).toBe(1);
  });

  it('existing callers passing no resolver still work', () => {
    // Back-compat: main() and older tests call aggregate(rows) with no options.
    const out = aggregate(ROWS);
    expect(out.byRegion).toBeInstanceOf(Map);
    expect(out.byCountry).toBeInstanceOf(Map);
  });
});

describe('shopHref — per-level hand-off', () => {
  const base = { slug: 's', lat: 0, lng: 0, total: 1,
    countsByGroup: {}, priceRange: { min: null, max: null }, peeks: [] };

  it('region pin emits country + region', () => {
    const href = shopHref({ ...base, name: 'California', country: 'USA', pinLevel: 'region' } as any, 'all');
    expect(href).toContain('country=USA');
    expect(href).toContain('region=California');
    expect(href).not.toContain('subregion=');
    expect(href).not.toContain('appellation=');
  });

  it('subregion pin emits parent region AND subregion', () => {
    const href = shopHref({
      ...base, name: 'Napa Valley', country: 'USA', pinLevel: 'subregion', parentName: 'California',
    } as any, 'all');
    expect(href).toContain('region=California');
    expect(href).toContain('subregion=Napa+Valley');
  });

  it('appellation pin emits appellation only', () => {
    const href = shopHref({
      ...base, name: 'Barolo', country: 'Italy', pinLevel: 'appellation', parentName: 'Piedmont',
    } as any, 'all');
    expect(href).toContain('appellation=Barolo');
    expect(href).not.toContain('region=');
    expect(href).not.toContain('subregion=');
  });

  it('a pin with NO pinLevel is treated as a region (back-compat)', () => {
    const href = shopHref({ ...base, name: 'Tuscany', country: 'Italy' } as any, 'all');
    expect(href).toContain('region=Tuscany');
    expect(href).not.toContain('subregion=');
  });

  it('lens group is still applied at every level', () => {
    const href = shopHref({
      ...base, name: 'Napa Valley', country: 'USA', pinLevel: 'subregion', parentName: 'California',
    } as any, 'wine');
    expect(href).toContain('group=Wine');
    expect(href).toContain('bev=1');
  });

  it('a subregion pin with NO parentName does not emit an empty region', () => {
    const href = shopHref({
      ...base, name: 'Orphan Sub', country: 'USA', pinLevel: 'subregion',
    } as any, 'all');
    expect(href).not.toMatch(/region=(&|$)/);
    expect(href).toContain('subregion=Orphan+Sub');
  });
});
