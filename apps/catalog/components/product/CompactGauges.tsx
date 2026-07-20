// components/product/CompactGauges.tsx
//
// Compact single-line variant of StructuralGauges (see that file for the scale
// contract) — label + segmented dot track + value on one row instead of
// label/track/scale-labels across three. No "Light…Full" axis labels
// underneath — the caller already normalised the value (taste-adapter.ts), so
// the value chip alone carries the meaning.
//
// Two sizes, same visual language: 'sm' for tight card grids, 'md' for the
// product detail page's own Taste profile section (replaces the old
// StructuralGauges 3-line layout there — same component everywhere now).

import { SCALE_DEFINITIONS } from '@/components/product/StructuralGauges';

interface CompactGaugesProps {
  structural: Record<string, string | null>;
  size?: 'sm' | 'md';
}

const SIZE = {
  sm: { label: 'text-xs', value: 'text-xs', track: 'h-1.5', gap: 'gap-2', cols: '3rem' },
  md: { label: 'text-sm', value: 'text-sm', track: 'h-2', gap: 'gap-3', cols: '5rem' },
} as const;

export function CompactGauges({ structural, size = 'sm' }: CompactGaugesProps) {
  const rows = Object.entries(structural).filter(([axis, value]) => value && SCALE_DEFINITIONS[axis]);
  if (rows.length === 0) return null;
  const s = SIZE[size];

  return (
    <dl className={`flex flex-col ${s.gap}`}>
      {rows.map(([axis, value]) => {
        const def = SCALE_DEFINITIONS[axis];
        const filledCount = def.scale.indexOf(value as string) + 1;
        const label = axis.charAt(0).toUpperCase() + axis.slice(1);
        return (
          <div
            key={axis}
            className={`grid items-center ${s.gap}`}
            style={{ gridTemplateColumns: `${s.cols} 1fr auto` }}
          >
            <dt className={`truncate ${s.label} text-muted-foreground`}>{label}</dt>
            <dd className="flex gap-1" aria-hidden="true">
              {def.scale.map((_, i) => (
                <span
                  key={i}
                  className={`${s.track} flex-1 rounded-full`}
                  style={{ background: i < filledCount ? def.color : '#e5dccb' }}
                />
              ))}
            </dd>
            <dd className={`whitespace-nowrap ${s.value} font-medium`} style={{ color: def.color }}>
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
