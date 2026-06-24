import { describe, it, expect } from 'vitest';
import { withAnswer } from '@/components/finder/ChoiceCards';
import type { Answers } from '@/lib/finder/answers';

// Guards the UI<->Answers seam: withAnswer must write EVERY StepField it is
// handed, including the 6 sommelier deep-dive fields. History: the switch once
// handled only the 5 v1 fields; the deep-dive fields fell through writing
// nothing, so the entire sommelier branch silently collected zero answers in
// the browser (every unit test passed because this seam was untested).
const base = () => ({ category: 'red' } as Answers);

describe('withAnswer — single-value deep-dive fields', () => {
  for (const field of ['acidity', 'tannin', 'grape', 'age', 'adventure', 'peat'] as const) {
    it(`writes ${field}`, () => {
      expect(withAnswer(base(), field, 'X')[field]).toBe('X');
    });
  }
});

// TASK B (Phase-2 sake): the new core `serve` field is a single-value string written by
// ChoiceCards, same shape as tasteFeel. Without a case here the sake serve step writes nothing.
describe('withAnswer — core sake serve field', () => {
  it('writes serve', () => {
    expect(withAnswer(base(), 'serve', 'warm').serve).toBe('warm');
  });
});

describe('withAnswer — v1 fields still work', () => {
  it('writes axis1', () => {
    expect(withAnswer(base(), 'axis1', 'bold').axis1).toBe('bold');
  });
  it('writes budget as a number', () => {
    expect(withAnswer(base(), 'budget', '2').budget).toBe(2);
  });
});
