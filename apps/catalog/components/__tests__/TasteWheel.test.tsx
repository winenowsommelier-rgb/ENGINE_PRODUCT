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
    const { container } = render(<TasteWheel tiers={tiers} />);

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.queryByText('Tertiary')).not.toBeInTheDocument();

    // Pills for the present tiers still render.
    expect(screen.getByText('Cherry')).toBeInTheDocument();
    expect(screen.getByText('Oak')).toBeInTheDocument();

    // Empty tertiary still draws its faint placeholder ring (spec §9).
    expect(container.querySelector('[data-placeholder="tertiary"]')).toBeInTheDocument();
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

  it('each chip has a wedge with a matching data-id (no orphan chip)', () => {
    const tiers: Tiers = {
      primary: [note('Blackcurrant', 3), note('Plum', 2)],
      secondary: [note('Cedar')],
      tertiary: [],
    };
    const { container } = render(<TasteWheel tiers={tiers} varietalLabel="Cab" />);
    const wedgeIds = [...container.querySelectorAll('path[data-id]')].map(p => p.getAttribute('data-id'));
    expect(wedgeIds).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    expect(screen.getByTestId('center-note')).toHaveTextContent('Cab');
  });
});
