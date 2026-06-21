import { parseCriticScores } from '@/lib/critic-score';

export interface CriticScoreStripProps {
  scoreMax?: number | null;
  scoreSummary?: string | null;
  maxCritics?: number;
  /**
   * "strip" (default) — full segmented data strip, one cell per critic. Used on
   *   the product detail page.
   * "compact" — a single small pill (lead score + abbr + "+N"). Used as an
   *   overlay on grid cards where the full strip is too heavy.
   */
  variant?: 'strip' | 'compact';
}

/**
 * Storefront critic-score badge. Renders nothing when there is no score or the
 * payload is malformed (the parse helper gates that), so it can be placed
 * unconditionally without leaving an empty box.
 */
export function CriticScoreStrip({
  scoreMax,
  scoreSummary,
  maxCritics = 4,
  variant = 'strip',
}: CriticScoreStripProps) {
  const parsed = parseCriticScores(scoreMax, scoreSummary, maxCritics);
  if (!parsed) return null;

  if (variant === 'compact') {
    // A single pill — lead score + abbr + "+N" for the remaining critics. The
    // full critic list rides in aria-label + title so nothing is lost.
    return (
      <span
        role="group"
        aria-label={parsed.ariaLabel}
        title={parsed.ariaLabel}
        className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground shadow-sm ring-1 ring-primary/20"
      >
        <span>{parsed.lead.score_native}</span>
        <span className="opacity-80">{parsed.lead.abbr}</span>
        {parsed.overflow > 0 ? <span className="opacity-70">+{parsed.overflow}</span> : null}
      </span>
    );
  }

  // Guarantee the lead is shown even if it ranks below the maxCritics cap.
  const cells = parsed.critics.some(
    (c) => c.abbr === parsed.lead.abbr && c.score_value === parsed.lead.score_value,
  )
    ? parsed.critics
    : [parsed.lead, ...parsed.critics.slice(0, Math.max(0, parsed.critics.length - 1))];

  return (
    <div
      role="group"
      aria-label={parsed.ariaLabel}
      className="inline-flex items-stretch overflow-hidden rounded-full text-sm tabular-nums ring-1 ring-border"
    >
      {cells.map((c, i) => {
        const isLead =
          c.abbr === parsed.lead.abbr && c.score_value === parsed.lead.score_value;
        return (
          <div
            key={`${c.abbr}-${i}`}
            data-lead={isLead || undefined}
            title={`${c.critic} — ${c.score_native}`}
            className={[
              'flex items-baseline gap-1.5 px-3 py-1',
              i < cells.length - 1 ? 'border-r border-border' : '',
              isLead ? 'bg-primary/8' : 'bg-secondary',
            ].join(' ')}
          >
            <span
              className={[
                'text-[11px] font-semibold uppercase tracking-wide',
                isLead ? 'text-primary' : 'text-muted-foreground',
              ].join(' ')}
            >
              {c.abbr}
            </span>
            <span
              className={[
                'font-semibold',
                isLead ? 'text-primary' : 'text-foreground',
              ].join(' ')}
            >
              {c.score_native}
            </span>
          </div>
        );
      })}
    </div>
  );
}
