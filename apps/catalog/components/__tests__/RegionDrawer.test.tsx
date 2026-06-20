import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/image (repo convention — real next/image rejects relative src in jsdom).
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src?: string; alt: string }) => {
    const { src, alt } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src ?? ''} alt={alt} />;
  },
}));

import { RegionDrawer } from '@/components/explore/RegionDrawer';
import type { MapRegion } from '@/lib/explore/types';

const region: MapRegion = {
  name: 'Bordeaux', slug: 'bordeaux', country: 'France', lat: 44.8, lng: -0.6,
  total: 323, countsByGroup: { Wine: 321, Liqueur: 2 }, priceRange: { min: 890, max: 48000 },
  peeks: [{ sku: 'WIN1', name: 'Ch. Test', price: 1200, image_url: 'a.jpg' }],
};

describe('RegionDrawer', () => {
  it('shows name, lens count, price range, and a /shop CTA with region NAME', () => {
    render(<RegionDrawer region={region} lens="wine" onClose={() => {}} />);
    expect(screen.getByText('Bordeaux')).toBeInTheDocument();
    expect(screen.getByText(/321 bottles/)).toBeInTheDocument(); // wine lens count
    const cta = screen.getByRole('link', { name: /view all/i });
    expect(cta).toHaveAttribute('href', expect.stringContaining('region=Bordeaux'));
    expect(cta).toHaveAttribute('href', expect.stringContaining('country=France'));
  });
  it('peek links to the product page', () => {
    render(<RegionDrawer region={region} lens="all" onClose={() => {}} />);
    expect(screen.getByRole('link', { name: /ch\. test/i })).toHaveAttribute('href', '/product/WIN1');
  });
});
