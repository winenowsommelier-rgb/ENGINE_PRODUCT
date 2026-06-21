import type { FinderCategory } from './answers';

export type StepField =
  | 'occasion'
  | 'budget'
  | 'axis1'
  | 'axis2'
  | 'flavorChips'
  | 'food'
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
  red: WINE_STEPS,
  white: WINE_STEPS,
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

// Wine — grape family (scoring tokens: cabernet | pinot-noir | syrah-shiraz |
// sangiovese | tempranillo | merlot | grenache | surprise)
const WINE_GRAPE_STEP: QuestionStep = {
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
  WINE_GRAPE_STEP,
  WINE_AGE_STEP,
  ADVENTURE_STEP,
];

// White & sparkling: same as red but NO tannin.
const WINE_DEEP_DIVE_NO_TANNIN: QuestionStep[] = [
  WINE_ACIDITY_STEP,
  WINE_GRAPE_STEP,
  WINE_AGE_STEP,
  ADVENTURE_STEP,
];

const DEEP_DIVE_CONFIG: Record<FinderCategory, QuestionStep[]> = {
  red: WINE_DEEP_DIVE_RED,
  white: WINE_DEEP_DIVE_NO_TANNIN,
  sparkling: WINE_DEEP_DIVE_NO_TANNIN,
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
