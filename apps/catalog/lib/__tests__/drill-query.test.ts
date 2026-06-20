import { clearDescendants } from '../drill-query';

describe('clearDescendants', () => {
  it('new group clears class', () => {
    expect(clearDescendants('group', 'Wine')).toEqual({ group: 'Wine', class: null });
  });
  it('new class sets only class', () => {
    expect(clearDescendants('class', 'Red Wine')).toEqual({ class: 'Red Wine' });
  });
  it('new country clears region + subregion', () => {
    expect(clearDescendants('country', 'France'))
      .toEqual({ country: 'France', region: null, subregion: null });
  });
  it('new region clears subregion', () => {
    expect(clearDescendants('region', 'Bordeaux'))
      .toEqual({ region: 'Bordeaux', subregion: null });
  });
  it('new subregion sets only subregion', () => {
    expect(clearDescendants('subregion', 'Pauillac')).toEqual({ subregion: 'Pauillac' });
  });
  it('null value clears the strand AND its descendants (deselect)', () => {
    expect(clearDescendants('country', null))
      .toEqual({ country: null, region: null, subregion: null });
  });
});
