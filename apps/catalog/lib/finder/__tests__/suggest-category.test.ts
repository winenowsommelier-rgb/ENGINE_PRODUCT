import { describe, it, expect } from 'vitest';
import { suggestCategory, NOVICE_MOMENTS } from '../suggest-category';
import type { FinderCategory } from '../answers';

/**
 * suggestCategory — the novice "help me choose" router. A plain moment/food cue maps
 * to a starting category so a first-timer who doesn't know "Sparkling vs Champagne"
 * still lands in a sensible finder journey. PURE + data-driven (a small map), never
 * a network call. Unknown input returns null so the UI can fall back gracefully.
 */
describe('suggestCategory', () => {
  it('maps steak / red meat → red', () => {
    expect(suggestCategory('steak')).toBe('red');
    expect(suggestCategory('red-meat')).toBe('red');
  });

  it('maps oysters / seafood → white', () => {
    expect(suggestCategory('oysters')).toBe('white');
    expect(suggestCategory('seafood')).toBe('white');
  });

  it('maps bubbles / celebration → sparkling', () => {
    expect(suggestCategory('celebration')).toBe('sparkling');
    expect(suggestCategory('bubbles')).toBe('sparkling');
  });

  it('maps nightcap / sipping → whisky', () => {
    expect(suggestCategory('nightcap')).toBe('whisky');
    expect(suggestCategory('sipping')).toBe('whisky');
  });

  it('is case / whitespace insensitive', () => {
    expect(suggestCategory('  STEAK ')).toBe('red');
  });

  it('returns null for unknown / empty input (UI falls back)', () => {
    expect(suggestCategory('xyzzy')).toBeNull();
    expect(suggestCategory('')).toBeNull();
    expect(suggestCategory(undefined)).toBeNull();
  });

  it('every NOVICE_MOMENTS token resolves to a real category', () => {
    const valid: FinderCategory[] = [
      'red', 'white', 'sparkling', 'whisky', 'gin', 'spirits', 'sake',
    ];
    for (const m of NOVICE_MOMENTS) {
      expect(valid).toContain(suggestCategory(m.token));
    }
  });
});
