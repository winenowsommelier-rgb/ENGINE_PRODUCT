import { describe, it, expect } from 'vitest';
import { parseCriticScores } from '@/lib/critic-score';

const good = JSON.stringify({
  critics: [
    { abbr: 'JS', critic: 'James Suckling', score_native: '92', score_value: 92 },
    { abbr: 'WA', critic: 'Wine Advocate', score_native: '91', score_value: 91 },
    { abbr: 'WS', critic: 'Wine Spectator', score_native: '88', score_value: 88 },
  ],
  community: [],
  medals: [],
});

describe('parseCriticScores', () => {
  it('parses a valid summary into a sorted result', () => {
    const r = parseCriticScores(92, good);
    expect(r).not.toBeNull();
    expect(r!.critics.map((c) => c.abbr)).toEqual(['JS', 'WA', 'WS']);
    expect(r!.critics[0].score_value).toBeGreaterThanOrEqual(r!.critics[1].score_value);
  });

  it('identifies the lead as the score_max critic (float-tolerant)', () => {
    expect(parseCriticScores(92.0, good)!.lead.abbr).toBe('JS');
  });

  it('computes overflow as critics beyond the lead', () => {
    expect(parseCriticScores(92, good)!.overflow).toBe(2);
  });

  it('builds an aria-label covering ALL sorted critics, even beyond the cap', () => {
    const five = JSON.stringify({
      critics: [
        { abbr: 'JS', critic: 'James Suckling', score_native: '100', score_value: 100 },
        { abbr: 'WA', critic: 'Wine Advocate', score_native: '99', score_value: 99 },
        { abbr: 'WS', critic: 'Wine Spectator', score_native: '98', score_value: 98 },
        { abbr: 'WE', critic: 'Wine Enthusiast', score_native: '97', score_value: 97 },
        { abbr: 'VN', critic: 'Vinous', score_native: '96', score_value: 96 },
      ],
      community: [],
      medals: [],
    });
    const r = parseCriticScores(100, five, 2)!;
    expect(r.critics.length).toBe(2);
    expect(r.ariaLabel).toContain('Vinous 96');
    expect(r.overflow).toBe(4);
  });

  it('returns null for malformed JSON (never throws)', () => {
    expect(parseCriticScores(90, '{not json')).toBeNull();
  });

  it('returns null when there are no critics', () => {
    expect(parseCriticScores(90, JSON.stringify({ critics: [], community: [], medals: [] }))).toBeNull();
  });

  it('returns null when scoreMax is missing', () => {
    expect(parseCriticScores(null, good)).toBeNull();
    expect(parseCriticScores(undefined, good)).toBeNull();
  });

  it('falls back to the top critic when score_max matches no critic', () => {
    expect(parseCriticScores(101, good)!.lead.abbr).toBe('JS');
  });

  it('filters entries missing required fields', () => {
    const dirty = JSON.stringify({
      critics: [
        { abbr: 'JS', critic: 'James Suckling', score_native: '92', score_value: 92 },
        { abbr: 'XX', score_value: 80 }, // missing critic/score_native
      ],
      community: [],
      medals: [],
    });
    const r = parseCriticScores(92, dirty)!;
    expect(r.critics.map((c) => c.abbr)).toEqual(['JS']);
  });
});
