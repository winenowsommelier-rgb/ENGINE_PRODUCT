import type { FinderCategory } from './answers';
// Plain taste-feel token -> archetype id. Body and tannin are SEPARATE axes:
// 'smooth' is soft-tannin/medium-full (Supple), NOT light-bodied (Bright). 'unsure'/missing
// is intentionally absent -> resolver returns null -> caller uses the crowd-pleaser.
const FEEL_TO_ARCHETYPE: Record<FinderCategory, Record<string, string>> = {
  red:   { light: 'bright-elegant-red', smooth: 'supple-everyday-red', bold: 'bold-structured-red' },
  // White is ACIDITY-led (not sweetness): crisp = high-acid lean white; rounded = rich,
  // fuller, lower-acid; aromatic = the fragrant balanced middle. 'unsure'/missing → null →
  // resolver uses CROWD_PLEASER.white (aromatic-balanced-white).
  white: { crisp: 'crisp-zesty-white', rounded: 'rich-textured-white', aromatic: 'aromatic-balanced-white' },
  whisky: {}, sparkling: {}, gin: {}, spirits: {}, sake: {},
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
