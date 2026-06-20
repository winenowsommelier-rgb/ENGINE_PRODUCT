import { describe, it, expect } from 'vitest';
import { primaryValue, FILTER_SCALE } from '@/lib/finder/scales';

describe('scale maps emit FILTER-scale values (what /shop accepts)', () => {
  it('body bold → Full', () => expect(primaryValue('body','bold')).toBe('Full'));
  it('tannin firm → High (NOT "Firm", NOT "Medium-Full")', () => expect(primaryValue('tannin','firm')).toBe('High'));
  it('acidity crisp → High', () => expect(primaryValue('acidity','crisp')).toBe('High'));
  it('acidity soft → Medium (Medium-Light is OUT of the filter scale)', () =>
    expect(primaryValue('acidity','soft')).toBe('Medium'));
  it('every emitted primary value is in the filter scale (no dead links)', () => {
    const tokens = {body:['bold','medium','light'],acidity:['crisp','balanced','soft'],tannin:['firm','silky']} as const;
    for (const [scale, ts] of Object.entries(tokens))
      for (const t of ts) {
        const v = primaryValue(scale as any, t);
        if (v) expect(FILTER_SCALE[scale as keyof typeof FILTER_SCALE]).toContain(v);
      }
  });
  it('unknown token → undefined', () => expect(primaryValue('body','zzz')).toBeUndefined());
});
