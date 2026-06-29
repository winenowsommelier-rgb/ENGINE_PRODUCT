import { describe, it, expect } from 'vitest';
import { normalizeScale, toTiers, toStructural } from '@/lib/taste-adapter';
import { SCALE_DEFINITIONS } from '@/components/product/StructuralGauges';
import type { PublicProduct } from '@/lib/types';

/**
 * Regression guard for the SILENT-EMPTY-GAUGE failure (CLAUDE.md Rule 2 / Rule 6).
 *
 * The live export's flat structural fields (acidity / body / tannin)
 * carry values OUTSIDE the component's SCALE_DEFINITIONS — e.g. acidity 'Medium-Full'
 * (260 products), 'Full' (72), 'Light' (44), 'Medium-Light' (138). StructuralGauges
 * computes filledCount = scale.indexOf(value) + 1; an unmapped value → -1 → 0 filled
 * cells → a gauge that renders ALL-EMPTY with no warning. normalizeScale() must map
 * every real value into the component's scale so filledCount > 0.
 */

const mk = (over: Partial<PublicProduct>): PublicProduct =>
  ({ sku: 'X', name: 'X', price: 1, ...over }) as PublicProduct;

describe('normalizeScale', () => {
  it('maps out-of-scale acidity values INTO the acidity scale (no silent-empty gauge)', () => {
    const scale = SCALE_DEFINITIONS.acidity.scale;
    for (const raw of ['Medium-Full', 'Full', 'Light', 'Medium-Light']) {
      const norm = normalizeScale('acidity', raw);
      expect(norm).not.toBeNull();
      // The whole point: the normalised value is IN the component's scale, so
      // filledCount = indexOf+1 is > 0 (gauge is not silently empty).
      expect(scale).toContain(norm);
      expect(scale.indexOf(norm as string) + 1).toBeGreaterThan(0);
    }
  });

  it('maps acidity per the spec table', () => {
    expect(normalizeScale('acidity', 'Medium-Full')).toBe('Medium-High');
    expect(normalizeScale('acidity', 'Full')).toBe('High');
    expect(normalizeScale('acidity', 'Medium-Light')).toBe('Medium');
    expect(normalizeScale('acidity', 'Light')).toBe('Low');
  });

  it('maps tannin per the spec table (same Low/Medium/Medium-High/High scale)', () => {
    expect(normalizeScale('tannin', 'Medium-Full')).toBe('Medium-High');
    expect(normalizeScale('tannin', 'Full')).toBe('High');
    expect(normalizeScale('tannin', 'Medium-Light')).toBe('Medium');
    expect(normalizeScale('tannin', 'Light')).toBe('Low');
  });

  it('maps body into its own scale [Light, Medium, Medium-Full, Full]', () => {
    const scale = SCALE_DEFINITIONS.body.scale;
    // Medium-Light is out-of-scale for body and must collapse to Medium.
    expect(normalizeScale('body', 'Medium-Light')).toBe('Medium');
    // In-scale values pass through unchanged.
    expect(normalizeScale('body', 'Medium-Full')).toBe('Medium-Full');
    expect(normalizeScale('body', 'Full')).toBe('Full');
    expect(normalizeScale('body', 'Light')).toBe('Light');
    for (const raw of ['Light', 'Medium', 'Medium-Full', 'Full', 'Medium-Light']) {
      expect(scale).toContain(normalizeScale('body', raw));
    }
  });

  it('passes through values already in scale', () => {
    expect(normalizeScale('acidity', 'Medium')).toBe('Medium');
    expect(normalizeScale('acidity', 'High')).toBe('High');
    expect(normalizeScale('body', 'Medium')).toBe('Medium');
  });

  it('returns null for empty / unknown values', () => {
    expect(normalizeScale('acidity', null)).toBeNull();
    expect(normalizeScale('acidity', undefined)).toBeNull();
    expect(normalizeScale('acidity', '')).toBeNull();
    expect(normalizeScale('acidity', 'Banana')).toBeNull();
  });
});

describe('toTiers', () => {
  it('returns the .tiers sub-object of a tiered taste_profile (not the whole object)', () => {
    const tp = {
      schema_version: '2.0',
      structure: 'tiered',
      tiers: {
        primary: [{ note: 'Strawberry', intensity: 3 }],
        secondary: [{ note: 'Brioche', intensity: 2 }],
        tertiary: [{ note: 'Minerality', intensity: 1 }],
      },
      structural: { body: 'Medium' },
    };
    const tiers = toTiers(tp);
    expect(tiers).not.toBeNull();
    expect(tiers!.primary[0].note).toBe('Strawberry');
    // Must be the tiers sub-object, NOT the whole profile (no schema_version leaking).
    expect((tiers as unknown as Record<string, unknown>).schema_version).toBeUndefined();
  });

  it('returns null when taste_profile is missing or has no tiers', () => {
    expect(toTiers(undefined)).toBeNull();
    expect(toTiers(null as unknown as undefined)).toBeNull();
    expect(toTiers({ schema_version: '2.0', structural: { body: 'Medium' } })).toBeNull();
  });
});

describe('toStructural', () => {
  it('builds {body,acidity,tannin} from flat fields, normalised into component scales', () => {
    const p = mk({ body: 'Medium-Full', acidity: 'Medium-Full', tannin: 'Full' });
    const s = toStructural(p);
    expect(s).toEqual({ body: 'Medium-Full', acidity: 'Medium-High', tannin: 'High' });
    // Every produced value lands in the matching component scale → gauges fill.
    for (const axis of ['body', 'acidity', 'tannin'] as const) {
      expect(SCALE_DEFINITIONS[axis].scale).toContain(s[axis]);
    }
  });

  it('a Medium-Full acidity product yields a filled gauge (filledCount > 0)', () => {
    const s = toStructural(mk({ acidity: 'Medium-Full' }));
    const filled = SCALE_DEFINITIONS.acidity.scale.indexOf(s.acidity) + 1;
    expect(filled).toBeGreaterThan(0);
  });

  it('folds lowercase tokens to the canonical scale value (3 rows have body=light)', () => {
    // Regression: the Details table no longer lists body/acidity/tannin, so a
    // lowercase value that fails to normalise would vanish entirely AND render
    // an all-empty gauge. Case-fold so it fills.
    expect(toStructural(mk({ body: 'light' })).body).toBe('Light');
    expect(toStructural(mk({ acidity: 'high' })).acidity).toBe('High');
    expect(toStructural(mk({ tannin: 'medium-full' })).tannin).toBe('Medium-High');
  });

  it('drops empty/null axes rather than emitting silent-empty gauges', () => {
    const s = toStructural(mk({ body: 'Medium', acidity: null as unknown as undefined }));
    expect(s).toEqual({ body: 'Medium' });
    expect('acidity' in s).toBe(false);
  });

  it('a no-taste product returns an empty object', () => {
    expect(toStructural(mk({}))).toEqual({});
  });

  it('emits sweetness on the gauge scale and drops off-scale', () => {
    expect(toStructural({ sweetness: 'Sweet' } as any).sweetness).toBe('Sweet');
    expect(toStructural({ sweetness: 'Off-Dry' } as any).sweetness).toBe('Off-Dry');
    // sake-ladder lowercase value is off the gauge scale -> dropped (no all-empty gauge)
    expect(toStructural({ sweetness: 'very dry' } as any).sweetness).toBeUndefined();
    expect(toStructural({} as any).sweetness).toBeUndefined();
  });
});
