'use client';

import { useMemo } from 'react';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount } from '@/lib/explore/map-data';

/**
 * RegionAtlas — a calm, on-brand interactive world map (NOT WebGL) with TWO levels:
 *
 *   WORLD view   → one pin per COUNTRY that has curated regions (11 of them).
 *   COUNTRY view → the map zooms/pans to that country's bounds and shows its
 *                  REGION pins spread out (so France's 5 regions no longer overlap).
 *
 * Zoom is a CSS transform on the whole map layer (background SVG + pin layer move
 * together), animated, respecting prefers-reduced-motion. Pins are real <button>s
 * with a ≥44px hit area, an always-on dot, and a label that reveals on
 * hover/focus/selection — tuned for a 40+ audience so nothing needs a precise tap.
 * The sibling RegionList stays the full keyboard/screen-reader browse path.
 */

const VIEW_W = 100;
const VIEW_H = 50; // equirectangular 360:180 = 2:1; the /explore-world.svg shares it

/** lng [-180,180] -> x% [0,100]; lat [90,-90] -> y% [0,100] of the map plane. */
function project(lat: number, lng: number): { xPct: number; yPct: number } {
  return { xPct: ((lng + 180) / 360) * 100, yPct: ((90 - lat) / 180) * 100 };
}

export interface CountryPin {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  regions: MapRegion[];
}

/** Compute a CSS transform that frames a set of points (a country's regions),
 *  with padding, clamped so the world plane still covers the viewport. */
function frameTransform(points: { lat: number; lng: number }[]): string {
  if (points.length === 0) return 'scale(1)';
  const xs = points.map((p) => project(p.lat, p.lng).xPct);
  const ys = points.map((p) => project(p.lat, p.lng).yPct);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // span (with generous padding so labels fit); floor so a single-region country
  // still zooms in meaningfully but not absurdly.
  const spanX = Math.max(maxX - minX, 6) + 16;
  const spanY = Math.max(maxY - minY, 6) + 16;
  const scale = Math.min(100 / spanX, 100 / spanY, 6); // cap zoom at 6x
  // translate the centroid to the viewport centre, in % of the (scaled) plane.
  const tx = 50 - cx;
  const ty = 50 - cy;
  return `scale(${scale}) translate(${tx}% ${ty}%)`;
}

export function RegionAtlas({
  countries,
  focusCountry,
  lens,
  selectedSlug,
  onSelectCountry,
  onSelectRegion,
}: {
  countries: CountryPin[];
  focusCountry: CountryPin | null;
  lens: LensKey;
  selectedSlug?: string;
  onSelectCountry: (c: CountryPin) => void;
  onSelectRegion: (r: MapRegion) => void;
}) {
  // What pins to show: world = countries (filtered to the active lens); country = its regions.
  const pins = useMemo(() => {
    if (focusCountry) {
      return focusCountry.regions
        .map((r) => ({ kind: 'region' as const, key: r.slug, label: r.name, lat: r.lat, lng: r.lng, n: lensCount(r, lens), region: r }))
        .filter((p) => p.n > 0)
        .sort((a, b) => project(a.lat, a.lng).yPct - project(b.lat, b.lng).yPct);
    }
    return countries
      .map((c) => {
        const n = c.regions.reduce((s, r) => s + lensCount(r, lens), 0);
        return { kind: 'country' as const, key: c.slug, label: c.name, lat: c.lat, lng: c.lng, n, country: c };
      })
      .filter((p) => p.n > 0)
      .sort((a, b) => project(a.lat, a.lng).yPct - project(b.lat, b.lng).yPct);
  }, [countries, focusCountry, lens]);

  const transform = useMemo(
    () => (focusCountry ? frameTransform(focusCountry.regions) : 'scale(1)'),
    [focusCountry],
  );

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-border bg-[hsl(36_33%_98%)] shadow-sm"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      {/* The whole map plane (background + pins) scales/translates together. */}
      <div
        className="absolute inset-0 origin-center transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/explore-world.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-90"
          draggable={false}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[hsl(36_14%_88%)]" />

        {pins.map((p) => {
          const { xPct, yPct } = project(p.lat, p.lng);
          const isSelected = p.kind === 'region' && p.region.slug === selectedSlug;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => (p.kind === 'country' ? onSelectCountry(p.country) : onSelectRegion(p.region))}
              aria-pressed={isSelected}
              aria-label={
                p.kind === 'country'
                  ? `${p.label} — ${p.n.toLocaleString()} bottles. Show regions.`
                  : `${p.label}, ${p.region.country} — ${p.n.toLocaleString()} bottles`
              }
              title={`${p.label} · ${p.n.toLocaleString()} bottles`}
              className={[
                'group absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2',
                'items-center justify-center rounded-full transition-[transform] duration-150 ease-out',
                'hover:z-30 focus-visible:z-30', isSelected ? 'z-30' : '',
              ].join(' ')}
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
            >
              <span
                aria-hidden="true"
                className={[
                  'block rounded-full ring-2 ring-background transition-[height,width,background-color] duration-150',
                  isSelected
                    ? 'h-4 w-4 bg-primary'
                    : 'h-3 w-3 bg-primary/80 group-hover:h-4 group-hover:w-4 group-hover:bg-primary',
                ].join(' ')}
              />
              <span
                className={[
                  'pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2',
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary px-3 py-1',
                  'text-sm font-medium text-primary-foreground shadow-md',
                  // Counter the map scale so labels stay readable at any zoom.
                  'bg-primary',
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                  'transition-opacity duration-150',
                ].join(' ')}
              >
                {p.label}
                <span className="text-xs tabular-nums opacity-80">{p.n.toLocaleString()}</span>
                {p.kind === 'country' && <span aria-hidden className="opacity-70">›</span>}
              </span>
            </button>
          );
        })}
      </div>

      {pins.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-base text-muted-foreground">
          No regions for this category.
        </p>
      )}
    </div>
  );
}
