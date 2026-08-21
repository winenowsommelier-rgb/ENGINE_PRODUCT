import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// PriceUnlockProvider reads NEXT_PUBLIC_PRICE_PASSCODE into a module-level
// const at import time (mirrors how Next.js inlines NEXT_PUBLIC_* at build
// time), so the env must be stubbed BEFORE any of these modules are first
// imported. All three are dynamic-imported below to avoid static-import
// hoisting evaluating them ahead of vi.stubEnv.
vi.stubEnv('NEXT_PUBLIC_PRICE_PASSCODE', '2026');
const { PriceDisplay } = await import('@/components/PriceDisplay');
const { PriceUnlockProvider } = await import('@/components/PriceUnlockProvider');
const { PriceUnlockModal } = await import('@/components/PriceUnlockModal');

/**
 * PriceDisplay is the single chokepoint every card/detail price renders
 * through. These tests lock in its core contract: a locked visitor must
 * NEVER see the real formatted price, only the ฿-tier icon — and unlocking
 * (via the modal, driven by usePriceUnlock) must flip every PriceDisplay on
 * the page to show real numbers.
 */
function renderLocked(price: number | null | undefined) {
  return render(
    <PriceUnlockProvider>
      <PriceDisplay price={price} />
      <PriceUnlockModal />
    </PriceUnlockProvider>,
  );
}

describe('PriceDisplay', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows the ฿-tier icon, never the real price, when locked', () => {
    renderLocked(1600);
    expect(screen.queryByText('฿1,600')).not.toBeInTheDocument();
    expect(screen.getByText('฿฿')).toBeInTheDocument();
  });

  it('shows the real formatted price once already unlocked (sessionStorage)', () => {
    sessionStorage.setItem('wnlq9_price_unlocked', '1');
    render(
      <PriceUnlockProvider>
        <PriceDisplay price={1600} />
      </PriceUnlockProvider>,
    );
    expect(screen.getByText('฿1,600')).toBeInTheDocument();
  });

  it('clicking the locked price opens the unlock modal', () => {
    renderLocked(1600);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /unlock to see price/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('entering the correct passcode reveals the real price', () => {
    renderLocked(1600);
    fireEvent.click(screen.getByRole('button', { name: /unlock to see price/i }));
    fireEvent.change(screen.getByPlaceholderText('Passcode'), { target: { value: '2026' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock prices/i }));
    expect(screen.getByText('฿1,600')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an incorrect passcode shows an error and keeps the price locked', () => {
    renderLocked(1600);
    fireEvent.click(screen.getByRole('button', { name: /unlock to see price/i }));
    fireEvent.change(screen.getByPlaceholderText('Passcode'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock prices/i }));
    expect(screen.getByText(/incorrect passcode/i)).toBeInTheDocument();
    expect(screen.queryByText('฿1,600')).not.toBeInTheDocument();
  });
});
