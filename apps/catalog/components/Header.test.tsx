import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';
import { PriceUnlockProvider } from '@/components/PriceUnlockProvider';

// Mock next/link — renders as a plain <a> so href is inspectable (same
// pattern as Footer.test.tsx / ProductCard.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Header imports actions/auth.ts (a 'use server' module) for logoutAction --
// neither the 'use server' directive nor a real server action works
// unmocked under vitest/jsdom (same reasoning as ProductCard.test.tsx's
// mock of actions/lists).
vi.mock('@/actions/auth', () => ({
  logoutAction: vi.fn(),
}));

function renderHeader(ui: React.ReactElement) {
  return render(<PriceUnlockProvider>{ui}</PriceUnlockProvider>);
}

describe('Header', () => {
  it('shows a Log in link when logged out', () => {
    renderHeader(<Header />);
    const loginLinks = screen.getAllByRole('link', { name: 'Log in' });
    expect(loginLinks.length).toBeGreaterThan(0);
    loginLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/login'));
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });

  it('shows the account menu trigger (not Log in) when logged in', () => {
    renderHeader(
      <Header
        user={{ id: 'user-1', email: 'a@b.com' }}
        profile={{ username: 'winefan', avatar_url: null }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
  });

  it('falls back to the username initial when there is no avatar', () => {
    renderHeader(
      <Header
        user={{ id: 'user-1', email: 'a@b.com' }}
        profile={{ username: 'winefan', avatar_url: null }}
      />,
    );
    expect(screen.getByText('W')).toBeTruthy();
  });
});
