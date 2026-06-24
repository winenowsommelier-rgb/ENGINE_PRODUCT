import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StepShell } from '@/components/finder/StepShell';

/**
 * StepShell renders the Layer-2 "what's this?" explainer (`hint`) when a step
 * carries one. The hint is the plain-language sentence that explains a sommelier
 * term (acidity / tannin / peat …) on the opt-in deep-dive steps.
 */
describe('StepShell — hint explainer', () => {
  it('renders the hint text below the title when a hint is passed', () => {
    render(
      <StepShell
        stepNumber={1}
        totalSteps={3}
        title="How much grip and structure do you like?"
        hint="Tannin is the grippy, drying feel in bigger reds — firmer means more structure."
        backHref="/finder"
      >
        <div>cards</div>
      </StepShell>,
    );
    expect(
      screen.getByText(/Tannin is the grippy, drying feel/),
    ).toBeInTheDocument();
  });

  it('renders no hint paragraph when no hint is passed', () => {
    render(
      <StepShell
        stepNumber={1}
        totalSteps={3}
        title="What's the occasion?"
        backHref="/finder"
      >
        <div>cards</div>
      </StepShell>,
    );
    expect(screen.queryByText(/Tannin is the grippy/)).not.toBeInTheDocument();
  });
});
