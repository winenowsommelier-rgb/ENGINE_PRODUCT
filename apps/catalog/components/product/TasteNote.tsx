// components/product/TasteNote.tsx
//
// PORTED from the internal app's TasteNote (repo-root components/product/TasteNote.tsx)
// and NEUTRALIZED for the public catalog:
//
//   The internal version was a <button> that called useRouter().push('/explore?...').
//   The catalog storefront has NO /explore route, so navigating there would 404. Per
//   Task 11 spec we strip the router navigation entirely and render a NON-INTERACTIVE
//   chip (a plain <span>). No useRouter import, no onClick, no /explore string — a grep
//   for "useRouter" / "/explore" under components/product/ must come back empty.
//
// This is purely presentational, so it does NOT need "use client".

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  className?: string;
}

export function TasteNote({ note, tier, intensity, className }: TasteNoteProps) {
  return (
    <span
      data-intensity={intensity}
      data-tier={tier}
      className={className ?? 'taste-note'}
    >
      {note}
    </span>
  );
}
