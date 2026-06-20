'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { encodeAnswers, type Answers } from '@/lib/finder/answers';
import type { StepField, StepOption } from '@/lib/finder/question-config';

/**
 * ChoiceCards — the interactive option grid for one finder step.
 *
 * URL state is the single source of truth: on choose we merge the picked
 * value(s) into the answers we were handed, re-`encodeAnswers`, and navigate to
 * the next path. We never read/write local answer state beyond a multi-select's
 * in-progress selection (committed on "Continue").
 *
 *  - Single-select: clicking a card navigates immediately.
 *  - Multi-select (`multi`): clicking toggles a pill; a "Continue" button
 *    commits the chosen set and navigates. (Flavor / food chips.)
 *
 * The server decides BOTH the field this step writes and the next path, so the
 * conditional food sub-step and end-of-flow redirect all live server-side.
 */
interface ChoiceCardsProps {
  /** Answers decoded from the current URL (the baseline we merge into). */
  answers: Answers;
  /** Which Answers field this step writes. */
  field: StepField;
  /** Selectable options. */
  options: StepOption[];
  /** Multi-select (writes string[]) vs single-select (navigates on click). */
  multi?: boolean;
  /** Path (no query) for the NEXT step, e.g. '/finder/3' or '/finder/result'. */
  nextPath: string;
  /**
   * Extra query string (no leading '?'/'&') appended after the encoded answers,
   * e.g. 'deep=1' to keep the sommelier deep-dive flag in the URL across steps.
   */
  extraQuery?: string;
}

/**
 * Merge a chosen value for `field` into a copy of `answers`.
 *
 * EXPORTED so the UI<->Answers seam is unit-testable. History: this switch once
 * handled only the 5 v1 fields (occasion/budget/axis1/axis2/flavorChips). The 6
 * sommelier deep-dive fields fell through writing NOTHING, so the entire deep-
 * dive collected zero answers in the browser (the result URL carried no deep-
 * dive params, the scoring bump was always 0) — and every unit test passed
 * because this seam was untested. The `default` exhaustiveness guard below now
 * makes any future StepField addition fail to COMPILE rather than silently drop.
 */
export function withAnswer(
  answers: Answers,
  field: StepField,
  value: string | string[],
): Answers {
  const next: Answers = { ...answers };
  switch (field) {
    case 'occasion':
      next.occasion = value as Answers['occasion'];
      // Picking a non-food occasion clears any stale food selection.
      if (value !== 'food') next.food = undefined;
      break;
    case 'budget':
      next.budget = Number(value) as Answers['budget'];
      break;
    case 'axis1':
      next.axis1 = value as string;
      break;
    case 'axis2':
      next.axis2 = value as string;
      break;
    case 'flavorChips':
      next.flavorChips = (value as string[]).length
        ? (value as string[])
        : undefined;
      break;
    case 'food':
      // `food` is normally written inline by FoodChoice (the synthetic food
      // sub-step is never routed through ChoiceCards). Handled here only so the
      // StepField union is exhausted and the `never` guard below compiles.
      next.food = (value as string[]).length ? (value as string[]) : undefined;
      break;
    // ── Sommelier deep-dive single-value string fields. Same shape as axis1.
    case 'acidity':
    case 'tannin':
    case 'grape':
    case 'age':
    case 'adventure':
    case 'peat':
      next[field] = value as string;
      break;
    default: {
      // Exhaustiveness guard: if a new StepField is added without a case here,
      // `field` is no longer `never` and this assignment fails to compile —
      // surfacing the dropped field at build time instead of silently in prod.
      const _exhaustive: never = field;
      return answers;
    }
  }
  return next;
}

export function ChoiceCards({
  answers,
  field,
  options,
  multi,
  nextPath,
  extraQuery,
}: ChoiceCardsProps) {
  const router = useRouter();

  // Seed a multi-select from whatever is already in answers for this field.
  const initialMulti =
    field === 'flavorChips' ? answers.flavorChips ?? [] : [];
  const [selected, setSelected] = useState<string[]>(initialMulti);

  const go = (next: Answers) => {
    const suffix = extraQuery ? `&${extraQuery}` : '';
    router.push(`${nextPath}?${encodeAnswers(next)}${suffix}`);
  };

  if (multi) {
    const toggle = (token: string) => {
      setSelected((cur) =>
        cur.includes(token)
          ? cur.filter((t) => t !== token)
          : [...cur, token],
      );
    };

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-3" role="group">
          {options.map((opt) => {
            const active = selected.includes(opt.token);
            return (
              <button
                key={opt.token}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(opt.token)}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-base transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:border-primary hover:text-primary',
                )}
              >
                {active ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : null}
                {opt.label}
              </button>
            );
          })}
        </div>

        <div>
          <button
            type="button"
            onClick={() => go(withAnswer(answers, field, selected))}
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground',
              'transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Single-select: each card navigates immediately.
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((opt) => (
        <button
          key={opt.token}
          type="button"
          onClick={() => go(withAnswer(answers, field, opt.token))}
          className={cn(
            'flex min-h-[64px] items-center rounded-lg border border-border bg-background px-5 text-left text-lg text-foreground transition-all',
            'hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
