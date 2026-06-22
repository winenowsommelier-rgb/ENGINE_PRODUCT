import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// FoodChoice navigates via next/navigation's router — stub it.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { FoodChoice } from '@/components/finder/FoodChoice';
import type { StepOption } from '@/lib/finder/question-config';

const options: StepOption[] = [
  { token: 'thai', label: 'Thai food', icon: '🌶️' },
  { token: 'korean', label: 'Korean BBQ', icon: '🍖' },
];

describe('FoodChoice — empty chips are greyed + unselectable', () => {
  it('renders a disabled token as disabled and ignores clicks on it', () => {
    render(
      <FoodChoice
        answers={{ category: 'red' } as any}
        options={options}
        nextPath="/finder/3"
        disabledTokens={['korean']}
      />,
    );
    const korean = screen.getByRole('button', { name: /Korean BBQ/ });
    const thai = screen.getByRole('button', { name: /Thai food/ });

    // Disabled chip carries the disabled attribute + not-allowed style.
    expect(korean).toBeDisabled();
    expect(korean.className).toContain('cursor-not-allowed');
    // Enabled chip is interactive.
    expect(thai).not.toBeDisabled();

    // Clicking the disabled chip must NOT select it (aria-pressed stays false).
    fireEvent.click(korean);
    expect(korean).toHaveAttribute('aria-pressed', 'false');
  });

  it('drops a disabled token that arrived via the URL so it is never committed', () => {
    render(
      <FoodChoice
        answers={{ category: 'red', food: ['korean', 'thai'] } as any}
        options={options}
        nextPath="/finder/3"
        disabledTokens={['korean']}
      />,
    );
    // thai (still valid) stays selected; korean (disabled) is dropped.
    expect(screen.getByRole('button', { name: /Thai food/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Korean BBQ/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
