import { describe, it, expect, vi } from 'vitest';

// We test the 404 logic in isolation: getProductBySku returns null → notFound() called
// Full RSC page rendering is tested via browser walkthrough in Phase 6

const mockNotFound = vi.fn();
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));

vi.mock('@/lib/catalog-data', () => ({
  getProductBySku: (sku: string) => sku === 'KNOWN' ? { sku: 'KNOWN', name: 'Test', b2b_price: 500 } : null,
  getAllProducts: () => [],
}));

// Import after mocks are set up
const { default: ProductDetailPage } = await import('./page');

describe('ProductDetailPage', () => {
  it('calls notFound() when getProductBySku returns null', async () => {
    await ProductDetailPage({ params: Promise.resolve({ sku: 'UNKNOWN-SKU' }) });
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('dynamicParams is true', async () => {
    const mod = await import('./page');
    expect(mod.dynamicParams).toBe(true);
  });
});
