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

/**
 * Per-category axis gating (the "tannin on tequila" fix).
 *
 * The structural gauges are a WINE schema. Before this gate, any populated flat
 * field rendered a gauge regardless of category — so Don Julio 1942 (tequila,
 * SKU LTQ...) and Jim Beam (bourbon, SKU LWH...) showed a Tannin gauge, and
 * whisky showed Acidity. Tannin is a grape-skin/oak property: red-wine only.
 * Acidity is meaningful for wine + sake + beer. toStructural() now drops axes
 * that don't apply to the product's category_group (and, for tannin, its
 * red-wine sub-type) — WITHOUT deleting the underlying paid-for data.
 *
 * Category is resolved from the SKU via the canonical taxonomy (groupForProduct/
 * typeForProduct); the live export does NOT carry category_group, so these tests
 * use real-prefix SKUs so resolve() drives the gate.
 */
describe('toStructural — per-category axis gating', () => {
  it('drops Tannin on tequila (Don Julio 1942, LTQ prefix) even when present', () => {
    const s = toStructural(mk({ sku: 'LTQ0203BU', name: 'Don Julio 1942', tannin: 'Light', body: 'Full' }));
    expect('tannin' in s).toBe(false);
    expect(s.body).toBe('Full'); // body still applies to spirits
  });

  it('drops Tannin AND Acidity on whisky (Jim Beam bourbon, LWH prefix)', () => {
    const s = toStructural(mk({ sku: 'LWH0329AA', name: 'Jim Beam Bourbon', tannin: 'Low', acidity: 'Low', body: 'Medium' }));
    expect('tannin' in s).toBe(false);
    expect('acidity' in s).toBe(false);
    expect(s.body).toBe('Medium'); // body + sweetness are whisky-appropriate
  });

  it('drops Tannin on gin (Bombay Sapphire, LGN prefix)', () => {
    const s = toStructural(mk({ sku: 'LGN0311DR', name: 'Bombay Sapphire Gin', tannin: 'Low', body: 'Light' }));
    expect('tannin' in s).toBe(false);
  });

  it('KEEPS all four wine axes for red wine (tannin is correct here)', () => {
    // A red-wine SKU prefix (WRW) resolves to type "Red Wine" → tannin allowed.
    const s = toStructural(mk({ sku: 'WRW3100CI', name: 'A Red Wine', body: 'Full', acidity: 'Medium', tannin: 'High', sweetness: 'Dry' }));
    expect(s.tannin).toBe('High');
    expect(s.body).toBe('Full');
    expect(s.acidity).toBe('Medium');
    expect(s.sweetness).toBe('Dry');
  });

  it('drops Tannin on white wine (same Wine group, but not Red sub-type)', () => {
    const s = toStructural(mk({ sku: 'WWW1000AA', name: 'A White Wine', body: 'Medium', acidity: 'High', tannin: 'Low' }));
    expect('tannin' in s).toBe(false);
    expect(s.acidity).toBe('High'); // acidity stays for white wine
  });

  it('keeps Acidity for sake but drops Tannin (sake has real acidity, no tannin)', () => {
    const s = toStructural(mk({ sku: 'LSJ0024DG', name: 'A Sake', acidity: 'Medium', tannin: 'Low', body: 'Medium' }));
    expect(s.acidity).toBe('Medium');
    expect('tannin' in s).toBe(false);
  });

  it('an unknown-group product (synthetic sku:X) keeps all axes — gate is permissive on Unknown', () => {
    // Legacy/test products with no resolvable category must not lose data.
    const s = toStructural(mk({ sku: 'X', body: 'Medium', acidity: 'Medium', tannin: 'Medium', sweetness: 'Dry' }));
    expect(s).toEqual({ body: 'Medium', acidity: 'Medium', tannin: 'Medium', sweetness: 'Dry' });
  });
});
