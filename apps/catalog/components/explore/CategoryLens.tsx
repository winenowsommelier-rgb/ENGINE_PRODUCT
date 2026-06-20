'use client';
import type { LensKey } from '@/lib/explore/types';

const LENSES: { key: LensKey; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'wine', label: 'Wine' },
  { key: 'whisky', label: 'Whisky' }, { key: 'spirits', label: 'Spirits' },
  { key: 'sake', label: 'Sake' },
];

export function CategoryLens({ active, onSelect, available }: {
  active: LensKey; onSelect: (l: LensKey) => void; available: Set<LensKey>;
}) {
  return (
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
      {LENSES.filter((l) => l.key === 'all' || available.has(l.key)).map((l) => (
        <button key={l.key} onClick={() => onSelect(l.key)}
          aria-pressed={active === l.key}
          className={`min-h-11 rounded-md border px-4 text-base transition-colors ${
            active === l.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-secondary'
          }`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
