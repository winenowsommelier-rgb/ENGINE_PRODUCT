import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from './Footer';

// Mock next/link — renders as a plain <a> so href is inspectable
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock CATEGORY_GROUPS so the Shop column renders without the real module
vi.mock('@/lib/category-groups', () => ({ CATEGORY_GROUPS: ['Wine', 'Spirits'] }));

describe('Footer', () => {
  it('renders the About link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'About' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/about');
  });

  it('renders the Contact link', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'Contact' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/contact');
  });

  it('renders B2B link pointing to b2b.wnlq9.shop', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: 'B2B' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('https://b2b.wnlq9.shop');
  });
});
