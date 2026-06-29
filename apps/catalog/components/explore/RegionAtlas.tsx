'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LensKey, MapRegion } from '@/lib/explore/types';
import { lensCount, LENS_GROUPS } from '@/lib/explore/map-data';
import { WORLD_PATH_D } from '@/lib/explore/world-path';

/**
 * RegionAtlas — an on-brand interactive world map, rebuilt from the ground up.
 *
 * THE ONE RULE that makes this correct: the world silhouette AND the pins live in
 * a SINGLE inline <svg viewBox="0 0 100 50">. They share one coordinate space, so
 * `preserveAspectRatio` crops them together and they can NEVER drift apart — the
 * failure mode of the old HTML-pins-over-an-<img> approach. A pin at lng/lat is a
 * <circle cx cy> in the exact same units the map path is drawn in.
 *
 * Two levels:
 *   WORLD view   → one pin per country with stock (clustered where crowded).
 *   COUNTRY view → the SVG viewBox zooms to that country's bounds; its regions
 *                  spread out as individually tappable pins.
 *
 * Zoom is a viewBox animation (CSS transition on the <g> transform). Pins counter-
 * scale so dots/labels stay a constant on-screen size. prefers-reduced-motion is
 * respected. The sibling RegionList is the full keyboard/screen-reader browse path.
 */

const VBW = 100; // viewBox width
const VBH = 50; // viewBox height (equirectangular 2:1)

/** lng [-180,180] → x [0,100] ; lat [90,-90] → y [0,50] — viewBox user units. */
function project(lat: number, lng: number): { x: number; y: number } {
  return { x: ((lng + 180) / 360) * VBW, y: ((90 - lat) / 180) * VBH };
}

export interface CountryPin {
  name: string;
  slug: string;
  lat: number;
  lng: number;
  regions: MapRegion[];
  /** Country roll-up totals — used for region-less countries (Spain, Germany…). */
  total?: number;
  countsByGroup?: Record<string, number>;
}

/** Retained for external callers (CountryChips, tests). No longer used to split. */
export const SOUTH_LAT_THRESHOLD = -20;

/** All countries with stock under the active lens go to `north`; `south` stays empty. */
export function partitionWorldPins(
  countries: CountryPin[],
  lens: LensKey,
): { north: CountryPin[]; south: CountryPin[] } {
  const north = countries.filter((c) => countryLensCount(c, lens) > 0);
  return { north, south: [] };
}

/** Bottle count for a country under the active lens. */
export function countryLensCount(c: CountryPin, lens: LensKey): number {
  if (c.regions.length > 0) return c.regions.reduce((s, r) => s + lensCount(r, lens), 0);
  if (lens === 'all') return c.total ?? 0;
  const groups = LENS_GROUPS[lens] ?? [];
  return groups.reduce((n, g) => n + (c.countsByGroup?.[g] ?? 0), 0);
}

/**
 * The world viewBox: a fixed window onto the populated band. We crop the empty
 * polar oceans by showing only viewBox-y [Y_TOP, Y_BOT] (≈68°N … 56°S), which
 * comfortably contains every country we stock while leaving no dead space. The
 * window is WIDER than tall (≈2.5:1) so it sits as a calm letterbox strip.
 */
const Y_TOP = project(68, 0).y; // ≈ 6.1
const Y_BOT = project(-56, 0).y; // ≈ 40.6
const WORLD_VIEW = { x: 0, y: Y_TOP, w: VBW, h: Y_BOT - Y_TOP };

/** A rendered view rectangle in viewBox units. */
interface ViewBox { x: number; y: number; w: number; h: number }

/**
 * Frame a set of geo points into a viewBox rectangle (for country/region zoom):
 * the tight bounds of the points, padded, clamped to the map, and widened to keep
 * a pleasant ratio so a single region doesn't zoom to an extreme close-up.
 */
function framePoints(points: { lat: number; lng: number }[], pad = 6): ViewBox {
  if (points.length === 0) return WORLD_VIEW;
  const xs = points.map((p) => project(p.lat, p.lng).x);
  const ys = points.map((p) => project(p.lat, p.lng).y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let w = maxX - minX, h = maxY - minY;
  // Floor the size so 1–2 points get a comfortable frame, not a hard close-up.
  const MIN_W = 26;
  if (w < MIN_W) w = MIN_W;
  // Match the strip's aspect ratio so the uniform scale doesn't distort the map.
  const ar = WORLD_VIEW.w / WORLD_VIEW.h;
  if (w / h < ar) w = h * ar; else h = w / ar;
  // Don't zoom out past the world view.
  if (w > WORLD_VIEW.w) { w = WORLD_VIEW.w; h = WORLD_VIEW.h; }
  // Recenter, then clamp the rect inside the map plane.
  let x = cx - w / 2, y = cy - h / 2;
  x = Math.max(0, Math.min(x, VBW - w));
  y = Math.max(0, Math.min(y, VBH - h));
  return { x, y, w, h };
}

/**
 * Greedy spatial clustering for world-view pins: countries closer than `radius`
 * (viewBox units, Y weighted ×2 for the 2:1 plane) merge into one count badge.
 * Deterministic (seeded by name-sorted input). A clicked cluster zooms to its
 * members' bounds, spreading them into individually-tappable pins.
 *
 * Radius 3 keeps Japan and Korea separate (distance ≈ 3.3 viewBox units) while
 * still merging genuinely dense regions like the Caribbean archipelago.
 */
const CLUSTER_RADIUS = 3;
interface ClusterMember { country: CountryPin; n: number; x: number; y: number }
interface Cluster { x: number; y: number; lat: number; lng: number; n: number; members: ClusterMember[] }

function clusterPins(members: ClusterMember[], radius: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const p of members) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(p.x - c.x, (p.y - c.y) * 2);
      if (d < radius && d < bestD) { best = c; bestD = d; }
    }
    if (best) {
      best.members.push(p);
      const tot = best.members.reduce((s, m) => s + Math.max(m.n, 1), 0);
      best.x = best.members.reduce((s, m) => s + m.x * Math.max(m.n, 1), 0) / tot;
      best.y = best.members.reduce((s, m) => s + m.y * Math.max(m.n, 1), 0) / tot;
      best.lat = best.members.reduce((s, m) => s + m.country.lat * Math.max(m.n, 1), 0) / tot;
      best.lng = best.members.reduce((s, m) => s + m.country.lng * Math.max(m.n, 1), 0) / tot;
      best.n += p.n;
    } else {
      clusters.push({ x: p.x, y: p.y, lat: p.country.lat, lng: p.country.lng, n: p.n, members: [p] });
    }
  }
  return clusters;
}

/** Nudge overlapping pins apart along the line between them (visual only). */
function spread<T extends { x: number; y: number }>(pins: T[], minSep: number): T[] {
  const out = pins.map((p) => ({ ...p }));
  for (let iter = 0; iter < 20; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const dx = a.x - b.x, dy = (a.y - b.y) * 2;
        const dist = Math.hypot(dx, dy);
        if (dist < minSep && dist > 0.001) {
          const push = (minSep - dist) / 2;
          const ux = dx / dist, uy = (dy / dist) / 2;
          a.x += ux * push; a.y += uy * push; b.x -= ux * push; b.y -= uy * push;
          moved = true;
        } else if (dist <= 0.001) {
          a.x += minSep / 2; b.x -= minSep / 2; moved = true;
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
  // Which world cluster (if any) the user expanded by tapping its badge.
  const [clusterFocus, setClusterFocus] = useState<CountryPin[] | null>(null);
  // Which region cluster (if any) the user expanded inside a country view.
  const [regionClusterFocus, setRegionClusterFocus] = useState<MapRegion[] | null>(null);
  // Reset the expanded cluster whenever we change focus/lens.
  useEffect(() => { setClusterFocus(null); setRegionClusterFocus(null); }, [focusCountry, lens]);

  const { north: worldCountries } = useMemo(
    () => partitionWorldPins(countries, lens),
    [countries, lens],
  );

  // The active viewBox: world band, an expanded cluster's bounds, or the focused
  // country's regions (or the single selected region, zoomed in tighter).
  const view: ViewBox = useMemo(() => {
    if (focusCountry) {
      const sel = selectedSlug
        ? focusCountry.regions.find((r) => r.slug === selectedSlug)
        : undefined;
      if (sel) return framePoints([{ lat: sel.lat, lng: sel.lng }], 4);
      if (regionClusterFocus) return framePoints(regionClusterFocus, 3);
      return framePoints(focusCountry.regions, 6);
    }
    if (clusterFocus) return framePoints(clusterFocus, 6);
    return WORLD_VIEW;
  }, [focusCountry, selectedSlug, clusterFocus, regionClusterFocus]);

  // Zoom factor of the active view vs. the full plane width — drives the counter-
  // scale so pins keep a constant on-screen size at every zoom level.
  const zoom = VBW / view.w;
  const inv = 1 / zoom;

  // The pins to render in the CURRENT view.
  type RenderPin =
    | { kind: 'cluster'; key: string; x: number; y: number; n: number; members: CountryPin[] }
    | { kind: 'country'; key: string; x: number; y: number; n: number; label: string; country: CountryPin }
    | { kind: 'region'; key: string; x: number; y: number; n: number; label: string; region: MapRegion; selected: boolean }
    | { kind: 'region-cluster'; key: string; x: number; y: number; n: number; members: MapRegion[] };

  // Pins are counter-scaled by `inv`, so their on-screen size is constant. The
  // de-overlap separation must therefore be measured in ON-SCREEN units and
  // converted back to viewBox units by dividing by the zoom — otherwise, at a deep
  // country zoom (Japan ≈ 3.8×) a fixed viewBox separation explodes into a huge
  // on-screen gap that flings the region pins clear off the country (the bug).
  const SCREEN_SEP = 4.5; // desired min gap between dots in on-screen viewBox units
  const sep = SCREEN_SEP / zoom;

  // Region cluster radius: 4 on-screen units, converted back to viewBox units so
  // the cluster threshold stays visually constant regardless of country zoom level.
  const REGION_CLUSTER_SCREEN = 4;
  const regionClusterRadius = REGION_CLUSTER_SCREEN / zoom;

  const pins: RenderPin[] = useMemo(() => {
    // COUNTRY view → region pins, with proximity clustering for crowded countries.
    if (focusCountry) {
      const activeRegions = regionClusterFocus ?? focusCountry.regions;
      const seed = activeRegions
        .map((r) => ({ country: { name: r.name, slug: r.slug, lat: r.lat, lng: r.lng, regions: [] } as CountryPin, region: r, n: lensCount(r, lens), ...project(r.lat, r.lng) }))
        .filter((p) => p.n > 0);

      // When zoomed into a region cluster, spread those members as plain pins.
      if (regionClusterFocus) {
        const spaced = spread(seed, sep);
        return spaced
          .map((p): RenderPin => ({
            kind: 'region', key: p.region.slug, x: p.x, y: p.y, n: p.n,
            label: p.region.name, region: p.region, selected: p.region.slug === selectedSlug,
          }))
          .sort((a, b) => a.y - b.y);
      }

      // Cluster nearby regions into count badges (same greedy algo as world view).
      const clusters = clusterPins(seed, regionClusterRadius);
      return clusters
        .map((cl): RenderPin => {
          if (cl.members.length === 1) {
            const m = cl.members[0];
            return {
              kind: 'region', key: m.country.slug, x: cl.x, y: cl.y, n: cl.n,
              label: m.country.name, region: seed.find(s => s.region.slug === m.country.slug)!.region,
              selected: m.country.slug === selectedSlug,
            };
          }
          return {
            kind: 'region-cluster',
            key: `rcluster-${cl.members.map(m => m.country.slug).join('-')}`,
            x: cl.x, y: cl.y, n: cl.n,
            members: cl.members.map(m => seed.find(s => s.region.slug === m.country.slug)!.region),
          };
        })
        .sort((a, b) => a.y - b.y);
    }
    // WORLD view → country pins, with proximity clustering (unless a cluster is open).
    const base = (clusterFocus ?? worldCountries)
      .map((c) => ({ country: c, n: countryLensCount(c, lens), ...project(c.lat, c.lng) }))
      .filter((p) => p.n > 0);

    // When zoomed into a cluster, show its members as plain spread pins.
    if (clusterFocus) {
      const spaced = spread(base, sep);
      return spaced
        .map((p): RenderPin => ({
          kind: 'country', key: p.country.slug, x: p.x, y: p.y, n: p.n,
          label: p.country.name, country: p.country,
        }))
        .sort((a, b) => a.y - b.y);
    }

    const clusters = clusterPins(base, CLUSTER_RADIUS);
    return clusters
      .map((cl): RenderPin => {
        if (cl.members.length === 1) {
          const m = cl.members[0];
          return { kind: 'country', key: m.country.slug, x: cl.x, y: cl.y, n: cl.n, label: m.country.name, country: m.country };
        }
        return {
          kind: 'cluster',
          key: `cluster-${cl.members.map((m) => m.country.slug).join('-')}`,
          x: cl.x, y: cl.y, n: cl.n, members: cl.members.map((m) => m.country),
        };
      })
      .sort((a, b) => a.y - b.y);
  }, [focusCountry, clusterFocus, regionClusterFocus, worldCountries, lens, selectedSlug, sep, regionClusterRadius, zoom]);

  const hasPins = pins.length > 0;

  return (
    <div className="relative w-full overflow-hidden rounded-3xl border border-[hsl(28_25%_86%)] bg-[hsl(34_38%_97%)] shadow-[0_1px_2px_rgba(60,30,20,0.04),0_12px_28px_-18px_rgba(60,30,20,0.22)]">
      {/* The map is a calm letterbox strip (~2.5:1). One inline SVG holds the land
          AND the pins, so they share a coordinate space and can never misalign. */}
      <svg
        viewBox={`${WORLD_VIEW.x} ${WORLD_VIEW.y} ${WORLD_VIEW.w} ${WORLD_VIEW.h}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="World map of regions we carry"
        className="block w-full"
        style={{ aspectRatio: `${WORLD_VIEW.w} / ${WORLD_VIEW.h}` }}
      >
        <defs>
          {/* Soft parchment vignette so the strip has depth, not a flat fill. */}
          <radialGradient id="atlas-sea" cx="50%" cy="42%" r="75%">
            <stop offset="0%" stopColor="hsl(34 40% 98%)" />
            <stop offset="100%" stopColor="hsl(30 30% 94%)" />
          </radialGradient>
          <filter id="atlas-pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0.15" stdDeviation="0.18" floodColor="rgba(60,20,20,0.35)" />
          </filter>
        </defs>

        {/* The whole scene pans/zooms as one group → land + pins move together.
            The transform is an SVG ATTRIBUTE (user-unit values, no px) — passing it
            via CSS `style.transform` silently fails because unitless translate is
            invalid CSS. Modern browsers transition the SVG transform attribute when
            `transition-property: transform` is set, giving the smooth zoom. */}
        <g
          transform={viewTransform(view)}
          className="motion-safe:transition-transform motion-safe:duration-[450ms] motion-safe:ease-out"
          style={{ transformBox: 'view-box', transformOrigin: '0 0' }}
        >
          {/* Sea / backdrop, drawn across the full plane. */}
          <rect x="0" y="0" width={VBW} height={VBH} fill="url(#atlas-sea)" />
          {/* Landmasses. */}
          <path d={WORLD_PATH_D} fill="hsl(28 20% 84%)" stroke="hsl(28 18% 78%)" strokeWidth={0.08} />

          {/* PINS — same units as the path. Counter-scaled so they stay constant size. */}
          {pins.map((p) => (
            <AtlasPin
              key={p.key}
              pin={p}
              inv={inv}
              onCountry={onSelectCountry}
              onRegion={onSelectRegion}
              onCluster={(members) => setClusterFocus(members)}
              onRegionCluster={(members) => setRegionClusterFocus(members)}
            />
          ))}
        </g>
      </svg>

      {/* Breadcrumb / context pill — frosted glass, top-left, clear of pins. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className="pointer-events-auto rounded-full border border-[hsl(28_25%_84%)] bg-white/80 px-3 py-1 font-serif text-sm font-medium tracking-wide text-[hsl(345_45%_28%)] shadow-sm backdrop-blur-md">
          {focusCountry ? focusCountry.name : 'World'}
        </span>
      </div>

      {/* Escape from an expanded country cluster (world view). */}
      {clusterFocus && !focusCountry && (
        <button
          type="button"
          onClick={() => setClusterFocus(null)}
          className="absolute right-3 top-3 z-10 inline-flex min-h-9 items-center gap-1 rounded-full border border-[hsl(28_25%_84%)] bg-white/85 px-3 py-1 text-sm font-medium text-[hsl(345_45%_28%)] shadow-sm backdrop-blur-md transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(345_45%_40%)]"
        >
          ‹ All countries
        </button>
      )}
      {/* Escape from an expanded region cluster (country view). */}
      {regionClusterFocus && focusCountry && (
        <button
          type="button"
          onClick={() => setRegionClusterFocus(null)}
          className="absolute right-3 top-3 z-10 inline-flex min-h-9 items-center gap-1 rounded-full border border-[hsl(28_25%_84%)] bg-white/85 px-3 py-1 text-sm font-medium text-[hsl(345_45%_28%)] shadow-sm backdrop-blur-md transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(345_45%_40%)]"
        >
          ‹ All regions
        </button>
      )}

      {!hasPins && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-base text-[hsl(28_12%_45%)]">
          {focusCountry ? 'No regions for this category here.' : 'No countries for this category.'}
        </p>
      )}
    </div>
  );
}

/**
 * SVG transform (in viewBox user units) that maps the active `view` rect to fill
 * the world-view viewBox. A point at the view's origin moves to the world-view's
 * origin and the view's width scales up to the world-view's width:
 *   p' = (p − view.origin) · s + WORLD_VIEW.origin
 * which is translate(WORLD_VIEW.origin) scale(s) translate(−view.origin).
 * For the world view itself (view === WORLD_VIEW) s=1 and the translates cancel
 * → identity, so no transition fires on first paint.
 */
function viewTransform(view: ViewBox): string {
  const s = WORLD_VIEW.w / view.w;
  const tx = WORLD_VIEW.x - view.x * s;
  const ty = WORLD_VIEW.y - view.y * s;
  return `translate(${tx} ${ty}) scale(${s})`;
}

/** One pin: a dot + a hover/focus label, all in SVG units (counter-scaled). */
function AtlasPin({
  pin,
  inv,
  onCountry,
  onRegion,
  onCluster,
  onRegionCluster,
}: {
  pin:
    | { kind: 'cluster'; key: string; x: number; y: number; n: number; members: CountryPin[] }
    | { kind: 'country'; key: string; x: number; y: number; n: number; label: string; country: CountryPin }
    | { kind: 'region'; key: string; x: number; y: number; n: number; label: string; region: MapRegion; selected: boolean }
    | { kind: 'region-cluster'; key: string; x: number; y: number; n: number; members: MapRegion[] };
  inv: number;
  onCountry: (c: CountryPin) => void;
  onRegion: (r: MapRegion) => void;
  onCluster: (members: CountryPin[]) => void;
  onRegionCluster: (members: MapRegion[]) => void;
}) {
  const isCluster = pin.kind === 'cluster' || pin.kind === 'region-cluster';
  const isSelected = pin.kind === 'region' && pin.selected;
  const clusterCount = pin.kind === 'cluster' ? pin.members.length : pin.kind === 'region-cluster' ? pin.members.length : 0;
  const label =
    pin.kind === 'cluster' ? `${clusterCount} countries`
    : pin.kind === 'region-cluster' ? `${clusterCount} regions`
    : pin.label;
  const aria =
    pin.kind === 'cluster'
      ? `${clusterCount} countries, ${pin.n.toLocaleString()} bottles. Zoom in.`
      : pin.kind === 'region-cluster'
        ? `${clusterCount} regions, ${pin.n.toLocaleString()} bottles. Zoom in.`
        : pin.kind === 'country'
          ? `${pin.label} — ${pin.n.toLocaleString()} bottles. Show regions.`
          : `${pin.label} — ${pin.n.toLocaleString()} bottles`;

  const handle = () => {
    if (pin.kind === 'cluster') onCluster(pin.members);
    else if (pin.kind === 'region-cluster') onRegionCluster(pin.members);
    else if (pin.kind === 'country') onCountry(pin.country);
    else onRegion(pin.region);
  };

  // Counter-scale the whole pin so its on-screen size is constant at any zoom.
  const r = isCluster ? 2.0 : isSelected ? 1.5 : 1.15;

  return (
    <g
      className="atlas-pin group cursor-pointer"
      transform={`translate(${pin.x} ${pin.y}) scale(${inv})`}
      role="button"
      tabIndex={0}
      aria-label={aria}
      onClick={handle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(); }
      }}
      style={{ outline: 'none' }}
    >
      {/* Generous invisible hit area (≥ touch target once scaled to screen). */}
      <circle cx={0} cy={0} r={3.2} fill="transparent" />

      {/* Halo on hover/focus/selection. */}
      <circle
        cx={0}
        cy={0}
        r={r + 1}
        className="origin-center scale-0 fill-[hsl(345_55%_45%)]/15 transition-transform duration-200 ease-out group-hover:scale-100 group-focus-visible:scale-100"
        style={isSelected ? { transform: 'scale(1)' } : undefined}
      />

      {/* The dot / count badge. */}
      {isCluster ? (
        <>
          <circle cx={0} cy={0} r={r} fill="hsl(345 50% 32%)" stroke="white" strokeWidth={0.4} filter="url(#atlas-pin-shadow)" />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={1.9}
            fontWeight={700}
            fill="white"
            style={{ pointerEvents: 'none' }}
          >
            {clusterCount}
          </text>
        </>
      ) : (
        <circle
          cx={0}
          cy={0}
          r={r}
          className="transition-[r] duration-200"
          fill={isSelected ? 'hsl(345 60% 38%)' : 'hsl(345 50% 42%)'}
          stroke="white"
          strokeWidth={0.4}
          filter="url(#atlas-pin-shadow)"
        />
      )}

      {/* Label — revealed on hover/focus (and always for the selected region). */}
      <g
        className="pointer-events-none -translate-y-[1px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={isSelected ? { opacity: 1 } : undefined}
        transform={`translate(0 ${-(r + 1.6)})`}
      >
        <LabelChip label={label} count={pin.n} chevron={pin.kind !== 'region'} />
      </g>
    </g>
  );
}

/**
 * A label chip drawn in SVG units. Width is estimated from the text length so the
 * rounded background hugs the label (no DOM measurement needed, no layout drift).
 */
function LabelChip({ label, count, chevron }: { label: string; count: number; chevron: boolean }) {
  const countStr = count.toLocaleString();
  const text = `${label}  ${countStr}${chevron ? '  ›' : ''}`;
  const charW = 1.05; // approx glyph advance at fontSize 1.9
  const w = Math.max(text.length * charW + 3, 10);
  const h = 4.2;
  return (
    <g transform={`translate(${-w / 2} ${-h})`}>
      <rect x={0} y={0} width={w} height={h} rx={h / 2} fill="hsl(345 50% 30%)" filter="url(#atlas-pin-shadow)" />
      <text
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={1.9}
        fill="white"
        fontWeight={500}
      >
        <tspan>{label}</tspan>
        <tspan dx={1.2} fillOpacity={0.75} fontWeight={400}>{countStr}</tspan>
        {chevron && <tspan dx={1.2} fillOpacity={0.65}>›</tspan>}
      </text>
    </g>
  );
}
