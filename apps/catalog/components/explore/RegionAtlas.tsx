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

/**
 * Frame a set of points (a country's regions) by ZOOMING INTO their centroid.
 * Returns a `transform` + `transformOrigin` pair: `scale(S)` about the centroid
 * point. This is the mathematically-correct way to zoom a plane to a sub-region —
 * scaling about transform-origin keeps that point fixed and magnifies around it,
 * so the country ends up centred and enlarged. (The previous scale()+translate(%)
 * composed in the wrong order and never actually centred the target.)
 *
 * The map plane has a 2:1 aspect (xPct 0..100, yPct 0..100 but the visible box is
 * half as tall), so a given xPct and yPct are NOT equal screen distances. We frame
 * on the X span (longitude) since that's the wider axis on this projection, and cap
 * the zoom so a single-region country doesn't blow up absurdly.
 */
function frame(points: { lat: number; lng: number }[]): { scale: number; ox: number; oy: number } {
  if (points.length === 0) return { scale: 1, ox: 50, oy: 50 };
  const xs = points.map((p) => project(p.lat, p.lng).xPct);
  const ys = points.map((p) => project(p.lat, p.lng).yPct);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  // Visible box is 2:1, so 1 unit of yPct is 2x the screen distance of 1 unit of
  // xPct. Normalise the Y span to X-equivalent units before sizing the zoom.
  const spanX = Math.max(maxX - minX, 4) + 10;     // padding so pins/labels fit
  const spanY = (Math.max(maxY - minY, 4) + 10) * 2;
  const scale = Math.max(1, Math.min(100 / Math.max(spanX, spanY), 5)); // 1x..5x
  return { scale, ox, oy };
}

/**
 * Collision avoidance for world-view country pins. Some countries sit almost on
 * top of each other at world scale (Chile/Argentina are 0.65% apart). Nudge any
 * pair closer than MIN_SEP apart away from each other along the line between them,
 * iterating a few times so chains settle. Deterministic (no randomness). Returns a
 * new array with adjusted display x/y; the underlying lat/lng (and the zoom target)
 * are unchanged — only the rendered dot moves a hair so both stay tappable.
 */
const MIN_SEP = 3.2; // % of the plane's X axis
function spread<T extends { dx: number; dy: number }>(pins: T[]): T[] {
  const out = pins.map((p) => ({ ...p }));
  // yPct distances are visually 2x xPct (2:1 box) — weight Y so separation is even.
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const ddx = a.dx - b.dx, ddy = (a.dy - b.dy) * 2; // scale Y to screen units
        const dist = Math.hypot(ddx, ddy);
        if (dist < MIN_SEP && dist > 0.001) {
          const push = (MIN_SEP - dist) / 2;
          const ux = ddx / dist, uy = (ddy / dist) / 2; // un-scale Y back to plane units
          a.dx += ux * push; a.dy += uy * push;
          b.dx -= ux * push; b.dy -= uy * push;
          moved = true;
        } else if (dist <= 0.001) {
          // exactly coincident — separate horizontally
          a.dx += MIN_SEP / 2; b.dx -= MIN_SEP / 2;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
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
  // What pins to show: world = countries (filtered to the active lens); country =
  // its regions. dx/dy are the RENDER positions (% of the plane), seeded from the
  // true projection then de-overlapped by spread() so no two pins sit on top of
  // each other (Chile/Argentina). lat/lng stay the source of truth for zoom.
  const pins = useMemo(() => {
    const seed = focusCountry
      ? focusCountry.regions
          .map((r) => ({ kind: 'region' as const, key: r.slug, label: r.name, lat: r.lat, lng: r.lng, n: lensCount(r, lens), region: r }))
          .filter((p) => p.n > 0)
      : countries
          .map((c) => {
            const n = c.regions.reduce((s, r) => s + lensCount(r, lens), 0);
            return { kind: 'country' as const, key: c.slug, label: c.name, lat: c.lat, lng: c.lng, n, country: c };
          })
          .filter((p) => p.n > 0);
    const withPos = seed.map((p) => {
      const { xPct, yPct } = project(p.lat, p.lng);
      return { ...p, dx: xPct, dy: yPct };
    });
    const spaced = spread(withPos);
    return spaced.sort((a, b) => a.dy - b.dy); // paint north→south so labels layer sanely
  }, [countries, focusCountry, lens]);

  // Zoom: scale about the focused country's centroid (transform-origin), so that
  // point stays fixed and the country fills the frame. scale(1) at world level.
  const zoom = useMemo(
    () => (focusCountry ? frame(focusCountry.regions) : { scale: 1, ox: 50, oy: 50 }),
    [focusCountry],
  );

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-border bg-[hsl(36_33%_98%)] shadow-sm"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      {/* The whole map plane (background + pins) zooms together: scale about the
          focused country's centroid via transform-origin. */}
      <div
        className="absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.ox}% ${zoom.oy}%` }}
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
          const isSelected = p.kind === 'region' && p.region.slug === selectedSlug;
          // Counter-scale the pin contents by 1/zoom so dots + labels stay a
          // constant on-screen size regardless of how far the plane is zoomed.
          const inv = 1 / zoom.scale;
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
                'group absolute z-10 flex h-11 w-11 items-center justify-center rounded-full',
                'transition-[left,top] duration-500 ease-out motion-reduce:transition-none',
                'hover:z-30 focus-visible:z-30', isSelected ? 'z-30' : '',
              ].join(' ')}
              style={{ left: `${p.dx}%`, top: `${p.dy}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
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
