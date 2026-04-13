/* ──────────────────────────────────────────────────
   Map configuration — MapLibre GL + CartoCDN
   ────────────────────────────────────────────────── */

export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const INITIAL_VIEW = {
  latitude: 30,
  longitude: 15,
  zoom: 2,
};

export const COUNTRY_BOUNDARIES_URL = "/data/ne_110m_countries.geojson";

/** Zoom levels for drill-down fly-to */
export const ZOOM_LEVELS = {
  world: 2,
  country: 5,
  region: 7,
  subregion: 9,
  appellation: 11,
} as const;

/** Fly-to animation duration (ms) */
export const FLY_DURATION = 1500;
export const FLY_BACK_DURATION = 1200;

/** Marker size range [min, max] in pixels */
export const MARKER_SIZE = { min: 8, max: 40 } as const;
