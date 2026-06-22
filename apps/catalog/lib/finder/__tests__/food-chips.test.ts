import { describe, it, expect } from 'vitest';
import { FOOD_CHIPS, foodChipMatches, emptyFoodChips } from '@/lib/finder/food-chips';

describe('food chips (15 grouped cuisine+dish, with icon+label+keywords)', () => {
  it('has 15 chips each with label, icon, keywords', () => {
    expect(Object.keys(FOOD_CHIPS)).toHaveLength(15);
    for (const c of Object.values(FOOD_CHIPS)) {
      expect(c.label).toBeTruthy();
      expect(c.icon).toBeTruthy();
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });
  it('thai matches a thai dish', () => expect(foodChipMatches({ food_matching:'Spicy Thai green curry' } as any, ['thai'])).toBe(1));
  it('sushi matches sashimi', () => expect(foodChipMatches({ food_matching:'Sushi & sashimi platter' } as any, ['sushi'])).toBe(1));
  it('grilled matches "Grilled red meat"', () => expect(foodChipMatches({ food_matching:'Grilled red meat, lamb' } as any, ['grilled'])).toBe(1));
  it('cheese matches charcuterie', () => expect(foodChipMatches({ food_matching:'Aged hard cheese, charcuterie board' } as any, ['cheese'])).toBe(1));
  it('counts one per matching chip', () => expect(foodChipMatches({ food_matching:'Grilled steak, aged cheese' } as any, ['grilled','cheese'])).toBe(2));
  it('no match → 0', () => expect(foodChipMatches({ food_matching:'Sushi' } as any, ['grilled'])).toBe(0));
  it('missing food_matching → 0', () => expect(foodChipMatches({} as any, ['thai'])).toBe(0));
});

describe('emptyFoodChips — tokens with no in-stock matches (greyed-out guard)', () => {
  it('flags a chip whose keywords match nothing in the pool', () => {
    // Pool has a thai dish only → every non-thai chip is "empty".
    const pool = [{ food_matching: 'Spicy Thai green curry' } as any];
    const empty = emptyFoodChips(pool);
    expect(empty.has('thai')).toBe(false);
    expect(empty.has('sushi')).toBe(true);
    expect(empty.has('dessert')).toBe(true);
  });
  it('empty pool → every chip is empty', () => {
    expect(emptyFoodChips([]).size).toBe(Object.keys(FOOD_CHIPS).length);
  });
  it('a chip with a match is not flagged', () => {
    const pool = [{ food_matching: 'Aged cheese, charcuterie board' } as any];
    expect(emptyFoodChips(pool).has('cheese')).toBe(false);
  });
});
