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
    // Combining diacritical marks (U+0300-U+036F), written ESCAPED on purpose: the
    // literal characters are invisible in editors and silently corrupt on copy-paste,
    // and this function is hand-mirrored into scripts/gen-explore-map-data.mjs.
    .replace(/[\u0300-\u036f]/g, '')
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

    // APPELLATION PINNING IS DEFERRED (Phase A). The appellation lookups that used
    // to sit at the end of both branches are GONE ON PURPOSE — do not "restore" them.
    //
    // Measured 2026-07-27 against the live export: `appellation` is populated on only
    // 956 / 11,934 rows (8%). The resolver pins a row using its region/SUBREGION
    // value, but shopHref hands an appellation pin off as `?appellation=`, which
    // filters a DIFFERENT, 8%-populated column. The two sets barely intersect, so
    // every appellation pin linked to a wrong or empty grid — 0 of 24 reproduced
    // their own total:
    //   Barolo                 own=99 -> grid=75   (99 via subregion, 75 via appellation)
    //   Chianti Classico       own=58 -> grid=35
    //   Brunello di Montalcino own=61 -> grid=0
    //   Haut-Médoc             own=32 -> grid=0
    //   Châteauneuf-du-Pape    own=62 -> grid=0
    // Falling through to the region/subregion fallbacks pins these on the columns
    // that are actually populated. `PinLevel`'s 'appellation' member and the
    // `appellation` filter in shop-query.ts are both KEPT: they are correct and
    // independently useful, they simply have no pin feeding them until the column
    // is backfilled.

    // 1. The subregion field. Try subregions, THEN regions.
    //
    //    The `regions` fallback is LOAD-BEARING, not a nicety. Many values sitting in
    //    the subregion field are classified as REGIONS in the taxonomy:
    //      Sonoma County    -> regions (parent usa)   + a same-named appellation
    //      Barossa Valley   -> regions (parent au)    + a same-named appellation
    //      Colchagua Valley -> regions (parent chile) , no appellation at all
    //    Skipping regions here makes Sonoma's 71 rows resolve to the APPELLATION
    //    entry, so a later invariant queries `appellation=Sonoma County` — and 0 of
    //    those 71 rows have any appellation value. Hard build failure on exactly
    //    the regions this work exists to fix.
    if (subKey) {
      const sub = byLevel.subregion.get(subKey);
      if (sub) return node('subregion', sub, region || (row.country ?? ''));
      const asRegion = byLevel.region.get(subKey);
      // A region-CLASSIFIED value that physically sits in the row's SUBREGION column
      // pins at SUBREGION level, carrying the row's own region as its parent.
      //
      // Pinning it at 'region' (what this did until 2026-07-27) emits `?region=<name>`,
      // which filters the REGION column — where these values never appear. Every such
      // pin linked to an empty grid while holding hundreds of rows:
      //   Colchagua Valley 140 rows -> grid 0   (all at region='Central Valley')
      //   Barossa Valley   125 rows -> grid 0   (all at region='South Australia')
      //   Sonoma County     71 rows -> grid 0   (all at region='California')
      // Emitting {region: <row's region>, subregion: <name>} recovers 140/125/71
      // exactly. The taxonomy's CLASSIFICATION of the place is irrelevant here; what
      // decides the hand-off shape is which COLUMN the value actually occupies.
      if (asRegion) return node('subregion', asRegion, region || (row.country ?? ''));
    }

    // 2. The region field. Regions first, then subregions.
    if (regionKey) {
      const reg = byLevel.region.get(regionKey);
      if (reg) return node('region', reg, row.country ?? '');
      const sub = byLevel.subregion.get(regionKey);
      if (sub) return node('subregion', sub, row.country ?? '');
    }

    return null;
  };
}
