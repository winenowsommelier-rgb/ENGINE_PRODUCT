import type { LensKey, MapRegion } from './types';
import { lensCount } from './map-data';
import { countryLensCount, type CountryPin } from './country-pins';

/**
 * Pure data→GeoJSON builders for the MapLibre atlas. Kept free of React/map deps
 * so the shaping logic (lens filtering, counts, flags carried as properties) is
 * unit-testable without a WebGL context.
 */

export interface PointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, string | number | boolean>;
}

export interface PointCollection {
  type: 'FeatureCollection';
  features: PointFeature[];
}

/** Compact "2.4k"-style label for pin badges (full number stays in aria/popup). */
export function compactCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}

/**
 * World-view source: one point per country with stock under the lens.
 * `hasRegions` drives the click behavior split (drill-in vs popup card).
 */
export function countriesToGeoJSON(countries: CountryPin[], lens: LensKey): PointCollection {
  return {
    type: 'FeatureCollection',
    features: countries
      .map((c) => ({ c, n: countryLensCount(c, lens) }))
      .filter(({ n }) => n > 0)
      .map(({ c, n }): PointFeature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: {
          slug: c.slug,
          name: c.name,
          count: n,
          countLabel: compactCount(n),
          hasRegions: c.regions.length > 0,
        },
      })),
  };
}

/** Country-view source: one point per region with stock under the lens. */
export function regionsToGeoJSON(regions: MapRegion[], lens: LensKey): PointCollection {
  return {
    type: 'FeatureCollection',
    features: regions
      .map((r) => ({ r, n: lensCount(r, lens) }))
      .filter(({ n }) => n > 0)
      .map(({ r, n }): PointFeature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          slug: r.slug,
          name: r.name,
          country: r.country,
          count: n,
          countLabel: compactCount(n),
        },
      })),
  };
}

/**
 * Tight [west, south, east, north] bounds of a point set — fed to fitBounds.
 * Returns null for an empty set (caller falls back to the world view).
 */
export function pointsBounds(
  points: { lat: number; lng: number }[],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}

/** The populated world frame (fits every country we stock; crops polar oceans). */
export const WORLD_BOUNDS: [number, number, number, number] = [-125, -47, 155, 62];
