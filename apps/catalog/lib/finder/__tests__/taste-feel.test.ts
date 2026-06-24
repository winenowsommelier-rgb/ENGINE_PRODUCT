import { test, expect } from 'vitest';
import { feelToArchetype } from '../taste-feel';
import { resolveArchetypeId, CROWD_PLEASER } from '../taste-feel';

test('red taste-feel maps to the CORRECT archetype (smooth != light)', () => {
  expect(feelToArchetype('red', 'light')).toBe('bright-elegant-red');
  expect(feelToArchetype('red', 'smooth')).toBe('supple-everyday-red');
  expect(feelToArchetype('red', 'bold')).toBe('bold-structured-red');
});
test('unknown / not-sure feel returns null', () => {
  expect(feelToArchetype('red', 'unsure')).toBeNull();
  expect(feelToArchetype('red', undefined)).toBeNull();
});
test('all-neutral red resolves to crowd-pleaser, not arbitrary', () => {
  expect(resolveArchetypeId('red', undefined)).toBe(CROWD_PLEASER.red);
});

// TASK 6 — white taste-feel maps to the correct white archetypes (acidity-led, not sweetness).
test('white taste-feel maps to the CORRECT archetype', () => {
  expect(feelToArchetype('white', 'crisp')).toBe('crisp-zesty-white');
  expect(feelToArchetype('white', 'rounded')).toBe('rich-textured-white');
  expect(feelToArchetype('white', 'aromatic')).toBe('aromatic-balanced-white');
});
test('white unsure / unknown feel returns null (→ crowd-pleaser via resolver)', () => {
  expect(feelToArchetype('white', 'unsure')).toBeNull();
  expect(resolveArchetypeId('white', undefined)).toBe(CROWD_PLEASER.white);
});
