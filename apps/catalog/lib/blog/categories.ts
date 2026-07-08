export type DrinkSlug = 'wine' | 'whisky' | 'spirits' | 'sake'
export type PurposeSlug = 'guides' | 'pairings' | 'deep-dives' | 'curated' | 'comparisons' | 'gifting'
export type CategorySlug = DrinkSlug | PurposeSlug

export const DRINK_SLUGS: DrinkSlug[] = ['wine', 'whisky', 'spirits', 'sake']
export const PURPOSE_SLUGS: PurposeSlug[] = ['guides', 'pairings', 'deep-dives', 'curated', 'comparisons', 'gifting']

export const CATEGORY_META: Record<CategorySlug, { label: string; description: string; icon: string }> = {
  wine:         { label: 'Wine',             icon: '🍷', description: 'Red, white, rosé, sparkling — from Bordeaux to Bangkok dinner tables' },
  whisky:       { label: 'Whisky',           icon: '🥃', description: "What's worth buying in Bangkok right now" },
  spirits:      { label: 'Spirits',          icon: '🍸', description: 'Gin, tequila, mezcal, rum — the Bangkok bar shelf decoded' },
  sake:         { label: 'Sake & Japanese',  icon: '🍶', description: "Sake grades, food pairings, and what to order at Bangkok's Japanese restaurants" },
  guides:       { label: 'Guides',           icon: '📖', description: 'Practical knowledge for buying, storing, and serving' },
  pairings:     { label: 'Pairings',         icon: '🍽️', description: 'What to drink with Thai food and beyond' },
  'deep-dives': { label: 'Deep Dives',       icon: '🔬', description: 'In-depth explorations of regions, grapes, and styles' },
  curated:      { label: 'Curated Lists',    icon: '✨', description: 'Handpicked selections for every occasion and budget' },
  comparisons:  { label: 'Comparisons',      icon: '⚖️', description: 'Side-by-side breakdowns to help you choose' },
  gifting:      { label: 'Gifting & Events', icon: '🎁', description: 'Perfect bottles for gifts, celebrations, and events' },
}

// Static sub-tags shown on hero tiles — editorial hints only, not computed from post data
export const DRINK_CATEGORY_SUBTAGS: Record<DrinkSlug, string[]> = {
  wine:    ['France', 'Italy', 'New World', 'Sparkling'],
  whisky:  ['Scotch', 'Japanese', 'Bourbon'],
  spirits: ['Gin', 'Tequila', 'Rum', 'Vodka'],
  sake:    ['Sake', 'Shochu', 'Japanese Whisky'],
}

export const DRINK_TAG_MAP: Record<string, DrinkSlug> = {
  // wine — varietals and regions
  'wine': 'wine', 'red-wine': 'wine', 'white-wine': 'wine',
  'rosé': 'wine', 'rose': 'wine',
  'sparkling': 'wine', 'champagne': 'wine', 'prosecco': 'wine',
  'chardonnay': 'wine', 'sauvignon-blanc': 'wine', 'pinot-noir': 'wine',
  'cabernet-sauvignon': 'wine', 'merlot': 'wine', 'malbec': 'wine', 'carmenere': 'wine',
  'shiraz': 'wine', 'syrah': 'wine', 'grenache': 'wine', 'nebbiolo': 'wine',
  'barolo': 'wine', 'burgundy': 'wine', 'bordeaux': 'wine',
  'tuscany': 'wine', 'chianti': 'wine', 'brunello': 'wine',
  'rhone-valley': 'wine', 'piedmont': 'wine',
  'marlborough': 'wine', 'new-zealand': 'wine',
  'france': 'wine', 'italy': 'wine', 'spain': 'wine', 'australia': 'wine',
  // whisky
  'whisky': 'whisky', 'whiskey': 'whisky', 'scotch': 'whisky',
  'japanese-whisky': 'whisky', 'speyside': 'whisky', 'islay': 'whisky', 'scotland': 'whisky',
  // spirits
  'spirits': 'spirits', 'gin': 'spirits', 'tequila': 'spirits',
  'mezcal': 'spirits', 'rum': 'spirits', 'vodka': 'spirits',
  'cocktails': 'spirits', 'mexico': 'spirits',
  // sake / japanese
  'sake': 'sake', 'shochu': 'sake', 'japanese-food': 'sake',
  'japan': 'sake', 'sushi': 'sake',
}

export const PURPOSE_TAG_MAP: Record<string, PurposeSlug> = {
  'guide': 'guides',
  'pairing': 'pairings', 'thai-food': 'pairings',
  'deep-dive': 'deep-dives',
  'compare': 'comparisons',
  'curated': 'curated', 'collection': 'curated',
  'gifting': 'gifting', 'event': 'gifting', 'celebration': 'gifting',
}

export function getDrinkSlugForPost(tagSlugs: string[]): DrinkSlug | null {
  for (const t of tagSlugs) {
    if (DRINK_TAG_MAP[t]) return DRINK_TAG_MAP[t];
  }
  return null;
}

export function getPurposeSlugForPost(tagSlugs: string[]): PurposeSlug | null {
  for (const t of tagSlugs) {
    if (PURPOSE_TAG_MAP[t]) return PURPOSE_TAG_MAP[t];
  }
  return null;
}
