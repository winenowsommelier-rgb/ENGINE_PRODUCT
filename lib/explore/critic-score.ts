// Pure parse helper for the critic-score badge. NO React import.
// Turns the score_summary JSON string into a typed, sorted, lead-identified result.

export interface CriticEntry {
  abbr: string;        // "JS"
  critic: string;      // "James Suckling"
  score_native: string;// "100"  (display string)
  score_value: number; // 100    (for math)
}

export interface ParsedCriticScores {
  critics: CriticEntry[]; // sorted desc, capped at maxCritics
  lead: CriticEntry;      // the score_max critic (or critics[0] fallback)
  overflow: number;       // count of critics beyond the lead (for "+N")
  ariaLabel: string;      // "Critic scores: James Suckling 100, Wine Advocate 99, ..."
}

const EPS = 0.001;

/**
 * @param scoreMax     products.score_max (number) — gate; null/undefined → no badge
 * @param scoreSummary products.score_summary (JSON string) — parsed here, safely
 * @param maxCritics   cap on rendered critics (default 4); lead always included
 * @returns ParsedCriticScores, or null when there is nothing to render
 */
export function parseCriticScores(
  scoreMax: number | null | undefined,
  scoreSummary: string | null | undefined,
  maxCritics = 4,
): ParsedCriticScores | null {
  if (scoreMax === null || scoreMax === undefined) return null;
  if (!scoreSummary) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(scoreSummary);
  } catch {
    return null; // malformed JSON must never throw / blank a card
  }

  const critics = Array.isArray((raw as { critics?: unknown })?.critics)
    ? ((raw as { critics: unknown[] }).critics.filter(
        (c): c is CriticEntry =>
          !!c && typeof c === "object" &&
          typeof (c as CriticEntry).abbr === "string" &&
          typeof (c as CriticEntry).score_value === "number",
      ))
    : [];

  if (critics.length === 0) return null;

  // Loader guarantees desc order, but don't trust it — sort defensively.
  const sorted = [...critics].sort((a, b) => b.score_value - a.score_value);

  const lead =
    sorted.find((c) => Math.abs(c.score_value - scoreMax) < EPS) ?? sorted[0];

  const capped = sorted.slice(0, Math.max(1, maxCritics));

  const ariaLabel =
    "Critic scores: " +
    sorted.map((c) => `${c.critic} ${c.score_native}`).join(", ");

  return { critics: capped, lead, overflow: sorted.length - 1, ariaLabel };
}
