import { redirect } from 'next/navigation';
import { TrustBar } from '@/components/TrustBar';
import { StepShell } from '@/components/finder/StepShell';
import { ChoiceCards } from '@/components/finder/ChoiceCards';
import { FoodChoice } from '@/components/finder/FoodChoice';
import { decodeAnswers, encodeAnswers, type Answers } from '@/lib/finder/answers';
import {
  stepsFor,
  type QuestionStep,
} from '@/lib/finder/question-config';
import { FOOD_CHIPS } from '@/lib/finder/food-chips';

/**
 * Finder step page — one adaptive question.
 *
 * URL state is authoritative: we decode the answers from searchParams, compute
 * the effective step list, and render the step that [step] (1-based) points at.
 * Every navigation flows through `encodeAnswers`, so Back/refresh/share all work.
 *
 * CONDITIONAL FOOD SUB-STEP (spec): when the user picked occasion === 'food', a
 * synthetic "What are you eating?" multi-select is spliced in immediately AFTER
 * the occasion step. The chips are the KEYS of FOOD_CHIPS, labelled human-
 * readably. Because the splice depends on an already-answered field (occasion),
 * the effective list is stable for any URL that has reached this step.
 *
 * Out-of-range step → redirect to the result page with the current answers.
 * Missing / invalid category → redirect to the intro.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Friendly Title Case label for a food chip key, e.g. 'red-meat' → 'Red meat'. */
function foodChipLabel(key: string): string {
  const spaced = key.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Synthetic food sub-step. `field` is unused here — FoodChoice writes
// answers.food directly (food isn't a ChoiceCards StepField) — so we set it to
// a valid union member purely to satisfy the QuestionStep type.
const FOOD_STEP: QuestionStep = {
  id: 'food',
  field: 'flavorChips',
  title: 'What are you eating?',
  multi: true,
  optional: true,
  options: Object.keys(FOOD_CHIPS).map((key) => ({
    token: key,
    label: foodChipLabel(key),
  })),
};

/**
 * The effective ordered step list for a finder run: the category's config steps
 * with the synthetic food sub-step spliced in right after occasion when the user
 * chose the "food" occasion.
 */
function effectiveSteps(answers: Answers): QuestionStep[] {
  const base = stepsFor(answers.category);
  if (answers.occasion !== 'food') return base;

  const occasionIdx = base.findIndex((s) => s.field === 'occasion');
  if (occasionIdx < 0) return base;

  const out = [...base];
  out.splice(occasionIdx + 1, 0, FOOD_STEP);
  return out;
}

/** Flatten Next's searchParams into a URLSearchParams the decoder expects. */
function toSearchParams(sp: SearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out.set(k, val);
  }
  return out;
}

export default function FinderStepPage({
  params,
  searchParams,
}: {
  params: { step: string };
  searchParams: SearchParams;
}) {
  const sp = toSearchParams(searchParams);
  const answers = decodeAnswers(sp);

  // Guard: a valid category is required for any step.
  if (!answers.category) redirect('/finder');

  const steps = effectiveSteps(answers);

  const stepNum = Number(params.step);
  const index = Number.isInteger(stepNum) ? stepNum - 1 : -1;

  // Below range → back to the intro; at/above range → run the result.
  if (index < 0) redirect('/finder');
  if (index >= steps.length) {
    redirect(`/finder/result?${encodeAnswers(answers)}`);
  }

  const step = steps[index];

  // The synthetic food step writes answers.food, which ChoiceCards' StepField
  // union doesn't cover, so we handle it inline here rather than via ChoiceCards.
  const isFoodStep = step.id === 'food' && step.title === 'What are you eating?';

  // Next / previous paths (the [step] route is 1-based).
  const nextPath =
    index + 1 >= steps.length ? '/finder/result' : `/finder/${index + 2}`;
  const backHref =
    index === 0
      ? '/finder'
      : `/finder/${index}?${encodeAnswers(answers)}`;
  const skipHref = step.optional
    ? `${nextPath}?${encodeAnswers(answers)}`
    : undefined;

  return (
    <>
      <TrustBar />
      <main className="container max-w-2xl py-8">
        <StepShell
          stepNumber={index + 1}
          totalSteps={steps.length}
          title={step.title}
          backHref={backHref}
          skipHref={skipHref}
        >
          {isFoodStep ? (
            <FoodChoice
              answers={answers}
              options={step.options}
              nextPath={nextPath}
            />
          ) : (
            <ChoiceCards
              answers={answers}
              field={step.field}
              options={step.options}
              multi={step.multi}
              nextPath={nextPath}
            />
          )}
        </StepShell>
      </main>
    </>
  );
}
