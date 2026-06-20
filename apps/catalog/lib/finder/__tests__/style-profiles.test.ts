import { describe, it, expect } from 'vitest';
import { resolveProfile, STYLE_PROFILES } from '@/lib/finder/style-profiles';
import type { Answers } from '@/lib/finder/answers';
import { getAllProducts } from '@/lib/catalog-data';
import { resolveOriginField } from '@/lib/finder/shop-links';

const ALL = ['red','white','sparkling','whisky','gin','spirits','sake'] as const;

describe('style profiles', () => {
  it('every category has ≥1 archetype', () => {
    for (const c of ALL) expect(STYLE_PROFILES.some(p=>p.category===c)).toBe(true);
  });
  it('resolves deterministically (same answers → same id)', () => {
    const a: Answers = { category:'red', axis1:'bold' };
    expect(resolveProfile(a)!.id).toBe(resolveProfile(a)!.id);
  });
  it('a bold red resolves to a full-bodied archetype', () => {
    const prof = resolveProfile({ category:'red', axis1:'bold' });
    expect(prof?.category).toBe('red');
    expect(prof?.definingAttributes.body?.toLowerCase()).toContain('full');
  });
  it('a light red resolves to a DIFFERENT archetype than a bold red', () => {
    const light = resolveProfile({ category:'red', axis1:'light' });
    const bold  = resolveProfile({ category:'red', axis1:'bold' });
    expect(light!.id).not.toBe(bold!.id);
  });
  it('always returns a profile for a valid category, even with no axis answers', () => {
    for (const c of ALL) expect(resolveProfile({ category:c } as Answers)).not.toBeNull();
  });
  it('every profile has non-empty name, expertNote, foodGuidance', () => {
    for (const p of STYLE_PROFILES) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.expertNote.length).toBeGreaterThan(0);
      expect(p.foodGuidance.length).toBeGreaterThan(0);
    }
  });
  it('every archetype typicalRegion resolves to a real catalog field (no dead geo links)', () => {
    const cat = getAllProducts();
    const dead: string[] = [];
    for (const p of STYLE_PROFILES)
      for (const r of (p.definingAttributes.typicalRegions ?? []))
        if (!resolveOriginField(r, cat)) dead.push(`${p.id}:${r}`);
    expect(dead, `dead geo values: ${dead.join(', ')}`).toEqual([]);
  });
});
