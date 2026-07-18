import type { PublicProduct } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * ReputationBadge — the single source of truth for how a reputation_tier
 * renders as a badge, everywhere it appears (ProductCard, QuickView, PDP).
 *
 * "Top Rated" was retired in favor of "Renowned": the old label collided
 * with the Critic-scored quick-filter and the critic-score pill shown on
 * the SAME card, reading as an unsubstantiated rating claim (2026-07-09
 * expert review). "Renowned" reads as a reputation/prestige signal, not a
 * numeric rating, so it can't be confused with the critic-score pill.
 *
 * Only iconic/premium render a badge — established/everyday/unrated are
 * intentionally silent (too noisy / not a meaningful signal to a shopper).
 */
export function reputationBadgeLabel(tier: PublicProduct['reputation_tier']): string | null {
  if (tier === 'iconic') return 'Iconic';
  if (tier === 'premium') return 'Renowned';
  return null;
}

export function ReputationBadge({
  tier,
  className,
}: {
  tier: PublicProduct['reputation_tier'];
  className?: string;
}) {
  const label = reputationBadgeLabel(tier);
  if (!label) return null;

  if (tier === 'iconic') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-amber-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-sm',
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-border',
        className,
      )}
    >
      {label}
    </span>
  );
}
