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
