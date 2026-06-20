import { describe, it, expect } from 'vitest';
import { QUESTION_CONFIG, stepsFor } from '@/lib/finder/question-config';

const ALL = ['red','white','sparkling','whisky','gin','spirits','sake'] as const;

describe('question config', () => {
  it('every category has ≥3 steps', () => {
    for (const c of ALL) expect(stepsFor(c).length).toBeGreaterThanOrEqual(3);
  });
  it('every category starts with occasion then budget', () => {
    for (const c of ALL) {
      expect(stepsFor(c)[0].field).toBe('occasion');
      expect(stepsFor(c)[1].field).toBe('budget');
    }
  });
  it('occasion and budget are NOT optional; taste steps ARE optional', () => {
    for (const c of ALL) {
      const steps = stepsFor(c);
      expect(steps[0].optional).toBeFalsy();
      expect(steps[1].optional).toBeFalsy();
      steps.filter(s => s.field === 'axis1' || s.field === 'axis2' || s.field === 'flavorChips')
        .forEach(s => expect(s.optional).toBe(true));
    }
  });
  it('wine categories have a body axis1, a character axis2, and a flavor step', () => {
    for (const c of ['red','white','sparkling'] as const) {
      const fields = stepsFor(c).map(s => s.field);
      expect(fields).toContain('axis1');
      expect(fields).toContain('axis2');
      expect(fields).toContain('flavorChips');
    }
  });
  it('gin has axis1 but no axis2', () => {
    const fields = stepsFor('gin').map(s => s.field);
    expect(fields).toContain('axis1');
    expect(fields).not.toContain('axis2');
  });
  it('flavor step is multi-select with ≥4 chips', () => {
    const flavor = stepsFor('red').find(s => s.field === 'flavorChips')!;
    expect(flavor.multi).toBe(true);
    expect(flavor.options.length).toBeGreaterThanOrEqual(4);
  });
  it('budget options use index tokens 0..4', () => {
    const budget = stepsFor('red').find(s => s.field === 'budget')!;
    expect(budget.options.map(o => o.token)).toEqual(['0','1','2','3','4']);
  });
});
