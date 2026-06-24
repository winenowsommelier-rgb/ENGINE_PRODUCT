import { stepsFor } from '../question-config';
const BANNED = ['tannin','acidity','dosage','junmai','ginjo','vsop','peat'];
test('red Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('red').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('red Layer-1 has a taste-feel step with light/smooth/bold + unsure', () => {
  const feel = stepsFor('red').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['light','smooth','bold','unsure']));
});

// TASK 6 — white Layer-1 is also jargon-free with a plain taste-feel step.
test('white Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('white').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('white Layer-1 has a taste-feel step with crisp/rounded/aromatic + unsure', () => {
  const feel = stepsFor('white').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['crisp','rounded','aromatic','unsure']));
});

// TASK A — sparkling Layer-1 is also jargon-free with a plain taste-feel step (festive/fine).
test('sparkling Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('sparkling').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('sparkling Layer-1 has a taste-feel step with festive/fine + unsure', () => {
  const feel = stepsFor('sparkling').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['festive','fine','unsure']));
});

// TASK B — gin Layer-1 is also jargon-free with a plain taste-feel step (classic/modern).
test('gin Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('gin').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('gin Layer-1 has a taste-feel step with classic/modern + unsure', () => {
  const feel = stepsFor('gin').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['classic','modern','unsure']));
});

// TASK A — spirits Layer-1 is jargon-free with a plain taste-feel step (light/smooth/rich/aged).
test('spirits Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('spirits').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('spirits Layer-1 has a taste-feel step with light/smooth/rich + unsure', () => {
  const feel = stepsFor('spirits').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['light','smooth','rich','unsure']));
});

// TASK B — sake Layer-1 is jargon-free: aroma in plain words (fragrant/clean), NO junmai/ginjo.
test('sake Layer-1 labels contain no jargon (no junmai/ginjo)', () => {
  const labels = stepsFor('sake').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('sake Layer-1 has an aroma taste-feel step with fragrant/clean + unsure', () => {
  const feel = stepsFor('sake').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['fragrant','clean','unsure']));
});

// ROSÉ (Phase-2) — body/acidity-led, jargon-free plain taste-feel step (crisp/fruity).
test('rose Layer-1 labels contain no jargon', () => {
  const labels = stepsFor('rose').flatMap(s => [s.title, ...s.options.map(o => o.label)]).join(' ').toLowerCase();
  for (const w of BANNED) expect(labels).not.toContain(w);
});
test('rose Layer-1 has a taste-feel step with crisp/fruity + unsure', () => {
  const feel = stepsFor('rose').find(s => s.field === 'tasteFeel');
  expect(feel).toBeTruthy();
  const tokens = feel!.options.map(o => o.token);
  expect(tokens).toEqual(expect.arrayContaining(['crisp','fruity','unsure']));
});
