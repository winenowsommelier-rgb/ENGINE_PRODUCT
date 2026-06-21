import type { PublicProduct } from '@/lib/types';

export const FOOD_CHIPS: Record<string, { label: string; icon: string; keywords: string[] }> = {
  thai:       { label: 'Thai food',            icon: '🌶️', keywords: ['thai'] },
  sushi:      { label: 'Sushi & sashimi',      icon: '🍣', keywords: ['sushi','sashimi'] },
  dimsum:     { label: 'Dim sum & Chinese',    icon: '🥟', keywords: ['dim sum','chinese'] },
  korean:     { label: 'Korean BBQ',           icon: '🍖', keywords: ['korean'] },
  vietnamese: { label: 'Vietnamese',           icon: '🍜', keywords: ['vietnamese'] },
  spicy:      { label: 'Spicy dishes',         icon: '🔥', keywords: ['spicy','curry'] },
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

/**
 * Number of chosen chips whose keyword set hits the product (substring, ci).
 *
 * Matches against BOTH food_matching (broad display categories, e.g. "Thai &
 * Southeast Asian") AND food_matching_detail (the original specific dishes/
 * cuisines, e.g. "Vietnamese cuisine", "Spicy tteokbokki", "Korean BBQ
 * samgyeopsal"). The 2026-06-21 category remap collapsed cuisine granularity
 * out of food_matching, which silently killed the korean/vietnamese/spicy
 * chips — detail preserves that granularity so the finder stays precise.
 */
export function foodChipMatches(p: PublicProduct, chips: string[] | undefined): number {
  if (!chips?.length) return 0;
  const hay = `${p.food_matching ?? ''} ${p.food_matching_detail ?? ''}`.toLowerCase();
  if (!hay.trim()) return 0;
  let n = 0;
  for (const chip of chips) {
    const kws = FOOD_CHIPS[chip]?.keywords;
    if (kws && kws.some((k) => hay.includes(k))) n += 1;
  }
  return n;
}
