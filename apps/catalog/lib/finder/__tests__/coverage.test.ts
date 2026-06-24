import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { scoreProducts } from '../scoring';
import type { Answers, FinderCategory } from '../answers';

/**
 * No-dead-ends coverage (spec §9 / §11.11). Every plain Layer-1 taste-feel answer for the
 * Phase-1 categories must resolve to ≥3 real IN-STOCK bottles when run through the actual
 * scorer against the live export. A precise-looking finder that returns 0-2 bottles for a
 * plausible answer is a silent conversion leak, so we assert against real inventory — not a
 * hand-counted snapshot that drifts. Re-baselined to in-stock per §11.11.
 */
const FEELS: Record<FinderCategory, string[]> = {
  red: ['light', 'smooth', 'bold', 'unsure'],
  white: ['crisp', 'rounded', 'aromatic', 'unsure'],
  whisky: ['smooth', 'rich', 'smoky', 'unsure'],
  // Phase 2 (not asserted here):
  rose: [], sparkling: [], gin: [], spirits: [], sake: [],
};

describe('finder coverage — no dead ends (Phase 1)', () => {
  const all = getAllProducts();

  for (const cat of ['red', 'white', 'whisky'] as FinderCategory[]) {
    for (const feel of FEELS[cat]) {
      it(`${cat} / "${feel}" returns ≥3 bottles`, () => {
        const a: Answers = { category: cat, tasteFeel: feel };
        const { products } = scoreProducts(a, all);
        expect(products.length).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('whisky / "smoky" surfaces a genuinely-peated dram (Talisker/Ledaig false-neg guard)', () => {
    const { products } = scoreProducts({ category: 'whisky', tasteFeel: 'smoky' }, all);
    const names = products.map((p) => (p.name || '').toLowerCase()).join(' | ');
    // At least one canonical peated distillery should rank into the shown set.
    expect(/talisker|ledaig|laphroaig|ardbeg|lagavulin|caol ila|bowmore/.test(names)).toBe(true);
  });
});
