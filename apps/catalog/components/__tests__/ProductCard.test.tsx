import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductCard } from '@/components/ProductCard';
import { PriceUnlockProvider } from '@/components/PriceUnlockProvider';
import type { PublicProduct } from '@/lib/types';

// ProductCard renders prices through PriceDisplay, which requires a
// PriceUnlockProvider ancestor. Most assertions here care about card
// content/structure, not the price gate itself, so tests render "unlocked"
// (real ฿ price visible) by default via sessionStorage — see the price-gate
// specific assertions in PriceDisplay.test.tsx for the locked-state behavior.
function renderUnlocked(ui: React.ReactElement) {
  sessionStorage.setItem('wnlq9_price_unlocked', '1');
  return render(<PriceUnlockProvider>{ui}</PriceUnlockProvider>);
}

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

// ProductCard now always renders SaveToListButton (Task 7), which calls
// useRouter() and imports the 'use server' actions module -- neither works
// unmocked under vitest/jsdom (no app router context, no server runtime).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/lists', () => ({
  pinToDefaultListAction: vi.fn(),
  addItemToListAction: vi.fn(),
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
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the product name with the redundant brand prefix stripped, and the brand as a separate label', () => {
    // baseProduct.name ("Château Test Grand Cru 2018") starts with
    // baseProduct.brand ("Château Test"), so the title shows only the
    // remainder while the brand still renders on its own, once, as a
    // clickable subtitle (see the "brand subtitle" test below).
    renderUnlocked(<ProductCard product={baseProduct} />);
    expect(screen.getByText('Grand Cru 2018')).toBeInTheDocument();
    expect(screen.queryByText('Château Test Grand Cru 2018')).not.toBeInTheDocument();
  });

  it('renders the brand as a clickable subtitle that filters /shop by brand', () => {
    renderUnlocked(<ProductCard product={baseProduct} />);
    const brandLink = screen.getByText('Château Test');
    expect(brandLink).toBeInTheDocument();
    expect(brandLink.getAttribute('role')).toBe('link');
  });

  it('renders the formatted ฿ price', () => {
    renderUnlocked(<ProductCard product={baseProduct} />);
    expect(screen.getByText('฿1,600')).toBeInTheDocument();
  });

  it('links to /product/[sku]', () => {
    renderUnlocked(<ProductCard product={baseProduct} />);
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
    renderUnlocked(<ProductCard product={{ ...baseProduct, is_in_stock: false }} />);
    expect(screen.getByText(/check availability/i)).toBeInTheDocument();
  });

  it('shows the out-of-stock indicator for the real export shape (string "0")', () => {
    // The live export stores is_in_stock as the STRING "0"/"1", not a boolean.
    renderUnlocked(
      <ProductCard
        product={{ ...baseProduct, is_in_stock: '0' as unknown as boolean }}
      />,
    );
    expect(screen.getByText(/check availability/i)).toBeInTheDocument();
  });

  it('does NOT show the out-of-stock indicator when in stock (string "1")', () => {
    renderUnlocked(
      <ProductCard
        product={{ ...baseProduct, is_in_stock: '1' as unknown as boolean }}
      />,
    );
    expect(screen.queryByText(/check availability/i)).not.toBeInTheDocument();
  });

  it('exposes a Quick look button', () => {
    renderUnlocked(<ProductCard product={baseProduct} />);
    expect(
      screen.getByRole('button', { name: /quick look/i }),
    ).toBeInTheDocument();
  });
});
