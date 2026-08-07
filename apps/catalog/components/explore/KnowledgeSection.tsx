'use client';
import { useId, useState } from 'react';
import type { MapRegion } from '@/lib/explore/types';

/**
 * KnowledgeSection — progressive-disclosure "knowledge" block for a region:
 * key grapes (non-interactive chips), a compact classification row, and a
 * collapsible "Learn more" terroir disclosure. Rendered only when the region
 * carries a `knowledge` payload. The disclosure reveals the STRING-valued
 * entries of `attributes` (array-valued attrs like `key_grapes` are skipped).
 *
 * Shared by RegionDrawer (explore-map) and RegionDescriptionCard (shop).
 */
export function KnowledgeSection({ knowledge }: { knowledge: NonNullable<MapRegion['knowledge']> }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const grapes = knowledge.grapes ?? [];
  const tiers = knowledge.tiers ?? [];
  // Only string-valued attributes are human-readable label→value rows.
  const detailRows = Object.entries(knowledge.attributes ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return (
    <div className="flex flex-col gap-4">
      {grapes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Key grapes</h3>
          <ul className="flex flex-wrap gap-2">
            {grapes.map((g) => (
              <li
                key={g}
                className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
              >
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tiers.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Classification</span>
          <span className="text-foreground">{tiers.join(' ')}</span>
        </div>
      )}

      {detailRows.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {open ? 'Show less' : 'Learn more'}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className={[
                'h-4 w-4 transition-transform duration-200 motion-safe:transition-transform',
                open ? 'rotate-180' : '',
              ].join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 7.5 10 12.5 15 7.5" />
            </svg>
          </button>
          <dl id={panelId} hidden={!open} className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
            {detailRows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="capitalize text-muted-foreground">{key.replace(/_/g, ' ')}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
