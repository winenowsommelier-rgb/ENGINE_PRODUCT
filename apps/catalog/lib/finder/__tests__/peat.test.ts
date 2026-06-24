import { test, expect } from 'vitest';
import { isLikelyPeated } from '../peated-distilleries';

test('known peated distilleries detected by name even when smokiness=none', () => {
  expect(isLikelyPeated('Talisker  10 Years (700 ml)')).toBe(true);
  expect(isLikelyPeated('Provenance  Ledaig 7 Years')).toBe(true);
  expect(isLikelyPeated('Glenfiddich 12')).toBe(false);
});
