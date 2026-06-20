import { buildQuery } from '@/lib/build-query';
import type { LensKey, MapRegion } from './types';

/**
 * UI lens -> catalog category_group(s). The lens is the SHOPPER's mental model
 * (Wine / Whisky / Spirits / Sake); it maps onto the catalog's real 10-group
 * `category_group` (the taxonomy's wine/spirits/beer/sake buckets are NOT used).
 * 'all' has no groups (means "no group filter").
 */
export const LENS_GROUPS: Record<Exclude<LensKey, 'all'>, string[]> = {
  wine: ['Wine'],
  whisky: ['Whisky'],
  spirits: ['Spirits', 'Liqueur'],
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
