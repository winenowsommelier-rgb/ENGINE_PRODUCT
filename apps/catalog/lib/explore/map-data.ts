import fs from 'node:fs';
import path from 'node:path';
import { buildQuery } from '@/lib/build-query';
import type { ExploreMapData, LensKey, MapRegion } from './types';

/**
 * UI lens -> catalog category_group(s). The lens is the SHOPPER's mental model
 * (Wine / Whisky / Spirits / Sake); it maps onto the catalog's real 10-group
 * `category_group` (the taxonomy's wine/spirits/beer/sake buckets are NOT used).
 * 'all' has no groups (means "no group filter").
 *
 * Each lens maps to EXACTLY ONE group. This is deliberate: /shop hands off a
 * single `?group=` value, so a multi-group lens (e.g. Spirits+Liqueur) would make
 * the drawer's "View all N" count diverge from the /shop grid total — the count
 * would sum both groups while the grid filtered only the primary (verified:
 * Piedmont would show 19 but land on a grid of 2). Liqueur is its own catalog
 * group and stays reachable via the 'All' lens; we do NOT fold it into Spirits.
 * One group per lens keeps count == grid by construction. (Modeled as string[]
 * to leave room for a future multi-group /shop hand-off if ever needed.)
 */
export const LENS_GROUPS: Record<Exclude<LensKey, 'all'>, string[]> = {
  wine: ['Wine'],
  whisky: ['Whisky'],
  spirits: ['Spirits'],
  sake: ['Sake & Asian'],
};

/** The single catalog group a lens hands off to /shop as ?group= (first of its set). */
export function lensPrimaryGroup(lens: LensKey): string | null {
  if (lens === 'all') return null;
  return LENS_GROUPS[lens][0];
}

export function lensCount(region: MapRegion, lens: LensKey): number {
  if (lens === 'all') return region.total;
  return LENS_GROUPS[lens].reduce((n, g) => n + (region.countsByGroup[g] ?? 0), 0);
}

/**
 * Build the /shop handoff URL. Emits the region NAME (never the slug) + parent
 * country so /shop's exact-ci matcher + DrillBreadcrumb work, plus the lens group.
 * bev=1 (beverages only) + inStock=1 (in-stock only) restrict /shop to the SAME
 * in-stock-beverage subset the map counts on BOTH axes, so the resulting grid
 * total == the drawer's "View all N" count exactly. bev is a pure group filter;
 * inStock supplies the freshness axis (reusing /shop's existing opt-in flag).
 */
export function shopHref(region: MapRegion, lens: LensKey): string {
  const group = lensPrimaryGroup(lens);
  const qs = buildQuery({}, {
    bev: '1',
    inStock: '1',
    country: region.country,
    region: region.name,
    group: group ?? null,
  });
  return qs ? `/shop?${qs}` : '/shop';
}

function dataPath(): string {
  const candidates = [
    path.join(process.cwd(), 'apps', 'catalog', 'data', 'explore-map-data.json'),
    path.join(process.cwd(), 'data', 'explore-map-data.json'),
    process.env.EXPLORE_MAP_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('explore-map-data.json not found — run the prebuild generator');
  return found;
}

let _cache: ExploreMapData | null = null;
export function loadExploreMapData(): ExploreMapData {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(dataPath(), 'utf8')) as ExploreMapData;
  return _cache;
}
