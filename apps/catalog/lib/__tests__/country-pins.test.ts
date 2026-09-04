import { describe, it, expect } from 'vitest';
import { countryLensCount, buildCountryPins, type CountryPin } from '@/lib/explore/country-pins';
import type { MapRegion, ExploreMapData } from '@/lib/explore/types';

const SEP = String.fromCharCode(0);

// Regression guard for the LSJ0024DG/Chum Churum bug report (2026-09-01):
// Vietnam has Sake & Asian stock (Kai, category_type Shochu) but ZERO real sake.
// The "Sake" lens's country chip list / map pin must NOT count Vietnam, even
// though the group-level count is > 0.
describe('countryLensCount — type-aware for the sake lens', () => {
  it('region-less country: excludes stock whose type does not match the lens type', () => {
    const vietnam: CountryPin = {
      name: 'Vietnam', slug: 'vietnam', lat: 14, lng: 108, regions: [],
      total: 1, countsByGroup: { 'Sake & Asian': 1 },
      countsByGroupType: { [`Sake & Asian${SEP}Shochu`]: 1 },
    };
    expect(countryLensCount(vietnam, 'sake')).toBe(0);
    // Group-level lens (spirits/wine/etc.) and 'all' are unaffected.
    expect(countryLensCount(vietnam, 'all')).toBe(1);
  });

  it('region-less country: counts stock whose type DOES match the lens type', () => {
    const japan: CountryPin = {
      name: 'Japan', slug: 'japan', lat: 36, lng: 138, regions: [],
      total: 500, countsByGroup: { 'Sake & Asian': 468 },
      countsByGroupType: { [`Sake & Asian${SEP}Sake / Shochu`]: 468 },
    };
    expect(countryLensCount(japan, 'sake')).toBe(468);
  });

  it('country WITH regions: sums the type-aware lensCount of each region', () => {
    const realSakeRegion: MapRegion = {
      name: 'Niigata', slug: 'niigata', country: 'Japan', lat: 37.9, lng: 139,
      total: 10, countsByGroup: { 'Sake & Asian': 10 },
      countsByGroupType: { [`Sake & Asian${SEP}Sake / Shochu`]: 8, [`Sake & Asian${SEP}Shochu`]: 2 },
      priceRange: { min: null, max: null }, peeks: [],
    };
    const pin: CountryPin = {
      name: 'Japan', slug: 'japan', lat: 36, lng: 138, regions: [realSakeRegion],
    };
    expect(countryLensCount(pin, 'sake')).toBe(8);
  });

  it('falls back to group-level count when countsByGroupType is absent (fail open, older data)', () => {
    const vietnamNoTypeData: CountryPin = {
      name: 'Vietnam', slug: 'vietnam', lat: 14, lng: 108, regions: [],
      total: 1, countsByGroup: { 'Sake & Asian': 1 },
    };
    expect(countryLensCount(vietnamNoTypeData, 'sake')).toBe(1);
  });
});

describe('buildCountryPins — carries countsByGroupType through for region-less countries', () => {
  it('a region-less country pin exposes countsByGroupType from the roll-up', () => {
    const data: ExploreMapData = {
      _meta: { generated: '', totalMapped: 0, rolledUpRegions: 0, curatedCount: 0 },
      regions: [],
      countries: [{
        name: 'Vietnam', slug: 'vietnam', lat: 14, lng: 108, total: 1,
        countsByGroup: { 'Sake & Asian': 1 },
        countsByGroupType: { [`Sake & Asian${SEP}Shochu`]: 1 },
      }],
    };
    const pins = buildCountryPins(data);
    const vn = pins.find((p) => p.name === 'Vietnam');
    expect(vn?.countsByGroupType?.[`Sake & Asian${SEP}Shochu`]).toBe(1);
  });
});
