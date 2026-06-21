import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TasteWheelInteractive } from '@/components/product/TasteWheelInteractive';
import { buildSegments, type Tiers } from '@/lib/taste-geometry';

const tiers: Tiers = {
  primary: [{ note: 'Blackcurrant', intensity: 3 }, { note: 'Plum', intensity: 2 }],
  secondary: [{ note: 'Cedar', intensity: 3 }],
  tertiary: [],
};

function setup() {
  const { segments, order } = buildSegments(tiers, 320);
  render(<TasteWheelInteractive segments={segments} tiers={tiers} order={order} size={320} varietalLabel="Cabernet Sauvignon" />);
}

describe('TasteWheelInteractive', () => {
  it('idle center shows the varietal label', () => {
    setup();
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });

  it('clicking a chip activates exactly its matching wedge and names it in the center', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const hot = document.querySelectorAll('path.is-hot');
    expect(hot).toHaveLength(1);
    expect(hot[0].getAttribute('data-id')).toBe('primary-0');
    expect(screen.getByText('Blackcurrant')).toBeInTheDocument();
  });

  it('clicking the same chip again clears (toggle)', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(0);
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });

  it('Escape clears a locked selection (spec §6c)', () => {
    setup();
    const chip = screen.getByRole('button', { name: /Blackcurrant/i });
    fireEvent.click(chip);
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(1);
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(document.querySelectorAll('path.is-hot')).toHaveLength(0);
    expect(screen.getByText('Cabernet Sauvignon')).toBeInTheDocument();
  });
});
