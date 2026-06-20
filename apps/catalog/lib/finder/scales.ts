import { normalizeScale } from '@/lib/taste-adapter';

// The 4-level scales /shop actually filters on (must match taste-adapter's SCALE).
export const FILTER_SCALE = {
  body:    ['Light','Medium','Medium-Full','Full'],
  acidity: ['Low','Medium','Medium-High','High'],
  tannin:  ['Low','Medium','Medium-High','High'],
} as const;
type Scale = keyof typeof FILTER_SCALE;

// token → raw representative values (primary first). Normalized into FILTER_SCALE on the way out.
const TOKEN_RAW: Record<Scale, Record<string, string[]>> = {
  body:    { bold:['Full','Medium-Full'], medium:['Medium'], light:['Light'] },
  acidity: { crisp:['High','Medium-High'], balanced:['Medium'], soft:['Medium-Light','Medium'] },
  tannin:  { firm:['High','Medium-High'], silky:['Low','Light'], any:[] },
};
/** Filter-scale values for a token (normalized, deduped, in-scale only). */
export function valuesForToken(scale: Scale, token: string): string[] {
  const raw = TOKEN_RAW[scale]?.[token] ?? [];
  const out: string[] = [];
  for (const r of raw) { const n = normalizeScale(scale, r); if (n && !out.includes(n)) out.push(n); }
  return out;
}
export function primaryValue(scale: Scale, token: string): string | undefined { return valuesForToken(scale, token)[0]; }
/** ordinal index in the FILTER scale (for ladder distance in scoring), or -1. */
export function bucketForValue(scale: Scale, normValue: string | undefined): number {
  return normValue ? (FILTER_SCALE[scale] as readonly string[]).indexOf(normValue) : -1;
}
