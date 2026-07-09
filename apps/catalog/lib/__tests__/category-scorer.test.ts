import { describe, it, expect } from 'vitest';
import { categorySignalPoints, regionWeightOverride } from '@/lib/category-scorer';

const mkProduct = (overrides: any) => ({
  sku: 'X', name: 'X', category_group: 'Spirits', category_type: 'Gin',
  region: 'UK', country: 'UK', is_in_stock: true,
  ...overrides,
}) as any;

describe('categorySignalPoints', () => {
  it('gin_style match scores +3', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y', gin_style: 'contemporary_citrus' });
    expect(categorySignalPoints(subject, candidate)).toBe(3);
  });
  it('gin_style mismatch scores 0', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y', gin_style: 'juniper_forward' });
    expect(categorySignalPoints(subject, candidate)).toBe(0);
  });
  it('missing gin_style scores 0 (no penalty)', () => {
    const subject = mkProduct({ gin_style: 'contemporary_citrus' });
    const candidate = mkProduct({ sku: 'Y' }); // no gin_style
    expect(categorySignalPoints(subject, candidate)).toBe(0);
  });
  it('agave_aging match scores +3 for Tequila', () => {
    const subject = mkProduct({ category_type: 'Tequila', agave_aging: 'blanco' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Tequila', agave_aging: 'blanco' });
    expect(categorySignalPoints(subject, candidate)).toBe(3);
  });
  it('agave_aging mismatch (blanco vs anejo) scores 0', () => {
    const subject = mkProduct({ category_type: 'Tequila', agave_aging: 'blanco' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Tequila', agave_aging: 'anejo' });
    expect(categorySignalPoints(subject, candidate)).toBe(0);
  });
  it('peat_level match scores +3 for Whisky', () => {
    const subject = mkProduct({ category_group: 'Whisky', peat_level: 'heavy' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Whisky', peat_level: 'heavy' });
    expect(categorySignalPoints(subject, candidate)).toBe(3);
  });
  it('peat_level match surfaces cross-distillery heavy-peat', () => {
    // Two "heavy peat" whiskies — Ardbeg (Islay) and Yoichi (Japan)
    const ardbeg = mkProduct({ sku: 'ARD', category_group: 'Whisky', region: 'Islay', peat_level: 'heavy' });
    const yoichi = mkProduct({ sku: 'YOI', category_group: 'Whisky', region: 'Hokkaido', peat_level: 'heavy' });
    const points = categorySignalPoints(ardbeg, yoichi);
    expect(points).toBe(3); // peat match alone gives +3, sufficient to surface cross-region
  });
  it('rum_style match scores +3', () => {
    const subject = mkProduct({ category_type: 'Rum', rum_style: 'spiced' });
    const candidate = mkProduct({ sku: 'Y', category_type: 'Rum', rum_style: 'spiced' });
    expect(categorySignalPoints(subject, candidate)).toBe(3);
  });
  it('production_method match scores +3 for Sparkling', () => {
    const subject = mkProduct({ category_group: 'Wine', category_type: 'Champagne', production_method: 'traditional_method' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Wine', category_type: 'Sparkling Wine', production_method: 'traditional_method' });
    expect(categorySignalPoints(subject, candidate)).toBe(3);
  });
  it('production_method mismatch (traditional vs tank) scores 0', () => {
    const subject = mkProduct({ category_group: 'Wine', category_type: 'Champagne', production_method: 'traditional_method' });
    const candidate = mkProduct({ sku: 'Y', category_group: 'Wine', category_type: 'Sparkling Wine', production_method: 'tank_method' });
    expect(categorySignalPoints(subject, candidate)).toBe(0);
  });
  it('scores 0 when no category-specific fields present (no penalty)', () => {
    const subject = mkProduct({ category_type: 'Gin' }); // no gin_style
    const candidate = mkProduct({ sku: 'Y' });
    expect(categorySignalPoints(subject, candidate)).toBe(0);
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
