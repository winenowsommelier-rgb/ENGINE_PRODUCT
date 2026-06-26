// apps/catalog/lib/seo/faq-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildFaqData } from './faq-builder';
import type { PublicProduct } from '@/lib/types';

const BASE = 'https://wnlq9-catalog.vercel.app';

const mockProducts = [
  {
    sku: 'WCH001', name: 'Château Test', price: 5000,
    region: 'Bordeaux', country: 'France', variety: 'Cabernet Sauvignon',
    is_in_stock: true, category_type: 'Red Wine', category_group: 'Wine',
    score_summary: JSON.stringify({ critics: [{ critic: 'James Suckling', score_value: 96 }] }),
  },
  {
    sku: 'WCH002', name: 'Château Test 2', price: 2000,
    region: 'Bordeaux', country: 'France', variety: 'Merlot',
    is_in_stock: true, category_type: 'Red Wine', category_group: 'Wine',
  },
] as unknown as PublicProduct[];

describe('buildFaqData', () => {
  it('returns 3 QA items for region with scored products', () => {
    const result = buildFaqData('bordeaux', 'Bordeaux', 'France', mockProducts, '/contact');
    expect(result.qaItems).toHaveLength(3);
  });
  it('returns 2 QA items for region with no scored products', () => {
    const unscored = mockProducts.map(p => ({ ...p, score_summary: undefined })) as unknown as PublicProduct[];
    const result = buildFaqData('bordeaux', 'Bordeaux', 'France', unscored, '/contact');
    expect(result.qaItems).toHaveLength(2);
  });
  it('schema FAQPage mirrors qaItems exactly', () => {
    const result = buildFaqData('bordeaux', 'Bordeaux', 'France', mockProducts, '/contact');
    const schemaItems = result.schema.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(schemaItems).toHaveLength(result.qaItems.length);
    schemaItems.forEach((item, i) => {
      expect(item.name).toBe(result.qaItems[i].question);
      expect(item.acceptedAnswer.text).toBe(result.qaItems[i].answer);
    });
  });
  it('includes variety names in Q1 answer', () => {
    const result = buildFaqData('bordeaux', 'Bordeaux', 'France', mockProducts, '/contact');
    expect(result.qaItems[0].answer).toContain('Cabernet Sauvignon');
  });
  it('includes price range in Q1 answer', () => {
    const result = buildFaqData('bordeaux', 'Bordeaux', 'France', mockProducts, '/contact');
    expect(result.qaItems[0].answer).toMatch(/฿\d/);
  });
});
