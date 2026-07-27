import { describe, it, expect } from 'vitest';
import {
  canonicalRegionForCountry,
  isRegionLevelValueForCountry,
  regionMatchesFilter,
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
});
