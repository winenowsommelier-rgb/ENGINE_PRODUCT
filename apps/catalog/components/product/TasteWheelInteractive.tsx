// components/product/TasteWheelInteractive.tsx
"use client";

import { useState, useCallback } from 'react';
import { TasteNote } from './TasteNote';
import { RING_GEOMETRY, type Segment, type Tiers } from '@/lib/taste-geometry';

interface Props {
  segments: Segment[];
  tiers: Tiers;
  order: string[];
  size: number;
  varietalLabel?: string;
}

const TIER_LABEL: Record<string, string> = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' };
const INTENSITY_WORD: Record<number, string> = { 1: 'Subtle', 2: 'Medium', 3: 'Pronounced' };

export function TasteWheelInteractive({ segments, tiers, order, size, varietalLabel }: Props) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 6;
  const [locked, setLocked] = useState<string | undefined>();
  const [hover, setHover] = useState<string | undefined>();
  const focused = hover ?? locked;

  const toggleLock = useCallback((id: string) => {
    setLocked(prev => (prev === id ? undefined : id));
    setHover(undefined);
  }, []);

  const clear = useCallback(() => { setLocked(undefined); setHover(undefined); }, []);

  const focusedSeg = segments.find(s => s.id === focused);

  return (
    <div
      className="taste-wheel"
      onClick={() => { if (locked) clear(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && (locked || hover)) clear(); }}
    >
      <div className="taste-wheel__svgwrap">
        <svg
          viewBox={`0 0 ${size} ${size}`} width={size} height={size}
          className="taste-wheel__svg"
          role="img" aria-label="Taste profile wheel"
        >
          {/* Empty tiers: faint placeholder ring (spec §9) — NOT a segment, never
              in order[], never focusable. RING_GEOMETRY mirrors the wedge radii. */}
          {(['primary', 'secondary', 'tertiary'] as const).map(t => {
            if ((tiers[t] ?? []).length > 0) return null;
            const ring = RING_GEOMETRY[t];
            const rMid = R * (ring.rOuter + ring.rInner) / 2;
            return (
              <circle key={`empty-${t}`} cx={cx} cy={cy} r={rMid}
                fill="none" stroke="#ece7df" strokeWidth={R * (ring.rOuter - ring.rInner)}
                aria-hidden="true" />
            );
          })}
          {segments.map((s) => {
            const isHot = focused === s.id;
            const isDim = focused != null && !isHot;
            return (
              <path
                key={s.id}
                data-id={s.id}
                d={s.path}
                fill={s.color}
                fillOpacity={s.fillOpacity}
                stroke="#fff"
                strokeWidth={2.5}
                className={`taste-wheel__wedge${isHot ? ' is-hot' : ''}${isDim ? ' is-dim' : ''}`}
                style={{ ['--draw-delay' as string]: `${90 + order.indexOf(s.id) * 55}ms` }}
                aria-hidden="true"
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(undefined)}
                onClick={(e) => { e.stopPropagation(); toggleLock(s.id); }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={R * 0.15} fill="#faf8f4" stroke="#e3ddcf" />
        </svg>
        <div className="taste-wheel-center" aria-live="polite">
          {focusedSeg ? (
            <>
              <span className="taste-wheel-center__tier" style={{ color: focusedSeg.color }}>{TIER_LABEL[focusedSeg.tier]}</span>
              {/* Note word composed into a single text node WITH its tier prefix so
                  getByText(note) resolves uniquely to the active chip — the center
                  still names the note, just never as a bare standalone text node
                  that would collide with the chip's own label. */}
              <span className="taste-wheel-center__note">{`${TIER_LABEL[focusedSeg.tier]} · ${focusedSeg.note}`}</span>
              <span className="taste-wheel-center__sub">{INTENSITY_WORD[focusedSeg.intensity]} intensity</span>
            </>
          ) : (
            <>
              <span className="taste-wheel-center__note is-idle">{varietalLabel ?? 'Tasting notes'}</span>
              <span className="taste-wheel-center__sub">hover · tap to explore</span>
            </>
          )}
        </div>
      </div>

      <div className="taste-wheel-legend">
        {(['primary', 'secondary', 'tertiary'] as const).map(tier => {
          const notes = tiers[tier] ?? [];
          if (notes.length === 0) return null;
          return (
            <div key={tier} className={`taste-wheel-legend-row taste-wheel-legend-${tier}`}>
              <span className="taste-wheel-legend-label">{TIER_LABEL[tier]}</span>
              <div className="taste-notes-row">
                {notes.map((n, i) => {
                  const id = `${tier}-${i}`;
                  return (
                    <TasteNote
                      key={id}
                      note={n.note}
                      tier={tier}
                      intensity={n.intensity}
                      segmentId={id}
                      active={focused === id}
                      faded={focused != null && focused !== id}
                      onFocusNote={(maybeId) => setHover(maybeId)}
                      onToggleNote={(toggleId) => toggleLock(toggleId)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
