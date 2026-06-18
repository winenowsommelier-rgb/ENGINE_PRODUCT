import { describe, it, expect } from 'vitest';
import {
  searchEntries,
  SEARCH_RESULT_CAP,
  type SearchEntry,
} from '@/lib/search-index';
import { buildSearchIndex } from '@/lib/search-index.server';
import { getAllProducts } from '@/lib/catalog-data';

describe('buildSearchIndex (real catalog)', () => {
  const index = buildSearchIndex();

  it('returns one entry per product', () => {
    expect(index.length).toBe(getAllProducts().length);
    expect(index.length).toBeGreaterThan(11000);
  });

  it('every entry exposes ONLY {sku,name,brand,region} keys (no margin/internal leak)', () => {
    const allowed = new Set(['sku', 'name', 'brand', 'region']);
    // Scan a generous sample (every entry would be fine too, but this is fast).
    for (const e of index) {
      for (const k of Object.keys(e)) {
        expect(allowed.has(k)).toBe(true);
      }
    }
  });

  it('never carries a forbidden internal field', () => {
    const forbidden = [
      'margin_pct',
      'b2b_margin_pct',
      'id',
      'price',
      'popularity_score',
      'enrichment_confidence',
    ];
    for (const e of index.slice(0, 500)) {
      for (const f of forbidden) {
        expect(f in e).toBe(false);
      }
    }
  });

  it('sku and name are always present', () => {
    for (const e of index.slice(0, 500)) {
      expect(typeof e.sku).toBe('string');
      expect(e.sku.length).toBeGreaterThan(0);
      expect(typeof e.name).toBe('string');
    }
  });
});

describe('searchEntries (pure match helper)', () => {
  const fixture: SearchEntry[] = [
    { sku: 'WSP1112BU', name: 'Moet & Chandon Rose Imperial', brand: 'Moet & Chandon', region: 'Champagne' },
    { sku: 'WRW6598GX', name: 'VIK Milla Cala', brand: 'Vik', region: 'Cachapoal Valley' },
    { sku: 'WWW1785GX', name: 'Pounamu Sauvignon Blanc', brand: 'Pounamu', region: 'Marlborough' },
    { sku: 'WRW6614GX', name: 'VIK Millahue', brand: 'Vik', region: 'Cachapoal Valley' },
  ];

  it('matches by name (case-insensitive)', () => {
    const r = searchEntries(fixture, 'milla');
    expect(r.map((e) => e.sku)).toContain('WRW6598GX'); // "Milla Cala"
    expect(r.map((e) => e.sku)).toContain('WRW6614GX'); // "Millahue"
  });

  it('matches by region', () => {
    const r = searchEntries(fixture, 'marlborough');
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('WWW1785GX');
  });

  it('matches by brand', () => {
    const r = searchEntries(fixture, 'moet');
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('WSP1112BU');
  });

  it('matches by sku', () => {
    const r = searchEntries(fixture, 'www1785gx');
    expect(r).toHaveLength(1);
    expect(r[0].sku).toBe('WWW1785GX');
  });

  it('is case-insensitive on the query', () => {
    expect(searchEntries(fixture, 'VIK')).toHaveLength(2);
    expect(searchEntries(fixture, 'vik')).toHaveLength(2);
  });

  it('returns [] for an empty / whitespace-only query', () => {
    expect(searchEntries(fixture, '')).toEqual([]);
    expect(searchEntries(fixture, '   ')).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    expect(searchEntries(fixture, 'zzz-no-match')).toEqual([]);
  });

  it('caps results at SEARCH_RESULT_CAP (10)', () => {
    // 25 entries all containing "wine" -> must cap at 10.
    const many: SearchEntry[] = Array.from({ length: 25 }, (_, i) => ({
      sku: `SKU${i}`,
      name: `Generic Wine ${i}`,
    }));
    const r = searchEntries(many, 'wine');
    expect(r).toHaveLength(SEARCH_RESULT_CAP);
    expect(SEARCH_RESULT_CAP).toBe(10);
  });

  it('tolerates entries missing brand/region', () => {
    const sparse: SearchEntry[] = [{ sku: 'X1', name: 'Lonely Bottle' }];
    expect(searchEntries(sparse, 'lonely')).toHaveLength(1);
    expect(searchEntries(sparse, 'nothere')).toEqual([]);
  });
});
