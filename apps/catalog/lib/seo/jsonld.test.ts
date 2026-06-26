// apps/catalog/lib/seo/jsonld.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildWebSiteOrganization,
  buildProductSchema,
  buildBreadcrumbList,
  buildLocalBusiness,
  buildCollectionPage,
  buildItemList,
} from './jsonld';
import type { PublicProduct } from '@/lib/types';

const BASE = 'https://wnlq9-catalog.vercel.app';

const mockProduct: PublicProduct = {
  sku: 'WRW2106AC',
  name: 'Coastal Ridge Cabernet Sauvignon',
  price: 700,
  brand: 'Coastal Ridge',
  category_type: 'Red Wine',
  category_group: 'Wine',
  country: 'USA',
  region: 'California',
  variety: 'Cabernet Sauvignon',
  vintage: '2020',
  body: 'Full',
  acidity: 'Medium-High',
  desc_en_short: 'Full-bodied California Cabernet.',
  image_url: 'https://th.wine-now.com/media/catalog/product/w/r/wrw2106ac_1.jpg',
  is_in_stock: true,
  food_matching: 'Grilled red meat | Lamb dishes',
  flavor_tags: ['Blackcurrant', 'Cedar'],
} as unknown as PublicProduct;

const mockArchivedProduct: PublicProduct = {
  ...mockProduct,
  sku: 'ARC001',
  custom_stock_status: 'CATALOG',
  is_in_stock: false,
} as unknown as PublicProduct;

const mockScoredProduct: PublicProduct = {
  ...mockProduct,
  score_summary: JSON.stringify({
    critics: [
      { critic: 'James Suckling', score_value: 98 },
      { critic: 'Wine Advocate', score_value: 96 },
    ],
  }),
} as unknown as PublicProduct;

describe('buildWebSiteOrganization', () => {
  it('returns @graph with WebSite and Organization', () => {
    const schema = buildWebSiteOrganization();
    expect(schema['@context']).toBe('https://schema.org');
    const graph = schema['@graph'] as object[];
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('WebSite');
    expect(graph[1]['@type']).toBe('Organization');
  });
  it('does NOT include SearchAction (no server search URL)', () => {
    const schema = buildWebSiteOrganization();
    const website = (schema['@graph'] as object[])[0];
    expect(website).not.toHaveProperty('potentialAction');
  });
});

describe('buildProductSchema', () => {
  it('maps required fields', () => {
    const schema = buildProductSchema(mockProduct);
    expect(schema['@type']).toBe('Product');
    expect(schema.sku).toBe('WRW2106AC');
    expect(schema.name).toBe('Coastal Ridge Cabernet Sauvignon');
    expect(schema.brand).toEqual({ '@type': 'Brand', name: 'Coastal Ridge' });
    expect(schema.category).toBe('Red Wine');
    expect(schema.countryOfOrigin).toBe('USA');
  });
  it('sets InStock availability for in-stock product', () => {
    const schema = buildProductSchema(mockProduct);
    expect(schema.offers.availability).toBe('https://schema.org/InStock');
  });
  it('sets Discontinued for archived product', () => {
    const schema = buildProductSchema(mockArchivedProduct);
    expect(schema.offers.availability).toBe('https://schema.org/Discontinued');
  });
  it('omits aggregateRating when no score_summary', () => {
    const schema = buildProductSchema(mockProduct);
    expect(schema).not.toHaveProperty('aggregateRating');
  });
  it('builds aggregateRating as MEAN of critics, not max', () => {
    const schema = buildProductSchema(mockScoredProduct);
    expect(schema.aggregateRating).toBeDefined();
    expect(schema.aggregateRating.ratingValue).toBe('97.0'); // (98+96)/2
    expect(schema.aggregateRating.bestRating).toBe('100');
    expect(schema.aggregateRating.worstRating).toBe('50');
    expect(schema.aggregateRating.ratingCount).toBe(2);
  });
  it('does NOT use classification for category — uses category_type', () => {
    const productWithClassification = {
      ...mockProduct,
      classification: 'Wine product',
      category_type: 'Red Wine',
    } as unknown as PublicProduct;
    const schema = buildProductSchema(productWithClassification);
    expect(schema.category).toBe('Red Wine');
    expect(schema.category).not.toBe('Wine product');
  });
  it('omits vintage from additionalProperty if not a 4-digit year', () => {
    const noVintage = { ...mockProduct, vintage: 'Current vintage' } as unknown as PublicProduct;
    const schema = buildProductSchema(noVintage);
    const props = schema.additionalProperty as Array<{ name: string; value: string }> | undefined;
    expect(props?.find((p) => p.name === 'Vintage')).toBeUndefined();
  });
  it('includes vintage in additionalProperty if 4-digit year', () => {
    const schema = buildProductSchema(mockProduct); // vintage: '2020'
    const props = schema.additionalProperty as Array<{ name: string; value: string }>;
    expect(props.find((p) => p.name === 'Vintage')?.value).toBe('2020');
  });
});

describe('buildBreadcrumbList', () => {
  it('uses absolute URLs for all items except last', () => {
    const schema = buildBreadcrumbList('Coastal Ridge Cabernet', 'Wine', 'wine');
    const items = schema.itemListElement as object[];
    expect(items[0]['item']).toMatch(/^https:\/\//);
    expect(items[1]['item']).toMatch(/^https:\/\//);
    expect(items[2]).not.toHaveProperty('item');
  });
  it('points category breadcrumb to static /shop/[slug] not query param', () => {
    const schema = buildBreadcrumbList('Some Whisky', 'Whisky', 'whisky');
    const items = schema.itemListElement as object[];
    expect(items[1]['item']).toBe(`${BASE}/shop/whisky`);
    expect(items[1]['item']).not.toContain('?group=');
  });
});

describe('buildLocalBusiness', () => {
  it('shares @id with Organization', () => {
    const schema = buildLocalBusiness();
    expect(schema['@id']).toBe(`${BASE}/#organization`);
  });
  it('does not include address field when none provided', () => {
    const schema = buildLocalBusiness();
    expect(schema).not.toHaveProperty('address');
  });
});

describe('buildItemList', () => {
  it('caps list at 20 items', () => {
    const products = Array.from({ length: 30 }, (_, i) => ({
      ...mockProduct,
      sku: `SKU${i}`,
      name: `Product ${i}`,
    })) as unknown as PublicProduct[];
    const schema = buildItemList(products, 'Wine', 'wine', 6983);
    expect((schema.itemListElement as object[]).length).toBeLessThanOrEqual(20);
  });
  it('includes numberOfItems as total group count, not capped list length', () => {
    const schema = buildItemList([mockProduct], 'Wine', 'wine', 6983);
    expect(schema.numberOfItems).toBe(6983);
  });
});
