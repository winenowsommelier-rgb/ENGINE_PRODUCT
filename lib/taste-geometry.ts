// lib/taste-geometry.ts  (INTERNAL app — repo ROOT)
//
// Pure geometry for the taste wheel. No React, no DOM — so it runs at build
// time inside the server TasteWheel. Emits a flat Segment[] (one per note) plus
// the draw-in order, which the client interactive layer consumes as plain
// serializable props (keeps trig out of the client bundle).
//
// Mirrors apps/catalog/lib/taste-geometry.ts EXACTLY, with one difference:
// the internal app's primary accent is #c64633 (not the catalog's #7c2d3a).
// secondary/tertiary are identical to catalog.

export interface Note { note: string; intensity: 1 | 2 | 3; }
export interface Tiers { primary: Note[]; secondary: Note[]; tertiary: Note[]; }

export interface Segment {
  id: string;            // `${tier}-${index}` — index-based, dup-note safe
  tier: keyof Tiers;
  note: string;
  intensity: 1 | 2 | 3;
  path: string;          // SVG path `d`
  fillOpacity: number;
  color: string;
}

const TIER_COLORS: Record<keyof Tiers, string> = {
  primary: '#c64633',   // INTERNAL primary (catalog uses #7c2d3a)
  secondary: '#8b5a2b',
  tertiary: '#6c6055',
};

const RINGS: Array<{ key: keyof Tiers; rOuter: number; rInner: number }> = [
  { key: 'primary', rOuter: 0.98, rInner: 0.66 },
  { key: 'secondary', rOuter: 0.64, rInner: 0.40 },
  { key: 'tertiary', rOuter: 0.38, rInner: 0.16 },
];

// Exposed so the interactive layer can place faint placeholder rings for empty
// tiers at exactly the radii their wedges would occupy (spec §9).
// Derived from RINGS so the radii have a single source of truth (no drift).
export const RING_GEOMETRY = Object.fromEntries(
  RINGS.map(({ key, rOuter, rInner }) => [key, { rOuter, rInner }])
) as Record<keyof Tiers, { rOuter: number; rInner: number }>;

function describeWedge(cx: number, cy: number, rO: number, rI: number, a0: number, a1: number): string {
  // Quantize coords + radii to 3 decimals so SSR and CSR emit byte-identical
  // path strings (avoids React hydration mismatch from float drift).
  rO = +rO.toFixed(3);
  rI = +rI.toFixed(3);
  const p = (r: number, a: number) => [
    +(cx + r * Math.cos(a)).toFixed(3),
    +(cy + r * Math.sin(a)).toFixed(3),
  ];
  const [x1, y1] = p(rO, a0);
  const [x2, y2] = p(rO, a1);
  const [x3, y3] = p(rI, a1);
  const [x4, y4] = p(rI, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rO} ${rO} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rI} ${rI} 0 ${large} 0 ${x4} ${y4} Z`;
}

export function buildSegments(tiers: Tiers, size: number): { segments: Segment[]; order: string[] } {
  const cx = size / 2, cy = size / 2, R = size / 2 - 6;
  const segments: Segment[] = [];
  for (const ring of RINGS) {
    const notes = tiers[ring.key] ?? [];
    const total = notes.reduce((s, n) => s + n.intensity, 0) || 1;
    let angle = -Math.PI / 2;
    notes.forEach((n, i) => {
      const sweep = (n.intensity / total) * Math.PI * 2;
      segments.push({
        id: `${ring.key}-${i}`,
        tier: ring.key,
        note: n.note,
        intensity: n.intensity,
        path: describeWedge(cx, cy, R * ring.rOuter, R * ring.rInner, angle, angle + sweep),
        fillOpacity: 0.42 + (n.intensity / 3) * 0.55,
        color: TIER_COLORS[ring.key],
      });
      angle += sweep;
    });
  }
  return { segments, order: segments.map(s => s.id) };
}

export { TIER_COLORS };
