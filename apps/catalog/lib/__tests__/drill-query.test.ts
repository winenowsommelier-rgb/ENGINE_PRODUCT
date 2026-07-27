import { clearDescendants } from '../drill-query';

describe('clearDescendants', () => {
  it('new group clears class', () => {
    expect(clearDescendants('group', 'Wine')).toEqual({ group: 'Wine', class: null });
  });
  it('new class sets only class', () => {
    expect(clearDescendants('class', 'Red Wine')).toEqual({ class: 'Red Wine' });
  });
  // Regression-guard history: these four assertions originally encoded a 3-level
  // geography chain (country → region → subregion). Appellation became the 4th level
  // when appellation-pin support landed, so every patch below now also nulls
  // `appellation`. Do NOT "fix" a failure here by shrinking DRILL_DESCENDANTS — a
  // stale appellation= surviving a country/region/subregion change silently empties
  // the grid.
  it('new country clears region + subregion + appellation', () => {
    expect(clearDescendants('country', 'France'))
      .toEqual({ country: 'France', region: null, subregion: null, appellation: null });
  });
  it('new region clears subregion + appellation', () => {
    expect(clearDescendants('region', 'Bordeaux'))
      .toEqual({ region: 'Bordeaux', subregion: null, appellation: null });
  });
  it('new subregion clears appellation', () => {
    expect(clearDescendants('subregion', 'Pauillac'))
      .toEqual({ subregion: 'Pauillac', appellation: null });
  });
  it('new appellation sets only appellation (deepest level)', () => {
    expect(clearDescendants('appellation', 'Barolo')).toEqual({ appellation: 'Barolo' });
  });
  it('null value clears the strand AND its descendants (deselect)', () => {
    expect(clearDescendants('country', null))
      .toEqual({ country: null, region: null, subregion: null, appellation: null });
  });
});

describe('appellation is a geography descendant', () => {
  it('changing region CLEARS a stale appellation', () => {
    // Without appellation in DRILL_DESCENDANTS an appellation= survives a region
    // change and silently filters the grid to nothing.
    expect(clearDescendants('region', 'Tuscany')).toEqual({
      region: 'Tuscany', subregion: null, appellation: null,
    });
  });

  it('changing subregion clears a stale appellation', () => {
    expect(clearDescendants('subregion', 'Langhe')).toEqual({
      subregion: 'Langhe', appellation: null,
    });
  });

  it('changing country clears region, subregion and appellation', () => {
    expect(clearDescendants('country', 'France')).toEqual({
      country: 'France', region: null, subregion: null, appellation: null,
    });
  });
});
