import { describe, it, expect } from 'vitest';
import { B2B_PUBLIC_FIELDS, toPublicProductB2B } from './catalog-data';

const RAW_B2B = {
  sku: 'WR001',
  name: 'Test Rouge',
  b2b_price: 450,
  price: 599,               // RETAIL — must be stripped
  margin_pct: 0.25,         // MARGIN — must be stripped
  b2b_margin_pct: 0.18,     // MARGIN — must be stripped
  cost: 360,                // COST — must be stripped
  b2b_discount_pct: 0.12,   // DISCOUNT — must be stripped
  popularity_score: 0.9,    // RAW SCORE — must be stripped (only tier ships)
  score_summary: '93 pts',
  score_max: 100,
  country: 'France',
  region: 'Bordeaux',
  is_in_stock: '1',
  category_group: 'Wine',
  category_type: 'Red Wine',
};

const FORBIDDEN = [
  'price', 'special_price', 'sp_discount_pct', 'b2b_discount_pct',
  'margin_pct', 'b2b_margin_pct', 'b2b_margin_thb', 'cost', 'popularity_score',
];

describe('B2B_PUBLIC_FIELDS', () => {
  it('includes b2b_price', () => {
    expect(B2B_PUBLIC_FIELDS).toContain('b2b_price');
  });
  it('includes score_summary', () => {
    expect(B2B_PUBLIC_FIELDS).toContain('score_summary');
  });
  it('does not include any forbidden field', () => {
    for (const f of FORBIDDEN) {
      expect(B2B_PUBLIC_FIELDS).not.toContain(f);
    }
  });
});

describe('toPublicProductB2B', () => {
  it('copies b2b_price', () => {
    const p = toPublicProductB2B(RAW_B2B);
    expect(p.b2b_price).toBe(450);
  });
  it('strips all forbidden fields', () => {
    const p = toPublicProductB2B(RAW_B2B) as unknown as Record<string, unknown>;
    for (const f of FORBIDDEN) {
      expect(p[f]).toBeUndefined();
    }
  });
  it('attaches popularity_tier from bucket arg', () => {
    const p = toPublicProductB2B(RAW_B2B, 2);
    expect(p.popularity_tier).toBe(2);
  });
  it('coerces is_in_stock string to boolean', () => {
    const p = toPublicProductB2B(RAW_B2B);
    expect(p.is_in_stock).toBe(true);
    const p2 = toPublicProductB2B({ ...RAW_B2B, is_in_stock: '0' });
    expect(p2.is_in_stock).toBe(false);
  });
  it('keeps score_summary', () => {
    const p = toPublicProductB2B(RAW_B2B);
    expect(p.score_summary).toBe('93 pts');
  });
  it('does NOT set a price field (no retail price)', () => {
    const p = toPublicProductB2B(RAW_B2B) as unknown as Record<string, unknown>;
    expect(p['price']).toBeUndefined();
  });
});
