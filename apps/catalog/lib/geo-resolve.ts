/**
 * geo-resolve — resolve a product row to its most specific PINNABLE geography node.
 *
 * Reads all THREE coordinate arrays of explore-taxonomy.json (regions, subregions,
 * appellations). The generator historically read only `regions`, which is why 81
 * subregion + 81 appellation coordinate sets sat unused and Napa/Barolo/Colchagua
 * were invisible. Spec: 2026-07-27-geography-resolution-design.md.
 *
 * PURE + fs-free so it can be unit-tested without Next and mirrored by the .mjs
 * prebuild generator (which cannot import TS). Parity-guarded.
 */

export type PinLevel = 'region' | 'subregion' | 'appellation';

export interface GeoNode {
  pinName: string;
  pinLevel: PinLevel;
  parentName: string;
  latitude: number;
  longitude: number;
  slug: string;
}

interface TaxonomyEntry {
  name: string;
  latitude?: number;
  longitude?: number;
  slug?: string;
  parentSlug?: string;
}

export interface TaxonomySource {
  regions?: TaxonomyEntry[];
  subregions?: TaxonomyEntry[];
  appellations?: TaxonomyEntry[];
}

export interface GeoRow {
  country?: string | null;
  region?: string | null;
  subregion?: string | null;
}

/** NFKD accent strip + punctuation collapse. 'Châteauneuf-du-Pape' -> 'chateauneuf du pape'. */
export function normGeoName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function indexOf(entries: TaxonomyEntry[] | undefined): Map<string, TaxonomyEntry> {
  const m = new Map<string, TaxonomyEntry>();
  for (const e of entries ?? []) {
    if (typeof e?.latitude !== 'number' || typeof e?.longitude !== 'number') continue;
    const k = normGeoName(e.name);
    if (k && !m.has(k)) m.set(k, e);
  }
  return m;
}

/**
 * Build a resolver over a taxonomy object. Returns null when nothing resolves —
 * the caller then rolls the row up to its country. NEVER drop the row.
 */
export function makeGeoResolver(taxonomy: TaxonomySource) {
  const byLevel: Record<PinLevel, Map<string, TaxonomyEntry>> = {
    region: indexOf(taxonomy.regions),
    subregion: indexOf(taxonomy.subregions),
    appellation: indexOf(taxonomy.appellations),
  };

  const node = (level: PinLevel, entry: TaxonomyEntry, parentName: string): GeoNode => ({
    pinName: entry.name,
    pinLevel: level,
    parentName,
    latitude: entry.latitude as number,
    longitude: entry.longitude as number,
    slug: entry.slug ?? normGeoName(entry.name).replace(/ /g, '-'),
  });

  return function resolveGeoNode(row: GeoRow): GeoNode | null {
    const region = (row.region ?? '').trim();
    const subregion = (row.subregion ?? '').trim();
    const regionKey = normGeoName(region);
    const subKey = normGeoName(subregion);

    // 1. The subregion field. Try subregions, THEN regions, THEN appellations.
    //
    //    The `regions` fallback is LOAD-BEARING, not a nicety. Many values sitting in
    //    the subregion field are classified as REGIONS in the taxonomy:
    //      Sonoma County    -> regions (parent usa)   + a same-named appellation
    //      Barossa Valley   -> regions (parent au)    + a same-named appellation
    //      Colchagua Valley -> regions (parent chile) , no appellation at all
    //    Skipping regions here makes Sonoma's 71 rows resolve to the APPELLATION
    //    entry, so a later invariant queries `appellation=Sonoma County` — and 0 of
    //    those 71 rows have any appellation value. Hard build failure on exactly
    //    the regions this work exists to fix. Appellations are tried LAST because
    //    they are the parentless level (0/81 carry parentSlug).
    if (subKey) {
      const sub = byLevel.subregion.get(subKey);
      if (sub) return node('subregion', sub, region || (row.country ?? ''));
      const asRegion = byLevel.region.get(subKey);
      // A region-classified value in the subregion field still pins at REGION level,
      // so its /shop hand-off uses region= (where the invariant can actually find it).
      if (asRegion) return node('region', asRegion, row.country ?? '');
      const app = byLevel.appellation.get(subKey);
      // Appellations carry NO parentSlug (0/81) — inherit the parent from the ROW.
      if (app) return node('appellation', app, region || (row.country ?? ''));
    }

    // 2. The region field. Regions first, so a region-field value never loses to a
    //    same-named appellation.
    if (regionKey) {
      const reg = byLevel.region.get(regionKey);
      if (reg) return node('region', reg, row.country ?? '');
      const sub = byLevel.subregion.get(regionKey);
      if (sub) return node('subregion', sub, row.country ?? '');
      const app = byLevel.appellation.get(regionKey);
      if (app) return node('appellation', app, row.country ?? '');
    }

    return null;
  };
}
