/** Lens keys shown in the UI, mapped to catalog category_group(s) in map-data.ts. */
export type LensKey = 'all' | 'wine' | 'whisky' | 'spirits' | 'sake';

/** A single peek product. ONLY these fields ever leave the server (margin-safe). */
export interface MapPeek {
  sku: string;
  name: string;
  price: number | null;
  image_url?: string;
}

export interface PriceRange {
  min: number | null;
  max: number | null;
}

export interface RegionKnowledge {
  grapes?: string[];
  tiers?: string[];
  attributes?: Record<string, string | string[]>;
  citation?: string;
}

export interface MapRegion {
  name: string;          // canonical region NAME (handoff value; never a slug)
  slug: string;          // URL slug for /explore-map/[region]
  country: string;       // parent country NAME (handoff value)
  lat: number;
  lng: number;
  x?: number;            // authored atlas % position (0..100), optional
  y?: number;
  total: number;         // in-stock beverage count (fresh, from live export)
  countsByGroup: Record<string, number>; // catalog category_group -> count
  /** "group\0category_type" -> count. Lets a lens (e.g. sake) isolate a SPECIFIC
   *  type within a group that bundles several (Sake & Asian: Sake/Shochu/Soju/
   *  Umeshu/Makgeolli). Optional: absent on older/hand-built fixtures. */
  countsByGroupType?: Record<string, number>;
  priceRange: PriceRange;
  peeks: MapPeek[];      // up to ~6 in-stock thumbnails
  // Sommelier description (from data/taxonomy.db, backfilled by Sonnet). Optional:
  // omitted cleanly when a region has none.
  description?: string;
  /** Names + blurbs of this region's subregions, for the drawer's text list. (Subregions
   *  that HAVE coords in the taxonomy — 81 of them, plus 81 appellations — also become
   *  their own pins; this list is the drawer copy, not the pin source.) */
  subregions?: { name: string; description?: string }[];
  knowledge?: RegionKnowledge;
  /** Rows resolving to THIS node exactly (excludes descendants). Optional until the generator populates it. */
  ownTotal?: number;
  /** ownTotal + every descendant. DERIVED by subtree sum — never incremented per-row. */
  inclusiveTotal?: number;
  /** Which taxonomy level this pin sits at — drives the /shop hand-off shape. Absent = region. */
  pinLevel?: 'region' | 'subregion' | 'appellation';
  /** Parent node NAME (a region, for a subregion pin). Absent at top level. */
  parentName?: string;
}

export interface MapCountry {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  total: number;
  countsByGroup: Record<string, number>;
  countsByGroupType?: Record<string, number>;
}

export interface ExploreMapData {
  _meta: {
    generated: string;
    totalMapped: number;      // products represented on the map
    rolledUpRegions: number;  // regions w/o coords folded into a country pin
    curatedCount: number;
  };
  regions: MapRegion[];   // the curated hotspot set
  countries: MapCountry[]; // full country roll-up (world view + fallback pins)
}
