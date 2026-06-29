import { describe, it, expect } from 'vitest';
import { partitionWorldPins, SOUTH_LAT_THRESHOLD, type CountryPin } from '../RegionAtlas';

/**
 * Previously, the world view split pins into a northern band + a southern-hemisphere
 * badge. The map now shows all pins on a taller full-height canvas, so partitionWorldPins
 * always returns all countries in `north` and an empty `south`.
 *
 * SOUTH_LAT_THRESHOLD is retained so external callers don't break; the partition
 * function no longer uses it for splitting (every country goes into north).
 */

function pin(name: string, lat: number, lng: number, total: number): CountryPin {
  return { name, slug: name.toLowerCase(), lat, lng, regions: [], total };
}

describe('partitionWorldPins — all pins go to north (no southern badge)', () => {
  const lens = 'all' as const;

  it('puts ALL countries including southern hemisphere into north bucket', () => {
    const pins = [
      pin('France', 46.6, 2.2, 2573),
      pin('USA', 38.5, -121.5, 789),
      pin('Japan', 35.7, 139.0, 50),
      pin('Chile', -33, -71, 196),
      pin('Argentina', -33, -68.5, 196),
      pin('Australia', -33, 151, 120),
      pin('New Zealand', -41.3, 174, 60),
      pin('South Africa', -33.9, 18.9, 84),
    ];
    const { north, south } = partitionWorldPins(pins, lens);
    // All 8 countries go into north; south is always empty.
    expect(north.map((c) => c.name).sort()).toEqual(
      ['Argentina', 'Australia', 'Chile', 'France', 'Japan', 'New Zealand', 'South Africa', 'USA'].sort(),
    );
    expect(south).toHaveLength(0);
  });

  it('puts near-equator southern countries into north (not split)', () => {
    const pins = [
      pin('Brazil', -10, -55, 30),
      pin('Peru', -9.2, -75, 12),
      pin('Chile', -33, -71, 196),
    ];
    const { north, south } = partitionWorldPins(pins, lens);
    expect(north.map((c) => c.name).sort()).toEqual(['Brazil', 'Chile', 'Peru'].sort());
    expect(south).toHaveLength(0);
  });

  it('excludes pins with zero count under the active lens', () => {
    const pins = [
      pin('France', 46.6, 2.2, 0), // no stock under lens
      pin('Chile', -33, -71, 0),
    ];
    const { north, south } = partitionWorldPins(pins, lens);
    expect(north).toHaveLength(0);
    expect(south).toHaveLength(0);
  });

  it('SOUTH_LAT_THRESHOLD constant still exported for external callers', () => {
    expect(typeof SOUTH_LAT_THRESHOLD).toBe('number');
    expect(SOUTH_LAT_THRESHOLD).toBeLessThan(0);
  });
});
