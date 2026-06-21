"use client";

import { useRouter } from 'next/navigation';

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  className?: string;
  // Linked-sunburst wiring (optional — TasteChipCard's flat path passes none):
  segmentId?: string;                 // which wheel wedge this chip mirrors
  active?: boolean;                   // this chip's wedge is currently focused
  faded?: boolean;                    // another chip/wedge is focused → dim this one
  onHoverNote?: (id?: string) => void; // hover enter -> segmentId, leave -> undefined
}

// swatch + 3 bars; tier color & intensity fill are applied via CSS using the
// data-tier / data-intensity attributes on the button (ancestor).
function Decoration() {
  return (
    <>
      <span className="taste-note__swatch" aria-hidden="true" />
      <span className="taste-note__bars" aria-hidden="true">
        <i /><i /><i />
      </span>
    </>
  );
}

export function TasteNote({ note, tier, intensity, className, segmentId, active, faded, onHoverNote }: TasteNoteProps) {
  const router = useRouter();

  // INTERNAL behavior (UNCHANGED): clicking a chip is the "find similar" feature —
  // it navigates to /explore. Hover/leave drives the wheel-wedge highlight only.
  const handleClick = () => {
    const url = `/explore?note=${encodeURIComponent(note)}&tier=${tier}`;
    router.push(url);
  };

  const cls = `${className ?? 'taste-note'}${active ? ' is-active' : ''}${faded ? ' is-faded' : ''}`;

  return (
    <button
      type="button"
      data-intensity={intensity}
      data-tier={tier}
      onClick={handleClick}
      onMouseEnter={() => onHoverNote?.(segmentId)}
      onMouseLeave={() => onHoverNote?.(undefined)}
      className={cls}
      aria-label={`Find other products with ${note} as ${tier} tier`}
    >
      <Decoration />
      {note}
    </button>
  );
}
