import { describe, it, expect } from 'vitest';
import { partitionWorldPins, SOUTH_LAT_THRESHOLD, type CountryPin } from '../RegionAtlas';

/**
 * The world view used to fit ALL 62 country pins into one short band. Because the
 * data is bimodal — ~56 pins in the northern mid-latitudes (Europe/USA/Japan) plus
 * a handful of deep-south wine countries (Chile, Argentina, S.Africa, Australia,
 * NZ, Uruguay) — the single frame had to zoom out to ~0.36 to reach the south,
 * showing the world ~2.8x over in empty ocean.
 *
 * The fix frames the world to the NORTHERN cluster and surfaces the southern
 * outliers as one tappable badge. partitionWorldPins is the pure split that drives
 * that: north pins are framed; south pins back the badge.
 */

function pin(name: string, lat: number, lng: number, total: number): CountryPin {
  return { name, slug: name.toLowerCase(), lat, lng, regions: [], total };
}

describe('partitionWorldPins — north/south split for world framing', () => {
  const lens = 'all' as const;

  it('puts deep-south wine countries in the south bucket', () => {
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
    expect(south.map((c) => c.name).sort()).toEqual(
      ['Argentina', 'Australia', 'Chile', 'New Zealand', 'South Africa'].sort(),
    );
    expect(north.map((c) => c.name).sort()).toEqual(['France', 'Japan', 'USA'].sort());
  });

  it('keeps near-equator northern-tropics origins (Brazil/Peru) in the NORTH bucket', () => {
    // These sit just north of the threshold; they belong with the main band, not
    // the deep-south badge, so they must not be split off.
    const pins = [
      pin('Brazil', -10, -55, 30), // slightly south but above threshold
      pin('Peru', -9.2, -75, 12),
      pin('Chile', -33, -71, 196),
    ];
    const { north, south } = partitionWorldPins(pins, lens);
    expect(north.map((c) => c.name).sort()).toEqual(['Brazil', 'Peru'].sort());
    expect(south.map((c) => c.name)).toEqual(['Chile']);
  });

  it('excludes pins with zero count under the active lens from BOTH buckets', () => {
    const pins = [
      pin('France', 46.6, 2.2, 0), // no stock under lens
      pin('Chile', -33, -71, 0),
    ];
    const { north, south } = partitionWorldPins(pins, lens);
    expect(north).toHaveLength(0);
    expect(south).toHaveLength(0);
  });

  it('threshold is a sane deep-south boundary (between tropics and temperate-south)', () => {
    expect(SOUTH_LAT_THRESHOLD).toBeLessThanOrEqual(-15);
    expect(SOUTH_LAT_THRESHOLD).toBeGreaterThanOrEqual(-30);
  });
});
