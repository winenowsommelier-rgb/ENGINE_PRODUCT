import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCardB2B } from './ProductCardB2B';
import type { B2BProduct } from '@/lib/types';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const BASE: B2BProduct = {
  sku: 'WR001',
  name: 'Test Rouge',
  b2b_price: 450,
  country: 'France',
  is_in_stock: true,
};

describe('ProductCardB2B', () => {
  it('renders b2b_price formatted', () => {
    render(<ProductCardB2B product={BASE} />);
    expect(screen.getByText('฿450')).toBeTruthy();
  });

  it('renders critic score pill from score_summary', () => {
    render(<ProductCardB2B product={{ ...BASE, score_summary: '93 pts' }} />);
    expect(screen.getByText('93')).toBeTruthy();
  });

  it('does not render any price/NaN/undefined text from missing price field', () => {
    render(<ProductCardB2B product={BASE} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');
  });

  it('does not render a strikethrough or discount element', () => {
    const { container } = render(<ProductCardB2B product={BASE} />);
    expect(container.querySelector('s, del, [class*="line-through"]')).toBeNull();
  });

  it('shows EXPRESS badge when wn_stock > 0', () => {
    render(<ProductCardB2B product={{ ...BASE, wn_stock: 5 }} />);
    expect(screen.getByText('EXPRESS')).toBeTruthy();
  });

  it('shows ARCHIVE badge when custom_stock_status is CATALOG', () => {
    render(<ProductCardB2B product={{ ...BASE, custom_stock_status: 'CATALOG' }} />);
    expect(screen.getByText('ARCHIVE')).toBeTruthy();
  });
});
