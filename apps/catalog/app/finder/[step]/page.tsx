import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { robots: { index: false } };
import { TrustBar } from '@/components/TrustBar';
import { StepShell } from '@/components/finder/StepShell';
import { ChoiceCards } from '@/components/finder/ChoiceCards';
import { FoodChoice } from '@/components/finder/FoodChoice';
import { decodeAnswers, encodeAnswers, type Answers } from '@/lib/finder/answers';
import {
  stepsFor,
  deepDiveStepsFor,
  type QuestionStep,
} from '@/lib/finder/question-config';
import { FOOD_CHIPS, emptyFoodChips } from '@/lib/finder/food-chips';
import { getAllProducts } from '@/lib/catalog-data';
import { emptyBudgetTiers } from '@/lib/finder/category-map';
import { isInStock } from '@/lib/utils';
import { cn } from '@/lib/utils';

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

// Synthetic food sub-step. FoodChoice writes answers.food directly; `field: 'food'`
// makes the QuestionStep honest so a future refactor that fell through to ChoiceCards
// would not silently write food selections into flavorChips.
const FOOD_STEP: QuestionStep = {
  id: 'food',
  field: 'food',
  title: 'What are you eating?',
  multi: true,
  optional: true,
  options: Object.entries(FOOD_CHIPS).map(([token, { label, icon }]) => ({
    token,
    label,
    icon,
  })),
};

/**
 * The CORE ordered step list for a finder run: the category's config steps with
 * the synthetic food sub-step spliced in right after occasion when the user chose
 * the "food" occasion. Excludes the opt-in sommelier deep-dive.
 */
function coreSteps(answers: Answers): QuestionStep[] {
  const base = stepsFor(answers.category);
  if (answers.occasion !== 'food') return base;

  const occasionIdx = base.findIndex((s) => s.field === 'occasion');
  if (occasionIdx < 0) return base;

  const out = [...base];
  out.splice(occasionIdx + 1, 0, FOOD_STEP);
  return out;
}

/**
 * The effective ordered step list. Without the `deep` opt-in flag this is just
 * the core steps. When the user has opted into the sommelier branch (`deep=1`),
 * the deep-dive steps (all `optional`) are appended after the core steps — which
 * simply lengthens the index→step mapping the page already relies on.
 */
function effectiveSteps(answers: Answers, deep: boolean): QuestionStep[] {
  const core = coreSteps(answers);
  if (!deep) return core;
  return [...core, ...deepDiveStepsFor(answers.category)];
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

const transitionBtn =
  'inline-flex min-h-[44px] items-center rounded-md border border-border bg-background px-6 text-base font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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

  // `deep=1` opts into the sommelier deep-dive (appends optional steps).
  const deep = sp.get('deep') === '1';
  const core = coreSteps(answers);
  const steps = effectiveSteps(answers, deep);

  const stepNum = Number(params.step);
  const index = Number.isInteger(stepNum) ? stepNum - 1 : -1;

  // Below range → back to the intro.
  if (index < 0) redirect('/finder');

  // Transition point: core steps are done but the user has NOT opted into the
  // deep-dive yet. Offer both "See my result" and "Refine like a sommelier".
  // (When deep=1, this index is a real deep-dive step instead, handled below.)
  if (!deep && index === core.length && deepDiveStepsFor(answers.category).length > 0) {
    const query = encodeAnswers(answers);
    return (
      <>
        <TrustBar />
        <main className="container max-w-2xl py-8">
          <div className="flex flex-col gap-6">
            <Link
              href={`/finder/${core.length}?${query}`}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-1 self-start rounded-md px-2 -ml-2 text-base text-muted-foreground',
                'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              Back
            </Link>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Ready for your match
              </h1>
              <p className="text-base text-muted-foreground">
                See your result now, or answer a few more sommelier questions to
                fine-tune your style.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/finder/result?${query}`} className={transitionBtn}>
                See my result →
              </Link>
              <Link
                href={`/finder/${core.length + 1}?${query}&deep=1`}
                className={cn(transitionBtn, 'border-primary text-primary')}
              >
                Refine like a sommelier →
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  // At/above range → run the result.
  if (index >= steps.length) {
    redirect(`/finder/result?${encodeAnswers(answers)}`);
  }

  const step = steps[index];

  // The synthetic food step writes answers.food, which ChoiceCards' StepField
  // union doesn't cover, so we handle it inline here rather than via ChoiceCards.
  const isFoodStep = step.id === 'food' && step.title === 'What are you eating?';

  // Keep the deep-dive flag in the URL across step navigation, so the effective
  // step list (which includes the deep-dive steps) stays consistent.
  const extraQuery = deep ? 'deep=1' : undefined;
  const deepSuffix = deep ? '&deep=1' : '';

  // Whether the transition screen sits one past the last core step (no deep flag
  // yet, and this category actually has a deep-dive to offer).
  const hasTransition =
    !deep && deepDiveStepsFor(answers.category).length > 0;

  // Next / previous paths (the [step] route is 1-based).
  // When NOT in the deep-dive and a transition screen exists, the last core step
  // advances to that transition screen (index core.length → /finder/core.length+1)
  // rather than jumping straight to the result.
  const isLastCoreStep = !deep && index === core.length - 1;
  const nextPath =
    isLastCoreStep && hasTransition
      ? `/finder/${core.length + 1}`
      : index + 1 >= steps.length
        ? '/finder/result'
        : `/finder/${index + 2}`;
  const backHref =
    index === 0
      ? '/finder'
      : `/finder/${index}?${encodeAnswers(answers)}${deepSuffix}`;
  const skipHref = step.optional
    ? `${nextPath}?${encodeAnswers(answers)}${deepSuffix}`
    : undefined;

  return (
    <>
      <TrustBar />
      <main className="container max-w-2xl py-8">
        <StepShell
          stepNumber={index + 1}
          totalSteps={steps.length}
          title={step.title}
          hint={step.hint}
          backHref={backHref}
          skipHref={skipHref}
        >
          {isFoodStep ? (
            <FoodChoice
              answers={answers}
              options={step.options}
              nextPath={nextPath}
              extraQuery={extraQuery}
              // Chips with no in-stock matches are greyed + unselectable (computed
              // against the live export). Today none are empty, but stock/vocabulary
              // changes can empty one — this avoids a dead-end selection.
              disabledTokens={[...emptyFoodChips(
                getAllProducts().filter((p) => isInStock(p.is_in_stock) && p.custom_stock_status !== 'CATALOG'),
              )]}
            />
          ) : (
            <ChoiceCards
              answers={answers}
              field={step.field}
              options={step.options}
              multi={step.multi}
              nextPath={nextPath}
              extraQuery={extraQuery}
              // Grey out budget tiers with zero in-stock products for this category,
              // so users can't select a price range that will always return nothing.
              disabledTokens={
                step.field === 'budget'
                  ? emptyBudgetTiers(getAllProducts(), answers.category)
                  : undefined
              }
            />
          )}
        </StepShell>
      </main>
    </>
  );
}
