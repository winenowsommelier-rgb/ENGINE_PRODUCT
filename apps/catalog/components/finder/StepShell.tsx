'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * StepShell — the chrome around one finder question.
 *
 * Renders a progress bar ("Step N of M"), a Back link to the previous step URL,
 * the question title, the option cards (children), and — when the current step
 * is `optional` — a calm "No preference / Skip" affordance that links straight
 * to the next step. URL state is the single source of truth, so Back/Skip are
 * just hrefs the server computed; nothing is held in local state here.
 *
 * Client component only because it sits in the client tree alongside ChoiceCards;
 * it does no navigation of its own beyond plain <Link>s.
 */
interface StepShellProps {
  /** 1-based index of the current step. */
  stepNumber: number;
  /** Total number of steps for this run. */
  totalSteps: number;
  /** Question shown above the cards. */
  title: string;
  /** Href to the previous step (or intro). */
  backHref: string;
  /** When set, render a "No preference / Skip" link to this href. */
  skipHref?: string;
  children: React.ReactNode;
}

export function StepShell({
  stepNumber,
  totalSteps,
  title,
  backHref,
  skipHref,
  children,
}: StepShellProps) {
  const pct = Math.round((stepNumber / totalSteps) * 100);

  return (
    <div className="flex flex-col gap-6">
      {/* Progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Link
            href={backHref}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 -ml-2 text-base text-muted-foreground',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Back
          </Link>
          <span className="text-base text-muted-foreground" aria-hidden="true">
            Step {stepNumber} of {totalSteps}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={stepNumber}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Step ${stepNumber} of ${totalSteps}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>

      {/* Option cards */}
      {children}

      {/* Skip — only on optional steps */}
      {skipHref ? (
        <div>
          <Link
            href={skipHref}
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-md px-3 -ml-3 text-base text-muted-foreground underline-offset-4',
              'hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            No preference / Skip
          </Link>
        </div>
      ) : null}
    </div>
  );
}
