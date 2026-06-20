import type { PublicProduct } from '@/lib/types';

// chip key → case-insensitive substring keywords (grounded in the 6,078 raw food_matching values).
export const FOOD_CHIPS: Record<string, string[]> = {
  'red-meat':  ['red meat','beef','lamb','steak','game','venison'],
  'poultry':   ['chicken','poultry','duck','turkey'],
  'seafood':   ['seafood','fish','oyster','shellfish','prawn','crab','lobster','sushi','sashimi','shrimp'],
  'cheese':    ['cheese','charcuterie'],
  'pasta-pizza':['pasta','pizza','risotto'],
  'spicy-asian':['spicy','thai','dim sum','curry','asian','szechuan','korean'],
  'vegetarian':['salad','vegetable','mushroom','vegetarian'],
  'dessert':   ['dessert','chocolate','cake','sweet','fruit tart'],
  'aperitif':  ['apéritif','aperitif','hors','tapas','small plates','snack','canapé'],
};

/** Number of chips whose keyword set hits the product's food_matching (substring, ci). */
export function foodChipMatches(p: PublicProduct, chips: string[] | undefined): number {
  if (!chips?.length || !p.food_matching) return 0;
  const hay = p.food_matching.toLowerCase();
  let n = 0;
  for (const chip of chips) {
    const kws = FOOD_CHIPS[chip];
    if (kws && kws.some((k) => hay.includes(k))) n += 1;
  }
  return n;
}
