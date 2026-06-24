import { describe, it, test, expect } from 'vitest';
import { encodeAnswers, decodeAnswers, type Answers } from '@/lib/finder/answers';

describe('answers URL codec', () => {
  const full: Answers = {
    category: 'red', occasion: 'food', food: ['red-meat', 'cheese'],
    budget: 2, axis1: 'bold', axis2: 'earthy', flavorChips: ['oak', 'leather'],
  };
  it('round-trips a full answer set losslessly', () => {
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(full)))).toEqual(full);
  });
  it('round-trips a minimal answer set (category only)', () => {
    const min: Answers = { category: 'whisky' };
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(min)))).toEqual(min);
  });
  it('drops unknown params and keeps category', () => {
    const a = decodeAnswers(new URLSearchParams('cat=gin&junk=1&b=9'));
    expect(a.category).toBe('gin');
    expect(a.budget).toBeUndefined(); // b=9 is out of 0..4 → dropped
  });
  it('returns category undefined when cat is invalid', () => {
    expect(decodeAnswers(new URLSearchParams('cat=banana')).category).toBeUndefined();
  });
  // REGRESSION GUARD: budget 0 is falsy — a `if (a.budget)` encode check would drop it.
  // Lock in that budget:0 ("Under ฿1,000") round-trips.
  it('round-trips budget 0 (falsy-trap guard)', () => {
    expect(decodeAnswers(new URLSearchParams(encodeAnswers({ category: 'red', budget: 0 }))).budget).toBe(0);
  });
  it('round-trips deep-dive fields', () => {
    const a = { category:'red', acidity:'crisp', tannin:'firm', grape:'cabernet', age:'mature', adventure:'discovery', peat:'heavy' } as any;
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(a)))).toEqual(a);
  });
  it('omits deep-dive params when unset (minimal core round-trips clean)', () => {
    const a = { category:'whisky' } as any;
    expect(decodeAnswers(new URLSearchParams(encodeAnswers(a)))).toEqual(a);
  });
  test('tasteFeel round-trips via URL params', () => {
    const enc = encodeAnswers({ category: 'red', tasteFeel: 'bold' });
    const dec = decodeAnswers(new URLSearchParams(enc));
    expect(dec.tasteFeel).toBe('bold');
  });
  // TASK B (Phase-2 sake): the new `serve` field (chilled/warm/either) must round-trip via 'sv'.
  test('serve round-trips via URL params (sake chilled/warm)', () => {
    const enc = encodeAnswers({ category: 'sake', serve: 'warm' });
    const dec = decodeAnswers(new URLSearchParams(enc));
    expect(dec.serve).toBe('warm');
  });
  test('serve omitted when unset (minimal round-trip clean)', () => {
    const dec = decodeAnswers(new URLSearchParams(encodeAnswers({ category: 'sake' })));
    expect(dec.serve).toBeUndefined();
  });
  // ROSÉ (Phase-2) — THE TRAP. decodeAnswers validates `cat` against a RUNTIME
  // `CATEGORIES` array that tsc does NOT cross-check against the FinderCategory union.
  // If 'rose' is added to the union but NOT to that array, cat=rose silently decodes to
  // undefined → the result page redirects → the whole rosé journey dies with no error.
  test('cat=rose decodes to the rose category (runtime CATEGORIES array guard)', () => {
    expect(decodeAnswers(new URLSearchParams('cat=rose')).category).toBe('rose');
  });
});
