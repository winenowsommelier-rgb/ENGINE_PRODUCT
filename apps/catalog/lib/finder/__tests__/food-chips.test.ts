import { describe, it, expect } from 'vitest';
import { foodChipMatches, FOOD_CHIPS } from '@/lib/finder/food-chips';

describe('food chips', () => {
  it('seafood chip matches "Oysters & raw seafood, grilled fish"', () =>
    expect(foodChipMatches({ food_matching: 'Oysters & raw seafood, grilled fish' } as any, ['seafood'])).toBe(1));
  it('red-meat chip matches "Grilled red meat, lamb dishes"', () =>
    expect(foodChipMatches({ food_matching: 'Grilled red meat, lamb dishes' } as any, ['red-meat'])).toBe(1));
  it('counts one per matching chip', () =>
    expect(foodChipMatches({ food_matching: 'Grilled red meat, aged hard cheese' } as any, ['red-meat','cheese'])).toBe(2));
  it('no match → 0', () =>
    expect(foodChipMatches({ food_matching: 'Sushi & sashimi' } as any, ['red-meat'])).toBe(0));
  it('missing food_matching → 0', () =>
    expect(foodChipMatches({} as any, ['seafood'])).toBe(0));
  it('exposes all 9 chips', () => expect(Object.keys(FOOD_CHIPS)).toHaveLength(9));
});
