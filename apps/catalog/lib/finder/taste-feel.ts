import type { FinderCategory } from './answers';
// Plain taste-feel token -> archetype id. Body and tannin are SEPARATE axes:
// 'smooth' is soft-tannin/medium-full (Supple), NOT light-bodied (Bright). 'unsure'/missing
// is intentionally absent -> resolver returns null -> caller uses the crowd-pleaser.
const FEEL_TO_ARCHETYPE: Record<FinderCategory, Record<string, string>> = {
  red:   { light: 'bright-elegant-red', smooth: 'supple-everyday-red', bold: 'bold-structured-red' },
  white: {}, whisky: {}, sparkling: {}, gin: {}, spirits: {}, sake: {},
};
export function feelToArchetype(cat: FinderCategory, feel: string | undefined): string | null {
  if (!feel) return null;
  return FEEL_TO_ARCHETYPE[cat]?.[feel] ?? null;
}
