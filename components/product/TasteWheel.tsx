// components/product/TasteWheel.tsx
"use client";

import { TasteNote, type Tier } from './TasteNote';

export interface Note { note: string; intensity: 1 | 2 | 3; }
export interface Tiers { primary: Note[]; secondary: Note[]; tertiary: Note[]; }

interface TasteWheelProps {
  tiers: Tiers;
  size?: number;     // default 240
}

const TIER_COLORS: Record<keyof Tiers, string> = {
  primary:   '#c64633',
  secondary: '#8b5a2b',
  tertiary:  '#6c6055',
};

const RINGS: Array<{ key: keyof Tiers; rOuter: number; rInner: number }> = [
  { key: 'primary',   rOuter: 0.95, rInner: 0.66 },
  { key: 'secondary', rOuter: 0.66, rInner: 0.42 },
  { key: 'tertiary',  rOuter: 0.42, rInner: 0.22 },
];

function describeWedge(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const polarToCart = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = polarToCart(rOuter, startAngle);
  const [x2, y2] = polarToCart(rOuter, endAngle);
  const [x3, y3] = polarToCart(rInner, endAngle);
  const [x4, y4] = polarToCart(rInner, startAngle);
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

export function TasteWheel({ tiers, size = 240 }: TasteWheelProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  return (
    <div className="taste-wheel">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Taste profile wheel">
        {RINGS.map(({ key, rOuter, rInner }) => {
          // Phase-5 enrichments occasionally omit a tier (e.g. only primary+secondary
          // for low-evidence SKUs). Treat missing tier as empty notes, not crash.
          const notes = tiers[key] ?? [];
          const ROuter = r * rOuter;
          const RInner = r * rInner;
          const totalWeight = notes.reduce((s, n) => s + n.intensity, 0) || 1;
          let angle = -Math.PI / 2;
          return (
            <g key={key} className="taste-ring" data-tier={key}>
              {notes.length === 0 ? (
                <circle cx={cx} cy={cy} r={(ROuter + RInner) / 2} fill="none" stroke="#eee" strokeWidth={ROuter - RInner} />
              ) : notes.map((n, i) => {
                const sweep = (n.intensity / totalWeight) * Math.PI * 2;
                const path = describeWedge(cx, cy, ROuter, RInner, angle, angle + sweep);
                const result = (
                  <path
                    key={`${key}-${i}`}
                    d={path}
                    fill={TIER_COLORS[key]}
                    fillOpacity={0.35 + (n.intensity / 3) * 0.55}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                );
                angle += sweep;
                return result;
              })}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={r * 0.22} fill="#f7f2ea" stroke="#d5cdb5" />
      </svg>
      {/* Below the wheel: tier listings with clickable TasteNotes */}
      <div className="taste-wheel-legend">
        {(['primary', 'secondary', 'tertiary'] as const).map(tier => (
          <div key={tier} className={`taste-wheel-legend-row taste-wheel-legend-${tier}`}>
            <span className="taste-wheel-legend-label">{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
            <div className="taste-notes-row">
              {(tiers[tier] ?? []).map((n, i) => (
                <TasteNote key={`${tier}-${i}`} note={n.note} tier={tier} intensity={n.intensity} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
