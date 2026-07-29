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

  // --- Added 2026-07-27 from the generator's gap report ------------------------
  // MIRRORED in scripts/gen-explore-map-data.mjs CENTROIDS — a parity test asserts
  // the two tables agree on keys AND lat/lng, so UPDATE BOTH TOGETHER.
  // ONLY genuine PLACES with well-established centroids. Legal tiers (Bourgogne,
  // Bordeaux Supérieur), styles (Valpolicella Ripasso), countries (Scotland,
  // England) and cities (London, Kobe, Turin) are deliberately excluded — they are
  // not map pins and stay in the gap report.
  //
  // The '<name> Prefecture' keys are the SAME places as the bare Japanese keys
  // above; the live export writes the long form, which never matched the short key.
  'niigata prefecture': { lat: 37.9, lng: 139.0 },
  'nagano prefecture': { lat: 36.2, lng: 138.0 },
  'kumamoto prefecture': { lat: 32.8, lng: 130.7 },
  'yamanashi prefecture': { lat: 35.7, lng: 138.6 },
  'hyogo prefecture': { lat: 34.7, lng: 135.0 },
  'kyoto prefecture': { lat: 35.0, lng: 135.8 },
  // Penedès — Catalan DO south-west of Barcelona, the Cava heartland. Both
  // spellings are keyed because the export carries the unaccented form.
  'penedes': { lat: 41.4, lng: 1.7 },
  'penedès': { lat: 41.4, lng: 1.7 },
  // Yarra Valley — cool-climate Victorian region ~50km east of Melbourne.
  'yarra valley': { lat: -37.7, lng: 145.5 },
  // Collio — Friulian white-wine hills on the Slovenian border.
  'collio': { lat: 45.95, lng: 13.5 },
  // Tequila — the municipality in Jalisco, Mexico (a real town, not just the spirit).
  'tequila': { lat: 20.88, lng: -103.84 },
};

export function centroidFor(region: string | null | undefined): Centroid | null {
  if (!region) return null;
  return REGION_CENTROIDS[region.trim().toLowerCase()] ?? null;
}
