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
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2.5">
      {LENSES.filter((l) => l.key === 'all' || available.has(l.key)).map((l) => {
        const isActive = active === l.key;
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => onSelect(l.key)}
            aria-pressed={isActive}
            className={[
              // Larger, easier targets for a 40+ audience: 48px tall, roomy padding,
              // pill shape, clear hover + active states (not colour-only — active also
              // carries a filled style + heavier weight + ring).
              'inline-flex min-h-12 items-center rounded-full border-2 px-5 text-base font-medium',
              'transition-[background-color,border-color,box-shadow] duration-150 ease-out',
              isActive
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-background text-foreground hover:border-primary/60 hover:bg-secondary',
            ].join(' ')}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
