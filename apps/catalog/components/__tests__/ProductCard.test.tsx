import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img src={src} alt={alt} />;
  },
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const baseProduct: PublicProduct = {
  sku: 'WN-1234',
  name: 'Château Test Grand Cru 2018',
  price: 1600,
  brand: 'Château Test',
  region: 'Bordeaux',
  image_url: 'https://th.wine-now.com/media/test.jpg',
  is_in_stock: true,
};

describe('ProductCard', () => {
  it('renders the product name', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText('Château Test Grand Cru 2018')).toBeInTheDocument();
  });

  it('renders the formatted ฿ price', () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.getByText('฿1,600')).toBeInTheDocument();
  });

  it('links to /product/[sku]', () => {
    render(<ProductCard product={baseProduct} />);
    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/product/WN-1234');
    expect(link).toBeTruthy();
  });

  // Regression guard: the OOS indicator copy was changed from "Out of stock" to
  // "Check availability" in PR #21 (softer wording). These tests assert the
  // CURRENT label — do not revert them to /out of stock/, that text no longer
  // renders. See ProductCard.tsx (the `!inStock` overlay).
  it('shows the out-of-stock indicator when is_in_stock is false (boolean)', () => {
    render(<ProductCard product={{ ...baseProduct, is_in_stock: false }} />);
    expect(screen.getByText(/check availability/i)).toBeInTheDocument();
  });

  it('shows the out-of-stock indicator for the real export shape (string "0")', () => {
    // The live export stores is_in_stock as the STRING "0"/"1", not a boolean.
    render(
      <ProductCard
        product={{ ...baseProduct, is_in_stock: '0' as unknown as boolean }}
      />,
    );
    expect(screen.getByText(/check availability/i)).toBeInTheDocument();
  });

  it('does NOT show the out-of-stock indicator when in stock (string "1")', () => {
    render(
      <ProductCard
        product={{ ...baseProduct, is_in_stock: '1' as unknown as boolean }}
      />,
    );
    expect(screen.queryByText(/check availability/i)).not.toBeInTheDocument();
  });

  it('exposes a Quick look button', () => {
    render(<ProductCard product={baseProduct} />);
    expect(
      screen.getByRole('button', { name: /quick look/i }),
    ).toBeInTheDocument();
  });
});
