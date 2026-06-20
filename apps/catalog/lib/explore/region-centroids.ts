/**
 * Hand-authored region centroids — supplements data/taxonomy/explore-taxonomy.json,
 * which lacks coordinates for several high-depth regions (verified: all sake
 * regions, Napa Valley, Languedoc, Maule). lat/lng are real geographic centroids;
 * x/y are AUTHORED positions on the atlas SVG (placement is authored, not
 * math-derived from a stylized silhouette). x/y are 0..100 percentage coords on the
 * atlas viewBox; the build picks taxonomy coords first, then this table.
 *
 * No API spend — these are looked up once by hand and committed.
 */
export interface Centroid {
  lat: number;
  lng: number;
  /** authored atlas position, 0..100 % of the SVG viewBox (optional; world fallback if absent) */
  x?: number;
  y?: number;
}

// Keys are lowercased region names (match the live export's `region` values).
export const REGION_CENTROIDS: Record<string, Centroid> = {
  'niigata': { lat: 37.9, lng: 139.0 },
  'nagano': { lat: 36.2, lng: 138.0 },
  'hyogo': { lat: 34.7, lng: 135.0 },
  'kumamoto': { lat: 32.8, lng: 130.7 },
  'kyoto': { lat: 35.0, lng: 135.8 },
  'yamanashi': { lat: 35.7, lng: 138.6 },
  'napa valley': { lat: 38.5, lng: -122.3 },
  'languedoc-roussillon': { lat: 43.6, lng: 3.4 },
  'maule valley': { lat: -35.7, lng: -71.6 },
};

export function centroidFor(region: string | null | undefined): Centroid | null {
  if (!region) return null;
  return REGION_CENTROIDS[region.trim().toLowerCase()] ?? null;
}
