'use client';
import { useId, useState } from 'react';
import { splitSentences } from '@/lib/explore/split-sentences';
import type { DesignationDescriptionEntry } from '@/lib/explore/designation-lookup.server';

const COLLAPSED_SENTENCE_COUNT = 3;

/**
 * Sommelier-authored designation/classification copy on the shop page,
 * shown once a shopper filters by ?designation=X and that designation has
 * a non-empty live count (enforced by findDesignationDescription, not
 * here). Structurally mirrors RegionDescriptionCard but drops the
 * KnowledgeSection block (region-specific) and the citation footer
 * (RegionDescriptionCard doesn't render one either — kept consistent).
 */
export function DesignationDescriptionCard({ entry }: { entry: DesignationDescriptionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const sentences = splitSentences(entry.description);
  const isLong = sentences.length > COLLAPSED_SENTENCE_COUNT;
  const visibleSentences = isLong && !expanded ? sentences.slice(0, COLLAPSED_SENTENCE_COUNT) : sentences;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Classification</div>
        <h2 className="text-lg font-semibold text-foreground sm:text-xl">{entry.designation}</h2>
      </div>

      <div>
        <div id={panelId} className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground sm:text-base">
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
    </div>
  );
}
