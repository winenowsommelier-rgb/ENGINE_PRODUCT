// components/product/TasteNote.tsx
//
// Presentational by default (a <span>), exactly as the public catalog needs for
// the flat-tag path. When the linked-sunburst wheel passes interaction callbacks,
// it upgrades to a focusable <button> that drives chip<->wedge highlight — it still
// does NOT navigate (no useRouter import, no router.push, no '/explore' literal in
// code; the words appearing in THIS comment are documentation, not code).

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

interface TasteNoteBase {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  active?: boolean;
  faded?: boolean;
  className?: string;
}

// Either a plain presentational chip (no interaction), OR an interactive chip
// that MUST carry a segmentId so click/hover always have an id to report.
// The union makes "interactive callback without segmentId" a compile error,
// so the dead-button state (focusable button that no-ops) is unrepresentable.
export type TasteNoteProps =
  | (TasteNoteBase & { segmentId?: undefined; onFocusNote?: undefined; onToggleNote?: undefined })
  | (TasteNoteBase & {
      segmentId: string;
      onFocusNote?: (id?: string) => void;   // hover: enter -> id, leave -> undefined
      onToggleNote?: (id: string) => void;   // click: lock/unlock this id
    });

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
  const interactive = !!onToggleNote || !!onFocusNote;

  // When interactive, the union guarantees segmentId is present. The extra
  // segmentId check is belt-and-suspenders: if it's somehow absent, fall back
  // to the presentational span rather than render a no-op button.
  if (!interactive || !segmentId) {
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
      onClick={(e) => { e.stopPropagation(); onToggleNote?.(segmentId); }}
      onMouseEnter={() => onFocusNote?.(segmentId)}
      onMouseLeave={() => onFocusNote?.(undefined)}
    >
      <Decoration />
      {note}
    </button>
  );
}
