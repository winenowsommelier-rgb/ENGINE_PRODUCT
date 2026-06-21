import { describe, it, expect } from 'vitest';
import { parseFoodMatching } from '@/lib/utils';

describe('parseFoodMatching', () => {
  it('splits pipe-delimited values (canonical, post-2026-06-21)', () => {
    expect(
      parseFoodMatching('Tomato-based pasta | Pizza & flatbreads | Grilled red meat'),
    ).toEqual(['Tomato-based pasta', 'Pizza & flatbreads', 'Grilled red meat']);
  });

  it('keeps a parenthetical with internal commas as ONE chip (the reported bug)', () => {
    // Regression guard: WRW3233BS rendered "Comfort food (pasta bakes" /
    // "casseroles" / "roasts)" as three broken chips. It must be one chip.
    const v =
      'Tomato-based pasta | Pizza & flatbreads | Grilled red meat | ' +
      'Beef stew & braised | Comfort food (pasta bakes, casseroles, roasts)';
    expect(parseFoodMatching(v)).toEqual([
      'Tomato-based pasta',
      'Pizza & flatbreads',
      'Grilled red meat',
      'Beef stew & braised',
      'Comfort food (pasta bakes, casseroles, roasts)',
    ]);
  });

  it('LEGACY fallback: paren-aware comma split when no pipe present', () => {
    // Un-migrated/legacy data must still render correctly (defense-in-depth).
    expect(
      parseFoodMatching('Grilled fish, Shellfish (lobster, crab, prawn), Roast chicken'),
    ).toEqual(['Grilled fish', 'Shellfish (lobster, crab, prawn)', 'Roast chicken']);
  });

  it('no chip ever contains an unbalanced parenthesis', () => {
    const samples = [
      'Comfort food (pasta bakes, casseroles, roasts)',
      'Grilled fish, Shellfish (lobster, crab, prawn), Thai food (spicy & sour)',
      'A | B (x, y, z) | C',
    ];
    for (const s of samples) {
      for (const chip of parseFoodMatching(s)) {
        const open = (chip.match(/\(/g) || []).length;
        const close = (chip.match(/\)/g) || []).length;
        expect(open).toBe(close);
      }
    }
  });

  it('trims whitespace and drops empty items (pipe mode)', () => {
    expect(parseFoodMatching('  A |  | B  ')).toEqual(['A', 'B']);
  });

  it('trims whitespace and drops empty items (legacy comma mode)', () => {
    expect(parseFoodMatching('A,, ,B')).toEqual(['A', 'B']);
  });

  it('in pipe mode, a stray comma stays inside its item (not a separator)', () => {
    // Once pipe is the delimiter, commas are plain characters — by design.
    expect(parseFoodMatching('A | B, still B | C')).toEqual(['A', 'B, still B', 'C']);
  });

  it('handles empty / nullish input', () => {
    expect(parseFoodMatching('')).toEqual([]);
    expect(parseFoodMatching(undefined)).toEqual([]);
    expect(parseFoodMatching(null)).toEqual([]);
  });

  it('single item (no separator) returns that item', () => {
    expect(parseFoodMatching('Sushi & sashimi')).toEqual(['Sushi & sashimi']);
  });
});
