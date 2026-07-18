import { describe, it, expect } from 'vitest';
import type { ExploreMapData, MapRegion } from '@/lib/explore/types';
import { buildCountryPins, countryLensCount, type CountryPin } from '@/lib/explore/country-pins';
import {
  countriesToGeoJSON,
  regionsToGeoJSON,
  pointsBounds,
  compactCount,
  WORLD_BOUNDS,
} from '@/lib/explore/geojson';

function region(over: Partial<MapRegion>): MapRegion {
  return {
    name: 'Bordeaux', slug: 'bordeaux', country: 'France', lat: 44.8, lng: -0.6,
    total: 300, countsByGroup: { Wine: 300 }, priceRange: { min: null, max: null }, peeks: [],
    ...over,
  };
}

const bordeaux = region({});
const burgundy = region({ name: 'Burgundy', slug: 'burgundy', lat: 47.0, lng: 4.8, total: 200, countsByGroup: { Wine: 180, Spirits: 20 } });
const islay = region({ name: 'Islay', slug: 'islay', country: 'Scotland', lat: 55.7, lng: -6.2, total: 90, countsByGroup: { Whisky: 90 } });

const data: ExploreMapData = {
  _meta: { generated: '', totalMapped: 0, rolledUpRegions: 0, curatedCount: 0 },
  regions: [bordeaux, burgundy, islay],
  countries: [
    { name: 'France', slug: 'france', lat: 46.6, lng: 2.2, total: 500, countsByGroup: { Wine: 480, Spirits: 20 } },
    { name: 'Scotland', slug: 'scotland', lat: 56.5, lng: -4.2, total: 90, countsByGroup: { Whisky: 90 } },
    // Region-less country with stock → must still get a pin.
    { name: 'Spain', slug: 'spain', lat: 40.2, lng: -3.6, total: 358, countsByGroup: { Wine: 350, Spirits: 8 } },
    // Zero stock → no pin.
    { name: 'Ghostland', slug: 'ghostland', lat: 0, lng: 0, total: 0, countsByGroup: {} },
  ],
};

describe('buildCountryPins', () => {
  const pins = buildCountryPins(data);
  it('covers curated AND region-less countries with stock; drops zero-stock', () => {
    expect(pins.map((p) => p.name)).toEqual(['France', 'Scotland', 'Spain']);
    expect(pins.find((p) => p.name === 'Spain')?.regions).toHaveLength(0);
    expect(pins.find((p) => p.name === 'France')?.regions.map((r) => r.slug).sort())
      .toEqual(['bordeaux', 'burgundy']);
  });
  it('countryLensCount: curated sums regions; region-less uses roll-up groups', () => {
    const france = pins.find((p) => p.name === 'France')!;
    expect(countryLensCount(france, 'all')).toBe(500);   // 300 + 200 region sum
    expect(countryLensCount(france, 'wine')).toBe(480);  // 300 + 180
    const spain = pins.find((p) => p.name === 'Spain')!;
    expect(countryLensCount(spain, 'all')).toBe(358);
    expect(countryLensCount(spain, 'whisky')).toBe(0);
  });
});

describe('countriesToGeoJSON', () => {
  const pins = buildCountryPins(data);
  it('emits [lng, lat] order, lens-filtered, with hasRegions for click routing', () => {
    const fc = countriesToGeoJSON(pins, 'all');
    const france = fc.features.find((f) => f.properties.slug === 'france')!;
    expect(france.geometry.coordinates).toEqual([2.2, 46.6]); // lng FIRST (GeoJSON)
    expect(france.properties.hasRegions).toBe(true);
    const spain = fc.features.find((f) => f.properties.slug === 'spain')!;
    expect(spain.properties.hasRegions).toBe(false);
  });
  it('drops countries with 0 under the lens (never a dead pin)', () => {
    const fc = countriesToGeoJSON(pins, 'whisky');
    expect(fc.features.map((f) => f.properties.slug)).toEqual(['scotland']);
  });
});

describe('regionsToGeoJSON', () => {
  it('lens-filters regions and carries count + label properties', () => {
    const fc = regionsToGeoJSON([bordeaux, burgundy], 'spirits');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ slug: 'burgundy', count: 20, countLabel: '20' });
  });
});

describe('pointsBounds', () => {
  it('returns tight [w,s,e,n] bounds and null for empty input', () => {
    expect(pointsBounds([bordeaux, burgundy, islay])).toEqual([-6.2, 44.8, 4.8, 55.7]);
    expect(pointsBounds([])).toBeNull();
  });
  it('every stocked country sits inside WORLD_BOUNDS', () => {
    const [w, s, e, n] = WORLD_BOUNDS;
    for (const c of data.countries.filter((c) => c.total > 0)) {
      expect(c.lng).toBeGreaterThanOrEqual(w);
      expect(c.lng).toBeLessThanOrEqual(e);
      expect(c.lat).toBeGreaterThanOrEqual(s);
      expect(c.lat).toBeLessThanOrEqual(n);
    }
  });
});

describe('compactCount', () => {
  it('abbreviates thousands for pin labels', () => {
    expect(compactCount(96)).toBe('96');
    expect(compactCount(1958)).toBe('2k');
    expect(compactCount(1449)).toBe('1.4k');
    expect(compactCount(10742)).toBe('11k');
  });
});

describe('lens-switch state rule (spec)', () => {
  it('a focused country emptied by the lens is detectable via countryLensCount', () => {
    const scotland: CountryPin = buildCountryPins(data).find((p) => p.name === 'Scotland')!;
    // Under 'sake' Scotland has nothing → client must reset to world view.
    expect(countryLensCount(scotland, 'sake')).toBe(0);
  });
});
