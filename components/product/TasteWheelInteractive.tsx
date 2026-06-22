// components/product/TasteWheelInteractive.tsx  (INTERNAL app — repo ROOT)
"use client";

import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  // Wedges can click-lock (touch users tap a WEDGE to drive highlight). Chips do
  // NOT lock — internally a chip CLICK navigates to /explore. Focus = chip hover
  // OR wedge hover OR wedge click-lock.
  const [locked, setLocked] = useState<string | undefined>();
  const [hover, setHover] = useState<string | undefined>();
  const focused = hover ?? locked;

  const toggleLock = useCallback((id: string) => {
    setLocked(prev => (prev === id ? undefined : id));
    setHover(undefined);
  }, []);

  const clear = useCallback(() => { setLocked(undefined); setHover(undefined); }, []);

  useEffect(() => {
    if (!locked && !hover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clear(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [locked, hover, clear]);

  const orderIndex = useMemo(() => new Map(order.map((id, i) => [id, i])), [order]);

  const focusedSeg = segments.find(s => s.id === focused);
  const lockedSeg = segments.find(s => s.id === locked);

  return (
    <div
      className="taste-wheel"
      onClick={() => { if (locked) clear(); }}
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
                fill="none" stroke="#2a2a2a" strokeWidth={R * (ring.rOuter - ring.rInner)}
                data-placeholder={t} aria-hidden="true" />
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
                stroke="#1f1f1f"
                strokeWidth={2.5}
                className={`taste-wheel__wedge${isHot ? ' is-hot' : ''}${isDim ? ' is-dim' : ''}`}
                style={{ '--draw-delay': `${90 + (orderIndex.get(s.id) ?? 0) * 55}ms` } as React.CSSProperties}
                aria-hidden="true"
                onMouseEnter={() => setHover(s.id)}
                onMouseLeave={() => setHover(undefined)}
                onClick={(e) => { e.stopPropagation(); toggleLock(s.id); }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r={R * 0.15} fill="#111111" stroke="#2a2a2a" />
        </svg>
        <div className="taste-wheel-center">
          {focusedSeg ? (
            <>
              <span className="taste-wheel-center__tier" style={{ color: focusedSeg.color }}>{TIER_LABEL[focusedSeg.tier]}</span>
              <span className="taste-wheel-center__note" data-testid="center-note">{focusedSeg.note}</span>
              <span className="taste-wheel-center__sub">{INTENSITY_WORD[focusedSeg.intensity]} intensity</span>
            </>
          ) : (
            <>
              <span className="taste-wheel-center__note is-idle" data-testid="center-note">{varietalLabel ?? 'Tasting notes'}</span>
              <span className="taste-wheel-center__sub">hover · tap to explore</span>
            </>
          )}
        </div>
        <div
          aria-live="polite"
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
        >
          {lockedSeg ? `${TIER_LABEL[lockedSeg.tier]} note: ${lockedSeg.note}, ${INTENSITY_WORD[lockedSeg.intensity]} intensity` : ''}
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
                    // Chip CLICK navigates to /explore (internal "find similar").
                    // Hover drives the wedge highlight via onHoverNote. No
                    // onToggleNote is passed — clicking must NOT lock/stay.
                    <TasteNote
                      key={id}
                      note={n.note}
                      tier={tier}
                      intensity={n.intensity}
                      segmentId={id}
                      active={focused === id}
                      faded={focused != null && focused !== id}
                      onHoverNote={(maybeId) => setHover(maybeId)}
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
