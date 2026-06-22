import { render, screen, fireEvent } from '@testing-library/react';
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

  it('hover fires onFocusNote with the id on enter and undefined on leave', () => {
    const onFocus = vi.fn();
    render(<TasteNote note="Cedar" tier="secondary" intensity={3} segmentId="secondary-0" onFocusNote={onFocus} />);
    const el = screen.getByRole('button', { name: /Cedar/i });
    fireEvent.mouseEnter(el);
    expect(onFocus).toHaveBeenCalledWith('secondary-0');
    fireEvent.mouseLeave(el);
    expect(onFocus).toHaveBeenCalledWith(undefined);
  });

  // No runtime dead-button guard test: the discriminated union makes passing
  // onToggleNote/onFocusNote without a segmentId a compile error, so the
  // dead-button state is unrepresentable by the type system.
});
