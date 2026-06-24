/**
 * Honest match band for a finder result (spec §11.9).
 *
 * We deliberately show a banded label ("Great / Strong / Good match") rather than a
 * precise percentage: a precise % over sparse/legacy taste data invites scrutiny the data
 * can't survive, and a top match at "58%" reads to a novice as a bad match. Bands are
 * legible and honest.
 *
 * Honesty floor: when the result was driven by NO taste signal (the all-neutral
 * "not sure — guide me" path → the crowd-pleaser archetype), we cap at "Good match" so the
 * page never claims a strong personalised fit that the user's answers did not produce.
 */
export type MatchBandLabel = 'Great match' | 'Strong match' | 'Good match';

export interface MatchBandInput {
  score: number;
  maxScore: number;
  /** True when the user gave at least one real taste/preference signal (not all-neutral). */
  hadTasteSignal: boolean;
}

export function matchBand({ score, maxScore, hadTasteSignal }: MatchBandInput): MatchBandLabel {
  // No taste signal → honest floor, regardless of raw score.
  if (!hadTasteSignal) return 'Good match';
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.75) return 'Great match';
  if (ratio >= 0.45) return 'Strong match';
  return 'Good match';
}
