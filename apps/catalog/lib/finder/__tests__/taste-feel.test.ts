import { test, expect } from 'vitest';
import { feelToArchetype } from '../taste-feel';

test('red taste-feel maps to the CORRECT archetype (smooth != light)', () => {
  expect(feelToArchetype('red', 'light')).toBe('bright-elegant-red');
  expect(feelToArchetype('red', 'smooth')).toBe('supple-everyday-red');
  expect(feelToArchetype('red', 'bold')).toBe('bold-structured-red');
});
test('unknown / not-sure feel returns null', () => {
  expect(feelToArchetype('red', 'unsure')).toBeNull();
  expect(feelToArchetype('red', undefined)).toBeNull();
});
