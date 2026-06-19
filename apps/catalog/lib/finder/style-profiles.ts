import type { Answers, FinderCategory } from './answers';

/**
 * Curated "style-profile first" archetype library. A finder run resolves to ONE
 * archetype expressed in a knowledgeable sommelier/spirits-expert voice. Pure
 * data + a pure resolver — no I/O, no React.
 */
export interface StyleProfile {
  id: string;
  category: FinderCategory;
  name: string;
  tagline: string;
  expertNote: string;
  definingAttributes: {
    body?: string;
    acidity?: string;
    tannin?: string;
    typicalGrapes?: string[];
    typicalRegions?: string[];
  };
  foodGuidance: string;
  occasionFit: string[];
  /** Deterministic; higher = better fit; 0 = no signal for this answer set. */
  match: (a: Answers) => number;
}

export const STYLE_PROFILES: StyleProfile[] = [
  // ─── RED (axis1: light | medium | bold ; axis2: fruity | earthy | balanced) ───
  {
    id: 'bright-elegant-red',
    category: 'red',
    name: 'The Bright & Elegant Red',
    tagline: 'Light-bodied, perfumed, and food-friendly.',
    expertNote:
      'These are reds built on finesse rather than power, with high acidity and gentle tannins that keep them lively on the palate. Expect red-berry and floral aromatics with an earthy undertone. They reward a slight chill and pair across a wide table.',
    definingAttributes: {
      body: 'Light',
      acidity: 'High',
      tannin: 'Low',
      typicalGrapes: ['Pinot Noir', 'Gamay'],
      typicalRegions: ['Burgundy', 'Beaujolais', 'Central Otago'],
    },
    foodGuidance: 'Roast chicken, mushroom dishes, charcuterie, salmon',
    occasionFit: ['food', 'everyday'],
    match: (a) =>
      a.category === 'red'
        ? (a.axis1 === 'light' ? 3 : 0) + (a.axis2 === 'earthy' ? 1 : 0)
        : 0,
  },
  {
    id: 'supple-everyday-red',
    category: 'red',
    name: 'The Supple Everyday Red',
    tagline: 'Medium-bodied, juicy, and easy to love.',
    expertNote:
      'A versatile middle-weight: ripe fruit, moderate tannin, and enough structure to stand up to a meal without dominating it. This is the reliable house red — generous on the nose and smooth through the finish. It flatters more dishes than almost any other style.',
    definingAttributes: {
      body: 'Medium',
      acidity: 'Medium',
      tannin: 'Medium',
      typicalGrapes: ['Merlot', 'Sangiovese', 'Grenache'],
      typicalRegions: ['Tuscany', 'Côtes du Rhône', 'Rioja'],
    },
    foodGuidance: 'Pasta with tomato sauce, pizza, grilled vegetables, burgers',
    occasionFit: ['everyday', 'food'],
    match: (a) =>
      a.category === 'red'
        ? (a.axis1 === 'medium' ? 3 : 0) + (a.axis2 === 'fruity' ? 1 : 0)
        : 0,
  },
  {
    id: 'bold-structured-red',
    category: 'red',
    name: 'The Bold & Structured Red',
    tagline: 'Full-bodied, powerful, and built to age.',
    expertNote:
      'This is wine with shoulders: full body, firm tannin, and concentrated dark-fruit and savoury character. The grip on the finish is the point — it carves through rich, fatty food and softens beautifully with a few years in the cellar. Decant it and give it air.',
    definingAttributes: {
      body: 'Full',
      acidity: 'Medium',
      tannin: 'Medium-High',
      typicalGrapes: ['Cabernet Sauvignon', 'Syrah'],
      typicalRegions: ['Bordeaux', 'Napa Valley', 'Barossa'],
    },
    foodGuidance: 'Red meat, aged hard cheese, venison, slow-braised dishes',
    occasionFit: ['food', 'special'],
    match: (a) =>
      a.category === 'red'
        ? (a.axis1 === 'bold' ? 3 : 0) + (a.axis2 === 'earthy' ? 1 : 0)
        : 0,
  },

  // ─── WHITE (axis1: light | medium | bold ; axis2: fruity | earthy | balanced) ───
  {
    id: 'crisp-zesty-white',
    category: 'white',
    name: 'The Crisp & Zesty White',
    tagline: 'Light, bright, and bracingly fresh.',
    expertNote:
      'Lean, high-acid whites that lead with citrus, green apple, and a clean mineral edge. There is no oak getting in the way — just energy and cut. Serve them well chilled; they are the classic aperitif and a natural with anything from the sea.',
    definingAttributes: {
      body: 'Light',
      acidity: 'High',
      typicalGrapes: ['Sauvignon Blanc', 'Pinot Grigio', 'Albariño'],
      typicalRegions: ['Marlborough', 'Loire Valley', 'Rías Baixas'],
    },
    foodGuidance: 'Oysters, ceviche, goat cheese, green salads, grilled fish',
    occasionFit: ['everyday', 'food'],
    match: (a) =>
      a.category === 'white'
        ? (a.axis1 === 'light' ? 3 : 0) + (a.axis2 === 'fruity' ? 1 : 0)
        : 0,
  },
  {
    id: 'aromatic-balanced-white',
    category: 'white',
    name: 'The Aromatic & Balanced White',
    tagline: 'Medium-bodied, fragrant, and versatile.',
    expertNote:
      'Whites that balance ripe stone fruit and floral perfume against a clean line of acidity. There is texture here without heaviness, which makes them remarkably adaptable at the table. They bridge the gap between crisp and rich beautifully.',
    definingAttributes: {
      body: 'Medium',
      acidity: 'Medium',
      typicalGrapes: ['Riesling', 'Chenin Blanc', 'Viognier'],
      typicalRegions: ['Mosel', 'Alsace', 'Loire Valley'],
    },
    foodGuidance: 'Roast pork, Thai and Indian curries, charcuterie, soft cheese',
    occasionFit: ['food', 'everyday'],
    match: (a) =>
      a.category === 'white'
        ? (a.axis1 === 'medium' ? 3 : 0) + (a.axis2 === 'balanced' ? 1 : 0)
        : 0,
  },
  {
    id: 'rich-textured-white',
    category: 'white',
    name: 'The Rich & Textured White',
    tagline: 'Full-bodied, creamy, and gently oaked.',
    expertNote:
      'These are the broad, mouth-filling whites — barrel-fermented, often with a touch of lees character that lends a creamy, nutty depth. Acidity holds the weight in balance so it never turns flabby. Treat them almost like a white wine with the presence of a red.',
    definingAttributes: {
      body: 'Full',
      acidity: 'Medium',
      typicalGrapes: ['Chardonnay', 'Marsanne', 'Roussanne'],
      typicalRegions: ['Burgundy', 'Napa Valley', 'Margaret River'],
    },
    foodGuidance: 'Lobster, roast chicken, creamy pasta, soft-rind cheese',
    occasionFit: ['food', 'special'],
    match: (a) =>
      a.category === 'white'
        ? (a.axis1 === 'bold' ? 3 : 0) + (a.axis2 === 'earthy' ? 1 : 0)
        : 0,
  },

  // ─── SPARKLING (axis1: light | medium | bold) ───
  {
    id: 'fresh-festive-sparkling',
    category: 'sparkling',
    name: 'The Fresh & Festive Sparkler',
    tagline: 'Light, fruity, and made for a toast.',
    expertNote:
      'Approachable bubbles built on bright orchard fruit and a soft, frothy mousse. These are joyful rather than serious — low on autolytic complexity, high on easy charm. Pour them cold as an aperitif or alongside something sweet.',
    definingAttributes: {
      body: 'Light',
      acidity: 'High',
      typicalGrapes: ['Glera', 'Moscato'],
      typicalRegions: ['Prosecco DOC', 'Asti', 'Veneto'],
    },
    foodGuidance: 'Canapés, fresh fruit, light desserts, brunch',
    occasionFit: ['everyday', 'gift'],
    match: (a) =>
      a.category === 'sparkling'
        ? a.axis1 === 'light' || a.axis1 === 'medium'
          ? 3
          : 0
        : 0,
  },
  {
    id: 'fine-traditional-sparkling',
    category: 'sparkling',
    name: 'The Fine Traditional-Method Sparkler',
    tagline: 'Full-bodied, complex, and built on autolysis.',
    expertNote:
      'Bottle-fermented sparkling wine with a fine, persistent bead and the toasty, brioche-like depth that only extended lees ageing delivers. Racy acidity keeps it precise from first sip to long finish. This is the benchmark for celebration and serious dining alike.',
    definingAttributes: {
      body: 'Full',
      acidity: 'High',
      typicalGrapes: ['Chardonnay', 'Pinot Noir', 'Pinot Meunier'],
      typicalRegions: ['Champagne', 'Franciacorta', 'Tasmania'],
    },
    foodGuidance: 'Oysters, fried chicken, hard cheese, smoked salmon',
    occasionFit: ['special', 'gift'],
    match: (a) =>
      a.category === 'sparkling' ? (a.axis1 === 'bold' ? 3 : 0) : 0,
  },

  // ─── WHISKY (axis1: origin scotch|japanese|bourbon|irish|world ; axis2: smoky|smooth) ───
  {
    id: 'peated-coastal-whisky',
    category: 'whisky',
    name: 'The Peated & Coastal Whisky',
    tagline: 'Smoky, maritime, and unmistakably Scottish.',
    expertNote:
      'Single malts shaped by peat smoke and sea air — think bonfire, iodine, and brine over a malty core. The intensity is divisive by design and rewards slow sipping with a few drops of water. This is the most evocative style in the whisky world.',
    definingAttributes: {
      typicalRegions: ['Islay', 'Campbeltown', 'Islands'],
    },
    foodGuidance: 'Smoked salmon, oysters, blue cheese, dark chocolate',
    occasionFit: ['special', 'exploring'],
    match: (a) =>
      a.category === 'whisky'
        ? (a.axis1 === 'scotch' ? 3 : 0) + (a.axis2 === 'smoky' ? 2 : 0)
        : 0,
  },
  {
    id: 'refined-japanese-whisky',
    category: 'whisky',
    name: 'The Refined Japanese Whisky',
    tagline: 'Delicate, precise, and harmoniously balanced.',
    expertNote:
      'Whisky made in the pursuit of balance and clarity, with restrained smoke, gentle orchard fruit, and a clean, almost crystalline finish. The hallmark is precision — nothing out of place. Reach for it when you want elegance over force.',
    definingAttributes: {
      typicalRegions: ['Japan'],
    },
    foodGuidance: 'Sushi, grilled yakitori, tempura, light desserts',
    occasionFit: ['special', 'gift'],
    match: (a) =>
      a.category === 'whisky'
        ? (a.axis1 === 'japanese' ? 3 : 0) + (a.axis2 === 'smooth' ? 1 : 0)
        : 0,
  },
  {
    id: 'sweet-bold-bourbon',
    category: 'whisky',
    name: 'The Sweet & Bold Bourbon',
    tagline: 'Rich, sweet, and built on new oak.',
    expertNote:
      'American whiskey driven by a high-corn mash bill and aggressive new-charred-oak ageing, giving vanilla, caramel, and baking-spice sweetness with a warming kick. It is generous and unsubtle in the best way. Excellent neat, over a single large cube, or as the backbone of a cocktail.',
    definingAttributes: {
      typicalRegions: ['Kentucky', 'Tennessee'],
    },
    foodGuidance: 'Barbecue, pecan pie, grilled steak, dark chocolate',
    occasionFit: ['everyday', 'food'],
    match: (a) =>
      a.category === 'whisky'
        ? (a.axis1 === 'bourbon' ? 3 : 0) + (a.axis2 === 'smooth' ? 1 : 0)
        : 0,
  },
  {
    id: 'smooth-irish-whiskey',
    category: 'whisky',
    name: 'The Smooth Irish Whiskey',
    tagline: 'Light, approachable, and triple-distilled.',
    expertNote:
      'Triple distillation gives Irish whiskey its signature smoothness — soft, light, and easy-drinking with notes of honey, green apple, and gentle malt. There is rarely any peat to negotiate. It is the most forgiving entry point in the whisky world.',
    definingAttributes: {
      typicalRegions: ['Ireland'],
    },
    foodGuidance: 'Soda bread, mild cheese, apple desserts, coffee',
    occasionFit: ['everyday', 'gift'],
    match: (a) =>
      a.category === 'whisky'
        ? (a.axis1 === 'irish' ? 3 : 0) +
          (a.axis1 === 'world' ? 3 : 0) +
          (a.axis2 === 'smooth' ? 1 : 0)
        : 0,
  },

  // ─── GIN (axis1: classic | contemporary) ───
  {
    id: 'classic-juniper-gin',
    category: 'gin',
    name: 'The Classic London Dry Gin',
    tagline: 'Juniper-forward, crisp, and bracingly dry.',
    expertNote:
      'The benchmark style — juniper leads, backed by citrus peel and a structured spine of coriander and angelica root. It is clean, dry, and uncompromising, which is exactly why it makes a textbook Martini and the definitive Gin & Tonic.',
    definingAttributes: {
      typicalRegions: ['England'],
    },
    foodGuidance: 'Classic Martini, Gin & Tonic, oysters, smoked salmon',
    occasionFit: ['everyday', 'food'],
    match: (a) =>
      a.category === 'gin' ? (a.axis1 === 'classic' ? 3 : 0) : 0,
  },
  {
    id: 'contemporary-botanical-gin',
    category: 'gin',
    name: 'The Contemporary Botanical Gin',
    tagline: 'Floral, citrus-led, and softer on the juniper.',
    expertNote:
      'A modern, new-wave style that dials back the juniper to spotlight floral, citrus, and exotic botanicals. The result is more aromatic and approachable, opening gin up to a wider range of mixers and lighter serves. Ideal for the curious drinker.',
    definingAttributes: {
      typicalRegions: ['Worldwide'],
    },
    foodGuidance: 'Citrus tonic serves, ceviche, herb salads, light seafood',
    occasionFit: ['exploring', 'everyday'],
    match: (a) =>
      a.category === 'gin' ? (a.axis1 === 'contemporary' ? 3 : 0) : 0,
  },

  // ─── SPIRITS (axis1: type vodka|rum|tequila|brandy|other) ───
  {
    id: 'clean-versatile-vodka',
    category: 'spirits',
    name: 'The Clean & Versatile Vodka',
    tagline: 'Neutral, smooth, and endlessly mixable.',
    expertNote:
      'Distilled for purity and a clean, near-neutral profile, the best vodkas show subtle texture and a soft, rounded mouthfeel rather than aggressive heat. That blank canvas is the strength — it disappears into cocktails and lets other ingredients shine. Serve it ice-cold.',
    definingAttributes: {
      typicalRegions: ['Poland', 'Russia', 'France'],
    },
    foodGuidance: 'Caviar, smoked fish, pickles, citrus cocktails',
    occasionFit: ['everyday', 'food'],
    match: (a) =>
      a.category === 'spirits'
        ? a.axis1 === 'vodka' || a.axis1 === 'other'
          ? 3
          : 0
        : 0,
  },
  {
    id: 'warm-aged-spirit',
    category: 'spirits',
    name: 'The Warm Aged Spirit',
    tagline: 'Barrel-aged, rich, and made for slow sipping.',
    expertNote:
      'Spirits that take their character from time in oak — molasses-sweet rum, agave-driven aged tequila, or grape-based brandy — sharing notes of caramel, dried fruit, and warm spice. They reward sipping neat far more than vodka ever does. This is the after-dinner end of the spirits shelf.',
    definingAttributes: {
      typicalRegions: ['Caribbean', 'Jalisco', 'Cognac'],
    },
    foodGuidance: 'Dark chocolate, dried fruit, aged cheese, coffee',
    occasionFit: ['special', 'food'],
    match: (a) =>
      a.category === 'spirits'
        ? a.axis1 === 'rum' || a.axis1 === 'tequila' || a.axis1 === 'brandy'
          ? 3
          : 0
        : 0,
  },

  // ─── SAKE (axis1: dry | sweet | any) ───
  {
    id: 'crisp-dry-sake',
    category: 'sake',
    name: 'The Crisp & Dry Sake',
    tagline: 'Clean, savoury, and food-driven.',
    expertNote:
      'Drier sake (a higher nihonshu-do) leans savoury and umami, with a clean, slightly mineral finish that refreshes the palate between bites. There is restraint here rather than overt sweetness. Serve it chilled to keep that crisp edge sharp.',
    definingAttributes: {
      typicalRegions: ['Niigata', 'Akita'],
    },
    foodGuidance: 'Sashimi, grilled fish, tempura, light izakaya plates',
    occasionFit: ['food', 'everyday'],
    match: (a) =>
      a.category === 'sake'
        ? a.axis1 === 'dry' || a.axis1 === 'any'
          ? 3
          : 0
        : 0,
  },
  {
    id: 'fragrant-sweet-sake',
    category: 'sake',
    name: 'The Fragrant & Fruity Sake',
    tagline: 'Aromatic, gently sweet, and approachable.',
    expertNote:
      'Highly polished sake — often ginjo or daiginjo grade — that bursts with melon, banana, and floral aromatics over a soft, gently sweet body. It is the most immediately charming style and an easy introduction for the newcomer. Serve well chilled to lift the perfume.',
    definingAttributes: {
      typicalRegions: ['Yamagata', 'Hyogo'],
    },
    foodGuidance: 'Fresh fruit, mild cheese, ceviche, light desserts',
    occasionFit: ['exploring', 'gift'],
    match: (a) =>
      a.category === 'sake' ? (a.axis1 === 'sweet' ? 3 : 0) : 0,
  },
];

/**
 * Highest-scoring archetype for the answers' category. Never null for a valid
 * category: if nothing scores (top score is 0), return that category's first
 * archetype as a sensible default. Ties are broken by array order (first wins),
 * keeping the resolution deterministic.
 */
export function resolveProfile(a: Answers): StyleProfile | null {
  const inCategory = STYLE_PROFILES.filter((p) => p.category === a.category);
  if (inCategory.length === 0) return null;

  let best = inCategory[0];
  let bestScore = best.match(a);
  for (let i = 1; i < inCategory.length; i++) {
    const score = inCategory[i].match(a);
    if (score > bestScore) {
      best = inCategory[i];
      bestScore = score;
    }
  }
  // If nothing produced a positive signal, fall back to the first archetype.
  return best;
}
