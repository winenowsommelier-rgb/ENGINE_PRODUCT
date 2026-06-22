'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { encodeAnswers, type Answers } from '@/lib/finder/answers';
import type { StepOption } from '@/lib/finder/question-config';

/**
 * FoodChoice — the conditional "What are you eating?" sub-step.
 *
 * Separate from ChoiceCards because it writes `answers.food` (chip keys), which
 * isn't one of ChoiceCards' StepField targets. Same multi-select UI: toggle
 * chips, then Continue commits the set into the URL via `encodeAnswers` and
 * navigates to the next step. URL stays the single source of truth.
 */
interface FoodChoiceProps {
  answers: Answers;
  options: StepOption[];
  /** Path (no query) for the next step. */
  nextPath: string;
  /**
   * Extra query string (no leading '?'/'&') appended after the encoded answers,
   * e.g. 'deep=1' to keep the sommelier deep-dive flag in the URL across steps.
   */
  extraQuery?: string;
  /**
   * Chip tokens that currently match no in-stock products — rendered greyed and
   * unselectable so the user isn't led to an empty result. Computed server-side.
   */
  disabledTokens?: string[];
}

export function FoodChoice({ answers, options, nextPath, extraQuery, disabledTokens }: FoodChoiceProps) {
  const router = useRouter();
  const disabled = new Set(disabledTokens ?? []);
  // Drop any disabled token that somehow rode in on the URL so it can't be committed.
  const [selected, setSelected] = useState<string[]>(
    (answers.food ?? []).filter((t) => !disabled.has(t)),
  );

  const toggle = (token: string) => {
    if (disabled.has(token)) return; // never select an empty chip
    setSelected((cur) =>
      cur.includes(token) ? cur.filter((t) => t !== token) : [...cur, token],
    );
  };

  const onContinue = () => {
    const next: Answers = {
      ...answers,
      food: selected.length ? selected : undefined,
    };
    const suffix = extraQuery ? `&${extraQuery}` : '';
    router.push(`${nextPath}?${encodeAnswers(next)}${suffix}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3" role="group">
        {options.map((opt) => {
          const isDisabled = disabled.has(opt.token);
          const active = !isDisabled && selected.includes(opt.token);
          return (
            <button
              key={opt.token}
              type="button"
              aria-pressed={active}
              disabled={isDisabled}
              onClick={() => toggle(opt.token)}
              title={isDisabled ? 'No items in stock right now' : undefined}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-base transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isDisabled
                  ? 'cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground/60'
                  : active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary hover:text-primary',
              )}
            >
              {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              {opt.icon ? (
                <span aria-hidden="true" className={cn('mr-2', isDisabled && 'opacity-50')}>
                  {opt.icon}
                </span>
              ) : null}
              {opt.label}
            </button>
          );
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={onContinue}
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
