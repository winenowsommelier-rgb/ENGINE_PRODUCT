import { describe, it, expect } from 'vitest';
import { categorySignalPoints, regionWeightOverride } from '@/lib/category-scorer';

const mkProduct = (overrides: any) => ({
  sku: 'X', name: 'X', category_group: 'Spirits', category_type: 'Gin',
  region: 'UK', country: 'UK', is_in_stock: true,
  ...overrides,
}) as any;

describe('categorySignalPoints', () => {
  it('gin_style match scores +3 under the gin_style key', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y', gin_style: 'contemporary_citrus' });
    const result = categorySignalPoints(subject, candidate);
    expect(result?.points).toBe(3);
    expect(result?.field).toBe('gin_style');
  });
  it('gin_style mismatch scores null', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y', gin_style: 'juniper_forward' });
    expect(categorySignalPoints(subject, candidate)).toBeNull();
  });
  it('missing gin_style scores null (no penalty)', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y' }); // no gin_style
    expect(categorySignalPoints(subject, candidate)).toBeNull();
  });
  it('agave_aging match scores +3 under the agave_aging key for Tequila', () => {
    const subject = mkProduct({ category_type: 'Tequila', agave_aging: 'blanco' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Tequila', agave_aging: 'blanco' });
    const result = categorySignalPoints(subject, candidate);
    expect(result?.points).toBe(3);
    expect(result?.field).toBe('agave_aging');
  });
  it('agave_aging mismatch (blanco vs anejo) scores null', () => {
    const subject = mkProduct({ category_type: 'Tequila', agave_aging: 'blanco' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Tequila', agave_aging: 'anejo' });
    expect(categorySignalPoints(subject, candidate)).toBeNull();
  });
  it('peat_level match scores +3 under the peat_level key for Whisky', () => {
    const subject = mkProduct({ category_group: 'Whisky', peat_level: 'heavy' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Whisky', peat_level: 'heavy' });
    const result = categorySignalPoints(subject, candidate);
    expect(result?.points).toBe(3);
    expect(result?.field).toBe('peat_level');
  });
  it('peat_level match surfaces cross-distillery heavy-peat', () => {
    // Two "heavy peat" whiskies — Ardbeg (Islay) and Yoichi (Japan)
    const ardbeg = mkProduct({ sku: 'ARD', category_group: 'Whisky', region: 'Islay', peat_level: 'heavy' });
    const yoichi = mkProduct({ sku: 'YOI', category_group: 'Whisky', region: 'Hokkaido', peat_level: 'heavy' });
    const result = categorySignalPoints(ardbeg, yoichi);
    expect(result?.points).toBe(3); // peat match alone gives +3, sufficient to surface cross-region
    expect(result?.field).toBe('peat_level');
  });
  it('rum_style match scores +3 under the rum_style key', () => {
    const subject = mkProduct({ category_type: 'Rum', rum_style: 'spiced' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Rum', rum_style: 'spiced' });
    const result = categorySignalPoints(subject, candidate);
    expect(result?.points).toBe(3);
    expect(result?.field).toBe('rum_style');
  });
  it('production_method match scores +3 under the production_method key for Sparkling', () => {
    const subject = mkProduct({ category_group: 'Wine', category_type: 'Champagne', production_method: 'traditional_method' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Wine', category_type: 'Sparkling Wine', production_method: 'traditional_method' });
    const result = categorySignalPoints(subject, candidate);
    expect(result?.points).toBe(3);
    expect(result?.field).toBe('production_method');
  });
  it('production_method mismatch (traditional vs tank) scores null', () => {
    const subject = mkProduct({ category_group: 'Wine', category_type: 'Champagne', production_method: 'traditional_method' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Wine', category_type: 'Sparkling Wine', production_method: 'tank_method' });
    expect(categorySignalPoints(subject, candidate)).toBeNull();
  });
  it('scores null when no category-specific fields present (no penalty)', () => {
    const subject = mkProduct({ category_type: 'Gin' }); // no gin_style
    const candidate = mkProduct({ sku: 'Y' });
    expect(categorySignalPoints(subject, candidate)).toBeNull();
  });
});

describe('regionWeightOverride', () => {
  it('returns 0 for Gin (suppress region)', () => {
    const gin = mkProduct({ category_type: 'Gin' });
    expect(regionWeightOverride(gin)).toBe(0);
  });
  it('returns null for Whisky (use default region weight)', () => {
    const whisky = mkProduct({ category_group: 'Whisky' });
    expect(regionWeightOverride(whisky)).toBeNull();
  });
  it('returns null for Red Wine (use default region weight)', () => {
    const wine = mkProduct({ category_group: 'Wine', category_type: 'Red Wine' });
    expect(regionWeightOverride(wine)).toBeNull();
  });
});
