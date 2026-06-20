'use client';

import { useMemo } from 'react';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

/**
 * RegionAtlas — a calm, on-brand stylized world map (NOT WebGL). Each curated
 * region is a real, focusable <button> hotspot positioned over a decorative
 * equirectangular world silhouette. Hotspots carry text labels + counts and are
 * sized by inventory, so the map never relies on colour alone. The silhouette is
 * decorative (aria-hidden); the accessible browse path is the sibling RegionList.
 *
 * Placement: equirectangular projection of lat/lng over a 0..100 viewBox. Because
 * the background art below is itself a coarse equirectangular world, hotspots land
 * roughly on the right landmass. lat/lng come from the build-time taxonomy/centroid
 * resolution (see gen-explore-map-data.mjs), so positions are stable across builds.
 */

const VIEW_W = 100;
const VIEW_H = 50; // equirectangular: width:height = 360:180 = 2:1

/** lng [-180,180] -> x [0,100]; lat [90,-90] -> y [0,50]. */
function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * VIEW_W;
  const y = ((90 - lat) / 180) * VIEW_H;
  return { x, y };
}

/** Marker radius (in viewBox units) scaled by count — gentle sqrt scale, clamped. */
function radiusFor(count: number, maxCount: number): number {
  const MIN = 0.9;
  const MAX = 2.4;
  if (maxCount <= 0) return MIN;
  const t = Math.sqrt(count) / Math.sqrt(maxCount);
  return MIN + t * (MAX - MIN);
}

export function RegionAtlas({
  regions,
  lens,
  onSelect,
}: {
  regions: MapRegion[];
  lens: LensKey;
  onSelect: (region: MapRegion) => void;
}) {
  // Only show hotspots the active lens actually has inventory for.
  const shown = useMemo(() => {
    const withCount = regions
      .map((r) => ({ r, n: lensCount(r, lens) }))
      .filter((x) => x.n > 0);
    const maxCount = withCount.reduce((m, x) => Math.max(m, x.n), 0);
    // Render larger markers first so smaller ones sit visually on top and stay clickable.
    return withCount
      .map((x) => ({ ...x, ...project(x.r.lat, x.r.lng), radius: radiusFor(x.n, maxCount) }))
      .sort((a, b) => b.radius - a.radius);
  }, [regions, lens]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border bg-[hsl(36_30%_97%)]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block w-full"
        role="img"
        aria-label="Map of regions in our collection. Use the region list below for full keyboard browsing."
      >
        {/* Decorative world silhouette (coarse equirectangular landmasses). */}
        <g aria-hidden="true" fill="hsl(36 18% 90%)" stroke="hsl(36 14% 84%)" strokeWidth={0.15}>
          {/* North + Central America */}
          <path d="M9,9 Q15,7 20,11 L23,17 Q22,22 18,24 L14,22 Q10,18 9,14 Z" />
          <path d="M21,25 L25,27 L24,31 L21,30 Z" />
          {/* South America */}
          <path d="M26,31 Q30,30 31,34 L30,42 Q27,46 25,42 L25,35 Z" />
          {/* Europe */}
          <path d="M47,11 Q51,9 54,12 L53,16 Q50,18 48,16 L46,14 Z" />
          {/* Africa */}
          <path d="M48,18 Q54,17 56,22 L55,30 Q52,36 49,33 L47,26 Q46,21 48,18 Z" />
          {/* Asia */}
          <path d="M55,9 Q68,6 80,11 L82,18 Q74,22 64,20 L56,17 Q54,13 55,9 Z" />
          {/* SE Asia / India */}
          <path d="M62,21 Q68,20 71,24 L69,28 Q65,29 63,26 Z" />
          {/* Australia */}
          <path d="M78,33 Q85,31 88,36 L86,41 Q80,43 77,39 Z" />
        </g>

        {/* Hotspots */}
        {shown.map(({ r, n, x, y, radius }) => (
          <g key={r.slug} transform={`translate(${x} ${y})`}>
            <circle
              r={radius}
              fill="hsl(350 47% 33% / 0.16)"
              stroke="hsl(350 47% 33%)"
              strokeWidth={0.3}
            />
          </g>
        ))}
      </svg>

      {/* Interactive label/button layer — real <button>s, absolutely positioned by
          the same projection (%), so they're keyboard-focusable with the global
          burgundy :focus-visible ring and have ≥44px hit area via padding. */}
      <div className="pointer-events-none absolute inset-0">
        {shown.map(({ r, n, x, y }) => (
          <button
            key={r.slug}
            type="button"
            onClick={() => onSelect(r)}
            aria-label={`${r.name}, ${r.country} — ${n.toLocaleString()} bottles`}
            className="pointer-events-auto absolute flex min-h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
            style={{ left: `${x}%`, top: `${(y / VIEW_H) * 100}%` }}
          >
            <span className="whitespace-nowrap">{r.name}</span>
            <span className="text-xs opacity-70">{n.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
