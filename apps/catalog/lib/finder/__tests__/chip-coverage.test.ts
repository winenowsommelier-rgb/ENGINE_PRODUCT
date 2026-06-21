import { describe, it, expect } from 'vitest';
import { getAllProducts } from '@/lib/catalog-data';
import { FOOD_CHIPS, foodChipMatches } from '@/lib/finder/food-chips';
import { FLAVOR_FAMILY } from '@/lib/finder/scoring';
import { isInStock } from '@/lib/utils';

// THE DEAD-CHIP GUARD (the feature's credibility rests on this): every chip the finder
// offers must return >=1 IN-STOCK product against the REAL export. A chip that matches
// nothing is a professional-looking dead end — the exact trap this whole effort avoids.
const inStock = getAllProducts().filter((p) => isInStock(p.is_in_stock));

describe('no dead chips — every finder chip returns >=1 in-stock product', () => {
  it('every food chip', () => {
    for (const key of Object.keys(FOOD_CHIPS)) {
      const n = inStock.filter((p) => foodChipMatches(p, [key]) > 0).length;
      expect(n, `food chip "${key}" returned 0 in-stock products`).toBeGreaterThan(0);
    }
  });

  it('every flavor family', () => {
    for (const [key, notes] of Object.entries(FLAVOR_FAMILY)) {
      const set = new Set(notes.map((s) => s.toLowerCase()));
      const n = inStock.filter((p) =>
        (p.flavor_tags_canonical ?? []).some((t) => set.has(t.trim().toLowerCase())),
      ).length;
      expect(n, `flavor chip "${key}" returned 0 in-stock products`).toBeGreaterThan(0);
    }
  });

  // Stricter than the per-family guard above: every INDIVIDUAL note in a family must
  // exist in the data. A zero-count note is inert — it overstates the matcher's reach
  // and is the same dead-path class as the hyphen-vs-space bug this feature fixed.
  it('no dead sub-notes — every note in every family exists in flavor_tags_canonical', () => {
    const universe = new Set<string>();
    for (const p of inStock)
      for (const t of p.flavor_tags_canonical ?? []) universe.add(t.trim().toLowerCase());
    for (const [key, notes] of Object.entries(FLAVOR_FAMILY))
      for (const note of notes)
        expect(universe.has(note.toLowerCase()), `family "${key}" note "${note}" matches 0 in-stock products`).toBe(true);
  });
});
