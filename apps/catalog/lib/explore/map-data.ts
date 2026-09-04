import { buildQuery } from '@/lib/build-query';
import type { LensKey, MapRegion } from './types';

// NOTE: this module is CLIENT-SAFE — it has NO node:fs/node:path imports, so it
// can be imported by 'use client' components (ExploreRegionClient pulls LENS_GROUPS
// from here). The server-only data LOADER lives in ./map-data.server.ts to keep
// node built-ins out of the client bundle (webpack rejects node: schemes there).

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

/**
 * Optional TYPE restriction within a lens's group, keyed to `category_type` (the
 * SAME value /shop's `class=` param filters on — see matchesFilters in
 * shop-query.ts). Only the "sake" lens has one today: "Sake & Asian" bundles real
 * Sake (category_type "Sake / Shochu") together with Shochu, Soju, Umeshu, and
 * Makgeolli, so clicking "Sake" on the explore map otherwise surfaces those too.
 * Absent = no restriction, whole group counts (unchanged behavior for every other
 * lens). Reported by user 2026-09-01 (LSJ0024DG / Chum Churum Soju bug report).
 */
export const LENS_TYPES: Partial<Record<Exclude<LensKey, 'all'>, string>> = {
  sake: 'Sake / Shochu',
};

/** Composite-key delimiter for countsByGroupType — MUST match GROUP_TYPE_SEP in
 *  scripts/gen-explore-map-data.mjs (a NUL byte can't appear in a real name). */
const GROUP_TYPE_SEP = String.fromCharCode(0);

/** The single catalog group a lens hands off to /shop as ?group= (first of its set). */
export function lensPrimaryGroup(lens: LensKey): string | null {
  if (lens === 'all') return null;
  return LENS_GROUPS[lens][0];
}

/** The optional category_type a lens hands off to /shop as ?class=. */
export function lensType(lens: LensKey): string | null {
  if (lens === 'all') return null;
  return LENS_TYPES[lens] ?? null;
}

export function lensCount(region: MapRegion, lens: LensKey): number {
  if (lens === 'all') return region.total;
  const type = lensType(lens);
  if (type) {
    return LENS_GROUPS[lens].reduce(
      (n, g) => n + (region.countsByGroupType?.[`${g}${GROUP_TYPE_SEP}${type}`] ?? 0), 0);
  }
  return LENS_GROUPS[lens].reduce((n, g) => n + (region.countsByGroup[g] ?? 0), 0);
}

/**
 * Whether a lens button should be OFFERED for a region/country roll-up — i.e.
 * whether there is actually stock reachable at that lens's shopHref/countryShopHref.
 * A group-only check is wrong for a typed lens (sake): South Korea/Vietnam/Thailand
 * all carry "Sake & Asian" stock (Soju/Makgeolli/Shochu/Umeshu) with ZERO real sake,
 * so the group has counts but the sake button would land on an empty grid.
 *
 * Fails OPEN (falls back to the group-level check) when countsByGroupType is
 * absent, so older/regenerated-later map data doesn't silently lose the sake
 * button — it just reverts to the pre-fix (group-level) behavior until the data
 * file is rebuilt, never a false negative that hides a lens with real stock.
 */
export function lensHasStock(
  countsByGroup: Record<string, number>,
  countsByGroupType: Record<string, number> | undefined,
  lens: Exclude<LensKey, 'all'>,
): boolean {
  const type = lensType(lens);
  if (type && countsByGroupType) {
    return LENS_GROUPS[lens].some(
      (g) => (countsByGroupType[`${g}${GROUP_TYPE_SEP}${type}`] ?? 0) > 0);
  }
  return LENS_GROUPS[lens].some((g) => (countsByGroup[g] ?? 0) > 0);
}

/**
 * Build the /shop handoff URL. Emits the region NAME (never the slug) + parent
 * country so /shop's exact-ci matcher + DrillBreadcrumb work, plus the lens group.
 * bev=1 (beverages only) restricts /shop to the SAME all-stock beverage subset the
 * map counts, so the resulting grid total == the drawer's "View all N" count
 * exactly. We deliberately DO NOT pass inStock=1: the map counts in-stock AND
 * out-of-stock beverages, so the grid must show both too (count == grid). Users
 * see the full catalogue for a region; out-of-stock items render greyed in /shop.
 *
 * The GEO part of the hand-off is shaped by the pin's LEVEL, because /shop's
 * matchesFilters ANDs region/subregion/appellation independently against the row's
 * own columns — a name alone is not enough. A subregion pin must therefore emit its
 * PARENT region as well as itself (Napa Valley lives at region='California',
 * subregion='Napa Valley'; emitting region='Napa Valley' matched ~1 row against an
 * ownTotal of ~300). An appellation pin emits appellation only — appellation is
 * already unique enough, and its parent region/subregion naming is inconsistent.
 * A pin with no pinLevel is treated as a region, so the current data file (all
 * region pins, no pinLevel field) keeps working unchanged.
 */
export function shopHref(region: MapRegion, lens: LensKey): string {
  const group = lensPrimaryGroup(lens);
  const level = region.pinLevel ?? 'region';
  const geo: Record<string, string | null> =
    level === 'region'
      ? { region: region.name, subregion: null, appellation: null }
      : level === 'subregion'
        ? { region: region.parentName ?? null, subregion: region.name, appellation: null }
        : { region: null, subregion: null, appellation: region.name };

  const qs = buildQuery({}, {
    bev: '1', country: region.country, ...geo, group: group ?? null, class: lensType(lens),
  });
  return qs ? `/shop?${qs}` : '/shop';
}

/**
 * /shop handoff for a COUNTRY with no curated regions (e.g. Spain, Germany).
 * Same bev=1 + lens semantics as shopHref(), but country-only (no region), so the
 * grid shows everything we carry from that country. Used when a region-less
 * country pin/chip is clicked on the explore map.
 */
export function countryShopHref(country: string, lens: LensKey): string {
  const group = lensPrimaryGroup(lens);
  const qs = buildQuery({}, {
    bev: '1',
    country,
    group: group ?? null,
    class: lensType(lens),
  });
  return qs ? `/shop?${qs}` : '/shop';
}
