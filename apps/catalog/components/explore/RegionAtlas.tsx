'use client';

import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount, LENS_GROUPS } from '@/lib/explore/map-data';

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
  /**
   * Country-level totals from the roll-up, used for countries that have NO curated
   * regions (e.g. Spain, Germany): they still get a world pin + chip, counted by
   * lens via these fields, and clicking them hands off straight to /shop?country=X.
   * Region-bearing countries leave these undefined and are counted from `regions`.
   */
  total?: number;
  countsByGroup?: Record<string, number>;
}

/**
 * Latitude boundary (degrees) below which a country is treated as "deep south" for
 * world framing. The origin set is bimodal: ~56 pins cluster in the northern
 * mid-latitudes (Europe/USA/Japan) while a handful of wine countries sit far south
 * (Chile/Argentina/S.Africa/Australia/NZ/Uruguay, all near −33° to −41°). Framing
 * one band around BOTH forced a zoom-out to ~0.36 — the world shown ~2.8× over in
 * empty ocean. We instead frame the world to the NORTH cluster and badge the south.
 *
 * −20° is chosen so it sits below the tropics (keeping Brazil/Peru/Indonesia with
 * the main band) but above the temperate-south wine belt (capturing the real
 * outliers). Verified against the live data: the 6 countries below −20 are exactly
 * the southern-hemisphere wine origins.
 */
export const SOUTH_LAT_THRESHOLD = -20;

/**
 * Split the world's country pins into the northern band (framed in place) and the
 * deep-south outliers (collapsed into one tappable badge). Pins with no stock under
 * the active lens are dropped from both buckets so an empty-lens country never adds
 * a phantom badge or frame point. Pure — drives both the frame and the badge.
 */
export function partitionWorldPins(
  countries: CountryPin[],
  lens: LensKey,
): { north: CountryPin[]; south: CountryPin[] } {
  const north: CountryPin[] = [];
  const south: CountryPin[] = [];
  for (const c of countries) {
    if (countryLensCount(c, lens) <= 0) continue;
    (c.lat < SOUTH_LAT_THRESHOLD ? south : north).push(c);
  }
  return { north, south };
}

/** Bottle count for a country under the active lens — from regions if it has any,
 *  else from the country roll-up's own countsByGroup (region-less countries). */
export function countryLensCount(c: CountryPin, lens: LensKey): number {
  if (c.regions.length > 0) {
    return c.regions.reduce((s, r) => s + lensCount(r, lens), 0);
  }
  if (lens === 'all') return c.total ?? 0;
  const groups = LENS_GROUPS[lens] ?? [];
  return groups.reduce((n, g) => n + (c.countsByGroup?.[g] ?? 0), 0);
}

/**
 * Frame a set of points (a country's regions) by PANNING their centroid to the
 * centre of the VISIBLE WINDOW and ZOOMING in. Built on `transform-origin: 0 0`
 * (top-left), so the math is exact:
 *
 *   transform = scale(S) translate((vcx/S − cx)%, (vcy/S − cy)%)
 *
 * Why vcx/vcy and not a flat 50/50 (the old bug): the map PLANE is a 2:1
 * equirectangular grid (100 plane-x-units × 50 plane-y-units), but the visible
 * WINDOW is much wider/shorter than 2:1 (16:5 → 16:4, capped by max-h). The plane
 * is therefore TALLER than the window, and the window only shows a top BAND of it.
 * `translate` is expressed in the plane's own % units (plane width = container
 * width = 100% ; plane height = 50% of container width). So:
 *
 *   • Horizontal centre of the window = 50% of plane width  → vcx = 50.
 *   • Vertical centre of the window in PLANE-Y units depends on the window's real
 *     height H and width W:  the window spans (100·H/W) plane-y-units tall, so its
 *     centre sits at vcy = 50·H/W plane-y-units — NOT 50. The old code used 50,
 *     which dropped the centroid to the middle of the FULL plane → below the
 *     visible band → the selected pin landed in the cropped-away area.
 *
 * `box` is the live visible window {w,h} in px (from a ResizeObserver). Before it
 * has measured we fall back to a 16:4 desktop ratio so SSR/first paint is close.
 */
function frame(
  points: { lat: number; lng: number }[],
  minScale: number,
  box: { w: number; h: number },
): { scale: number; tx: number; ty: number; vcy: number } {
  // Visible-window vertical centre, in plane-Y units (see doc above).
  const ratio = box.w > 0 ? box.h / box.w : 4 / 16;
  const vcx = 50;
  const vcy = 50 * (box.w > 0 ? (box.h / (box.w / 2)) / 2 : ratio); // = 50·H/W
  const visH = 2 * vcy; // visible band height in plane-Y units
  if (points.length === 0) return { scale: minScale, tx: 0, ty: 0, vcy };
  const xs = points.map((p) => project(p.lat, p.lng).xPct);
  const ys = points.map((p) => project(p.lat, p.lng).yPct);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Spans in plane-units, with a min clamp + padding so a single pin still gets a
  // comfortable frame and labels/dots aren't clipped at the edge.
  const spanX = Math.max(maxX - minX, 1.5) + 2;
  const spanY = Math.max(maxY - minY, 1.5) + 2;
  const fitX = 100 / spanX;
  const fitY = visH / spanY;
  // Fit each axis to its OWN visible extent. The floor (minScale) keeps a single
  // focused country/region zoomed enough to be tappable. CRUCIALLY the floor must
  // NOT prevent zooming OUT when the span is bigger than the band: the world view
  // spans ~90° of latitude, which cannot fit the short band at scale 1 — flooring
  // at 1 there shoved most country pins above the top edge where the cull hid them
  // (the "all countries disappeared" bug). So the floor only applies when the span
  // actually fits; otherwise we let scale drop below 1 to fit the whole span.
  const rawFit = Math.min(fitX, fitY);
  const scale = Math.min(rawFit >= minScale ? Math.max(minScale, rawFit) : rawFit, 14);
  const tx = vcx / scale - cx;
  // Vertical pan: centre on the MEDIAN latitude, not the bbox midpoint. Origins
  // cluster in the northern mid-latitudes with a few far-south outliers
  // (NZ/Chile/S.Africa). The bbox midpoint sat well south of the mass, so the dense
  // northern cluster got panned to the top edge while the empty south filled the
  // band ("pins at the top"). The median tracks the actual cluster, so it sits
  // mid-band; the southern outliers still render (within the cull margin) below it.
  // For 1–2 points median == midpoint, so focused/region views are unchanged.
  const sortedY = [...ys].sort((a, b) => a - b);
  const medY = sortedY.length % 2
    ? sortedY[(sortedY.length - 1) / 2]
    : (sortedY[sortedY.length / 2 - 1] + sortedY[sortedY.length / 2]) / 2;
  // Vertical pan: centre on the MEDIAN latitude (the mass centre), then CLAMP so no
  // pin is pushed outside the visible band. Why median, not the bbox midpoint:
  // origins cluster in the northern mid-latitudes with a few far-south outliers
  // (NZ/Chile/S.Africa); the midpoint sat south of the mass, panning the dense
  // cluster to the top edge ("pins at the top"). The median tracks the cluster.
  // Why clamp: centring the mass could shove the southern outliers below the band
  // where the cull hides them — instead we pan as far as centring the median wants,
  // but no further than keeps the [minY,maxY] extent inside [0,visH] (with the same
  // 4-unit margin the cull uses). Result: the cluster sits as centred as possible
  // while every pin stays on screen. (1–2 points → median == midpoint, extent fits,
  // clamp is a no-op → focused/region views unchanged.)
  let ty = vcy / scale - medY;
  const M = 4; // cull margin in plane-Y units
  const bot = scale * (maxY + ty);
  if (bot > visH + M) ty -= (bot - (visH + M)) / scale;       // pull up so south fits
  if (scale * (minY + ty) < -M) ty += (-M - scale * (minY + ty)) / scale; // push down so north fits
  return { scale, tx, ty, vcy };
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
// Cluster radius in SCREEN plane-% (Y weighted ×2). Pins closer than this at world
// scale collapse into one badge; tuned so dense Europe groups but distant continents
// stay separate.
const CLUSTER_RADIUS = 9;
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

/**
 * Greedy spatial clustering for world-view country pins. With 60+ countries the
 * globe gets crowded (Europe alone has ~20), so pins closer than `radius` (in
 * SCREEN plane-% — Y already weighted ×2 for the 2:1 plane) merge into one
 * cluster carrying its members, a count-weighted centre, and the summed bottle
 * count. Singletons stay singletons. Deterministic (seeded by input order, which
 * is name-sorted upstream). A clicked cluster zooms to its members' bounds, which
 * spreads them into individually-tappable pins.
 */
interface ClusterMember {
  key: string; label: string; lat: number; lng: number; n: number; country: CountryPin; dx: number; dy: number;
}
interface Cluster {
  cx: number; cy: number;   // badge centre in plane-%
  lat: number; lng: number; // centroid lat/lng (for zoom framing)
  n: number;                // summed bottle count
  members: ClusterMember[];
}
function clusterPins(pins: ClusterMember[], radius: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const p of pins) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(p.dx - c.cx, (p.dy - c.cy) * 2);
      if (d < radius && d < bestD) { best = c; bestD = d; }
    }
    if (best) {
      best.members.push(p);
      const tot = best.members.reduce((s, m) => s + m.n, 0) || 1;
      best.cx = best.members.reduce((s, m) => s + m.dx * m.n, 0) / tot;
      best.cy = best.members.reduce((s, m) => s + m.dy * m.n, 0) / tot;
      best.lat = best.members.reduce((s, m) => s + m.lat * m.n, 0) / tot;
      best.lng = best.members.reduce((s, m) => s + m.lng * m.n, 0) / tot;
      best.n += p.n;
    } else {
      clusters.push({ cx: p.dx, cy: p.dy, lat: p.lat, lng: p.lng, n: p.n, members: [p] });
    }
  }
  return clusters;
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
  // Live size of the VISIBLE window — frame() needs the real aspect ratio to
  // centre the focus pin in the band that's actually on screen (the plane is 2:1
  // but the window is wider/shorter, so a flat 50% centre drops pins off-frame).
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () =>
      setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // World view only: which cluster (if any) the user expanded by tapping its badge.
  // Holds the member country pins to FRAME (zoom in on), spreading them apart so
  // each becomes individually tappable. Reset whenever the focus/lens changes.
  const [clusterFocus, setClusterFocus] = useState<CountryPin[] | null>(null);
  useLayoutEffect(() => { setClusterFocus(null); }, [focusCountry, lens]);

  // Split the world's pins into the northern band (framed in place) and the deep-
  // south wine outliers (Chile/Argentina/S.Africa/Australia/NZ/Uruguay). Framing one
  // band around both forced a zoom-out to ~0.36 — the whole globe shown ~2.8× over
  // in empty ocean. We frame the NORTH and surface the south as one badge anchored
  // at the bottom of the band; tapping it reuses the cluster-expand path (zoom to
  // those members + an "All countries" escape). Recomputed per lens.
  const { north: northCountries, south: southCountries } = useMemo(
    () => partitionWorldPins(countries, lens),
    [countries, lens],
  );

  // What pins to show: world = NORTH countries (filtered to the active lens); country
  // = its regions. dx/dy are the RENDER positions (% of the plane), seeded from the
  // true projection then de-overlapped by spread() so no two pins sit on top of
  // each other (Chile/Argentina). lat/lng stay the source of truth for zoom.
  // The set of countries to plot as INDIVIDUAL pins in world view: the north band by
  // default, or — when a cluster (incl. the south badge) is expanded — its members.
  const worldCountries = clusterFocus ?? northCountries;

  // Summed bottle count behind the southern badge, under the active lens.
  const southTotal = useMemo(
    () => southCountries.reduce((s, c) => s + countryLensCount(c, lens), 0),
    [southCountries, lens],
  );

  const pins = useMemo(() => {
    const seed = focusCountry
      ? focusCountry.regions
          .map((r) => ({ kind: 'region' as const, key: r.slug, label: r.name, lat: r.lat, lng: r.lng, n: lensCount(r, lens), region: r }))
          .filter((p) => p.n > 0)
      : worldCountries
          .map((c) => {
            const n = countryLensCount(c, lens);
            return { kind: 'country' as const, key: c.slug, label: c.name, lat: c.lat, lng: c.lng, n, country: c };
          })
          .filter((p) => p.n > 0);
    const withPos = seed.map((p) => {
      const { xPct, yPct } = project(p.lat, p.lng);
      return { ...p, dx: xPct, dy: yPct };
    });
    const spaced = spread(withPos);
    return spaced.sort((a, b) => a.dy - b.dy); // paint north→south so labels layer sanely
  }, [worldCountries, focusCountry, lens]);

  // World-view clustering: group the (unspread) country pins by screen proximity so
  // the crowded globe shows a handful of count badges instead of 60 overlapping
  // dots. Only computed at world level AND when not already drilled into a cluster.
  // Clusters with a single member render as a normal pin; multi-member ones render
  // as a badge that zooms to its members on click. `worldClusters` is null when
  // we're showing individual pins (focused country, or an expanded cluster).
  const worldClusters = useMemo(() => {
    if (focusCountry || clusterFocus) return null;
    // Cluster only the NORTH band — the deep-south outliers are represented by their
    // own anchored badge, so they must not pull a cluster centre south (which is what
    // dragged the frame down into empty ocean in the first place).
    const members = northCountries
      .map((c) => ({
        key: c.slug, label: c.name, lat: c.lat, lng: c.lng,
        n: countryLensCount(c, lens), country: c,
        ...project(c.lat, c.lng),
      }))
      .filter((m) => m.n > 0)
      .map((m) => ({ ...m, dx: m.xPct, dy: m.yPct }));
    const cl = clusterPins(members, CLUSTER_RADIUS);
    // If nothing actually clusters (all singletons), fall back to plain pins.
    return cl.some((c) => c.members.length > 1) ? cl : null;
  }, [northCountries, focusCountry, clusterFocus, lens]);

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
      // single-/tight-region ones. frame()'s cap (14×) bounds the top end.
      if (sel) return frame([{ lat: sel.lat, lng: sel.lng }], 6, box);
      return frame(focusCountry.regions, 5, box);
    }
    // Expanded cluster → frame just its members (spreads them apart, tappable).
    if (clusterFocus) {
      return frame(clusterFocus.map((c) => ({ lat: c.lat, lng: c.lng })), 3, box);
    }
    // World view → frame exactly the markers being RENDERED so the centring matches
    // what the user sees. When clustering is active that's the cluster centres (not
    // the raw country coords — clusters are count-weighted and skew north, so
    // framing raw coords left the rendered badges crammed at the top). Otherwise
    // frame every country with data.
    const worldPts = worldClusters
      ? worldClusters.map((cl) => ({ lat: cl.lat, lng: cl.lng }))
      : worldCountries.flatMap((c) =>
          countryLensCount(c, lens) > 0 ? [{ lat: c.lat, lng: c.lng }] : [],
        );
    return frame(worldPts, 1, box);
  }, [focusCountry, selectedSlug, clusterFocus, worldCountries, worldClusters, lens, box]);

  return (
    <div
      ref={boxRef}
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

        {/* WORLD CLUSTERS: when the globe is crowded, multi-member clusters render
            as a single count badge (tap → zoom to its members). Single-member
            clusters render as a normal country pin. When worldClusters is null
            (focused country, or an expanded cluster) we fall through to the flat
            pin list below. */}
        {worldClusters
          ? worldClusters.map((cl) => {
              const inv = 1 / zoom.scale;
              const visH = 2 * zoom.vcy;
              const sx = zoom.scale * (cl.cx + zoom.tx);
              const sy = zoom.scale * (cl.cy + zoom.ty);
              const offFrame = sx < -4 || sx > 104 || sy < -4 || sy > visH + 4;
              // Single-member cluster → behave exactly like a country pin.
              if (cl.members.length === 1) {
                const m = cl.members[0];
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => onSelectCountry(m.country)}
                    aria-hidden={offFrame}
                    tabIndex={offFrame ? -1 : 0}
                    aria-label={`${m.label} — ${m.n.toLocaleString()} bottles`}
                    title={`${m.label} · ${m.n.toLocaleString()} bottles`}
                    className={[
                      'group absolute z-10 flex h-8 w-8 items-center justify-center rounded-full',
                      'transition-[left,top] duration-500 ease-out motion-reduce:transition-none',
                      'hover:z-30 focus-visible:z-30',
                      offFrame ? 'pointer-events-none opacity-0' : '',
                    ].join(' ')}
                    style={{ left: `${cl.cx}%`, top: `${cl.cy}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
                  >
                    <span aria-hidden="true" className="block h-3 w-3 rounded-full bg-primary/80 ring-2 ring-background transition-[height,width] duration-150 group-hover:h-4 group-hover:w-4 group-hover:bg-primary" />
                    <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary bg-primary px-3 py-1 text-sm font-medium text-primary-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                      {m.label}
                      <span className="text-xs tabular-nums opacity-80">{m.n.toLocaleString()}</span>
                    </span>
                  </button>
                );
              }
              // Multi-member cluster → a count badge that zooms to its members.
              return (
                <button
                  key={`cluster-${cl.members.map((m) => m.key).join('-')}`}
                  type="button"
                  onClick={() => setClusterFocus(cl.members.map((m) => m.country))}
                  aria-hidden={offFrame}
                  tabIndex={offFrame ? -1 : 0}
                  aria-label={`${cl.members.length} countries, ${cl.n.toLocaleString()} bottles. Tap to zoom in.`}
                  title={`${cl.members.length} countries · ${cl.n.toLocaleString()} bottles`}
                  className={[
                    'group absolute z-20 flex items-center justify-center rounded-full',
                    'transition-[left,top] duration-500 ease-out motion-reduce:transition-none',
                    'hover:z-30 focus-visible:z-30',
                    offFrame ? 'pointer-events-none opacity-0' : '',
                  ].join(' ')}
                  style={{ left: `${cl.cx}%`, top: `${cl.cy}%`, transform: `translate(-50%, -50%) scale(${inv})` }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full border-2 border-background bg-primary px-2 text-xs font-semibold tabular-nums text-primary-foreground shadow-md transition-transform duration-150 group-hover:scale-110"
                  >
                    {cl.members.length}
                  </span>
                  <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary bg-primary px-3 py-1 text-sm font-medium text-primary-foreground shadow-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    {cl.members.length} countries
                    <span className="text-xs tabular-nums opacity-80">{cl.n.toLocaleString()}</span>
                    <span aria-hidden className="opacity-70">›</span>
                  </span>
                </button>
              );
            })
          : pins.map((p) => {
          const isSelected = p.kind === 'region' && p.region.slug === selectedSlug;
          // Counter-scale the pin contents by 1/zoom so dots + labels stay a
          // constant on-screen size regardless of how far the plane is zoomed.
          const inv = 1 / zoom.scale;
          // On-screen position of this pin in PLANE-% after scale()+translate().
          // screen-x is 0..100 (plane width === container width). screen-y is in
          // plane-Y units 0..(2·vcy) — the visible band's height (NOT a fixed 0..50,
          // which assumed a 2:1 window; the window is wider/shorter and capped by
          // max-h). A pin outside the visible band (+4 margin) is cropped away — hide
          // it AND disable pointer events so it can't steal a click on empty map.
          const visH = 2 * zoom.vcy; // visible band height in plane-Y units
          const sx = zoom.scale * (p.dx + zoom.tx);
          const sy = zoom.scale * (p.dy + zoom.ty);
          const offFrame = sx < -4 || sx > 104 || sy < -4 || sy > visH + 4;
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

      {/* SOUTHERN-HEMISPHERE badge — a fixed overlay (OUTSIDE the zoom transform) at
          the bottom edge of the band. The deep-south wine countries are too far from
          the northern mass to share the frame without flooding it with empty ocean,
          so they live here: one tap zooms to just those countries (spread apart and
          tappable), with the same "All countries" escape as any cluster. Shown only
          in the default world view (no focused country, no expanded cluster) and only
          when the active lens actually has southern stock. */}
      {!focusCountry && !clusterFocus && southCountries.length > 0 && (
        <button
          type="button"
          onClick={() => setClusterFocus(southCountries)}
          aria-label={`${southCountries.length} southern-hemisphere countries, ${southTotal.toLocaleString()} bottles. Tap to zoom in.`}
          title={`Southern hemisphere · ${southCountries.length} countries · ${southTotal.toLocaleString()} bottles`}
          className="group absolute bottom-3 left-1/2 z-20 inline-flex min-h-9 -translate-x-1/2 items-center gap-2 rounded-full border-2 border-background bg-primary px-3.5 py-1 text-sm font-medium text-primary-foreground shadow-md transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="text-base leading-none">↓</span>
          Southern hemisphere
          <span className="text-xs tabular-nums opacity-80">{southTotal.toLocaleString()}</span>
          <span aria-hidden className="opacity-70">›</span>
        </button>
      )}

      {/* Expanded-cluster escape: a clear way back to the full world view, since the
          parent breadcrumb doesn't know about this map-local cluster state. */}
      {clusterFocus && !focusCountry && (
        <button
          type="button"
          onClick={() => setClusterFocus(null)}
          className="absolute right-3 top-3 z-30 inline-flex min-h-9 items-center gap-1 rounded-full border border-border/70 bg-background/85 px-3 py-1 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ‹ All countries
        </button>
      )}

      {pins.length === 0 && !worldClusters && (
        <p className="absolute inset-0 flex items-center justify-center text-base text-muted-foreground">
          {focusCountry ? 'No regions for this category.' : 'No countries for this category.'}
        </p>
      )}
    </div>
  );
}
