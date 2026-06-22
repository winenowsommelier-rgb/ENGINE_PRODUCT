import type { PublicProduct } from '@/lib/types';

export const FOOD_CHIPS: Record<string, { label: string; icon: string; keywords: string[] }> = {
  thai:       { label: 'Thai food',            icon: '🌶️', keywords: ['thai'] },
  sushi:      { label: 'Sushi & sashimi',      icon: '🍣', keywords: ['sushi','sashimi'] },
  dimsum:     { label: 'Dim sum & Chinese',    icon: '🥟', keywords: ['dim sum','chinese'] },
  // korean/vietnamese/spicy: the curated food_matching vocabulary has no literal
  // 'korean'/'vietnamese'/'spicy'/'curry' phrases, so these chips matched nothing
  // (dead chips — see chip-coverage.test.ts). Anchor each to the category that
  // DOES exist in the data: Korean BBQ ⊂ grilled red meat, Vietnamese ⊂ SE-Asian,
  // spicy ⊂ "indian & spiced dishes". Specific terms kept first for future data.
  korean:     { label: 'Korean BBQ',           icon: '🍖', keywords: ['korean','grilled'] },
  vietnamese: { label: 'Vietnamese',           icon: '🍜', keywords: ['vietnamese','southeast asian'] },
  spicy:      { label: 'Spicy dishes',         icon: '🔥', keywords: ['spicy','curry','spiced'] },
  grilled:    { label: 'Grilled & BBQ meat',   icon: '🥩', keywords: ['grilled','bbq','barbecue','steak'] },
  roast:      { label: 'Roast & duck',         icon: '🍗', keywords: ['roast','duck'] },
  lamb:       { label: 'Lamb & game',          icon: '🐑', keywords: ['lamb','game','venison'] },
  pork:       { label: 'Pork dishes',          icon: '🥓', keywords: ['pork'] },
  seafood:    { label: 'Seafood & oysters',    icon: '🦪', keywords: ['seafood','oyster','shellfish','prawn','crab','fish'] },
  cheese:     { label: 'Cheese & charcuterie', icon: '🧀', keywords: ['cheese','charcuterie'] },
  pasta:      { label: 'Pasta & pizza',        icon: '🍝', keywords: ['pasta','pizza','risotto'] },
  salad:      { label: 'Salads & light',       icon: '🥗', keywords: ['salad','vegetable','vegetarian'] },
  dessert:    { label: 'Chocolate & dessert',  icon: '🍫', keywords: ['chocolate','dessert','cake','sweet'] },
};

/** Number of chosen chips whose keyword set hits the product's food_matching (substring, ci). */
export function foodChipMatches(p: PublicProduct, chips: string[] | undefined): number {
  if (!chips?.length || !p.food_matching) return 0;
  const hay = p.food_matching.toLowerCase();
  let n = 0;
  for (const chip of chips) {
    const kws = FOOD_CHIPS[chip]?.keywords;
    if (kws && kws.some((k) => hay.includes(k))) n += 1;
  }
  return n;
}

/**
 * Tokens of food chips that currently match ZERO in-stock products — so the UI can
 * grey them out and make them unselectable instead of leading users to an empty
 * result. A chip going empty is a data state (stock sold out / pairing vocabulary
 * changed), not a code bug; today all chips have matches, but this guards the future.
 * `inStock` should be the in-stock product pool (the caller filters by isInStock).
 */
export function emptyFoodChips(inStock: PublicProduct[]): Set<string> {
  const empty = new Set<string>();
  for (const token of Object.keys(FOOD_CHIPS)) {
    const has = inStock.some((p) => foodChipMatches(p, [token]) > 0);
    if (!has) empty.add(token);
  }
  return empty;
}
