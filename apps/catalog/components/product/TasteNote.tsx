// components/product/TasteNote.tsx
//
// Presentational by default (a <span>), exactly as the public catalog needs for
// the flat-tag path. When the linked-sunburst wheel passes interaction callbacks,
// it upgrades to a focusable <button> that drives chip<->wedge highlight — it still
// does NOT navigate (no useRouter import, no router.push, no '/explore' literal in
// code; the words appearing in THIS comment are documentation, not code).

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  segmentId?: string;
  active?: boolean;
  faded?: boolean;
  onFocusNote?: (id?: string) => void;   // hover: enter -> id, leave -> undefined
  onToggleNote?: (id: string) => void;   // click: lock/unlock this id
  className?: string;
}

function Decoration() {
  // swatch + 3 bars; tier color & intensity fill are applied via CSS using the
  // data-tier / data-intensity attributes on the chip element (ancestor).
  return (
    <>
      <span className="taste-note__swatch" aria-hidden="true" />
      <span className="taste-note__bars" aria-hidden="true">
        <i /><i /><i />
      </span>
    </>
  );
}

export function TasteNote({ note, tier, intensity, segmentId, active, faded, onFocusNote, onToggleNote, className }: TasteNoteProps) {
  const cls = `${className ?? 'taste-note'}${active ? ' is-active' : ''}${faded ? ' is-faded' : ''}`;
  const interactive = !!onFocusNote || !!onToggleNote;

  if (!interactive) {
    return (
      <span data-intensity={intensity} data-tier={tier} className={cls}>
        <Decoration />
        {note}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-intensity={intensity}
      data-tier={tier}
      className={cls}
      aria-pressed={!!active}
      aria-label={`${note}, ${tier} note, intensity ${intensity}`}
      onClick={(e) => { e.stopPropagation(); if (segmentId) onToggleNote?.(segmentId); }}
      onMouseEnter={() => onFocusNote?.(segmentId)}
      onMouseLeave={() => onFocusNote?.(undefined)}
    >
      <Decoration />
      {note}
    </button>
  );
}
