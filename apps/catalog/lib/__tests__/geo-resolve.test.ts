import { describe, it, expect } from 'vitest';
import { normGeoName, makeGeoResolver } from '../geo-resolve';

// FIXTURE MIRRORS THE REAL data/taxonomy/explore-taxonomy.json SHAPES — verified
// 2026-07-27. Do not "tidy" these into a neater hierarchy; the awkwardness IS the
// test. Sonoma County / Barossa Valley are REGIONS that also have a same-named
// appellation entry. Napa Valley's parentSlug here is deliberately 'napa' (a
// separate region) even though the real file says 'california': the resolver must
// take the parent from the ROW and never consult parentSlug at all, so a wrong
// parentSlug must not be able to change the answer.
const TAXONOMY = {
  regions: [
    { name: 'California', latitude: 37.3, longitude: -119.0, slug: 'california' },
    { name: 'Piedmont', latitude: 44.9, longitude: 8.2, slug: 'piedmont' },
    { name: 'Central Valley', latitude: -34.5, longitude: -71.0, slug: 'central-valley' },
    { name: 'Sonoma County', latitude: 38.4, longitude: -122.8, slug: 'sonoma-county' },
    { name: 'Colchagua Valley', latitude: -34.6, longitude: -71.1, slug: 'colchagua-valley' },
  ],
  subregions: [
    { name: 'Napa Valley', latitude: 38.5, longitude: -122.3, slug: 'napa-valley', parentSlug: 'napa' },
    { name: 'Langhe', latitude: 44.6, longitude: 8.0, slug: 'langhe', parentSlug: 'piedmont' },
  ],
  appellations: [
    { name: 'Barolo', latitude: 44.6, longitude: 7.9, slug: 'barolo' },
    { name: 'Châteauneuf-du-Pape', latitude: 44.0, longitude: 4.8, slug: 'chateauneuf-du-pape' },
    { name: 'California', latitude: 36.0, longitude: -120.0, slug: 'california-ava' },
    { name: 'Sonoma County', latitude: 38.5, longitude: -122.8, slug: 'sonoma-county-ava' },
  ],
};

describe('normGeoName', () => {
  it('strips accents and collapses punctuation', () => {
    expect(normGeoName('Châteauneuf-du-Pape')).toBe('chateauneuf du pape');
    expect(normGeoName('Penedès')).toBe('penedes');
    expect(normGeoName('  Napa  Valley ')).toBe('napa valley');
  });
});

describe('makeGeoResolver', () => {
  const resolve = makeGeoResolver(TAXONOMY);

  it('pins at SUBREGION when the row has one with coords', () => {
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Napa Valley' });
    expect(n).toMatchObject({
      pinName: 'Napa Valley', pinLevel: 'subregion',
      parentName: 'California', latitude: 38.5, longitude: -122.3,
    });
  });

  it('pins at APPELLATION and inherits its parent FROM THE ROW', () => {
    const n = resolve({ country: 'Italy', region: 'Piedmont', subregion: 'Barolo' });
    expect(n).toMatchObject({
      pinName: 'Barolo', pinLevel: 'appellation', parentName: 'Piedmont',
    });
  });

  it('a REGION-classified value in the subregion field pins at REGION level', () => {
    // Sonoma County is a REGION in the taxonomy but sits in the subregion field on
    // 71 product rows, AND has a same-named appellation entry. Without the regions
    // fallback it resolves to the appellation, a later invariant queries
    // appellation='Sonoma County', and 0 of those 71 rows carry any appellation
    // value -> hard build failure. This test is that guard.
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Sonoma County' });
    expect(n).toMatchObject({ pinName: 'Sonoma County', pinLevel: 'region', latitude: 38.4 });
  });

  it('Colchagua Valley (region, no appellation twin) pins at REGION level', () => {
    const n = resolve({ country: 'Chile', region: 'Central Valley', subregion: 'Colchagua Valley' });
    expect(n).toMatchObject({ pinName: 'Colchagua Valley', pinLevel: 'region' });
  });

  it('takes a subregion parent from the ROW, never from parentSlug', () => {
    // The fixture's Napa Valley carries parentSlug 'napa' (a separate region).
    // Using it would make the /shop hand-off emit region=Napa, matching 1 row
    // instead of ~299.
    const n = resolve({ country: 'USA', region: 'California', subregion: 'Napa Valley' });
    expect(n!.parentName).toBe('California');
    expect(n!.parentName).not.toBe('Napa');
  });

  it('scopes lookup by SOURCE FIELD so cross-level collisions do not orphan', () => {
    // 'California' exists as BOTH region and appellation. A value arriving in the
    // region field must resolve against regions, not the parentless appellation.
    const n = resolve({ country: 'USA', region: 'California', subregion: '' });
    expect(n).toMatchObject({ pinName: 'California', pinLevel: 'region', latitude: 37.3 });
  });

  it('falls back to REGION when the subregion resolves to nothing', () => {
    const n = resolve({ country: 'Chile', region: 'Central Valley', subregion: 'Unknown Valley' });
    expect(n).toMatchObject({ pinName: 'Central Valley', pinLevel: 'region' });
  });

  it('returns null when nothing resolves (row rolls up to country)', () => {
    expect(resolve({ country: 'Thailand', region: 'Nowhere', subregion: 'Nope' })).toBeNull();
  });

  it('normalizes accents when matching', () => {
    const n = resolve({ country: 'France', region: '', subregion: 'Chateauneuf-du-Pape' });
    expect(n).toMatchObject({ pinName: 'Châteauneuf-du-Pape', pinLevel: 'appellation' });
  });
});

import { normGeoName as mjsNorm, makeGeoResolver as mjsMake } from
  '../../scripts/gen-explore-map-data.mjs';

describe('parity — .mjs mirror matches the TS resolver', () => {
  // gen-explore-map-data.mjs runs at prebuild, BEFORE tsc, so it cannot import TS.
  // It hand-copies the resolver; this test is the only thing preventing drift.
  // Accented probes are deliberate: normGeoName's combining-marks regex is the
  // most corruption-prone line in the mirror.
  const probes = [
    'Châteauneuf-du-Pape', 'Penedès', 'Napa Valley', 'CENTRAL  VALLEY',
    'Côtes du Rhône', 'Rioja Alavesa', '', '   ',
  ];

  it('normGeoName agrees on every probe', () => {
    for (const p of probes) expect(mjsNorm(p)).toBe(normGeoName(p));
  });

  it('resolveGeoNode agrees on every probe row', () => {
    const rows = [
      { country: 'USA', region: 'California', subregion: 'Napa Valley' },
      { country: 'USA', region: 'California', subregion: 'Sonoma County' },
      { country: 'Italy', region: 'Piedmont', subregion: 'Barolo' },
      { country: 'USA', region: 'California', subregion: '' },
      { country: 'Chile', region: 'Central Valley', subregion: 'Colchagua Valley' },
      { country: 'France', region: '', subregion: 'Chateauneuf-du-Pape' },
      { country: 'Nowhere', region: 'Nope', subregion: 'Nada Land' },
    ];
    const ts = makeGeoResolver(TAXONOMY);
    const mjs = mjsMake(TAXONOMY);
    for (const r of rows) expect(mjs(r)).toEqual(ts(r));
  });
});
