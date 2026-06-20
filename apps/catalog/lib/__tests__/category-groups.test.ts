import { describe, it, expect } from 'vitest';
import {
  groupForProduct,
  typeForProduct,
  accessoryCategoryForSku,
  CATEGORY_GROUPS,
} from '@/lib/category-groups';

// HISTORY: category-groups.ts used to own a 6-group model + a CLASSIFICATION_TO_GROUP
// map keyed off the unreliable `classification` field. It is now a thin shim over the
// canonical SKU-derived taxonomy in lib/sku-taxonomy.ts (data/taxonomy/sku_prefix_map.json),
// which defines 10 shopper-facing groups. groupForProduct now prefers the backfilled
// `category_group` field, else resolves from the SKU. These tests assert the NEW model.

describe('category grouping — 10-group SKU-derived model', () => {
  it('exposes the 10 ordered groups, Wine first', () => {
    expect(CATEGORY_GROUPS.length).toBe(10);
    expect(CATEGORY_GROUPS[0]).toBe('Wine');
    expect([...CATEGORY_GROUPS]).toEqual([
      'Wine', 'Whisky', 'Spirits', 'Sake & Asian', 'Liqueur',
      'Beer & RTD', 'Non-Alcoholic', 'Cigars', 'Events', 'Accessories',
    ]);
  });
});

// REGRESSION GUARD: the raw `classification` field is unreliable for the 1,509
// "Wine product" rows — only ~84 are actually wine. The other ~1,425 are whisky,
// spirits, sake, beer, non-alc, and accessories that were dumped into "Wine product"
// and were ALL landing in the Wine tab. SKU prefix is the reliable signal. With the
// canonical taxonomy, groupForProduct prefers the backfilled category_group, else
// resolves the group from the SKU — classification is no longer consulted at all.
describe('groupForProduct — SKU/canonical-field overrides bad classification', () => {
  it('LWH whisky mislabeled "Wine product" -> Whisky (by SKU)', () =>
    expect(groupForProduct({ sku: 'LWH0078BU', classification: 'Wine product' } as any)).toBe('Whisky'));
  it('LGN gin mislabeled "Wine product" -> Spirits (by SKU)', () =>
    expect(groupForProduct({ sku: 'LGN0012XX', classification: 'Wine product' } as any)).toBe('Spirits'));
  it('LSK/LSJ sake mislabeled "Wine product" -> Sake & Asian', () => {
    expect(groupForProduct({ sku: 'LSK0001' } as any)).toBe('Sake & Asian');
    expect(groupForProduct({ sku: 'LSJ0001' } as any)).toBe('Sake & Asian');
  });
  it('LBE beer -> Beer & RTD', () =>
    expect(groupForProduct({ sku: 'LBE0258AX' } as any)).toBe('Beer & RTD'));
  it('AWC fridge mislabeled "Wine product" -> Accessories', () =>
    expect(groupForProduct({ sku: 'AWC0058', classification: 'Wine product' } as any)).toBe('Accessories'));
  it('ABA bar tools + glassware (G*) -> Accessories', () => {
    for (const p of ['ABA', 'GWN', 'GLQ', 'GBE', 'GDC']) {
      expect(groupForProduct({ sku: `${p}0001` } as any)).toBe('Accessories');
    }
  });
  it('CIG cigars -> Cigars (own group in the 10-group model)', () =>
    expect(groupForProduct({ sku: 'CIG0001' } as any)).toBe('Cigars'));
  it('WEV events -> Events (own group; W prefix but NOT wine)', () =>
    expect(groupForProduct({ sku: 'WEV01' } as any)).toBe('Events'));
  it('genuine wine (W* prefix) -> Wine', () => {
    expect(groupForProduct({ sku: 'WRW0058' } as any)).toBe('Wine');
  });

  // The backfilled category_group is the PRIMARY signal and is preferred over SKU.
  it('prefers the backfilled category_group field when present', () =>
    expect(groupForProduct({ sku: 'LWH0001', category_group: 'Whisky' } as any)).toBe('Whisky'));
});

describe('typeForProduct — canonical sub-type', () => {
  it('prefers the backfilled category_type field', () =>
    expect(typeForProduct({ sku: 'WRW0001', category_type: 'Red Wine' } as any)).toBe('Red Wine'));
  it('falls back to resolving the type from the SKU', () =>
    expect(typeForProduct({ sku: 'CIG0001' } as any)).toBe('Cigar'));
});

describe('accessoryCategoryForSku — drill-down sub-category (canonical values)', () => {
  it('AWC -> Wine Coolers & Fridges', () => expect(accessoryCategoryForSku('AWC0058')).toBe('Wine Coolers & Fridges'));
  it('GWN -> Glassware', () => expect(accessoryCategoryForSku('GWN0001')).toBe('Glassware'));
  it('ABA -> Bar Tools & Gifts', () => expect(accessoryCategoryForSku('ABA0001')).toBe('Bar Tools & Gifts'));
  // CIG and WEV are now their OWN top-level groups, NOT accessories, so they return null here.
  it('CIG (now its own Cigars group) -> null', () => expect(accessoryCategoryForSku('CIG0001')).toBeNull());
  it('WEV (now its own Events group) -> null', () => expect(accessoryCategoryForSku('WEV01')).toBeNull());
  it('non-accessory sku -> null', () => expect(accessoryCategoryForSku('WRW0001')).toBeNull());
});
