/// <reference types="jest" />

import { calculateSupplierPrice } from '@/lib/supplier-intake/pricing';

describe('calculateSupplierPrice', () => {
  it('uses supplier RSP when hybrid mode has valid RSP', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      supplierRsp: 890,
      currentWebsitePrice: 820,
      rule: {
        mode: 'hybrid',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.final_selling_price).toBe(890);
    expect(result.decision_source).toBe('supplier_rsp');
    expect(result.status).toBe('auto_approved');
  });

  it('falls back to formula when hybrid mode has no RSP', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      currentWebsitePrice: 820,
      rule: {
        mode: 'hybrid',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.final_selling_price).toBe(700);
    expect(result.decision_source).toBe('formula');
  });

  it('blocks prices below minimum margin', () => {
    const result = calculateSupplierPrice({
      cost: 455,
      supplierRsp: 500,
      currentWebsitePrice: 820,
      rule: {
        mode: 'supplier_rsp',
        target_margin_pct: 35,
        minimum_margin_pct: 25,
        vat_pct: 0,
        rounding: 'nearest_10',
        review_price_change_pct: 20,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.issues).toContain('Margin below minimum');
  });
});
