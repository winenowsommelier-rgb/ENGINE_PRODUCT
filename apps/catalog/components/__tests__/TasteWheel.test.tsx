// components/__tests__/TasteWheel.test.tsx
//
// Regression guard for the taste-profile legend redesign:
//   - EMPTY tiers (e.g. a SKU with no tertiary notes) must NOT render an orphan
//     header row with zero pills. Before the redesign the legend always emitted
//     a "Tertiary" label even when tiers.tertiary was empty, which looked broken.
//   - Non-empty tiers DO render their header + pills.

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TasteWheel, type Tiers } from '@/components/product/TasteWheel';

const note = (n: string, intensity: 1 | 2 | 3 = 2) => ({ note: n, intensity });

describe('TasteWheel legend', () => {
  it('hides a tier with no notes (no orphan header row)', () => {
    const tiers: Tiers = {
      primary: [note('Cherry'), note('Plum')],
      secondary: [note('Oak')],
      tertiary: [], // empty → must not render a "Tertiary" header
    };
    render(<TasteWheel tiers={tiers} />);

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.queryByText('Tertiary')).not.toBeInTheDocument();

    // Pills for the present tiers still render.
    expect(screen.getByText('Cherry')).toBeInTheDocument();
    expect(screen.getByText('Oak')).toBeInTheDocument();
  });

  it('renders all three tier headers when all are populated', () => {
    const tiers: Tiers = {
      primary: [note('Blackberry')],
      secondary: [note('Vanilla')],
      tertiary: [note('Leather')],
    };
    render(<TasteWheel tiers={tiers} />);

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('Tertiary')).toBeInTheDocument();
    expect(screen.getByText('Leather')).toBeInTheDocument();
  });
});
