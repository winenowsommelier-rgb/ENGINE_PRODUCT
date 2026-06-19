import { describe, it, expect } from 'vitest';
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
});
