"use client";

import { useRouter } from 'next/navigation';

export type Tier = 'primary' | 'secondary' | 'tertiary' | 'flat';

export interface TasteNoteProps {
  note: string;
  tier: Tier;
  intensity: 1 | 2 | 3;
  className?: string;
}

export function TasteNote({ note, tier, intensity, className }: TasteNoteProps) {
  const router = useRouter();
  const handleClick = () => {
    const url = `/explore?note=${encodeURIComponent(note)}&tier=${tier}`;
    router.push(url);
  };
  return (
    <button
      type="button"
      data-intensity={intensity}
      data-tier={tier}
      onClick={handleClick}
      className={className ?? 'taste-note'}
      aria-label={`Find other products with ${note} as ${tier} tier`}
    >
      {note}
    </button>
  );
}
