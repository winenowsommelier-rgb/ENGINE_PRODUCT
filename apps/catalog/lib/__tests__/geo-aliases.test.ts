import { describe, it, expect } from 'vitest';
import {
  canonicalRegionForCountry,
  isRegionLevelValueForCountry,
  regionAncestors,
  regionMatchesFilter,
  walkAncestors,
} from '../geo-aliases';

describe('geo-aliases — spelling vs hierarchy', () => {
  it('still normalizes SPELLING aliases (Scotland)', () => {
    expect(canonicalRegionForCountry('Scotland', 'Highlands')).toBe('Highland');
    expect(canonicalRegionForCountry('Scotland', 'Lowlands')).toBe('Lowland');
  });

  it('NO LONGER collapses Napa Valley into California', () => {
    // Regression guard: napa->California was a HIERARCHY COLLAPSE disguised as a
    // spelling alias. It destroyed the sub-AVA level and is why the explore map
    // showed every USA wine as "California". See spec 2026-07-27.
    expect(canonicalRegionForCountry('USA', 'Napa Valley')).toBe('Napa Valley');
  });

  it('still drops a region value equal to its own country', () => {
    expect(canonicalRegionForCountry('France', 'France')).toBe('');
  });

  it('isRegionLevelValueForCountry reads the UNION of both tables', () => {
    // California comes from HIERARCHY_PARENT values; Highland from SPELLING_ALIASES.
    // Reading only one table regresses the other country.
    expect(isRegionLevelValueForCountry('USA', 'California')).toBe(true);
    expect(isRegionLevelValueForCountry('Scotland', 'Highland')).toBe(true);
    expect(isRegionLevelValueForCountry('USA', 'Napa Valley')).toBe(false);
  });

  it('regionMatchesFilter matches a product via its ANCESTOR', () => {
    expect(regionMatchesFilter('USA', 'Napa Valley', 'California')).toBe(true);
    expect(regionMatchesFilter('USA', 'California', 'California')).toBe(true);
    expect(regionMatchesFilter('USA', 'Oregon', 'California')).toBe(false);
  });

  it('real table: Napa Valley rolls up to California', () => {
    expect(regionAncestors('USA', 'Napa Valley')).toEqual(['California']);
    expect(regionAncestors('USA', 'California')).toEqual([]);
    expect(regionAncestors('France', 'Bordeaux')).toEqual([]);
  });
});

describe('walkAncestors — cycle safety', () => {
  // Regression guard: the bounded for(i<8) loop stopped a hang but still returned
  // garbage on a cyclic table — ['B','A','B','A','B','A','B','A'], listing a region
  // as its own ancestor. Latent today (the real table is acyclic) but it would be
  // very hard to debug if a future loader introduced a cycle.
  it('a two-cycle terminates and yields each ancestor at most once', () => {
    // Walking a->B, b->A from 'a' stops at ['B']: coming back round to 'A' would
    // name the STARTING region as its own ancestor, which is exactly the garbage
    // the old bounded-only loop produced (['B','A','B','A','B','A','B','A']).
    const out = walkAncestors({ a: 'B', b: 'A' }, 'a');
    expect(out).toEqual(['B']);
    expect(new Set(out).size).toBe(out.length); // no repeats
    expect(out.map((v) => v.toLowerCase())).not.toContain('a'); // never self-ancestor
  });

  it('a self-cycle yields nothing — a region is never its own ancestor', () => {
    expect(walkAncestors({ a: 'A' }, 'a')).toEqual([]);
  });

  it('a longer 3-cycle still terminates without repeats', () => {
    // a->B->C->(A) — the hop back to the start is dropped for the same reason.
    const out = walkAncestors({ a: 'B', b: 'C', c: 'A' }, 'a');
    expect(out).toEqual(['B', 'C']);
    expect(new Set(out).size).toBe(out.length);
    expect(out.map((v) => v.toLowerCase())).not.toContain('a');
  });

  it('an acyclic chain returns the full lineage nearest-first', () => {
    const out = walkAncestors({ a: 'B', b: 'C' }, 'a');
    expect(out).toEqual(['B', 'C']);
  });
});
