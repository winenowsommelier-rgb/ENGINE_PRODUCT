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
