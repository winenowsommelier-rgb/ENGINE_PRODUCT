"use client";

import { TasteNote } from './TasteNote';

interface Note { note: string; intensity: 1 | 2 | 3; }

export function TasteChipCard({ flatTags }: { flatTags: Note[] | undefined }) {
  const safe = flatTags ?? [];
  const groups: Record<string, Note[]> = {
    Dominant:   safe.filter(n => n.intensity === 3),
    Supporting: safe.filter(n => n.intensity === 2),
    Subtle:     safe.filter(n => n.intensity === 1),
  };
  return (
    <div className="taste-chip-card">
      {Object.entries(groups).map(([label, notes]) => (
        notes.length > 0 && (
          <div key={label} className="taste-chip-group">
            <div className="taste-chip-group-label">{label}</div>
            <div className="taste-chip-row">
              {notes.map((n, i) => (
                <TasteNote key={`${label}-${i}`} note={n.note} tier="flat" intensity={n.intensity} />
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
