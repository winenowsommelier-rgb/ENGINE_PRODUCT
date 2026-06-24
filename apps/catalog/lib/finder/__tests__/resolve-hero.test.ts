import { describe, it, expect } from 'vitest';
import type { Answers, FinderCategory } from '@/lib/finder/answers';
import { resolveHeroProfile } from '@/lib/finder/style-profiles';
import { resolveArchetypeId } from '@/lib/finder/taste-feel';

/**
 * REGRESSION GUARD (Rule 5/6): the result-page HERO must show the SAME archetype the
 * scoring/grid ranks by. Before this fix the hero went through resolveProfile(), whose
 * match() functions read the legacy a.axis1/a.axis2 — but the redesigned Layer-1 now
 * writes a.tasteFeel, so match() scored 0 for every archetype and resolveProfile fell
 * back to the FIRST archetype of each category. Result: headline contradicted the
 * bottles (gin 'modern' showed "Classic London Dry Gin", red 'bold' showed
 * "Bright & Elegant Red", sake 'fragrant' showed "Crisp & Dry Sake").
 *
 * Invariant: for EVERY (category, feel) the user can pick, the hero archetype id
 * === resolveArchetypeId(category, feel) — the single resolution path the grid uses.
 */
const FEELS: Record<FinderCategory, string[]> = {
  red: ['light', 'smooth', 'bold'],
  white: ['crisp', 'rounded', 'aromatic'],
  whisky: ['smooth', 'rich', 'smoky'],
  rose: ['crisp', 'fruity'],
  sparkling: ['festive', 'fine'],
  gin: ['classic', 'modern'],
  spirits: ['light', 'smooth', 'rich'],
  sake: ['fragrant', 'clean'],
};

describe('resolveHeroProfile — hero matches the grid (no headline/grid drift)', () => {
  for (const cat of Object.keys(FEELS) as FinderCategory[]) {
    for (const feel of FEELS[cat]) {
      it(`${cat} / ${feel}: hero id === resolveArchetypeId`, () => {
        const a: Answers = { category: cat, tasteFeel: feel };
        const hero = resolveHeroProfile(a);
        const gridId = resolveArchetypeId(cat, feel);
        expect(hero, `no hero for ${cat}/${feel}`).not.toBeNull();
        expect(hero!.id).toBe(gridId);
        // and the hero must actually be of the asked-for category
        expect(hero!.category).toBe(cat);
      });
    }
  }

  it('all-neutral path (no tasteFeel) falls back to the category crowd-pleaser', () => {
    for (const cat of Object.keys(FEELS) as FinderCategory[]) {
      const hero = resolveHeroProfile({ category: cat } as Answers);
      expect(hero, `no fallback hero for ${cat}`).not.toBeNull();
      expect(hero!.id).toBe(resolveArchetypeId(cat, undefined));
    }
  });
});
