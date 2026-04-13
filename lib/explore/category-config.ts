/* ──────────────────────────────────────────────────
   Category lens configuration — colors, labels, filters
   ────────────────────────────────────────────────── */

import type { CategoryScope } from "./types";

export interface CategoryConfig {
  key: CategoryScope;
  label: string;
  accent: string;        // Tailwind-compatible hex
  accentRgb: string;     // For rgba() usage
  markerColor: string;   // MapLibre paint expression value
}

export const CATEGORIES: CategoryConfig[] = [
  { key: "wine",    label: "Wine",    accent: "#722F37", accentRgb: "114,47,55",  markerColor: "#722F37" },
  { key: "spirits", label: "Spirits", accent: "#B5651D", accentRgb: "181,101,29", markerColor: "#B5651D" },
  { key: "beer",    label: "Beer",    accent: "#DAA520", accentRgb: "218,165,32", markerColor: "#DAA520" },
  { key: "sake",    label: "Sake",    accent: "#5F8575", accentRgb: "95,133,117", markerColor: "#5F8575" },
];

export const DEFAULT_ACCENT = "#4A90D9";
export const DEFAULT_ACCENT_RGB = "74,144,217";

export function getCategoryConfig(scope: CategoryScope | null): CategoryConfig | null {
  if (!scope) return null;
  return CATEGORIES.find((c) => c.key === scope) ?? null;
}

export function getAccent(scope: CategoryScope | null): string {
  return getCategoryConfig(scope)?.accent ?? DEFAULT_ACCENT;
}

export function getAccentRgb(scope: CategoryScope | null): string {
  return getCategoryConfig(scope)?.accentRgb ?? DEFAULT_ACCENT_RGB;
}

/** Determine dominant category for a counts object */
export function getDominantCategory(counts: { wine: number; spirits: number; beer: number; sake: number }): CategoryScope {
  const entries: [CategoryScope, number][] = [
    ["wine", counts.wine],
    ["spirits", counts.spirits],
    ["beer", counts.beer],
    ["sake", counts.sake],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
