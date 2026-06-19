import { describe, it, expect } from 'vitest';
import {
  groupForClassification,
  groupForProduct,
  accessoryCategoryForSku,
  classificationsInGroup,
  CATEGORY_GROUPS,
} from '@/lib/category-groups';

describe('category grouping', () => {
  it('maps Red Wine -> Wine', () => expect(groupForClassification('Red Wine')).toBe('Wine'));
  it('maps Whiskey and Whisky -> Whisky', () => {
    expect(groupForClassification('Whisky')).toBe('Whisky');
    expect(groupForClassification('Whiskey')).toBe('Whisky');
  });
  it('maps Gin/Vodka/Rum -> Spirits', () => {
    expect(groupForClassification('Gin')).toBe('Spirits');
    expect(groupForClassification('Vodka')).toBe('Spirits');
    expect(groupForClassification('Rum')).toBe('Spirits');
  });
  it('maps Sake/Shochu -> Sake & Asian', () => expect(groupForClassification('Sake/Shochu')).toBe('Sake & Asian'));
  it('maps Beer -> Beer & RTD', () => expect(groupForClassification('Beer')).toBe('Beer & RTD'));
  it('maps Glassware -> Accessories', () => expect(groupForClassification('Glassware')).toBe('Accessories'));
  it('splits pipe-delimited (Red Wine|Fruit Wine) -> Wine', () =>
    expect(groupForClassification('Red Wine|Fruit Wine')).toBe('Wine'));
  it('unknown -> Accessories (catch-all)', () =>
    expect(groupForClassification('Mystery Thing')).toBe('Accessories'));
  it('handles null/empty -> Accessories', () => {
    expect(groupForClassification(null as any)).toBe('Accessories');
    expect(groupForClassification('')).toBe('Accessories');
  });
  it('exposes <= 7 ordered groups, Wine first', () => {
    expect(CATEGORY_GROUPS.length).toBeLessThanOrEqual(7);
    expect(CATEGORY_GROUPS[0]).toBe('Wine');
  });

  // Helper: classificationsInGroup returns raw classifications mapping to a group
  it('classificationsInGroup(Whisky) returns Whisky + Whiskey', () => {
    const inGroup = classificationsInGroup('Whisky');
    expect(inGroup).toContain('Whisky');
    expect(inGroup).toContain('Whiskey');
  });
  it('every classification returned by classificationsInGroup maps back to that group', () => {
    for (const group of CATEGORY_GROUPS) {
      for (const raw of classificationsInGroup(group)) {
        expect(groupForClassification(raw)).toBe(group);
      }
    }
  });
});

// REGRESSION GUARD: the raw `classification` field is unreliable for the 1,509
// "Wine product" rows — only ~84 are actually wine. The other ~1,425 are whisky,
// spirits, sake, beer, non-alc, and accessories that were dumped into "Wine product"
// and were ALL landing in the Wine tab. SKU prefix is the reliable signal and must
// override classification. Verified examples come straight from the real export.
describe('groupForProduct — SKU prefix overrides bad classification', () => {
  it('LWH whisky mislabeled "Wine product" -> Whisky (Johnnie Walker)', () =>
    expect(groupForProduct({ sku: 'LWH0078BU', classification: 'Wine product' })).toBe('Whisky'));
  it('LGN gin mislabeled "Wine product" -> Spirits (Tanqueray)', () =>
    expect(groupForProduct({ sku: 'LGN0012XX', classification: 'Wine product' })).toBe('Spirits'));
  it('LTQ/LRM/LVK/LBD/LLQ/LGP -> Spirits', () => {
    for (const p of ['LTQ', 'LRM', 'LVK', 'LBD', 'LLQ', 'LGP']) {
      expect(groupForProduct({ sku: `${p}0001`, classification: 'Wine product' })).toBe('Spirits');
    }
  });
  it('LSK/LSJ sake mislabeled "Wine product" -> Sake & Asian', () => {
    expect(groupForProduct({ sku: 'LSK0001', classification: 'Wine product' })).toBe('Sake & Asian');
    expect(groupForProduct({ sku: 'LSJ0001', classification: 'Wine product' })).toBe('Sake & Asian');
  });
  it('LBE beer + NNA non-alc mislabeled "Wine product" -> Beer & RTD', () => {
    expect(groupForProduct({ sku: 'LBE0258AX', classification: 'Wine product' })).toBe('Beer & RTD');
    expect(groupForProduct({ sku: 'NNA0001', classification: 'Wine product' })).toBe('Beer & RTD');
  });
  it('AWC fridge mislabeled "Wine product" -> Accessories', () =>
    expect(groupForProduct({ sku: 'AWC0058', classification: 'Wine product' })).toBe('Accessories'));
  it('ABA/GWN/GLQ/GBE/GDC -> Accessories', () => {
    for (const p of ['ABA', 'GWN', 'GLQ', 'GBE', 'GDC']) {
      expect(groupForProduct({ sku: `${p}0001`, classification: 'Wine product' })).toBe('Accessories');
    }
  });
  it('WEV events (W prefix, but NOT wine) -> Accessories', () =>
    expect(groupForProduct({ sku: 'WEV01', classification: 'Red Wine' })).toBe('Accessories'));
  it('CIG cigars -> Accessories', () =>
    expect(groupForProduct({ sku: 'CIG0001', classification: 'Cigar' })).toBe('Accessories'));

  it('genuine wine (W* prefix) keeps its classification group', () => {
    expect(groupForProduct({ sku: 'WRW0058', classification: 'Wine product' })).toBe('Wine');
    expect(groupForProduct({ sku: 'W001', classification: 'Red Wine' })).toBe('Wine');
  });
  it('falls back to classification when SKU prefix is unknown', () =>
    expect(groupForProduct({ sku: 'ZZZ999', classification: 'Red Wine' })).toBe('Wine'));
  it('missing/empty sku -> classification fallback', () =>
    expect(groupForProduct({ sku: '', classification: 'Gin' })).toBe('Spirits'));
});

describe('accessoryCategoryForSku — drill-down sub-category', () => {
  it('AWC -> Wine Fridges & Coolers', () => expect(accessoryCategoryForSku('AWC0058')).toBe('Wine Fridges & Coolers'));
  it('GWN -> Glassware', () => expect(accessoryCategoryForSku('GWN0001')).toBe('Glassware'));
  it('CIG -> Cigars', () => expect(accessoryCategoryForSku('CIG0001')).toBe('Cigars'));
  it('ABA -> Bar Tools & Gifts', () => expect(accessoryCategoryForSku('ABA0001')).toBe('Bar Tools & Gifts'));
  it('WEV -> Events', () => expect(accessoryCategoryForSku('WEV01')).toBe('Events'));
  it('non-accessory sku -> null', () => expect(accessoryCategoryForSku('W001')).toBeNull());
});
