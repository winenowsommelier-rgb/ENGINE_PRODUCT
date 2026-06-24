import type { FinderCategory } from './answers';

/**
 * Cross-category novice entry (Task 11). A first-timer who doesn't know
 * "Sparkling vs Champagne" — or whether they want wine at all — picks a plain
 * MOMENT ("celebrating", "with steak", "a quiet nightcap") and we route them
 * into a sensible category journey.
 *
 * PURE + data-driven: a small synonym→category map, no network, no LLM. Unknown
 * input returns null so the caller can fall back (e.g. keep the user on the
 * category grid) instead of guessing wrongly.
 *
 * Each MOMENT shown in the UI carries a label/icon; the underlying matcher also
 * accepts a few synonyms (steak/red-meat, oysters/seafood, …) so the same helper
 * powers both the curated cards and any free-text the UI might pass later.
 */

const TOKEN_TO_CATEGORY: Record<string, FinderCategory> = {
  // — with food —
  steak: 'red',
  'red-meat': 'red',
  beef: 'red',
  lamb: 'red',
  oysters: 'white',
  seafood: 'white',
  fish: 'white',
  shellfish: 'white',
  // — the occasion —
  celebration: 'sparkling',
  celebrating: 'sparkling',
  bubbles: 'sparkling',
  party: 'sparkling',
  // — the mood —
  nightcap: 'whisky',
  sipping: 'whisky',
  'after-dinner': 'whisky',
};

/**
 * The curated MOMENT cards the novice picker shows. `token` feeds suggestCategory;
 * `label`/`icon` are the plain-language UI. Kept small and concrete (spec: SIMPLEST
 * viable) — four clear moments that each route to a confident starting category.
 */
export const NOVICE_MOMENTS: ReadonlyArray<{
  token: string;
  label: string;
  icon: string;
}> = [
  { token: 'steak', label: 'Something for a steak dinner', icon: '🥩' },
  { token: 'seafood', label: 'Pairing with seafood', icon: '🦪' },
  { token: 'celebration', label: 'Bubbles to celebrate', icon: '🥂' },
  { token: 'nightcap', label: 'A nightcap to sip', icon: '🥃' },
];

/**
 * Map a plain moment/food cue to a starting finder category. Case/whitespace
 * insensitive. Returns null for unknown/empty input so the UI can fall back.
 */
export function suggestCategory(input: string | undefined): FinderCategory | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return TOKEN_TO_CATEGORY[key] ?? null;
}
