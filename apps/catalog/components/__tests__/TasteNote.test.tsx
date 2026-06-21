import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TasteNote } from '@/components/product/TasteNote';

describe('TasteNote', () => {
  it('renders a non-interactive span when no callbacks are given', () => {
    render(<TasteNote note="Cedar" tier="flat" intensity={2} />);
    const el = screen.getByText('Cedar');
    expect(el.tagName).toBe('SPAN');
  });

  it('renders a button when a callback is given; click toggles, hover focuses', () => {
    const onFocus = vi.fn();
    const onToggle = vi.fn();
    render(<TasteNote note="Cedar" tier="secondary" intensity={3} segmentId="secondary-0" onFocusNote={onFocus} onToggleNote={onToggle} />);
    const el = screen.getByRole('button', { name: /Cedar/i });
    el.click();
    expect(onToggle).toHaveBeenCalledWith('secondary-0');
  });
});
