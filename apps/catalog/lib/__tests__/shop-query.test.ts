import { describe, it, expect } from 'vitest';
import { applyShopQuery, matchesFilters, SHOP_PAGE_SIZE } from '@/lib/shop-query';
import type { PublicProduct } from '@/lib/types';

/** Minimal product factory; only the fields a test cares about. */
function p(overrides: Partial<PublicProduct> & { sku: string }): PublicProduct {
  return {
    name: overrides.sku,
    price: 100,
    ...overrides,
  } as PublicProduct;
}

/**
 * N products with zero-padded skus/names so default name-sort order equals
 * index order (un-padded "Name 5" would sort after "Name 48" lexicographically).
 */
function many(n: number, fn?: (i: number) => Partial<PublicProduct>): PublicProduct[] {
  return Array.from({ length: n }, (_, i) => {
    const id = String(i).padStart(3, '0');
    return p({ sku: `S${id}`, name: `Name ${id}`, ...(fn?.(i) ?? {}) });
  });
}

// NOTE (10-group migration): the group filter is driven by groupForProduct, which now
// prefers the backfilled category_group field (the same field the export carries). Test
// fixtures set category_group explicitly rather than relying on the unreliable classification.
describe('applyShopQuery — group filter', () => {
  const data = [
    p({ sku: 'w1', category_group: 'Wine', category_type: 'Red Wine' }),
    p({ sku: 'w2', category_group: 'Wine', category_type: 'Sparkling & Champagne' }),
    p({ sku: 'k1', category_group: 'Whisky', category_type: 'Whisky' }),
    p({ sku: 'k2', category_group: 'Whisky', category_type: 'Whisky' }),
    p({ sku: 'g1', category_group: 'Spirits', category_type: 'Gin' }),
  ];

  it('keeps only products in the requested group', () => {
    const r = applyShopQuery(data, { group: 'Wine' });
    expect(r.total).toBe(2);
    expect(r.items.map((x) => x.sku).sort()).toEqual(['w1', 'w2']);
  });

  it('keeps both Whisky products in the Whisky group', () => {
    const r = applyShopQuery(data, { group: 'Whisky' });
    expect(r.total).toBe(2);
    expect(r.items.map((x) => x.sku).sort()).toEqual(['k1', 'k2']);
  });

  it('returns empty for a nonexistent group', () => {
    const r = applyShopQuery(data, { group: 'NonexistentXYZ' });
    expect(r.total).toBe(0);
    expect(r.pageItems).toEqual([]);
  });

  it('no group param → all products', () => {
    expect(applyShopQuery(data, {}).total).toBe(5);
  });
});

describe('applyShopQuery — price filter', () => {
  const data = [
    p({ sku: 'a', price: 500 }), // under-1000
    p({ sku: 'b', price: 1000 }), // 1000-3000 (lower bound inclusive)
    p({ sku: 'c', price: 2999 }), // 1000-3000
    p({ sku: 'd', price: 3000 }), // 3000-7000 (exclusive upper of prev)
    p({ sku: 'e', price: 50000 }), // 15000-plus
  ];

  it('applies [min, max) bounds — lower inclusive, upper exclusive', () => {
    const r = applyShopQuery(data, { price: '1000-3000' });
    expect(r.items.map((x) => x.sku).sort()).toEqual(['b', 'c']);
  });

  it('under-1000 keeps sub-1000 only', () => {
    expect(applyShopQuery(data, { price: 'under-1000' }).items.map((x) => x.sku)).toEqual(['a']);
  });

  it('open-ended top tier keeps the expensive one', () => {
    expect(applyShopQuery(data, { price: '15000-plus' }).items.map((x) => x.sku)).toEqual(['e']);
  });

  it('unknown price id → no price constraint (all pass)', () => {
    expect(applyShopQuery(data, { price: 'bogus' }).total).toBe(5);
  });

  it('drops products with non-numeric price when a tier is active', () => {
    const withBad = [...data, p({ sku: 'x', price: undefined as unknown as number })];
    const r = applyShopQuery(withBad, { price: 'under-1000' });
    expect(r.items.map((x) => x.sku)).toEqual(['a']);
  });
});

describe('applyShopQuery — country / inStock / attribute filters', () => {
  const data = [
    p({ sku: 'fr', country: 'France', is_in_stock: true, region: 'Bordeaux', grape_variety: 'Merlot', wine_body: 'Full', wine_acidity: 'High', wine_tannin: 'Medium', flavor_tags: ['Berry', 'Oak'] }),
    p({ sku: 'it', country: 'Italy', is_in_stock: false, region: 'Tuscany', grape_variety: 'Sangiovese', wine_body: 'Medium', flavor_tags: ['Cherry'] }),
    p({ sku: 'fr2', country: 'france', is_in_stock: true, region: 'Burgundy', grape_variety: 'Pinot Noir' }),
  ];

  it('country match is case-insensitive exact', () => {
    const r = applyShopQuery(data, { country: 'France' });
    expect(r.items.map((x) => x.sku).sort()).toEqual(['fr', 'fr2']);
  });

  it('inStock=1 keeps only in-stock', () => {
    const r = applyShopQuery(data, { inStock: '1' });
    expect(r.items.map((x) => x.sku).sort()).toEqual(['fr', 'fr2']);
  });

  it('region is case-insensitive EXACT match', () => {
    // regression guard: region/subregion are EXACT (was substring); drill-down chips emit
    // exact canonical values, free-text region input removed.
    // A partial like 'bord' must NO LONGER match 'Bordeaux'.
    expect(applyShopQuery(data, { region: 'bord' }).items.map((x) => x.sku)).toEqual([]);
    // The exact value (any case) SHOULD match.
    expect(applyShopQuery(data, { region: 'bordeaux' }).items.map((x) => x.sku)).toEqual(['fr']);
    expect(applyShopQuery(data, { region: 'Bordeaux' }).items.map((x) => x.sku)).toEqual(['fr']);
  });

  it('grape is case-insensitive substring', () => {
    expect(applyShopQuery(data, { grape: 'pinot' }).items.map((x) => x.sku)).toEqual(['fr2']);
  });

  it('flavor matches a tag case-insensitively', () => {
    expect(applyShopQuery(data, { flavor: 'berry' }).items.map((x) => x.sku)).toEqual(['fr']);
  });

  it('body/acidity/tannin are exact case-insensitive', () => {
    expect(applyShopQuery(data, { body: 'full' }).items.map((x) => x.sku)).toEqual(['fr']);
    expect(applyShopQuery(data, { acidity: 'high' }).items.map((x) => x.sku)).toEqual(['fr']);
    expect(applyShopQuery(data, { tannin: 'medium' }).items.map((x) => x.sku)).toEqual(['fr']);
  });

  it('combines filters with AND', () => {
    const r = applyShopQuery(data, { country: 'France', inStock: '1', grape: 'merlot' });
    expect(r.items.map((x) => x.sku)).toEqual(['fr']);
  });
});

describe('applyShopQuery — hasScore filter', () => {
  const data = [
    p({ sku: 'scored', score_summary: '{"avg":92}' }),
    p({ sku: 'empty', score_summary: '' }),
    p({ sku: 'none' }),
  ];
  it('hasScore=1 keeps only non-empty score_summary', () => {
    expect(applyShopQuery(data, { hasScore: '1' }).items.map((x) => x.sku)).toEqual(['scored']);
  });
});

describe('applyShopQuery — sort', () => {
  const data = [
    p({ sku: 'c', name: 'Cabernet', price: 300 }),
    p({ sku: 'a', name: 'Albarino', price: 100 }),
    p({ sku: 'b', name: 'beaujolais', price: 200 }), // lowercase — case-insensitive sort
  ];

  it('default sort is name A–Z, case-insensitive', () => {
    expect(applyShopQuery(data, {}).items.map((x) => x.name)).toEqual([
      'Albarino',
      'beaujolais',
      'Cabernet',
    ]);
  });

  it('price-asc sorts cheapest first', () => {
    expect(applyShopQuery(data, { sort: 'price-asc' }).items.map((x) => x.price)).toEqual([100, 200, 300]);
  });

  it('price-desc sorts most expensive first', () => {
    expect(applyShopQuery(data, { sort: 'price-desc' }).items.map((x) => x.price)).toEqual([300, 200, 100]);
  });

  it('unknown sort falls back to name', () => {
    expect(applyShopQuery(data, { sort: 'bogus' }).items.map((x) => x.name)[0]).toBe('Albarino');
  });

  it('does not mutate the input array order', () => {
    const input = [...data];
    applyShopQuery(input, { sort: 'price-asc' });
    expect(input.map((x) => x.sku)).toEqual(['c', 'a', 'b']);
  });
});

describe('applyShopQuery — pagination math', () => {
  const data = many(50); // 50 items, page size 24 → 3 pages

  it('page 1 returns first 24', () => {
    const r = applyShopQuery(data, {});
    expect(r.pageSize).toBe(SHOP_PAGE_SIZE);
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(3);
    expect(r.pageItems).toHaveLength(24);
    expect(r.pageItems[0].sku).toBe('S000');
    expect(r.pageItems[23].sku).toBe('S023');
  });

  it('page 2 returns items 25–48', () => {
    const r = applyShopQuery(data, { page: '2' });
    expect(r.page).toBe(2);
    expect(r.pageItems).toHaveLength(24);
    expect(r.pageItems[0].sku).toBe('S024');
  });

  it('last page returns the remainder', () => {
    const r = applyShopQuery(data, { page: '3' });
    expect(r.page).toBe(3);
    expect(r.pageItems).toHaveLength(2); // 50 - 48
    expect(r.pageItems.map((x) => x.sku)).toEqual(['S048', 'S049']);
  });

  it('out-of-range page is clamped to the last page', () => {
    const r = applyShopQuery(data, { page: '99' });
    expect(r.page).toBe(3);
    expect(r.pageItems.map((x) => x.sku)).toEqual(['S048', 'S049']);
  });

  it('page < 1 or garbage clamps to 1', () => {
    expect(applyShopQuery(data, { page: '0' }).page).toBe(1);
    expect(applyShopQuery(data, { page: '-5' }).page).toBe(1);
    expect(applyShopQuery(data, { page: 'abc' }).page).toBe(1);
  });

  it('exactly 24 items → 1 page', () => {
    expect(applyShopQuery(many(24), {}).totalPages).toBe(1);
  });

  it('25 items → 2 pages', () => {
    expect(applyShopQuery(many(25), {}).totalPages).toBe(2);
  });
});

describe('applyShopQuery — empty result', () => {
  it('reports page 1 / totalPages 1 / empty slice (never page 0 of 0)', () => {
    const r = applyShopQuery([], {});
    expect(r.total).toBe(0);
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(1);
    expect(r.pageItems).toEqual([]);
  });

  it('filtering down to zero still yields a valid page 1', () => {
    const r = applyShopQuery(many(10), { group: 'NopeXYZ', page: '5' });
    expect(r.total).toBe(0);
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(1);
  });
});

describe('applyShopQuery — Next searchParams array shape', () => {
  it('uses the first value when a param arrives as string[]', () => {
    const data = [p({ sku: 'w', classification: 'Red Wine' }), p({ sku: 'g', classification: 'Gin' })];
    const r = applyShopQuery(data, { group: ['Wine', 'Spirits'] });
    expect(r.items.map((x) => x.sku)).toEqual(['w']);
  });
});

// ----------------------------------------------------------------------------
// matchesFilters — shared per-product predicate (drill-down nav + facet counts)
// ----------------------------------------------------------------------------

const P = (over: Partial<import('@/lib/types').PublicProduct>): import('@/lib/types').PublicProduct =>
  ({ sku: 'W1', name: 'x', ...over } as import('@/lib/types').PublicProduct);

// NOTE (10-group migration): for non-accessory groups, `class` now matches the canonical
// category_type (typeForProduct), not the first classification segment. category_type is the
// authoritative SKU-derived sub-type. For Accessories it still matches accessoryCategoryForSku.
describe('matchesFilters — class (canonical category_type)', () => {
  it('matches category_type case-insensitively', () => {
    const prod = P({ sku: 'WRW1', category_group: 'Wine', category_type: 'Red Wine' });
    expect(matchesFilters(prod, { class: 'red wine' })).toBe(true);
    expect(matchesFilters(prod, { class: 'fruit wine' })).toBe(false);
  });
  it('no class param → no constraint', () => {
    expect(matchesFilters(P({ category_type: 'Gin' }), {})).toBe(true);
  });
});

describe('matchesFilters — Accessories class = accessory sub-category (NOT classification)', () => {
  it('matches accessoryCategoryForSku when group is Accessories', () => {
    const prod = P({ sku: 'GWN1' });
    expect(matchesFilters(prod, { group: 'Accessories', class: 'Glassware' })).toBe(true);
    expect(matchesFilters(prod, { group: 'Accessories', class: 'Bar Tools & Gifts' })).toBe(false);
  });
  it('an AWC fridge matches the "Wine Coolers & Fridges" accessory class', () => {
    const prod = P({ sku: 'AWC100' });
    expect(matchesFilters(prod, { group: 'Accessories', class: 'Wine Coolers & Fridges' })).toBe(true);
  });
  it('for a NON-Accessories group, class matches the canonical category_type', () => {
    const prod = P({ sku: 'WRW1', category_group: 'Wine', category_type: 'Red Wine' });
    expect(matchesFilters(prod, { group: 'Wine', class: 'Red Wine' })).toBe(true);
  });
  it('an Accessories product whose SKU has no sub-category mapping never falsely matches a class', () => {
    // 'AZZ999' resolves to the Accessories GROUP (A* letter fallback) but has no specific
    // accessory sub-type → accessoryCategoryForSku yields 'Unknown', which must never equal
    // a real accessory class like 'Glassware'.
    const prod = P({ sku: 'AZZ999' });
    expect(matchesFilters(prod, { group: 'Accessories', class: 'Glassware' })).toBe(false);
  });
});

describe('matchesFilters — subregion (EXACT, like region)', () => {
  const prod = P({ region: 'Bordeaux', subregion: 'Pauillac' });
  it('EXACT-matches subregion case-insensitively', () => {
    // regression guard: region/subregion are EXACT (was substring); drill-down chips emit
    // exact canonical values, free-text region input removed.
    expect(matchesFilters(prod, { subregion: 'pauil' })).toBe(false); // partial no longer matches
    expect(matchesFilters(prod, { subregion: 'Pauillac' })).toBe(true);
    expect(matchesFilters(prod, { subregion: 'pauillac' })).toBe(true);
    expect(matchesFilters(prod, { subregion: 'margaux' })).toBe(false);
  });
});

describe('matchesFilters — combined drill-down AND', () => {
  it('all of group+class+country+region+subregion must hold', () => {
    const prod = P({ sku: 'WRW1', category_group: 'Wine', category_type: 'Red Wine', country: 'France',
      region: 'Bordeaux', subregion: 'Pauillac' });
    const params = { group: 'Wine', class: 'Red Wine', country: 'France',
      region: 'Bordeaux', subregion: 'Pauillac' };
    expect(matchesFilters(prod, params)).toBe(true);
    expect(matchesFilters(prod, { ...params, subregion: 'Margaux' })).toBe(false);
  });
});

describe('applyShopQuery still honors everything via matchesFilters', () => {
  it('class filter narrows the grid', () => {
    const items = [
      P({ sku: 'WRW1', category_group: 'Wine', category_type: 'Red Wine' }),
      P({ sku: 'WWW2', category_group: 'Wine', category_type: 'White Wine' }),
    ];
    const r = applyShopQuery(items, { class: 'Red Wine' });
    expect(r.total).toBe(1);
    expect(r.pageItems[0].sku).toBe('WRW1');
  });
});

describe('matchesFilters — body/acidity/tannin normalized to the 4-step scale', () => {
  it('a product stored "Medium-Light" body matches the "Medium" dropdown option', () => {
    const prod = { sku: 'W1', name: 'x', wine_body: 'Medium-Light' } as any;
    expect(matchesFilters(prod, { body: 'Medium' })).toBe(true);
  });
  it('a product stored "Medium-Full" acidity matches the "Medium-High" option', () => {
    const prod = { sku: 'W1', name: 'x', wine_acidity: 'Medium-Full' } as any;
    expect(matchesFilters(prod, { acidity: 'Medium-High' })).toBe(true);
  });
  it('exact in-scale value still matches', () => {
    const prod = { sku: 'W1', name: 'x', wine_acidity: 'High' } as any;
    expect(matchesFilters(prod, { acidity: 'High' })).toBe(true);
  });
  it('off-scale/unknown → null normalize → does not match an unrelated option', () => {
    const prod = { sku: 'W1', name: 'x', wine_tannin: 'unknowable' } as any;
    expect(matchesFilters(prod, { tannin: 'High' })).toBe(false);
  });
});
