import { describe, it, expect } from 'vitest';
import {
  DRINK_SLUGS,
  PURPOSE_SLUGS,
  CATEGORY_META,
  DRINK_TAG_MAP,
  PURPOSE_TAG_MAP,
  getDrinkSlugForPost,
  getPurposeSlugForPost,
} from './categories';

describe('DRINK_SLUGS / PURPOSE_SLUGS', () => {
  it('has exactly 4 drink slugs', () => {
    expect(DRINK_SLUGS).toHaveLength(4);
    expect(DRINK_SLUGS).toContain('wine');
    expect(DRINK_SLUGS).toContain('whisky');
    expect(DRINK_SLUGS).toContain('spirits');
    expect(DRINK_SLUGS).toContain('sake');
  });

  it('has exactly 6 purpose slugs', () => {
    expect(PURPOSE_SLUGS).toHaveLength(6);
    expect(PURPOSE_SLUGS).toContain('guides');
    expect(PURPOSE_SLUGS).toContain('pairings');
    expect(PURPOSE_SLUGS).toContain('deep-dives');
    expect(PURPOSE_SLUGS).toContain('curated');
    expect(PURPOSE_SLUGS).toContain('comparisons');
    expect(PURPOSE_SLUGS).toContain('gifting');
  });
});

describe('CATEGORY_META', () => {
  it('has an entry for every slug (10 total)', () => {
    const allSlugs = [...DRINK_SLUGS, ...PURPOSE_SLUGS];
    for (const slug of allSlugs) {
      expect(CATEGORY_META[slug]).toBeDefined();
      expect(CATEGORY_META[slug].label).toBeTruthy();
      expect(CATEGORY_META[slug].icon).toBeTruthy();
      expect(CATEGORY_META[slug].description).toBeTruthy();
    }
  });
});

describe('DRINK_TAG_MAP', () => {
  it('maps wine varietals and regions to wine', () => {
    expect(DRINK_TAG_MAP['red-wine']).toBe('wine');
    expect(DRINK_TAG_MAP['chardonnay']).toBe('wine');
    expect(DRINK_TAG_MAP['rosé']).toBe('wine');
    expect(DRINK_TAG_MAP['rose']).toBe('wine');
    expect(DRINK_TAG_MAP['france']).toBe('wine');
    expect(DRINK_TAG_MAP['spain']).toBe('wine');
  });

  it('maps whisky tags to whisky', () => {
    expect(DRINK_TAG_MAP['scotch']).toBe('whisky');
    expect(DRINK_TAG_MAP['japanese-whisky']).toBe('whisky');
    expect(DRINK_TAG_MAP['speyside']).toBe('whisky');
  });

  it('maps spirits tags to spirits', () => {
    expect(DRINK_TAG_MAP['gin']).toBe('spirits');
    expect(DRINK_TAG_MAP['tequila']).toBe('spirits');
    expect(DRINK_TAG_MAP['cocktails']).toBe('spirits');
  });

  it('maps sake tags to sake', () => {
    expect(DRINK_TAG_MAP['sake']).toBe('sake');
    expect(DRINK_TAG_MAP['shochu']).toBe('sake');
    expect(DRINK_TAG_MAP['japan']).toBe('sake');
  });
});

describe('PURPOSE_TAG_MAP', () => {
  it('maps purpose tags correctly', () => {
    expect(PURPOSE_TAG_MAP['guide']).toBe('guides');
    expect(PURPOSE_TAG_MAP['pairing']).toBe('pairings');
    expect(PURPOSE_TAG_MAP['thai-food']).toBe('pairings');
    expect(PURPOSE_TAG_MAP['deep-dive']).toBe('deep-dives');
    expect(PURPOSE_TAG_MAP['compare']).toBe('comparisons');
    expect(PURPOSE_TAG_MAP['curated']).toBe('curated');
    expect(PURPOSE_TAG_MAP['collection']).toBe('curated');
    expect(PURPOSE_TAG_MAP['gifting']).toBe('gifting');
    expect(PURPOSE_TAG_MAP['celebration']).toBe('gifting');
  });
});

describe('getDrinkSlugForPost', () => {
  it('returns wine for a post with wine tags', () => {
    expect(getDrinkSlugForPost(['red-wine', 'france', 'guide'])).toBe('wine');
  });

  it('returns whisky for scotch-tagged post', () => {
    expect(getDrinkSlugForPost(['scotch', 'guide'])).toBe('whisky');
  });

  it('returns null for a post with only unmapped tags', () => {
    expect(getDrinkSlugForPost(['bangkok', 'restaurants', 'value'])).toBeNull();
  });

  it('returns the first matching drink category in tag order', () => {
    // sake tag comes first, so result is sake
    expect(getDrinkSlugForPost(['sake', 'japanese-whisky'])).toBe('sake');
  });
});

describe('getPurposeSlugForPost', () => {
  it('returns pairings for a post tagged pairing', () => {
    expect(getPurposeSlugForPost(['red-wine', 'pairing', 'thai-food'])).toBe('pairings');
  });

  it('returns null for posts with no purpose tags', () => {
    expect(getPurposeSlugForPost(['red-wine', 'france'])).toBeNull();
  });

  it('returns curated for collection tag', () => {
    expect(getPurposeSlugForPost(['collection', 'wine'])).toBe('curated');
  });
});
