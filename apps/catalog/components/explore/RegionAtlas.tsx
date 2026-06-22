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
 * Frame a set of points (a country's regions) by PANNING their centroid to the
 * middle of the visible box and ZOOMING in. Returns a ready-to-use `transform`
 * string built on `transform-origin: 0 0` (top-left), which makes the math exact:
 *
 *   transform = scale(S) translate((50/S − cx)%, (50/S − cy)%)
 *
 * With origin at the top-left, `scale(S)` first magnifies the plane about (0,0),
 * then the translate (in the plane's OWN, post-scale % units) shifts it so the
 * centroid (cx%, cy%) lands at the box centre (50%, 50%). The earlier version
 * scaled about a transform-origin AT the centroid, which keeps that point fixed
 * in PLACE rather than moving it to centre — so the country never actually framed
 * up (it stayed wherever it sat on the world plane, only slightly larger).
 *
 * The visible box aspect varies (4:3 → 16:9 → 2:1). The map plane is a 2:1
 * equirectangular grid drawn with object-cover, so 1 unit of yPct ≈ 2× the screen
 * distance of 1 unit of xPct. We size the zoom off the LARGER normalised span and
 * lift the floor so even a single-region country gets a real, clickable zoom.
 */
function frame(
  points: { lat: number; lng: number }[],
  minScale = 1,
): { scale: number; tx: number; ty: number } {
  if (points.length === 0) return { scale: minScale, tx: 0, ty: 0 };
  const xs = points.map((p) => project(p.lat, p.lng).xPct);
  const ys = points.map((p) => project(p.lat, p.lng).yPct);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Normalise the Y span to X-equivalent screen units (2:1 plane) before sizing.
  // Padding (was +8, then +4) trimmed to +2 and the min-span clamp lowered (3→1.5)
  // so the fit hugs the pins tighter — a focused country / selected region fills
  // the frame with little empty sea. Still leaves a small margin for the pin dot.
  const spanX = Math.max(maxX - minX, 1.5) + 2;    // padding so pins/labels fit
  const spanY = (Math.max(maxY - minY, 1.5) + 2) * 2;
  // Fit the span to the box; floor (minScale) keeps a single country zoomed enough
  // that its pins are big and tappable; cap at 14× so a tightly-clustered country
  // (or a single-region one) fills the frame instead of leaving slack.
  const scale = Math.max(minScale, Math.min(100 / Math.max(spanX, spanY), 14));
  const tx = 50 / scale - cx;
  const ty = 50 / scale - cy;
  return { scale, tx, ty };
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

  // Zoom: frame the points that actually have data, centering on the user's focus.
  //   • A region is SELECTED   → center on that region (zoomed in tight on it).
  //   • A country is focused   → frame all its regions.
  //   • World view             → frame ALL country pins (scope to where data exists,
  //                              not an empty whole-globe).
  const zoom = useMemo(() => {
    if (focusCountry) {
      const sel = selectedSlug
        ? focusCountry.regions.find((r) => r.slug === selectedSlug)
        : undefined;
      // Center on the selected region (single point → frame()'s span floor gives a
      // comfortable tight zoom); otherwise frame the whole country. Floors raised
      // (6 / 5) so country views fill the frame instead of leaving slack — the
      // computed fit still wins for wide countries; the floor only bites for
      // single-/tight-region ones. frame()'s cap (12×) bounds the top end.
      if (sel) return frame([{ lat: sel.lat, lng: sel.lng }], 6);
      return frame(focusCountry.regions, 5);
    }
    const worldPts = countries.flatMap((c) =>
      c.regions.reduce((s, r) => s + lensCount(r, lens), 0) > 0 ? [{ lat: c.lat, lng: c.lng }] : [],
    );
    return frame(worldPts, 1);
  }, [focusCountry, selectedSlug, countries, lens]);

  return (
    <div
      className={[
        'relative w-full overflow-hidden rounded-2xl border border-border bg-[hsl(36_33%_98%)] shadow-sm',
        // SHORT band at every size — the view is zoomed/scoped to just the data
        // points, so it needs little vertical room. Capped tight on desktop.
        // Shortened: wider aspect ratios + lower max-h so the band hugs the pins
        // with minimal empty sea above/below.
        'aspect-[2/1] sm:aspect-[16/5] lg:aspect-[16/4] max-h-[15rem]',
      ].join(' ')}
    >
      {/* PROJECTION-LOCKED PLANE: an inner 2:1 layer that exactly matches the SVG's
          equirectangular 0..100 x / 0..50 y viewBox, so pin %s land on real land
          (no object-cover crop to desync the art from the pins). It is taller than
          the short visible window; the zoom transform pans/scales it to frame the
          data, and the window's overflow-hidden crops the rest. */}
      <div
        className="absolute left-0 top-0 w-full origin-top-left transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{
          aspectRatio: `${VIEW_W} / ${VIEW_H}`,
          transform: `scale(${zoom.scale}) translate(${zoom.tx}%, ${zoom.ty}%)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/explore-world.svg"
          alt=""
          aria-hidden="true"
          // object-fill (not cover): the plane IS the SVG's 2:1 viewBox, so fill it
          // 1:1 — this is what keeps pins exactly over their land.
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill opacity-90"
          draggable={false}
        />

        {pins.map((p) => {
          const isSelected = p.kind === 'region' && p.region.slug === selectedSlug;
          // Counter-scale the pin contents by 1/zoom so dots + labels stay a
          // constant on-screen size regardless of how far the plane is zoomed.
          const inv = 1 / zoom.scale;
          // On-screen position of this pin (% of the container) after the plane's
          // scale()+translate(). Plane width === container width, so screen-x maps
          // directly; the plane is 2:1 (height = width/2 in container %), so screen-y
          // is in 0..50 container%. A pin whose dot lands outside [−4, 104]×[−4, 54]
          // is in the cropped-away area — hide it AND disable its pointer events so it
          // can't steal a click meant for empty visible map (the phantom-click bug).
          const sx = zoom.scale * (p.dx + zoom.tx);
          const sy = (zoom.scale * (p.dy + zoom.ty)) / 2;
          const offFrame = sx < -4 || sx > 104 || sy < -4 || sy > 54;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => (p.kind === 'country' ? onSelectCountry(p.country) : onSelectRegion(p.region))}
              aria-pressed={isSelected}
              aria-hidden={offFrame}
              tabIndex={offFrame ? -1 : 0}
              aria-label={
                p.kind === 'country'
                  ? `${p.label} — ${p.n.toLocaleString()} bottles. Show regions.`
                  : `${p.label}, ${p.region.country} — ${p.n.toLocaleString()} bottles`
              }
              title={`${p.label} · ${p.n.toLocaleString()} bottles`}
              className={[
                'group absolute z-10 flex h-8 w-8 items-center justify-center rounded-full',
                'transition-[left,top] duration-500 ease-out motion-reduce:transition-none',
                'hover:z-30 focus-visible:z-30', isSelected ? 'z-30' : '',
                // Cull off-frame pins from both sight and interaction.
                offFrame ? 'pointer-events-none opacity-0' : '',
              ].join(' ')}
              // Hit area hugs the dot (not a wide 44px box), so a pin whose dot sits
              // just outside the cropped frame can't reach its hit area into the
              // visible map and steal a click meant for empty space.
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
                  'bg-primary',
                  // HOVER/FOCUS ONLY — the selected region is shown by the highlighted
                  // pill in the chip row above the map, so we don't double-label it here.
                  'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
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
