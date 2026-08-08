'use client';
import { useId, useState } from 'react';
import { KnowledgeSection } from '@/components/explore/KnowledgeSection';
import { splitSentences } from '@/lib/explore/split-sentences';
import type { RegionDescriptionEntry } from '@/lib/explore/region-lookup.server';

// Sentences shown before the Read more toggle kicks in.
const COLLAPSED_SENTENCE_COUNT = 3;

/**
 * Sommelier-authored region/subregion copy on the shop page, shown once a
 * shopper has drilled into a specific region or subregion. Reuses the same
 * taxonomy-backed copy as the explore-map drawer (see region-lookup.server.ts)
 * — no price/bottle-count line here since "Showing X of N" already covers it.
 *
 * Rendered one sentence per line (tight stacking, no paragraph gaps) rather
 * than as a single dense block. Full descriptions can run 1,000+ characters,
 * so long copy is clamped to the first few sentences with a Read more/less
 * toggle rather than always rendered in full (which would push the product
 * grid below the fold).
 */
export function RegionDescriptionCard({ entry }: { entry: RegionDescriptionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const sentences = splitSentences(entry.description);
  const isLong = sentences.length > COLLAPSED_SENTENCE_COUNT;
  const visibleSentences = isLong && !expanded ? sentences.slice(0, COLLAPSED_SENTENCE_COUNT) : sentences;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Region · {entry.country}
        </div>
        <h2 className="text-lg font-semibold text-foreground sm:text-xl">{entry.name}</h2>
      </div>

      <div>
        <div id={panelId} className="text-sm leading-snug text-foreground sm:text-base">
          {visibleSentences.map((sentence, i) => (
            <p key={i}>{sentence}</p>
          ))}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {expanded ? 'Read less' : 'Read more'}
          </button>
        )}
      </div>

      {entry.knowledge && <KnowledgeSection knowledge={entry.knowledge} />}
    </div>
  );
}
