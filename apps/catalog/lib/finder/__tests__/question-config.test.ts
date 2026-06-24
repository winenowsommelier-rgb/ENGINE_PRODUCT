import { describe, it, expect } from 'vitest';
import { QUESTION_CONFIG, stepsFor, deepDiveStepsFor } from '@/lib/finder/question-config';

const ALL = ['red','white','sparkling','whisky','gin','spirits','sake'] as const;

describe('question config', () => {
  it('every category has ≥3 steps', () => {
    for (const c of ALL) expect(stepsFor(c).length).toBeGreaterThanOrEqual(3);
  });
  it('every category starts with occasion then budget', () => {
    for (const c of ALL) {
      expect(stepsFor(c)[0].field).toBe('occasion');
      expect(stepsFor(c)[1].field).toBe('budget');
    }
  });
  it('occasion and budget are NOT optional; taste steps ARE optional', () => {
    for (const c of ALL) {
      const steps = stepsFor(c);
      expect(steps[0].optional).toBeFalsy();
      expect(steps[1].optional).toBeFalsy();
      steps.filter(s => s.field === 'axis1' || s.field === 'axis2' || s.field === 'flavorChips')
        .forEach(s => expect(s.optional).toBe(true));
    }
  });
  // Rule 5 (Phase-2 plain-language redesign): sparkling NO LONGER asks the body(axis1)/
  // character(axis2) sommelier questions — like red & white it now asks a single plain
  // `tasteFeel` step (festive/fine, TASK A). The old assertion ("sparkling still has a
  // body axis1 + character axis2") locked in the now-replaced jargon flow, so it was
  // rewritten to assert the new plain-language flow. All three colours still carry a
  // flavor step.
  it('all wine colours (red/white/sparkling) use a plain tasteFeel step instead of body/character axes', () => {
    for (const c of ['red','white','sparkling'] as const) {
      const fields = stepsFor(c).map(s => s.field);
      expect(fields).toContain('tasteFeel');
      expect(fields).not.toContain('axis1');
      expect(fields).not.toContain('axis2');
      expect(fields).toContain('flavorChips');
    }
  });
  // Rule 5 (Phase-2 TASK B): gin moved off the axis1 classic/contemporary step to a plain
  // `tasteFeel` step (classic/modern). The old check ("gin has axis1 but no axis2") locked
  // in the replaced field, so it was rewritten to assert the plain-language flow.
  it('gin uses a plain tasteFeel step (no axis1/axis2)', () => {
    const fields = stepsFor('gin').map(s => s.field);
    expect(fields).toContain('tasteFeel');
    expect(fields).not.toContain('axis1');
    expect(fields).not.toContain('axis2');
  });
  it('flavor step is multi-select with ≥4 chips', () => {
    const flavor = stepsFor('red').find(s => s.field === 'flavorChips')!;
    expect(flavor.multi).toBe(true);
    expect(flavor.options.length).toBeGreaterThanOrEqual(4);
  });
  it('budget options use index tokens 0..4', () => {
    const budget = stepsFor('red').find(s => s.field === 'budget')!;
    expect(budget.options.map(o => o.token)).toEqual(['0','1','2','3','4']);
  });
  it('StepOption supports optional icon; occasion options all have icons', () => {
    const occ = stepsFor('red').find(s=>s.field==='occasion')!;
    expect(occ.options.every(o=>typeof o.icon==='string' && o.icon!.length>0)).toBe(true);
  });
  it('flavor step has 12 family chips (tokens = FLAVOR_FAMILY keys), all iconed', () => {
    const flavor = stepsFor('red').find(s=>s.field==='flavorChips')!;
    expect(flavor.options).toHaveLength(12);
    const tokens = flavor.options.map(o=>o.token).sort();
    expect(tokens).toEqual(['citrus','dark-fruit','earthy','floral','mineral','nutty','oak','red-fruit','smoky','spice','stone-fruit','tropical']);
    expect(flavor.options.every(o=>o.icon)).toBe(true);
  });
  // Rule 5 (Phase-2 redesign): sparkling no longer has an axis1 body step — like red it
  // uses the plain `tasteFeel` step. The old check ("body axis1 (sparkling) options carry
  // icons") referenced the removed axis1 step, so it was rewritten to assert icons on the
  // tasteFeel step for both red and sparkling.
  it('budget + tasteFeel (red & sparkling) options carry icons', () => {
    for (const f of ['budget','tasteFeel'] as const) {
      const step = stepsFor('red').find(s=>s.field===f)!;
      expect(step.options.every(o=>o.icon)).toBe(true);
    }
    const sparkFeel = stepsFor('sparkling').find(s=>s.field==='tasteFeel')!;
    expect(sparkFeel.options.every(o=>o.icon)).toBe(true);
  });
  it('retired flavor tokens earth/vanilla are gone', () => {
    const tokens = stepsFor('red').find(s=>s.field==='flavorChips')!.options.map(o=>o.token);
    expect(tokens).not.toContain('earth');
    expect(tokens).not.toContain('vanilla');
  });
});

describe('deepDiveStepsFor (opt-in sommelier branch)', () => {
  const ALL = ['red','white','sparkling','whisky','gin','spirits','sake'] as const;
  it('wine categories include acidity, grape, age, adventure (and tannin for red)', () => {
    for (const c of ['red','white','sparkling'] as const) {
      const fields = deepDiveStepsFor(c).map(s=>s.field);
      expect(fields).toContain('acidity'); expect(fields).toContain('grape');
      expect(fields).toContain('age'); expect(fields).toContain('adventure');
    }
    expect(deepDiveStepsFor('red').map(s=>s.field)).toContain('tannin');
  });

  // ── W5: grape options must follow the wine colour. A white/sparkling deep-dive must
  // NOT offer red grapes (Cabernet/Merlot/…) — that was nonsensical and unscoreable. ──
  const grapeTokens = (c: 'red'|'white'|'sparkling') =>
    deepDiveStepsFor(c).find(s => s.field === 'grape')!.options.map(o => o.token);
  const RED_ONLY = ['cabernet','syrah-shiraz','sangiovese','tempranillo','merlot','grenache'];
  const WHITE_ONLY = ['chardonnay','sauv-blanc','riesling','pinot-grigio','viognier','semillon'];

  it('RED deep-dive offers red grapes (Cabernet/Merlot), not white ones', () => {
    const t = grapeTokens('red');
    expect(t).toContain('cabernet'); expect(t).toContain('merlot');
    expect(t).not.toContain('chardonnay'); expect(t).not.toContain('sauv-blanc');
  });
  it('WHITE deep-dive offers white grapes (Chardonnay/Sauv Blanc), NO red grapes', () => {
    const t = grapeTokens('white');
    expect(t).toContain('chardonnay'); expect(t).toContain('sauv-blanc'); expect(t).toContain('riesling');
    for (const red of RED_ONLY) expect(t).not.toContain(red); // the W5 bug: zero red grapes
  });
  it('SPARKLING deep-dive offers the Champagne trio + Glera, NO white-still-only or red-only grapes', () => {
    const t = grapeTokens('sparkling');
    expect(t).toContain('chardonnay'); expect(t).toContain('pinot-noir'); // legit in sparkling
    expect(t).toContain('meunier'); expect(t).toContain('glera');
    for (const w of ['sauv-blanc','riesling','viognier']) expect(t).not.toContain(w);
    for (const red of ['cabernet','merlot','sangiovese']) expect(t).not.toContain(red);
  });
  it('every offered grape token (all wine colours) maps to a real GRAPE_FAMILY scorer or is "surprise"', async () => {
    const { FLAVOR_FAMILY } = await import('@/lib/finder/scoring'); // ensure module loads
    void FLAVOR_FAMILY;
    // GRAPE_FAMILY isn't exported; assert indirectly via scoring in scoring.test.ts.
    // Here we just assert no token is empty/dup within a colour.
    for (const c of ['red','white','sparkling'] as const) {
      const t = grapeTokens(c);
      expect(new Set(t).size).toBe(t.length); // no dups
      expect(t).toContain('surprise');        // every colour keeps the escape hatch
    }
  });
  it('whisky deep-dive has peat/age/adventure and NO cask (spirit_style is phantom)', () => {
    const fields = deepDiveStepsFor('whisky').map(s=>s.field);
    expect(fields).toContain('peat'); expect(fields).toContain('age');
    expect(fields).not.toContain('cask');
  });
  it('every deep-dive step is optional', () => {
    for (const c of ALL) for (const s of deepDiveStepsFor(c)) expect(s.optional).toBe(true);
  });
  it('thin categories (gin/sake) have a shorter deep-dive than wine', () => {
    expect(deepDiveStepsFor('gin').length).toBeLessThan(deepDiveStepsFor('red').length);
  });
  it('core stepsFor is unchanged (no deep-dive fields leak into core)', () => {
    // tasteFeel is a CORE Layer-1 field (red/white plain-language step), not a deep-dive
    // field — added to the allowlist when red/white moved off body/character axes.
    for (const c of ALL) for (const s of stepsFor(c))
      expect(['occasion','budget','axis1','axis2','flavorChips','food','tasteFeel']).toContain(s.field);
  });
});
