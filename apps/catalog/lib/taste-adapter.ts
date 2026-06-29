/**
 * taste-adapter.ts — bridges the live export's taste data onto the ported
 * taste-viz components (TasteWheel / StructuralGauges).
 *
 * Two shape mismatches this file reconciles (both VERIFIED against
 * data/live_products_export.json, 11,436 rows):
 *
 * 1. TIERS (TasteWheel)
 *    taste_profile is a NESTED object:
 *      { schema_version, structure, tiers:{primary,secondary,tertiary}, structural, ... }
 *    Only ~3,689 products have .tiers. TasteWheel wants the .tiers SUB-OBJECT,
 *    NOT the whole profile. toTiers() extracts it (or null).
 *
 * 2. STRUCTURAL (StructuralGauges) — the SILENT-EMPTY-GAUGE trap (Rule 2 / Rule 6)
 *    The FLAT fields wine_body / wine_acidity / wine_tannin are more populated
 *    (~4,438) and are the canonical structural source. BUT their values are NOT
 *    all in the component's SCALE_DEFINITIONS:
 *      acidity scale = [Low, Medium, Medium-High, High]
 *        live values also include: Medium-Full(260), Full(72), Medium-Light(138), Light(44)
 *      body scale = [Light, Medium, Medium-Full, Full]
 *        live values also include: Medium-Light(122)
 *      tannin scale = [Low, Medium, Medium-High, High]
 *        live values also include: Medium-Full(122), Full(25), Medium-Light(78), Light(430)
 *    StructuralGauges renders filledCount = scale.indexOf(value)+1. An unmapped
 *    value → indexOf -1 → 0 filled cells → a gauge that is ALL-EMPTY with NO
 *    warning. That is exactly the kind of silent data drop Rules 2/6 forbid.
 *    normalizeScale() maps every real value INTO the component scale so the gauge
 *    always fills. Regression-tested in __tests__/taste-adapter.test.ts.
 */

import type { PublicProduct } from '@/lib/types';
import type { Tiers } from '@/components/product/TasteWheel';

/**
 * The intensity-vs-fullness scales differ between axes:
 *   - acidity / tannin use a Low → High scale.
 *   - body uses a Light → Full scale (Medium-Full and Full are IN-scale here).
 * So the same raw token (e.g. 'Full') normalises differently per axis.
 */
type Axis = 'body' | 'acidity' | 'tannin' | 'sweetness';

// Per-axis value remap: raw export token → component-scale token. Tokens already
// in the component scale are passed through (handled below); only OUT-of-scale
// tokens need an explicit entry here.
const REMAP: Record<Axis, Record<string, string>> = {
  // acidity scale: [Low, Medium, Medium-High, High]
  acidity: {
    'Medium-Full': 'Medium-High',
    'Full': 'High',
    'Medium-Light': 'Medium',
    'Light': 'Low',
  },
  // tannin scale: [Low, Medium, Medium-High, High] (same remap as acidity)
  tannin: {
    'Medium-Full': 'Medium-High',
    'Full': 'High',
    'Medium-Light': 'Medium',
    'Light': 'Low',
  },
  // body scale: [Light, Medium, Medium-Full, Full] — only Medium-Light is out-of-scale.
  body: {
    'Medium-Light': 'Medium',
  },
  // sweetness scale: [Dry, Off-Dry, Medium-Sweet, Sweet] — no aliases; the model
  // emits exact gauge values and the validator guards upstream.
  sweetness: {},
};

// The in-scale value sets, used to pass through values that are already valid.
const SCALE: Record<Axis, ReadonlySet<string>> = {
  body: new Set(['Light', 'Medium', 'Medium-Full', 'Full']),
  acidity: new Set(['Low', 'Medium', 'Medium-High', 'High']),
  tannin: new Set(['Low', 'Medium', 'Medium-High', 'High']),
  sweetness: new Set(['Dry', 'Off-Dry', 'Medium-Sweet', 'Sweet']),
};

// lowercase token → canonical-cased token, per axis. Covers both in-scale
// values and remappable out-of-scale values so case folding happens before
// the SCALE/REMAP lookups below.
const CANON: Record<Axis, Map<string, string>> = (() => {
  const out = {} as Record<Axis, Map<string, string>>;
  (Object.keys(SCALE) as Axis[]).forEach((a) => {
    const m = new Map<string, string>();
    SCALE[a].forEach((t) => m.set(t.toLowerCase(), t));
    Object.keys(REMAP[a]).forEach((t) => m.set(t.toLowerCase(), t));
    out[a] = m;
  });
  return out;
})();

/**
 * Normalise a raw structural value into the component's scale for `axis`.
 *
 * @returns a token guaranteed to be in the component scale (so the gauge fills),
 *          or null for empty / unknown values (drop the axis rather than emit a
 *          silent-empty gauge).
 */
export function normalizeScale(axis: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const a = axis as Axis;
  if (!(a in SCALE)) return null;
  const raw = value.trim();
  if (raw === '') return null;
  // Case-insensitive match: live export carries a few lowercase tokens
  // (e.g. body='light', 3 rows). Without folding, indexOf -1 → silent-empty
  // gauge AND (now that the Details table no longer lists body/acidity/tannin)
  // the value would vanish entirely. Fold to the canonical-cased scale token.
  const v = CANON[a].get(raw.toLowerCase()) ?? raw;
  if (SCALE[a].has(v)) return v;          // already valid → pass through
  const mapped = REMAP[a][v];
  return mapped ?? null;                    // unknown token → drop (null)
}

/**
 * Extract the TasteWheel tiers sub-object from a product's taste_profile.
 * Returns null when there is no taste_profile or it carries no .tiers
 * (~7,747 of 11,436 products have no tiers). Guards every level.
 */
export function toTiers(taste_profile: Record<string, unknown> | null | undefined): Tiers | null {
  if (!taste_profile || typeof taste_profile !== 'object') return null;
  const tiers = (taste_profile as { tiers?: unknown }).tiers;
  if (!tiers || typeof tiers !== 'object') return null;
  return tiers as Tiers;
}

/**
 * Build the StructuralGauges input from a product's FLAT structural fields,
 * normalising each value into the component scale and DROPPING empties.
 * Returns {} when the product has no usable structural data.
 *
 * body / acidity / tannin / sweetness are emitted from their flat fields
 * (sweetness is Phase-B-Run-2 enriched on the [Dry, Off-Dry, Medium-Sweet, Sweet]
 * gauge scale). The component also supports bitterness/carbonation/intensity but
 * those have no flat source here, so we don't emit them.
 */
export function toStructural(product: PublicProduct): Record<string, string> {
  const out: Record<string, string> = {};
  const body = normalizeScale('body', product.body);
  const acidity = normalizeScale('acidity', product.acidity);
  const tannin = normalizeScale('tannin', product.tannin);
  if (body) out.body = body;
  if (acidity) out.acidity = acidity;
  if (tannin) out.tannin = tannin;
  const sweetness = normalizeScale('sweetness', product.sweetness);
  if (sweetness) out.sweetness = sweetness;
  return out;
}
