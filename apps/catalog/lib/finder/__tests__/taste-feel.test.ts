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

// TASK A — sparkling taste-feel maps to the correct sparkling archetypes (style-led:
// festive = light/fruity Prosecco-style, fine = traditional-method Champagne-style).
test('sparkling taste-feel maps to the CORRECT archetype', () => {
  expect(feelToArchetype('sparkling', 'festive')).toBe('fresh-festive-sparkling');
  expect(feelToArchetype('sparkling', 'fine')).toBe('fine-traditional-sparkling');
});
test('sparkling unsure / unknown feel returns null (→ crowd-pleaser via resolver)', () => {
  expect(feelToArchetype('sparkling', 'unsure')).toBeNull();
  expect(resolveArchetypeId('sparkling', undefined)).toBe(CROWD_PLEASER.sparkling);
});

// TASK B — gin taste-feel maps to the correct gin archetypes (classic = juniper-forward
// London Dry; modern = contemporary botanical).
test('gin taste-feel maps to the CORRECT archetype', () => {
  expect(feelToArchetype('gin', 'classic')).toBe('classic-juniper-gin');
  expect(feelToArchetype('gin', 'modern')).toBe('contemporary-botanical-gin');
});
test('gin unsure / unknown feel returns null (→ crowd-pleaser via resolver)', () => {
  expect(feelToArchetype('gin', 'unsure')).toBeNull();
  expect(resolveArchetypeId('gin', undefined)).toBe(CROWD_PLEASER.gin);
});

// TASK A (Phase-2 spirits) — generic feel after the TYPE question. light/smooth → the
// clean versatile vodka archetype; rich/aged → the warm aged spirit archetype.
test('spirits taste-feel maps to the CORRECT archetype', () => {
  expect(feelToArchetype('spirits', 'rich')).toBe('warm-aged-spirit');
  expect(feelToArchetype('spirits', 'aged')).toBe('warm-aged-spirit');
  expect(feelToArchetype('spirits', 'light')).toBe('clean-versatile-vodka');
  expect(feelToArchetype('spirits', 'smooth')).toBe('clean-versatile-vodka');
});
test('spirits unsure / unknown feel returns null (→ crowd-pleaser via resolver)', () => {
  expect(feelToArchetype('spirits', 'unsure')).toBeNull();
  expect(resolveArchetypeId('spirits', undefined)).toBe(CROWD_PLEASER.spirits);
});
