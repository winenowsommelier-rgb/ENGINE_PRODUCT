export type FinderCategory =
  | 'red' | 'white' | 'rose' | 'sparkling' | 'whisky' | 'gin' | 'spirits' | 'sake';
export type Budget = 0 | 1 | 2 | 3 | 4;
export type Occasion = 'everyday' | 'food' | 'gift' | 'special' | 'exploring';

export interface Answers {
  category: FinderCategory;   // required
  occasion?: Occasion;
  food?: string[];            // chip keys, e.g. ['red-meat','cheese']
  budget?: Budget;
  axis1?: string;             // category-specific token
  axis2?: string;
  flavorChips?: string[];     // flavor_note_master slugs (≤5)
  acidity?: string;           // deep-dive: sommelier upgrade
  tannin?: string;
  grape?: string;
  age?: string;
  adventure?: string;
  peat?: string;
  tasteFeel?: string;
  serve?: string;            // sake serve preference: chilled | warm | either (TASK B)
}

// RUNTIME guard for decodeAnswers — MUST include every FinderCategory member or that
// category's cat= param silently decodes to undefined (result page redirects). tsc does NOT
// cross-check this array against the union, so 'rose' must be added here by hand.
const CATEGORIES: FinderCategory[] = ['red','white','rose','sparkling','whisky','gin','spirits','sake'];
const OCCASIONS: Occasion[] = ['everyday','food','gift','special','exploring'];

// URL params: cat, occ, food (csv), b (0..4), a1, a2, fl (csv). All optional except cat.
export function encodeAnswers(a: Answers): string {
  const p = new URLSearchParams();
  p.set('cat', a.category);
  if (a.occasion) p.set('occ', a.occasion);
  if (a.food?.length) p.set('food', a.food.join(','));
  if (a.budget != null) p.set('b', String(a.budget));
  if (a.axis1) p.set('a1', a.axis1);
  if (a.axis2) p.set('a2', a.axis2);
  if (a.flavorChips?.length) p.set('fl', a.flavorChips.join(','));
  if (a.acidity) p.set('ac', a.acidity);
  if (a.tannin) p.set('tn', a.tannin);
  if (a.grape) p.set('gr', a.grape);
  if (a.age) p.set('ag', a.age);
  if (a.adventure) p.set('adv', a.adventure);
  if (a.peat) p.set('pt', a.peat);
  if (a.tasteFeel) p.set('tf', a.tasteFeel);
  if (a.serve) p.set('sv', a.serve);
  return p.toString();
}

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function decodeAnswers(sp: URLSearchParams): Answers {
  const cat = sp.get('cat');
  const category = CATEGORIES.includes(cat as FinderCategory) ? (cat as FinderCategory) : undefined;
  const occ = sp.get('occ');
  const occasion = OCCASIONS.includes(occ as Occasion) ? (occ as Occasion) : undefined;
  const bRaw = sp.get('b');
  const bNum = bRaw == null ? NaN : Number(bRaw);
  const budget = Number.isInteger(bNum) && bNum >= 0 && bNum <= 4 ? (bNum as Budget) : undefined;
  return {
    category: category as FinderCategory, // result page guards undefined → redirect
    occasion, food: csv(sp.get('food')), budget,
    axis1: sp.get('a1') ?? undefined, axis2: sp.get('a2') ?? undefined,
    flavorChips: csv(sp.get('fl')),
    acidity: sp.get('ac') ?? undefined, tannin: sp.get('tn') ?? undefined,
    grape: sp.get('gr') ?? undefined, age: sp.get('ag') ?? undefined,
    adventure: sp.get('adv') ?? undefined, peat: sp.get('pt') ?? undefined,
    tasteFeel: sp.get('tf') ?? undefined,
    serve: sp.get('sv') ?? undefined,
  };
}
