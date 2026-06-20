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
  priceRange: PriceRange;
  peeks: MapPeek[];      // up to ~6 in-stock thumbnails
}

export interface MapCountry {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  total: number;
  countsByGroup: Record<string, number>;
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
