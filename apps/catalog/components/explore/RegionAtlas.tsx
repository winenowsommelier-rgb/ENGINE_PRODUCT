'use client';

import { useMemo } from 'react';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

/**
 * RegionAtlas — a calm, on-brand interactive world map (NOT WebGL). A real
 * Natural-Earth world silhouette (served as the static /explore-world.svg asset,
 * equirectangular 0..100 x 0..50) sits behind generously-sized, clearly-labelled
 * region pins. Each pin is a real <button> with a ≥44px hit area, an always-visible
 * label + count, and strong hover/active/focus states — tuned for a 40+ audience
 * with eyesight challenges, so nothing requires a precise tap. The map is a visual
 * enhancement; the sibling RegionList is the full keyboard/screen-reader browse path.
 */

const VIEW_W = 100;
const VIEW_H = 50; // equirectangular: 360:180 = 2:1, so the SVG/img share this ratio

/** lng [-180,180] -> x% [0,100]; lat [90,-90] -> y% [0,100]. */
function project(lat: number, lng: number): { xPct: number; yPct: number } {
  const xPct = ((lng + 180) / 360) * 100;
  const yPct = ((90 - lat) / 180) * 100;
  return { xPct, yPct };
}

export function RegionAtlas({
  regions,
  lens,
  selectedSlug,
  onSelect,
}: {
  regions: MapRegion[];
  lens: LensKey;
  selectedSlug?: string;
  onSelect: (region: MapRegion) => void;
}) {
  const shown = useMemo(() => {
    return regions
      .map((r) => ({ r, n: lensCount(r, lens), ...project(r.lat, r.lng) }))
      .filter((x) => x.n > 0)
      // Render eastern/southern pins first so western/northern labels overlap on top
      // predictably; keeps the densest cluster (Europe) legible.
      .sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
  }, [regions, lens]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-border bg-[hsl(36_33%_98%)] shadow-sm"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      {/* Real world map silhouette — static asset, no JS-bundle cost, decorative. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/explore-world.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-90"
        draggable={false}
      />

      {/* Faint graticule hint of latitude (equator) for visual grounding. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[hsl(36_14%_86%)]" />

      {/* Hotspots — a generous dot ALWAYS visible (so the map reads as a
          constellation of places, never text-soup even where regions cluster
          densely, e.g. Europe). The NAME + count label reveals on hover / focus /
          selection, lifting that pin above its neighbours. Every region is still
          fully browsable via the always-on RegionList below — the map is the
          delightful layer, the list is the exhaustive one. The whole control is a
          44px hit target centred on the dot, so it's easy to hit for a 40+ audience
          without demanding a precise tap. */}
      {shown.map(({ r, n, xPct, yPct }) => {
        const isSelected = r.slug === selectedSlug;
        return (
          <button
            key={r.slug}
            type="button"
            onClick={() => onSelect(r)}
            aria-pressed={isSelected}
            aria-label={`${r.name}, ${r.country} — ${n.toLocaleString()} bottles`}
            title={`${r.name} · ${r.country} · ${n.toLocaleString()} bottles`}
            className={[
              'group absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2',
              'items-center justify-center rounded-full',
              'transition-[transform,z-index] duration-150 ease-out',
              'hover:z-30 focus-visible:z-30',
              isSelected ? 'z-30' : '',
            ].join(' ')}
            style={{ left: `${xPct}%`, top: `${yPct}%` }}
          >
            {/* The dot. Burgundy fill, white ring so it pops on the warm-neutral land. */}
            <span
              aria-hidden="true"
              className={[
                'block rounded-full ring-2 transition-[height,width,background-color] duration-150',
                isSelected
                  ? 'h-4 w-4 bg-primary ring-background'
                  : 'h-3 w-3 bg-primary/80 ring-background group-hover:h-4 group-hover:w-4 group-hover:bg-primary',
              ].join(' ')}
            />
            {/* The label — hidden until hover/focus/selected to avoid clutter. */}
            <span
              className={[
                'pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2',
                'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1',
                'text-sm font-medium shadow-md',
                'border-primary bg-primary text-primary-foreground',
                isSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                'transition-opacity duration-150',
              ].join(' ')}
            >
              {r.name}
              <span className="text-xs tabular-nums opacity-80">{n.toLocaleString()}</span>
            </span>
          </button>
        );
      })}

      {/* Empty-lens guard (shouldn't happen — lens chips are gated — but be honest). */}
      {shown.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-base text-muted-foreground">
          No regions for this category.
        </p>
      )}
    </div>
  );
}
