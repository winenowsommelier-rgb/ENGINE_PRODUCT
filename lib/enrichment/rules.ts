export type EnrichmentResult = {
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  confidence: number;
  source: 'rules' | 'claude' | 'manual';
  note: string;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BRAND_MAP: Array<{ patterns: string[]; country: string; confidence: number }> = [
  { patterns: ['bacardi', 'havanaclub'], country: 'Cuba', confidence: 0.95 },
  { patterns: ['jackdaniel', 'jimbeam', 'makersmark', 'buffalotrace', 'wildturkey', 'woodfordreserve'], country: 'USA', confidence: 0.95 },
  { patterns: ['johnniewalker', 'glenfiddich', 'macallan', 'chivas', 'laphroaig', 'glenlivet', 'balvenie', 'oban', 'talisker'], country: 'Scotland', confidence: 0.95 },
  { patterns: ['hennessy', 'remymartin', 'courvoisier', 'martell', 'greygoo'], country: 'France', confidence: 0.95 },
  { patterns: ['patron', 'donjulio', 'josecuervo', 'espolon'], country: 'Mexico', confidence: 0.95 },
  { patterns: ['tanqueray', 'gordons', 'beefeater', 'bombaysapphire', 'hendricks'], country: 'England', confidence: 0.90 },
  { patterns: ['absolut'], country: 'Sweden', confidence: 0.95 },
  { patterns: ['smirnoff'], country: 'Russia', confidence: 0.80 },
  { patterns: ['jameson', 'bushmills', 'tullamore'], country: 'Ireland', confidence: 0.95 },
  { patterns: ['yamazaki', 'hakushu', 'nikka', 'hibiki'], country: 'Japan', confidence: 0.95 },
  { patterns: ['coastalridge'], country: 'USA', confidence: 0.85 },
];

type KeywordRule = { keyword: string; country: string; classification: string; confidence: number };
const KEYWORD_MAP: KeywordRule[] = [
  { keyword: 'champagne', country: 'France', classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'prosecco', country: 'Italy', classification: 'Sparkling Wine', confidence: 0.95 },
  { keyword: 'cava', country: 'Spain', classification: 'Sparkling Wine', confidence: 0.90 },
  { keyword: 'bordeaux', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'burgundy', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'bourgogne', country: 'France', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'barolo', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'chianti', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'brunello', country: 'Italy', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'rioja', country: 'Spain', classification: 'Red Wine', confidence: 0.90 },
  { keyword: 'cognac', country: 'France', classification: 'Brandy', confidence: 0.95 },
  { keyword: 'bourbon', country: 'USA', classification: 'Whiskey', confidence: 0.95 },
  { keyword: 'scotch', country: 'Scotland', classification: 'Whisky', confidence: 0.90 },
  { keyword: 'sake', country: 'Japan', classification: 'Rice Wine', confidence: 0.95 },
  { keyword: 'mezcal', country: 'Mexico', classification: 'Mezcal', confidence: 0.95 },
  { keyword: 'cabernetsauvignon', country: '', classification: 'Red Wine', confidence: 0.70 },
  { keyword: 'sauvignonblanc', country: '', classification: 'White Wine', confidence: 0.70 },
  { keyword: 'chardonnay', country: '', classification: 'White Wine', confidence: 0.70 },
  { keyword: 'pinotnoir', country: '', classification: 'Red Wine', confidence: 0.70 },
];

export function enrichWithRules(product: Record<string, any>): EnrichmentResult {
  const name = norm(String(product.name ?? ''));
  const brand = norm(String(product.brand ?? ''));

  // 1. Brand match
  for (const entry of BRAND_MAP) {
    if (entry.patterns.some(p => name.includes(p) || brand.includes(p))) {
      return {
        country: entry.country,
        confidence: entry.confidence,
        source: 'rules',
        note: `Brand match → ${entry.country}`,
      };
    }
  }

  // 2. Keyword match
  for (const rule of KEYWORD_MAP) {
    if (name.includes(rule.keyword)) {
      return {
        country: rule.country || undefined,
        classification: rule.classification,
        confidence: rule.confidence,
        source: 'rules',
        note: `Keyword "${rule.keyword}" → ${rule.classification}`,
      };
    }
  }

  // 3. Category defaults (low confidence)
  const liquorType = norm(String(product.liquor_main_type ?? ''));
  if (liquorType.includes('rum')) {
    return { country: 'Caribbean', confidence: 0.40, source: 'rules', note: 'Default: rum → Caribbean' };
  }
  if (liquorType.includes('whisky') || liquorType.includes('whiskey')) {
    return { confidence: 0.35, source: 'rules', note: 'Default: whisky (country unknown)' };
  }

  return { confidence: 0.20, source: 'rules', note: 'No rule matched' };
}
