import type { ExploreMapData, LensKey, MapRegion } from './types';
import { LENS_GROUPS } from './map-data';

/**
 * CountryPin — one world-view map entry per country with stock. Curated countries
 * carry their drill-in regions; region-less countries (Spain, Germany, Thailand…)
 * carry only the roll-up totals and hand off straight to /shop?country=X.
 *
 * CLIENT-SAFE pure data module (no node built-ins, no React) — shared by the map,
 * the chips and the tests.
 */
export interface CountryPin {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  regions: MapRegion[];
  /** Country roll-up totals — used for region-less countries. */
  total?: number;
  countsByGroup?: Record<string, number>;
}

/** Bottle count for a country under the active lens. */
export function countryLensCount(c: CountryPin, lens: LensKey): number {
  if (c.regions.length > 0) return c.regions.reduce((s, r) => s + lensCountOf(r, lens), 0);
  if (lens === 'all') return c.total ?? 0;
  const groups = LENS_GROUPS[lens] ?? [];
  return groups.reduce((n, g) => n + (c.countsByGroup?.[g] ?? 0), 0);
}

function lensCountOf(r: MapRegion, lens: LensKey): number {
  if (lens === 'all') return r.total;
  return (LENS_GROUPS[lens] ?? []).reduce((n, g) => n + (r.countsByGroup[g] ?? 0), 0);
}

/**
 * Build ONE world pin per country that has stock — covering BOTH the curated
 * countries (with regions to drill into) AND the long tail of region-less
 * countries that have coords + counts in the roll-up but no hand-authored
 * regions. Without the latter, ~52 of 62 countries were invisible on the map.
 */
export function buildCountryPins(data: ExploreMapData): CountryPin[] {
  const byCountry = new Map<string, MapRegion[]>();
  for (const r of data.regions) {
    if (!r.country) continue;
    (byCountry.get(r.country) ?? byCountry.set(r.country, []).get(r.country)!).push(r);
  }
  const countryCoord = new Map(data.countries.map((c) => [c.name, c]));
  const pins: CountryPin[] = [];
  // 1) Curated countries — coords from the roll-up (fallback: mean of regions).
  for (const [name, regions] of byCountry.entries()) {
    const cc = countryCoord.get(name);
    const lat = cc?.lat ?? regions.reduce((s, r) => s + r.lat, 0) / regions.length;
    const lng = cc?.lng ?? regions.reduce((s, r) => s + r.lng, 0) / regions.length;
    const slug = cc?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    pins.push({ name, slug, lat, lng, regions, total: cc?.total, countsByGroup: cc?.countsByGroup });
  }
  // 2) Region-less countries — every roll-up country we didn't already add.
  for (const c of data.countries) {
    if (byCountry.has(c.name)) continue;
    if (!(c.total > 0)) continue; // no stock → no pin
    pins.push({
      name: c.name,
      slug: c.slug,
      lat: c.lat,
      lng: c.lng,
      regions: [],
      total: c.total,
      countsByGroup: c.countsByGroup,
    });
  }
  return pins.sort((a, b) => a.name.localeCompare(b.name));
}
