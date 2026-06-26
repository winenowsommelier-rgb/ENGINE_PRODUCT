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
  // Sake serve preference (Layer-1, chilled/warm/either — TASK B). Core field, written by
  // ChoiceCards; needs a case in withAnswer's switch or the step writes nothing.
  | 'serve'
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
  hint?: string; // optional one-line explainer shown on Layer-2 deep-dive steps
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

// Rosé plain-language taste-feel step (Layer-1, no jargon). Body/acidity-led framing
// (crisp & dry vs fruity & soft), NOT sweetness — rosé's sweetness is 0/95 in stock (a DEAD
// field). crisp → crisp-dry-rose (lean Provence-style, Light/High); fruity → fruity-easy-rose
// (riper New-World, Medium/Medium). 'unsure' → null → CROWD_PLEASER.rose.
const ROSE_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'Crisp & dry, or fruity & soft?',
  optional: true,
  options: [
    { token: 'crisp', label: 'Crisp & dry', icon: '🌸' },
    { token: 'fruity', label: 'Fruity & soft', icon: '🍓' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// Sparkling plain-language taste-feel step (Layer-1, no jargon). Style-led framing
// (festive vs fine), NOT body/dosage. festive → fresh-festive-sparkling (light, fruity,
// Prosecco-style); fine → fine-traditional-sparkling (full, toasty, Champagne-style).
// REPLACES the old body(axis1)/character(axis2) wine steps for sparkling.
const SPARKLING_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: "What's the vibe?",
  optional: true,
  options: [
    { token: 'festive', label: 'Light & fun', icon: '🎉' },
    { token: 'fine', label: 'Fine & classic', icon: '✨' },
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

// ── Whisky plain-language taste-feel step (Layer-1, no jargon). Resolves to an archetype
// via taste-feel.ts; 'smoky' also drives a positive rank boost in scoring.ts (spec §11.8).
// REPLACES the old smoky/smooth axis2 style step in the whisky flow, but KEEPS the origin
// step. (Japanese 'refined' is reachable via the origin question, so it's not a feel token.)
const WHISKY_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'What’s your style?',
  optional: true,
  options: [
    { token: 'smooth', label: 'Smooth & mellow', icon: '🥃' },
    { token: 'rich', label: 'Rich & warming', icon: '🔥' },
    { token: 'smoky', label: 'Smoky', icon: '💨' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// ── Gin plain-language taste-feel step (Layer-1, no jargon). Style-led framing
// (classic vs modern), writing `tasteFeel` (not axis1). classic → classic-juniper-gin
// (London Dry); modern → contemporary-botanical-gin. Drives a rank-only keyword lean in
// scoring.ts (ginStyleBump reads tasteFeel). REPLACES the old axis1 classic/contemporary step.
const GIN_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'Classic or modern?',
  optional: true,
  options: [
    { token: 'classic', label: 'Classic & junipery', icon: '🍸' },
    { token: 'modern', label: 'Modern & aromatic', icon: '🌿' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
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

// ── Spirits (other) plain feel step (TASK A). ONE generic feel after the TYPE question,
// writing `tasteFeel` (light/smooth/rich/aged). light/smooth → clean-versatile-vodka;
// rich/aged → warm-aged-spirit (taste-feel.ts). 'rich'/'aged' also earn a positive-only
// age/grade rank lean in scoring.ts (spiritsFeelScore). 'unsure' → crowd-pleaser.
const SPIRITS_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'How do you want it?',
  optional: true,
  options: [
    { token: 'light', label: 'Light & clean', icon: '💧' },
    { token: 'smooth', label: 'Smooth', icon: '🥃' },
    { token: 'rich', label: 'Rich & aged', icon: '🔥' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// ── Sake & Asian Layer-1 (TASK B). Replaces the single sweetness step with sub-type →
// aroma → serve. axis1 sub-type is display/filter only (category_type already filters the
// pool); aroma writes `tasteFeel`; serve writes the new `serve` field. The dry/sweet
// sweetness signal moves to the opt-in Layer-2 path (sakeSweetness in scoring.ts).
// ──

// Sake sub-type (axis1). Rice sake / Shochu / Plum (umeshu). No scoring needed — the pool
// is already category-filtered; this just lets the shopper narrow within Sake & Asian.
const SAKE_TYPE_STEP: QuestionStep = {
  id: 'type',
  field: 'axis1',
  title: 'What kind?',
  optional: true,
  options: [
    { token: 'sake', label: 'Rice sake', icon: '🍶' },
    { token: 'shochu', label: 'Shochu', icon: '🍶' },
    { token: 'umeshu', label: 'Plum (umeshu)', icon: '🍑' },
  ],
};

// Sake aroma feel (tasteFeel). Plain words, NO junmai/ginjo jargon: fragrant & fruity →
// fragrant-sweet-sake; clean & dry → crisp-dry-sake (taste-feel.ts). The structured
// `variety` drives a rank lean (sakeAromaScore). 'unsure' → crowd-pleaser.
const SAKE_FEEL_STEP: QuestionStep = {
  id: 'taste-feel',
  field: 'tasteFeel',
  title: 'Fragrant or clean?',
  optional: true,
  options: [
    { token: 'fragrant', label: 'Fragrant & fruity', icon: '🌸' },
    { token: 'clean', label: 'Clean & dry', icon: '💧' },
    { token: 'unsure', label: 'Not sure — guide me', icon: '🤷' },
  ],
};

// Sake serve preference (serve). Chilled / warm / either. Optional preference; writes the
// new `serve` field (URL param 'sv', see answers.ts).
const SAKE_SERVE_STEP: QuestionStep = {
  id: 'serve',
  field: 'serve',
  title: 'Chilled or warm?',
  optional: true,
  options: [
    { token: 'chilled', label: 'Chilled', icon: '❄️' },
    { token: 'warm', label: 'Warm', icon: '♨️' },
    { token: 'either', label: 'Either', icon: '🤷' },
  ],
};

export const QUESTION_CONFIG: Record<FinderCategory, QuestionStep[]> = {
  // Red Layer-1 is plain-language: occasion → budget → taste-feel → flavor. No body/
  // character jargon. (Food is an inline FoodChoice sub-step, not a config step.)
  red: [OCCASION_STEP, BUDGET_STEP, RED_FEEL_STEP, FLAVOR_STEP],
  // White Layer-1 is plain-language too: occasion → budget → taste-feel (acidity-led) →
  // flavor. (sparkling still uses the body/character axes.)
  white: [OCCASION_STEP, BUDGET_STEP, WHITE_FEEL_STEP, FLAVOR_STEP],
  // Rosé Layer-1 (Phase-2): occasion → budget → taste-feel (body/acidity-led, crisp/fruity) →
  // flavor. Mirrors the white flow; sweetness is NOT asked (0/95 in stock — dead field).
  rose: [OCCASION_STEP, BUDGET_STEP, ROSE_FEEL_STEP, FLAVOR_STEP],
  // Sparkling Layer-1 is plain-language too: occasion → budget → taste-feel (style-led,
  // festive/fine) → flavor. Replaces the old body/character axis1/axis2 wine steps.
  sparkling: [OCCASION_STEP, BUDGET_STEP, SPARKLING_FEEL_STEP, FLAVOR_STEP],
  // Whisky Layer-1: occasion → budget → origin → plain taste-feel → flavor. The feel step
  // REPLACES the old smoky/smooth axis2 style step but KEEPS origin (axis1 → country boost).
  whisky: [OCCASION_STEP, BUDGET_STEP, WHISKY_ORIGIN_STEP, WHISKY_FEEL_STEP, FLAVOR_STEP],
  // Gin Layer-1 is plain-language: occasion → budget → taste-feel (classic/modern) → flavor.
  gin: [OCCASION_STEP, BUDGET_STEP, GIN_FEEL_STEP, FLAVOR_STEP],
  // Spirits Layer-1 (TASK A): occasion → budget → TYPE (axis1) → plain feel (tasteFeel) →
  // flavor. Keeps the TYPE question, adds ONE generic feel step after it.
  spirits: [OCCASION_STEP, BUDGET_STEP, SPIRITS_TYPE_STEP, SPIRITS_FEEL_STEP, FLAVOR_STEP],
  // Sake Layer-1 (TASK B): occasion → budget → sub-type (axis1) → aroma (tasteFeel) →
  // serve (serve) → flavor. Replaces the old single sweetness(axis1) step. Sweetness is now
  // an opt-in Layer-2 path (sakeSweetness in scoring.ts), still keyed off axis1 in deep-dive.
  sake: [OCCASION_STEP, BUDGET_STEP, SAKE_TYPE_STEP, SAKE_FEEL_STEP, SAKE_SERVE_STEP, FLAVOR_STEP],
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
  hint: 'Acidity is the fresh, mouth-watering zing — high feels crisp, low feels soft and round.',
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
  hint: 'Tannin is the grippy, drying feel in bigger reds — firmer means more structure.',
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
  hint: 'The grape behind the wine — pick one you enjoy, or let us surprise you.',
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
  hint: 'The grape behind the wine — pick one you enjoy, or let us surprise you.',
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
  hint: 'The grape behind the wine — pick one you enjoy, or let us surprise you.',
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
  hint: 'Younger wines are bright and fruity; older ones are mellower and more developed.',
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
  hint: 'How far from the classics you want to roam.',
  optional: true,
  options: [
    { token: 'classic', label: 'Stick to a classic', icon: '🏛️' },
    { token: 'twist', label: 'A little twist', icon: '🧭' },
    { token: 'discovery', label: 'Surprise & discovery', icon: '🌍' },
  ],
};

// Whisky — peat (scored via peatScore in scoring.ts using the REAL `smokiness` field +
// peated-distillery allow-list, positive-only — NOT region; spec §11.8). Writes field:'peat'.
const WHISKY_PEAT_STEP: QuestionStep = {
  id: 'peat',
  field: 'peat',
  title: 'How much smoke and peat do you want?',
  hint: 'Peat is the campfire-smoke character in some whiskies — from none to big and smoky.',
  optional: true,
  options: [
    { token: 'none', label: 'None — clean & unpeated', icon: '🧼' },
    { token: 'light', label: 'A whisper of smoke', icon: '🌫️' },
    { token: 'heavy', label: 'Big, bold & smoky', icon: '💨' },
  ],
};

// Sake — age / style freshness (scoring tokens: young | mature | any)
// Sake aging is real (koshu = aged sake is mellow/complex; nama/fresh = lively).
// Framing avoids wine language entirely.
const SAKE_AGE_STEP: QuestionStep = {
  id: 'age',
  field: 'age',
  title: 'Fresh and lively, or aged and mellow?',
  hint: 'Fresh sake is bright and crisp; aged sake (koshu) is richer, deeper, and more complex.',
  optional: true,
  options: [
    { token: 'young', label: 'Fresh & lively', icon: '🌱' },
    { token: 'mature', label: 'Aged & complex', icon: '🍂' },
    { token: 'any', label: 'No preference', icon: '🤷' },
  ],
};

// Whisky — age (scoring tokens: young | mature | any)
const WHISKY_AGE_STEP: QuestionStep = {
  id: 'age',
  field: 'age',
  title: 'Younger and lively, or older and mellow?',
  hint: 'Younger whiskies are brighter and livelier; older ones are mellower and more developed.',
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
  // Rosé deep-dive: SHORT (acidity is the discriminator rosé leads on, plus adventure). No
  // grape step — rosé variety is a blend signal, not a single-grape pick like red/white.
  rose: [WINE_ACIDITY_STEP, ADVENTURE_STEP],
  sparkling: WINE_DEEP_DIVE_SPARKLING,
  whisky: [WHISKY_PEAT_STEP, WHISKY_AGE_STEP, ADVENTURE_STEP],
  // Thin categories — kept deliberately short (gin MUST be shorter than red).
  // Gin's classic/contemporary axis is profile-only, so a single adventure
  // step is all the extra signal worth collecting.
  gin: [ADVENTURE_STEP],
  spirits: [ADVENTURE_STEP, WHISKY_AGE_STEP],
  sake: [SAKE_AGE_STEP],
};

/**
 * Ordered OPT-IN deep-dive steps for a category (sommelier branch).
 * Separate from {@link stepsFor}; every step is `optional`.
 */
export function deepDiveStepsFor(category: FinderCategory): QuestionStep[] {
  return DEEP_DIVE_CONFIG[category];
}
