import { describe, it, expect } from 'vitest';
import { stripBrandPrefix } from './product-display';

describe('stripBrandPrefix', () => {
  it('strips a clean single-space prefix', () => {
    expect(stripBrandPrefix('Ardbeg 10 Years (700 ml)', 'Ardbeg')).toBe(
      '10 Years (700 ml)',
    );
  });

  it('strips a multi-word brand prefix', () => {
    expect(
      stripBrandPrefix('Coastal Ridge Cabernet Sauvignon', 'Coastal Ridge'),
    ).toBe('Cabernet Sauvignon');
  });

  it('strips a brand containing internal punctuation', () => {
    expect(
      stripBrandPrefix(
        'Max Ferd. Richter Estate Riesling',
        'Max Ferd. Richter',
      ),
    ).toBe('Estate Riesling');
  });

  it('collapses a double space left after the removed brand prefix', () => {
    // Real data shape: brand_lookup.json entries frequently have two spaces
    // between brand and the rest of the name.
    expect(
      stripBrandPrefix(
        'Talenti  Brunello di Montalcino "Piero" DOCG',
        'Talenti',
      ),
    ).toBe('Brunello di Montalcino "Piero" DOCG');
  });

  it('returns the name unchanged when it does not start with the brand', () => {
    // Real pair: brand is the parent house, name is a sub-label range name.
    expect(
      stripBrandPrefix('Tournon Victoria Shiraz', 'M. Chapoutier'),
    ).toBe('Tournon Victoria Shiraz');
  });

  it('does not strip on a mid-word false-positive prefix match', () => {
    // Word-boundary guard: "Ace" is a literal string-prefix of "Acevedo" but
    // not a whole-word prefix, so nothing should be stripped.
    expect(
      stripBrandPrefix('Acevedo Winery Malbec', 'Ace'),
    ).toBe('Acevedo Winery Malbec');
  });

  it('returns the name unchanged on a case-only mismatch (exact match only)', () => {
    // Real pair from the data: name is all-caps, brand is title-case.
    // Spec decision: no case/punctuation normalization, so this stays
    // un-deduped rather than risk false positives elsewhere.
    expect(stripBrandPrefix('VIK Milla Cala', 'Vik')).toBe('VIK Milla Cala');
  });

  it('returns the original name when name === brand exactly', () => {
    expect(stripBrandPrefix('Talenti', 'Talenti')).toBe('Talenti');
  });

  it('returns the original name when name is brand plus only trailing whitespace', () => {
    expect(stripBrandPrefix('Talenti   ', 'Talenti')).toBe('Talenti   ');
  });

  it('returns the name unchanged when brand is undefined', () => {
    expect(stripBrandPrefix('Some Wine Name', undefined)).toBe(
      'Some Wine Name',
    );
  });

  it('returns the name unchanged when brand is an empty/whitespace-only string', () => {
    expect(stripBrandPrefix('Some Wine Name', '   ')).toBe('Some Wine Name');
  });

  it('strips a leading comma-separator after the brand prefix', () => {
    expect(stripBrandPrefix('Talenti, Reserve', 'Talenti')).toBe('Reserve');
  });

  it('strips a leading dash-separator after the brand prefix', () => {
    expect(stripBrandPrefix('Talenti - Reserve', 'Talenti')).toBe('Reserve');
  });
});
