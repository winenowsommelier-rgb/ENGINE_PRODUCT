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
import { groupForProduct, typeForProduct } from '@/lib/category-groups';

/**
 * PER-CATEGORY AXIS POLICY — the "tannin on tequila" fix.
 *
 * The structural gauges (Body / Acidity / Tannin / Sweetness) are a WINE schema.
 * Before this gate, ANY populated flat field rendered a gauge regardless of
 * category, so Don Julio 1942 (tequila) and Jim Beam (bourbon) showed a Tannin
 * gauge and whisky showed Acidity — meaningless to a knowledgeable buyer.
 *
 * Tannin is a grape-skin / oak property → RED WINE only.
 * Acidity is meaningful for wine, sake and beer; not for brown/clear spirits.
 * Body and Sweetness are broadly applicable.
 *
 * This gate suppresses inapplicable axes AT DISPLAY TIME. It does NOT delete the
 * underlying (paid-for) enrichment data — toStructural is a read-side adapter.
 *
 * FUTURE AXES (design captured, not yet shipped): the StructuralGauges component
 * also supports `intensity`, `bitterness`, `carbonation` — and we'd want
 * smoke/peat for whisky. Those have NO flat source field in the export yet, so
 * they are listed here as the INTENDED per-category profile but are inert until
 * an enrichment run (Rule 10, paid) populates them. Listing an axis here that has
 * no data is harmless: toStructural only emits axes whose value normalises, so
 * there is never a silent-empty gauge.
 */
type Group =
  | 'Wine' | 'Whisky' | 'Spirits' | 'Sake & Asian' | 'Liqueur'
  | 'Beer & RTD' | 'Non-Alcoholic' | 'Cigars' | 'Events' | 'Accessories' | 'Unknown';

// Axes allowed for each category group. Tannin is intentionally ABSENT from every
// group here and handled separately (red-wine-only) in toStructural, because the
// Wine group also contains white/rosé/sparkling where tannin must NOT show.
// '*' (Unknown / unresolved) is permissive so legacy/synthetic products keep all axes.
const AXES_BY_GROUP: Record<Group, ReadonlySet<string>> = {
  // Wine tannin gated by sub-type below; body/acidity/sweetness always apply.
  'Wine':          new Set(['body', 'acidity', 'sweetness']),
  // Whisky: weight + sweetness (sherried/peated). Smoke/peat + intensity are future.
  'Whisky':        new Set(['body', 'sweetness']),
  // Clear/agave spirits: weight + a little sweetness; no acidity, no tannin.
  'Spirits':       new Set(['body', 'sweetness']),
  // Sake has genuine acidity; never tannin.
  'Sake & Asian':  new Set(['body', 'acidity', 'sweetness']),
  // Liqueurs: sweetness-led, with body; bitterness is future.
  'Liqueur':       new Set(['body', 'sweetness']),
  // Beer & RTD: body/sweetness/acidity (sours); carbonation + bitterness future.
  'Beer & RTD':    new Set(['body', 'acidity', 'sweetness']),
  // Non-alcoholic: keep body/sweetness/acidity (juices, mixers, NA wine).
  'Non-Alcoholic': new Set(['body', 'acidity', 'sweetness']),
  // No taste gauges for these — they have no flat taste data anyway.
  'Cigars':        new Set<string>(),
  'Events':        new Set<string>(),
  'Accessories':   new Set<string>(),
  // Unresolved category → permissive (don't drop data for synthetic/test SKUs).
  'Unknown':       new Set(['body', 'acidity', 'sweetness']),
};

// Tannin is shown ONLY for these wine sub-types (typeForProduct). White/Rosé/
// Sparkling/Sweet wines carry negligible tannin and must not display the gauge.
const TANNIN_TYPES: ReadonlySet<string> = new Set(['Red Wine', 'Orange Wine']);

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
 * PER-CATEGORY GATE: only axes applicable to the product's category_group are
 * emitted (see AXES_BY_GROUP), and tannin is restricted to red/orange wine
 * sub-types (TANNIN_TYPES). Category is resolved from the SKU via the canonical
 * taxonomy (groupForProduct/typeForProduct) — the live export does not carry the
 * group field, so resolution drives the gate. This suppresses nonsensical gauges
 * (tannin on tequila, acidity on whisky) WITHOUT deleting the underlying data.
 *
 * body / acidity / tannin / sweetness are emitted from their flat fields
 * (sweetness is Phase-B-Run-2 enriched on the [Dry, Off-Dry, Medium-Sweet, Sweet]
 * gauge scale). The component also supports bitterness/carbonation/intensity but
 * those have no flat source here yet (see AXES_BY_GROUP doc), so we don't emit them.
 */
export function toStructural(product: PublicProduct): Record<string, string> {
  const group = (groupForProduct(product) as Group) ?? 'Unknown';
  const allowed = AXES_BY_GROUP[group] ?? AXES_BY_GROUP.Unknown;
  // Tannin: allowed only for red/orange wine sub-types, regardless of group set.
  const tanninOK = group === 'Unknown' || TANNIN_TYPES.has(typeForProduct(product));

  const out: Record<string, string> = {};
  if (allowed.has('body')) {
    const body = normalizeScale('body', product.body);
    if (body) out.body = body;
  }
  if (allowed.has('acidity')) {
    const acidity = normalizeScale('acidity', product.acidity);
    if (acidity) out.acidity = acidity;
  }
  if (tanninOK) {
    const tannin = normalizeScale('tannin', product.tannin);
    if (tannin) out.tannin = tannin;
  }
  if (allowed.has('sweetness')) {
    const sweetness = normalizeScale('sweetness', product.sweetness);
    if (sweetness) out.sweetness = sweetness;
  }
  return out;
}
