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

// Honest default when no taste signal: a broadly-liked style per category.
export const CROWD_PLEASER: Record<FinderCategory, string> = {
  red: 'supple-everyday-red', white: 'aromatic-balanced-white', whisky: 'smooth-irish-whiskey',
  sparkling: 'fresh-festive-sparkling', gin: 'classic-juniper-gin',
  spirits: 'clean-versatile-vodka', sake: 'crisp-dry-sake',
};
export function resolveArchetypeId(cat: FinderCategory, feel: string | undefined): string {
  return feelToArchetype(cat, feel) ?? CROWD_PLEASER[cat];
}
