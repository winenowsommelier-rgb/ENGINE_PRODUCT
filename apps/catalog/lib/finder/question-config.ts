import type { FinderCategory } from './answers';

export type StepField =
  | 'occasion'
  | 'budget'
  | 'axis1'
  | 'axis2'
  | 'flavorChips'
  | 'food'
  // Plain-language taste-feel step (Layer-1, no jargon). Resolves to an archetype
  // via taste-feel.ts; replaces the body/character axis1/axis2 questions for red & white.
  | 'tasteFeel'
  // ── Opt-in sommelier deep-dive fields (separate from the core flow) ──
  | 'acidity'
  | 'tannin'
  | 'grape'
  | 'age'
  | 'adventure'
  | 'peat';

export interface StepOption {
  token: string;
  label: string;
  icon?: string;
}

export interface QuestionStep {
  id: string; // unique within the category, e.g. 'occasion','budget','body','character',…
  field: StepField; // which Answers field this writes
  title: string; // question shown to the user
  options: StepOption[]; // selectable options
  multi?: boolean; // true for flavor chips (writes string[])
  optional?: boolean; // true for taste steps → UI shows "No preference / Skip"
}

// ── Shared steps (every category, in this order after category is chosen) ──
const OCCASION_STEP: QuestionStep = {
  id: 'occasion',
  field: 'occasion',
  title: "What's the occasion?",
  options: [
    { token: 'everyday', label: 'Everyday', icon: '🥂' },
    { token: 'food', label: 'With food', icon: '🍽️' },
    { token: 'gift', label: 'A gift', icon: '🎁' },
    { token: 'special', label: 'Special / cellar', icon: '✨' },
    { token: 'exploring', label: 'Just exploring', icon: '🧭' },
  ],
};

const BUDGET_STEP: QuestionStep = {
  id: 'budget',
  field: 'budget',
  title: "What's your budget?",
  options: [
    { token: '0', label: 'Under ฿1,000', icon: '🪙' },
    { token: '1', label: '฿1,000–3,000', icon: '💵' },
    { token: '2', label: '฿3,000–7,000', icon: '💳' },
    { token: '3', label: '฿7,000–15,000', icon: '💎' },
    { token: '4', label: '฿15,000+', icon: '👑' },
  ],
};

// ── Wine taste steps (red, white, sparkling) ──
const WINE_BODY_STEP: QuestionStep = {
  id: 'body',
  field: 'axis1',
  title: 'How full-bodied do you like it?',
  optional: true,
  options: [
    { token: 'light', label: 'Light & easy', icon: '🪶' },
    { token: 'medium', label: 'Medium-bodied', icon: '⚖️' },
    { token: 'bold', label: 'Bold & full', icon: '🍷' },
  ],
};

const WINE_CHARACTER_STEP: QuestionStep = {
  id: 'character',
  field: 'axis2',
  title: 'What character do you prefer?',
  optional: true,
  options: [
    { token: 'fruity', label: 'Fruit-forward', icon: '🍓' },
    { token: 'earthy', label: 'Earthy & savory', icon: '🍂' },
    { token: 'balanced', label: 'Balanced', icon: '⚖️' },
  ],
};

// ── Plain-language taste-feel steps (Layer-1, no jargon). One per wine colour. ──
// These REPLACE the body/character axis1/axis2 questions for red & white: a single
// approachable question whose token resolves to an archetype (taste-feel.ts), rather
// than asking the shopper about "body" and "character" in sommelier terms.
const RED_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'How do you like your reds?',
  optional: true,
  options: [
    { token: 'light', label: 'Light & delicate', icon: '🪶' },
    { token: 'smooth', label: 'Smooth & easygoing', icon: '🍷' },
    { token: 'bold', label: 'Bold & rich', icon: '🔥' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// White plain-language taste-feel step. Acidity-led framing (crisp/rounded/aromatic),
// NOT sweetness — matches the acidity-primary scoring in scoring.ts.
const WHITE_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'What sounds good?',
  optional: true,
  options: [
    { token: 'crisp', label: 'Crisp & refreshing', icon: '⚡' },
    { token: 'rounded', label: 'Smooth & rounded', icon: '🫧' },
    { token: 'aromatic', label: 'Aromatic & floral', icon: '🌸' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// ── Flavor step (red, white, sparkling, whisky) ──
const FLAVOR_STEP: QuestionStep = {
  id: 'flavor',
  field: 'flavorChips',
  title: 'Any flavors you love? (pick a few)',
  multi: true,
  optional: true,
  // Tokens MUST equal the FLAVOR_FAMILY keys in scoring.ts — chips that don't map
  // to a family score nothing. (Retired the old `earth`/`vanilla` tokens, which
  // never matched any FLAVOR_FAMILY key.)
  options: [
    { token: 'red-fruit', label: 'Red fruit', icon: '🍒' },
    { token: 'dark-fruit', label: 'Dark fruit', icon: '🫐' },
    { token: 'citrus', label: 'Citrus', icon: '🍋' },
    { token: 'stone-fruit', label: 'Stone & orchard fruit', icon: '🍑' },
    { token: 'tropical', label: 'Tropical', icon: '🍍' },
    { token: 'oak', label: 'Oak & vanilla', icon: '🪵' },
    { token: 'spice', label: 'Spice', icon: '🌶️' },
    { token: 'earthy', label: 'Earthy & savory', icon: '🍂' },
    { token: 'floral', label: 'Floral', icon: '🌸' },
    { token: 'mineral', label: 'Mineral & saline', icon: '🪨' },
    { token: 'smoky', label: 'Smoky', icon: '💨' },
    { token: 'nutty', label: 'Nutty & creamy', icon: '🥜' },
  ],
};

// ── Whisky taste steps ──
const WHISKY_ORIGIN_STEP: QuestionStep = {
  id: 'origin',
  field: 'axis1',
  title: 'Where should it come from?',
  optional: true,
  options: [
    { token: 'scotch', label: 'Scotch', icon: '🏴' },
    { token: 'japanese', label: 'Japanese', icon: '🇯🇵' },
    { token: 'bourbon', label: 'Bourbon / American', icon: '🥃' },
    { token: 'irish', label: 'Irish', icon: '☘️' },
    { token: 'world', label: 'World / other', icon: '🌍' },
  ],
};

const WHISKY_STYLE_STEP: QuestionStep = {
  id: 'style',
  field: 'axis2',
  title: 'What style do you prefer?',
  optional: true,
  options: [
    { token: 'smoky', label: 'Smoky & peaty', icon: '💨' },
    { token: 'smooth', label: 'Smooth & mellow', icon: '🥃' },
  ],
};

// ── Gin taste step (axis1 only) ──
const GIN_STYLE_STEP: QuestionStep = {
  id: 'style',
  field: 'axis1',
  title: 'Classic or contemporary?',
  optional: true,
  options: [
    { token: 'classic', label: 'Classic / London Dry', icon: '🍸' },
    { token: 'contemporary', label: 'Contemporary / botanical', icon: '🌿' },
  ],
};

// ── Spirits (other) taste step (axis1 = type) ──
const SPIRITS_TYPE_STEP: QuestionStep = {
  id: 'type',
  field: 'axis1',
  title: 'What kind of spirit?',
  optional: true,
  options: [
    { token: 'vodka', label: 'Vodka', icon: '🍸' },
    { token: 'rum', label: 'Rum', icon: '🥃' },
    { token: 'tequila', label: 'Tequila / mezcal', icon: '🌵' },
    { token: 'brandy', label: 'Brandy / cognac', icon: '🍷' },
    { token: 'other', label: 'Something else', icon: '✨' },
  ],
};

// ── Sake & Asian taste step (axis1 = sweetness) ──
const SAKE_SWEETNESS_STEP: QuestionStep = {
  id: 'sweetness',
  field: 'axis1',
  title: 'Dry or sweet?',
  optional: true,
  options: [
    { token: 'dry', label: 'Dry', icon: '🍶' },
    { token: 'sweet', label: 'Sweet / fruity', icon: '🍯' },
    { token: 'any', label: 'No preference', icon: '🤷' },
  ],
};

const WINE_STEPS: QuestionStep[] = [
  OCCASION_STEP,
  BUDGET_STEP,
  WINE_BODY_STEP,
  WINE_CHARACTER_STEP,
  FLAVOR_STEP,
];

export const QUESTION_CONFIG: Record<FinderCategory, QuestionStep[]> = {
  // Red Layer-1 is plain-language: occasion → budget → taste-feel → flavor. No body/
  // character jargon. (Food is an inline FoodChoice sub-step, not a config step.)
  red: [OCCASION_STEP, BUDGET_STEP, RED_FEEL_STEP, FLAVOR_STEP],
  // White Layer-1 is plain-language too: occasion → budget → taste-feel (acidity-led) →
  // flavor. (sparkling still uses the body/character axes.)
  white: [OCCASION_STEP, BUDGET_STEP, WHITE_FEEL_STEP, FLAVOR_STEP],
  sparkling: WINE_STEPS,
  whisky: [OCCASION_STEP, BUDGET_STEP, WHISKY_ORIGIN_STEP, WHISKY_STYLE_STEP, FLAVOR_STEP],
  gin: [OCCASION_STEP, BUDGET_STEP, GIN_STYLE_STEP],
  spirits: [OCCASION_STEP, BUDGET_STEP, SPIRITS_TYPE_STEP],
  sake: [OCCASION_STEP, BUDGET_STEP, SAKE_SWEETNESS_STEP],
};

/** Ordered steps for a category (after Step 1 category selection). */
export function stepsFor(category: FinderCategory): QuestionStep[] {
  return QUESTION_CONFIG[category];
}

// ─────────────────────────────────────────────────────────────────────────
// Opt-in "deep dive" (sommelier branch)
//
// These steps are SEPARATE from the core flow above. They are surfaced only
// when the user explicitly asks to go deeper, and every step is `optional`
// (the UI offers "No preference / Skip"). Tokens here MUST match what
// lib/finder/scoring.ts reads, or the extra answers score nothing.
// ─────────────────────────────────────────────────────────────────────────

// Wine — acidity (scoring tokens: crisp | balanced | soft)
const WINE_ACIDITY_STEP: QuestionStep = {
  id: 'acidity',
  field: 'acidity',
  title: 'How should it feel in your mouth?',
  optional: true,
  options: [
    { token: 'crisp', label: 'Crisp & refreshing', icon: '⚡' },
    { token: 'balanced', label: 'Balanced', icon: '⚖️' },
    { token: 'soft', label: 'Soft & round', icon: '🫧' },
  ],
};

// Wine (red only) — tannin (scoring tokens: firm | silky | any)
const WINE_TANNIN_STEP: QuestionStep = {
  id: 'tannin',
  field: 'tannin',
  title: 'How much grip and structure do you like?',
  optional: true,
  options: [
    { token: 'firm', label: 'Firm & gripping', icon: '🧱' },
    { token: 'silky', label: 'Silky & smooth', icon: '🪶' },
    { token: 'any', label: 'No preference', icon: '🤷' },
  ],
};

// Wine — grape family. The options MUST be category-appropriate (W5 fix): a white-wine
// deep-dive must NOT offer red grapes. Three variants, one per wine colour; every token
// maps to a GRAPE_FAMILY key in scoring.ts (else it scores nothing) and to real in-stock
// `variety` values (counts verified against the live export).

// RED grapes (scoring tokens: cabernet | pinot-noir | syrah-shiraz | sangiovese |
// tempranillo | merlot | grenache | surprise)
const WINE_GRAPE_RED_STEP: QuestionStep = {
  id: 'grape',
  field: 'grape',
  title: 'Is there a grape you gravitate toward?',
  optional: true,
  options: [
    { token: 'cabernet', label: 'Cabernet Sauvignon', icon: '🍇' },
    { token: 'pinot-noir', label: 'Pinot Noir', icon: '🍒' },
    { token: 'syrah-shiraz', label: 'Syrah / Shiraz', icon: '🌶️' },
    { token: 'sangiovese', label: 'Sangiovese', icon: '🍅' },
    { token: 'tempranillo', label: 'Tempranillo', icon: '🪵' },
    { token: 'merlot', label: 'Merlot', icon: '🫐' },
    { token: 'grenache', label: 'Grenache', icon: '🍓' },
    { token: 'surprise', label: 'Surprise me', icon: '🎲' },
  ],
};

// WHITE grapes (scoring tokens: chardonnay | sauv-blanc | riesling | pinot-grigio |
// viognier | semillon | surprise). Counts in live export: chardonnay 316, sauv-blanc 186,
// riesling 55, pinot-grigio 36, viognier 17, semillon 14.
const WINE_GRAPE_WHITE_STEP: QuestionStep = {
  id: 'grape',
  field: 'grape',
  title: 'Is there a grape you gravitate toward?',
  optional: true,
  options: [
    { token: 'chardonnay', label: 'Chardonnay', icon: '🍐' },
    { token: 'sauv-blanc', label: 'Sauvignon Blanc', icon: '🌿' },
    { token: 'riesling', label: 'Riesling', icon: '🍏' },
    { token: 'pinot-grigio', label: 'Pinot Grigio / Gris', icon: '🍇' },
    { token: 'viognier', label: 'Viognier', icon: '🌸' },
    { token: 'semillon', label: 'Sémillon', icon: '🍋' },
    { token: 'surprise', label: 'Surprise me', icon: '🎲' },
  ],
};

// SPARKLING grapes (scoring tokens: chardonnay | pinot-noir | meunier | glera | surprise).
// Counts: chardonnay 236, pinot-noir 214, meunier 151, glera/prosecco 74. (Pinot Noir is a
// legitimate sparkling grape — the Champagne trio is Chardonnay/Pinot Noir/Meunier.)
const WINE_GRAPE_SPARKLING_STEP: QuestionStep = {
  id: 'grape',
  field: 'grape',
  title: 'Is there a grape you gravitate toward?',
  optional: true,
  options: [
    { token: 'chardonnay', label: 'Chardonnay (Blanc de Blancs)', icon: '🍐' },
    { token: 'pinot-noir', label: 'Pinot Noir', icon: '🍒' },
    { token: 'meunier', label: 'Pinot Meunier', icon: '🍇' },
    { token: 'glera', label: 'Glera (Prosecco)', icon: '🫧' },
    { token: 'surprise', label: 'Surprise me', icon: '🎲' },
  ],
};

// Wine — age / readiness (scoring tokens: young | mature | any)
const WINE_AGE_STEP: QuestionStep = {
  id: 'age',
  field: 'age',
  title: 'Drinking now, or something with some age?',
  optional: true,
  options: [
    { token: 'young', label: 'Young & vibrant', icon: '🌱' },
    { token: 'mature', label: 'Mature & developed', icon: '🍂' },
    { token: 'any', label: 'No preference', icon: '🤷' },
  ],
};

// Adventure level — shared by wine & spirits (scoring tokens: classic | twist | discovery)
const ADVENTURE_STEP: QuestionStep = {
  id: 'adventure',
  field: 'adventure',
  title: 'How adventurous are you feeling?',
  optional: true,
  options: [
    { token: 'classic', label: 'Stick to a classic', icon: '🏛️' },
    { token: 'twist', label: 'A little twist', icon: '🧭' },
    { token: 'discovery', label: 'Surprise & discovery', icon: '🌍' },
  ],
};

// Whisky — peat (scored via peatScore in scoring.ts using region=Islay;
// tokens: none | light | heavy). Writes field:'peat' — NOT axis2.
const WHISKY_PEAT_STEP: QuestionStep = {
  id: 'peat',
  field: 'peat',
  title: 'How much smoke and peat do you want?',
  optional: true,
  options: [
    { token: 'none', label: 'None — clean & unpeated', icon: '🧼' },
    { token: 'light', label: 'A whisper of smoke', icon: '🌫️' },
    { token: 'heavy', label: 'Big, bold & smoky', icon: '💨' },
  ],
};

// Whisky — age (scoring tokens: young | mature | any)
const WHISKY_AGE_STEP: QuestionStep = {
  id: 'age',
  field: 'age',
  title: 'Younger and lively, or older and mellow?',
  optional: true,
  options: [
    { token: 'young', label: 'Younger & lively', icon: '🌱' },
    { token: 'mature', label: 'Older & mellow', icon: '🍂' },
    { token: 'any', label: 'No preference', icon: '🤷' },
  ],
};

const WINE_DEEP_DIVE_RED: QuestionStep[] = [
  WINE_ACIDITY_STEP,
  WINE_TANNIN_STEP,
  WINE_GRAPE_RED_STEP,
  WINE_AGE_STEP,
  ADVENTURE_STEP,
];

// White: like red but NO tannin, and WHITE grapes (W5 — was sharing the red grape step).
const WINE_DEEP_DIVE_WHITE: QuestionStep[] = [
  WINE_ACIDITY_STEP,
  WINE_GRAPE_WHITE_STEP,
  WINE_AGE_STEP,
  ADVENTURE_STEP,
];

// Sparkling: like white but with SPARKLING grapes (Champagne trio + Glera).
const WINE_DEEP_DIVE_SPARKLING: QuestionStep[] = [
  WINE_ACIDITY_STEP,
  WINE_GRAPE_SPARKLING_STEP,
  WINE_AGE_STEP,
  ADVENTURE_STEP,
];

const DEEP_DIVE_CONFIG: Record<FinderCategory, QuestionStep[]> = {
  red: WINE_DEEP_DIVE_RED,
  white: WINE_DEEP_DIVE_WHITE,
  sparkling: WINE_DEEP_DIVE_SPARKLING,
  whisky: [WHISKY_PEAT_STEP, WHISKY_AGE_STEP, ADVENTURE_STEP],
  // Thin categories — kept deliberately short (gin MUST be shorter than red).
  // Gin's classic/contemporary axis is profile-only, so a single adventure
  // step is all the extra signal worth collecting.
  gin: [ADVENTURE_STEP],
  spirits: [ADVENTURE_STEP, WHISKY_AGE_STEP],
  sake: [WINE_AGE_STEP],
};

/**
 * Ordered OPT-IN deep-dive steps for a category (sommelier branch).
 * Separate from {@link stepsFor}; every step is `optional`.
 */
export function deepDiveStepsFor(category: FinderCategory): QuestionStep[] {
  return DEEP_DIVE_CONFIG[category];
}
