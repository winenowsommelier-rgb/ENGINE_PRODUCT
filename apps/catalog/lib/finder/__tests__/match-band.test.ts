import { matchBand } from '../match-band';

// §11.9: honest banded labels instead of a precise fake %. A result driven by NO taste
// signal (all-neutral "not sure" path) is capped at "Good match" — never "Great" — so the
// page never claims a strong personalised fit the data didn't actually produce.
describe('matchBand', () => {
  it('maps score ratio + taste signal to honest bands', () => {
    expect(matchBand({ score: 9, maxScore: 10, hadTasteSignal: true })).toBe('Great match');
    expect(matchBand({ score: 5, maxScore: 10, hadTasteSignal: true })).toBe('Strong match');
    expect(matchBand({ score: 2, maxScore: 10, hadTasteSignal: true })).toBe('Good match');
  });

  it('caps at "Good match" when no taste signal contributed (honesty floor)', () => {
    expect(matchBand({ score: 9, maxScore: 10, hadTasteSignal: false })).toBe('Good match');
  });

  it('handles zero/empty maxScore without dividing by zero', () => {
    expect(matchBand({ score: 0, maxScore: 0, hadTasteSignal: false })).toBe('Good match');
  });
});
