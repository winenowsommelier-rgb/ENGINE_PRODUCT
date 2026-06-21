import { describe, it, expect } from 'vitest';
import { buildSegments, type Tiers } from '@/lib/taste-geometry';

const note = (n: string, intensity: 1 | 2 | 3 = 2) => ({ note: n, intensity });

describe('buildSegments', () => {
  it('emits one segment per note with index-based ids', () => {
    const tiers: Tiers = {
      primary: [note('Blackcurrant', 3), note('Plum', 2)],
      secondary: [note('Cedar', 3)],
      tertiary: [],
    };
    const { segments, order } = buildSegments(tiers, 320);
    expect(segments.map(s => s.id)).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    expect(order).toEqual(['primary-0', 'primary-1', 'secondary-0']);
    expect(segments[0]).toMatchObject({ tier: 'primary', note: 'Blackcurrant', intensity: 3, color: '#7c2d3a' });
    expect(segments[0].path.startsWith('M ')).toBe(true);
  });

  it('gives duplicate note names within a tier distinct ids', () => {
    const tiers: Tiers = { primary: [note('Spice'), note('Spice')], secondary: [], tertiary: [] };
    const { segments } = buildSegments(tiers, 320);
    expect(segments.map(s => s.id)).toEqual(['primary-0', 'primary-1']);
  });

  it('excludes empty tiers from segments and order', () => {
    const tiers: Tiers = { primary: [note('Cherry')], secondary: [], tertiary: [] };
    const { segments, order } = buildSegments(tiers, 320);
    expect(segments).toHaveLength(1);
    expect(order).toHaveLength(1);
  });
});
