import type { FinderCategory } from './answers';

export type StepField = 'occasion' | 'budget' | 'axis1' | 'axis2' | 'flavorChips';

export interface StepOption {
  token: string;
  label: string;
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
    { token: 'everyday', label: 'Everyday' },
    { token: 'food', label: 'With food' },
    { token: 'gift', label: 'A gift' },
    { token: 'special', label: 'Special / cellar' },
    { token: 'exploring', label: 'Just exploring' },
  ],
};

const BUDGET_STEP: QuestionStep = {
  id: 'budget',
  field: 'budget',
  title: "What's your budget?",
  options: [
    { token: '0', label: 'Under ฿1,000' },
    { token: '1', label: '฿1,000–3,000' },
    { token: '2', label: '฿3,000–7,000' },
    { token: '3', label: '฿7,000–15,000' },
    { token: '4', label: '฿15,000+' },
  ],
};

// ── Wine taste steps (red, white, sparkling) ──
const WINE_BODY_STEP: QuestionStep = {
  id: 'body',
  field: 'axis1',
  title: 'How full-bodied do you like it?',
  optional: true,
  options: [
    { token: 'light', label: 'Light & easy' },
    { token: 'medium', label: 'Medium-bodied' },
    { token: 'bold', label: 'Bold & full' },
  ],
};

const WINE_CHARACTER_STEP: QuestionStep = {
  id: 'character',
  field: 'axis2',
  title: 'What character do you prefer?',
  optional: true,
  options: [
    { token: 'fruity', label: 'Fruit-forward' },
    { token: 'earthy', label: 'Earthy & savory' },
    { token: 'balanced', label: 'Balanced' },
  ],
};

// ── Flavor step (red, white, sparkling, whisky) ──
const FLAVOR_STEP: QuestionStep = {
  id: 'flavor',
  field: 'flavorChips',
  title: 'Any flavors you love? (pick a few)',
  multi: true,
  optional: true,
  options: [
    { token: 'oak', label: 'Oak' },
    { token: 'red-fruit', label: 'Red fruit' },
    { token: 'dark-fruit', label: 'Dark fruit' },
    { token: 'citrus', label: 'Citrus' },
    { token: 'spice', label: 'Spice' },
    { token: 'earth', label: 'Earthy' },
    { token: 'floral', label: 'Floral' },
    { token: 'vanilla', label: 'Vanilla' },
  ],
};

// ── Whisky taste steps ──
const WHISKY_ORIGIN_STEP: QuestionStep = {
  id: 'origin',
  field: 'axis1',
  title: 'Where should it come from?',
  optional: true,
  options: [
    { token: 'scotch', label: 'Scotch' },
    { token: 'japanese', label: 'Japanese' },
    { token: 'bourbon', label: 'Bourbon / American' },
    { token: 'irish', label: 'Irish' },
    { token: 'world', label: 'World / other' },
  ],
};

const WHISKY_STYLE_STEP: QuestionStep = {
  id: 'style',
  field: 'axis2',
  title: 'What style do you prefer?',
  optional: true,
  options: [
    { token: 'smoky', label: 'Smoky & peaty' },
    { token: 'smooth', label: 'Smooth & mellow' },
  ],
};

// ── Gin taste step (axis1 only) ──
const GIN_STYLE_STEP: QuestionStep = {
  id: 'style',
  field: 'axis1',
  title: 'Classic or contemporary?',
  optional: true,
  options: [
    { token: 'classic', label: 'Classic / London Dry' },
    { token: 'contemporary', label: 'Contemporary / botanical' },
  ],
};

// ── Spirits (other) taste step (axis1 = type) ──
const SPIRITS_TYPE_STEP: QuestionStep = {
  id: 'type',
  field: 'axis1',
  title: 'What kind of spirit?',
  optional: true,
  options: [
    { token: 'vodka', label: 'Vodka' },
    { token: 'rum', label: 'Rum' },
    { token: 'tequila', label: 'Tequila / mezcal' },
    { token: 'brandy', label: 'Brandy / cognac' },
    { token: 'other', label: 'Something else' },
  ],
};

// ── Sake & Asian taste step (axis1 = sweetness) ──
const SAKE_SWEETNESS_STEP: QuestionStep = {
  id: 'sweetness',
  field: 'axis1',
  title: 'Dry or sweet?',
  optional: true,
  options: [
    { token: 'dry', label: 'Dry' },
    { token: 'sweet', label: 'Sweet / fruity' },
    { token: 'any', label: 'No preference' },
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
