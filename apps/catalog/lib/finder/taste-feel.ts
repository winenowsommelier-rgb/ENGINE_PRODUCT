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
  // Whisky Layer-1 plain-feel → archetype (taste-feel.ts is COPY only; smoky is also a
  // rank boost in scoring.ts). smooth=mellow/Irish, rich=warming/bourbon, smoky=peated/
  // coastal. Japanese refined is reachable via the ORIGIN question (axis1=japanese), so it
  // is intentionally NOT a feel token here. 'unsure'/missing → null → CROWD_PLEASER.whisky.
  whisky: { smooth: 'smooth-irish-whiskey', rich: 'sweet-bold-bourbon', smoky: 'peated-coastal-whisky' },
  // Sparkling Layer-1 plain-feel → archetype (style-led, COPY + body/acidity scoring).
  // festive = light, fruity, frothy (Prosecco/Asti-style fresh-festive). fine = full,
  // toasty, traditional-method (Champagne-style fine-traditional). 'unsure'/missing →
  // null → CROWD_PLEASER.sparkling (fresh-festive-sparkling).
  sparkling: { festive: 'fresh-festive-sparkling', fine: 'fine-traditional-sparkling' },
  // Gin Layer-1 plain-feel → archetype (style-led, COPY + a rank-only keyword lean in
  // scoring.ts ginStyleBump). classic = juniper-forward London Dry; modern = contemporary
  // botanical. 'unsure'/missing → null → CROWD_PLEASER.gin (classic-juniper-gin).
  gin: { classic: 'classic-juniper-gin', modern: 'contemporary-botanical-gin' },
  // Spirits (other) Layer-1 plain-feel → archetype (TASK A). One generic feel after the
  // TYPE question (axis1). light/smooth → clean-versatile-vodka (clean, mixable);
  // rich/aged → warm-aged-spirit (an aged/grade-marked sipper). A POSITIVE-ONLY age/grade
  // rank lean (spiritsFeelScore) also boosts rich/aged. 'unsure'/missing → null →
  // CROWD_PLEASER.spirits (clean-versatile-vodka).
  spirits: { light: 'clean-versatile-vodka', smooth: 'clean-versatile-vodka', rich: 'warm-aged-spirit', aged: 'warm-aged-spirit' },
  // Sake Layer-1 plain-feel → archetype (TASK B). Aroma-led, no junmai/ginjo jargon in the
  // UI labels: fragrant = fruity/aromatic (Ginjo-style) → fragrant-sweet-sake; clean = dry,
  // crisp (Honjozo/Junmai-style) → crisp-dry-sake. The structured `variety` drives a rank
  // lean (sakeAromaScore). 'unsure'/missing → null → CROWD_PLEASER.sake (crisp-dry-sake).
  sake: { fragrant: 'fragrant-sweet-sake', clean: 'crisp-dry-sake' },
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
