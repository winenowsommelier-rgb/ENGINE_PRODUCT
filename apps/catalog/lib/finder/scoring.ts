import type { PublicProduct } from '@/lib/types';
import type { Answers } from './answers';
import { finderPrefilter } from './category-map';
import { foodChipMatches } from './food-chips';
import { primaryValue, bucketForValue } from './scales';
import { normalizeScale } from '@/lib/taste-adapter';
import { typeForProduct, groupForProduct } from '@/lib/category-groups';
import { resolveArchetypeId } from './taste-feel';
import { STYLE_PROFILES } from './style-profiles';
import { isLikelyPeated } from './peated-distilleries';
import { matchBand, type MatchBandLabel } from './match-band';

const BODY_LADDER = ['light','medium-light','medium','medium-full','full'];
// 4-level intensity ladder shared by acidity & tannin (matches FILTER_SCALE in scales.ts).
// Used by the taste-feel scorer to nudge on tannin (red) / acidity (white) toward the
// resolved archetype's definingAttributes. Off-ladder / missing values yield null → 0.
const INTENSITY_LADDER = ['low','medium','medium-high','high'];
const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** Ordinal distance on the 4-level acidity/tannin ladder; null if either is off-ladder. */
function intensityLadderDistance(target: string, value: string): number | null {
  const ti = INTENSITY_LADDER.indexOf(norm(target));
  const vi = INTENSITY_LADDER.indexOf(norm(value));
  if (ti < 0 || vi < 0) return null;
  return Math.abs(ti - vi);
}

/** Ordinal distance on the 5-level body scale; null if either value is off-ladder. */
export function bodyLadderDistance(target: string, value: string): number | null {
  const ti = BODY_LADDER.indexOf(norm(target));
  const vi = BODY_LADDER.indexOf(norm(value));
  if (ti < 0 || vi < 0) return null;
  return Math.abs(ti - vi);
}

const BODY_TOKEN: Record<string, string> = { light:'Light', medium:'Medium', bold:'Full' };

// ── SAKE sweetness (axis1 = dry | sweet | any) ──────────────────────────────
// Sake's PRIMARY taste question is sweetness, the dry↔sweet analogue of wine's
// body. ~26% of sake carry a structured value at taste_profile.axes.sweetness.value
// on the 4-level scale below; the rest have no signal (null → neutral 0, never
// penalized — same "no signal = 0" contract as the body ladder). 'any' imposes no
// constraint. Reading the sparse-but-real field replaces the old "profile-only,
// no reliable sweetness field" no-op so the finder answer actually ranks results.
const SWEETNESS_LADDER = ['very dry', 'dry', 'off-dry', 'sweet'];
// token → target bucket on the ladder (dry end vs sweet end).
const SWEETNESS_TARGET: Record<string, string> = { dry: 'dry', sweet: 'sweet' };

/** The product's sake sweetness value (taste_profile.axes.sweetness.value), or undefined. */
function sakeSweetness(p: PublicProduct): string | undefined {
  const tp = p.taste_profile;
  if (!tp || typeof tp !== 'object') return undefined;
  const axes = (tp as Record<string, unknown>).axes;
  if (!axes || typeof axes !== 'object') return undefined;
  const s = (axes as Record<string, unknown>).sweetness;
  if (!s || typeof s !== 'object') return undefined;
  const v = (s as Record<string, unknown>).value;
  return typeof v === 'string' ? v : undefined;
}

/** Ordinal distance on the 4-level sweetness scale; null if either value is off-ladder. */
function sweetnessLadderDistance(target: string, value: string): number | null {
  const ti = SWEETNESS_LADDER.indexOf(norm(target));
  const vi = SWEETNESS_LADDER.indexOf(norm(value));
  if (ti < 0 || vi < 0) return null;
  return Math.abs(ti - vi);
}

// ── TIER-2 origin/style signal maps (spec §5). Kept as data, not buried magic
// strings (Rule 3). Each token comes from question-config.ts for that category. ──

// WHISKY axis1 (origin) → expected p.country. 'world' has no reliable single
// country, so no boost.
//
// NOTE (spec §11.8): whisky has NO axis2→region "style" term. The old
// WHISKY_STYLE_TO_REGIONS map guessed peat from region (smoky→Islay) — verified
// WRONG (the export false-negatives non-Islay smoky malts like Talisker/Ledaig and
// mislabels clean Islay bottles), and the whisky question-config no longer even emits
// axis2 (it uses WHISKY_FEEL_STEP). Removed. Whisky smoke is now scored from REAL
// evidence (smokiness='heavy' / peated allow-list) via whiskyFeelSmokyBump + peatScore,
// never from region.
const WHISKY_ORIGIN_TO_COUNTRY: Record<string, string> = {
  scotch: 'scotland', japanese: 'japan', bourbon: 'usa', irish: 'ireland',
};

// SPIRITS (other) axis1 (type) → accepted canonical category_type values
// (lowercased). MUST read the SKU-derived `category_type` (via typeForProduct),
// NEVER the raw Magento `classification` — classification is a stale TYPE duplicate
// that dumps 162/419 spirit-pool rows into the junk bucket "wine product", so they
// could never score the type answer (audit finding C1; see CLAUDE.md Rule 12 and
// [[project_classification_means_designation]]). category_type is clean: Rum/Tequila/
// Vodka/Brandy/Cognac/Mezcal with ZERO junk. 'other' is a catch-all → no boost.
const SPIRITS_TYPE_TO_TYPE: Record<string, string[]> = {
  vodka: ['vodka'], rum: ['rum'], tequila: ['tequila', 'mezcal'],
  brandy: ['brandy', 'cognac', 'armagnac'],
};

/**
 * Category-aware TIER-2 scorer for the axis answers (spec §5). Returns the points
 * a single product earns from the (axis1, axis2) origin/style answers. Wine body
 * (axis1) is scored separately via the BODY_TOKEN ladder in scoreProducts and is
 * NOT handled here.
 *
 * No longer profile-only (audit finding W3 — both used to rank NOTHING):
 *  - WINE axis2 (fruity/earthy/balanced): now a TASTE-TIER term via
 *    wineCharacterScore (flavor_tags_canonical set-intersection) in scoreProducts.
 *    'balanced' stays a deliberate neutral (no constraint).
 *  - GIN axis1 (classic/contemporary): now a RANK-ONLY keyword lean via
 *    ginStyleBump in deepDiveBump (no structured field, so kept out of the gate).
 * Neither is handled HERE — wine character is a taste-tier term, gin style a
 * rank-only bump, exactly like wine body vs the deep-dive terms.
 *
 * NOTE: SAKE axis1 (dry/sweet) is NO LONGER profile-only — it is scored as a
 * taste-tier term in scoreProducts via the sweetness ladder (taste_profile.axes.
 * sweetness, ~26% populated; no-signal sake is neutral). Not handled here because,
 * like wine body, it is a ladder term in scoreProducts, not a flat +2 origin boost.
 */
function tier2Score(a: Answers, p: PublicProduct): number {
  let s = 0;
  switch (a.category) {
    case 'whisky': {
      // ORIGIN only (axis1 → country). Whisky smoke is scored from real evidence
      // (smokiness/peated allow-list) in whiskyFeelSmokyBump/peatScore, NOT a region-
      // guessing axis2→region map (removed, spec §11.8 — see WHISKY_ORIGIN_TO_COUNTRY note).
      const wantCountry = a.axis1 ? WHISKY_ORIGIN_TO_COUNTRY[a.axis1] : undefined;
      if (wantCountry && p.country && norm(p.country) === wantCountry) s += 2;
      break;
    }
    case 'spirits': {
      const wantTypes = a.axis1 ? SPIRITS_TYPE_TO_TYPE[a.axis1] : undefined;
      // category_type (SKU taxonomy), not classification — Rule 12.
      if (wantTypes && wantTypes.includes(norm(typeForProduct(p)))) s += 2;
      break;
    }
    // gin: axis1 is profile-only (see doc above). sake: axis1 (sweetness) IS scored,
    // but as a ladder term in scoreProducts (not here) — see the doc above.
  }
  return s;
}

function ladderScore(distance: number | null, exact: number): number {
  // Exact/adjacent body matches clear QUALITY_MIN (rungs 4/3); a body ≥2 steps off the
  // wanted level is a weak match (rung 1, BELOW QUALITY_MIN) so an all-far-body pool
  // honestly degrades. Off-ladder / missing body returns null above and scores 0
  // (the genuine "no signal" case).
  if (distance === null) return 0;
  if (distance === 0) return exact;       // exact     → 4
  if (distance === 1) return exact - 1;   // adjacent  → 3
  return 1; // 2+ steps off the wanted body → rung 1, BELOW QUALITY_MIN (=2). A pool
            // that is all far-body honestly degrades. The rung is a literal, deliberately
            // decoupled from QUALITY_MIN so the ladder and the degrade gate move independently.
}

const MIN_RESULTS = 4;
const TOP_N = 8;
const QUALITY_MIN = 2;

// ── DEEP-DIVE sommelier scoring (acidity / tannin / grape / age / adventurousness).
// ADDITIVE by design: these terms add to the RANK score only. The honest-label
// `degraded` flag is computed from the v1 taste-tier score ONLY (see scoreProducts),
// so a deep-dive bump can re-order results but can never clear the quality gate.

/**
 * Ordinal-ladder match on a 4-level intensity scale (acidity / tannin). Both the
 * product value and the answer token are normalised into the SAME FILTER_SCALE
 * bucket, then compared by ordinal distance: exact +3, ±1 +1, else 0. Returns 0
 * for any off-ladder / missing value (the genuine "no signal" case).
 */
function intensityScore(scale: 'acidity' | 'tannin', token: string | undefined, value: string | undefined): number {
  if (!token) return 0;
  const want = bucketForValue(scale, primaryValue(scale, token) ?? undefined);
  const have = bucketForValue(scale, normalizeScale(scale, value) ?? undefined);
  if (want < 0 || have < 0) return 0;
  const d = Math.abs(want - have);
  if (d === 0) return 3;
  if (d === 1) return 1;
  return 0;
}

// Grape family → tokens that, if present in p.variety, signal that family.
// 'surprise' (and any unmapped token) intentionally has no entry → never constrains.
// RED grapes (red deep-dive) + WHITE/SPARKLING grapes (white/sparkling deep-dive, W5).
// The white/sparkling tokens were derived from the live export's actual `variety`
// distribution (chardonnay 316 / sauvignon blanc 186 / riesling 55 / … for white;
// chardonnay+pinot noir+meunier+glera for sparkling) so every grape the UI offers in
// a given category maps to real in-stock bottles. FIXES the W5 bug where white &
// sparkling deep-dives showed only RED grapes (Cabernet/Merlot/…), nonsensical to the
// user and unscoreable against a white wine's variety.
const GRAPE_FAMILY: Record<string, string[]> = {
  // — RED —
  cabernet:      ['cabernet'],
  'pinot-noir':  ['pinot noir'],
  'syrah-shiraz':['syrah', 'shiraz'],
  sangiovese:    ['sangiovese'],
  tempranillo:   ['tempranillo', 'rioja'],
  merlot:        ['merlot'],
  grenache:      ['grenache', 'garnacha'],
  // — WHITE — ('sauv-blanc' → 'sauvignon blanc'; 'pinot-grigio' also catches 'pinot gris')
  chardonnay:    ['chardonnay'],
  'sauv-blanc':  ['sauvignon blanc'],
  riesling:      ['riesling'],
  'pinot-grigio':['pinot grigio', 'pinot gris'],
  viognier:      ['viognier'],
  semillon:      ['semillon', 'sémillon'],
  // — SPARKLING — (reuses chardonnay/pinot-noir above; adds the bubbles-specific grapes.
  // 'glera' is the Prosecco grape, also labelled 'prosecco' on some rows.)
  glera:         ['glera', 'prosecco'],
  meunier:       ['meunier'],
};

// Flavor family → canonical-note SET that signals that family. Chip tokens are
// hyphenated (`dark-fruit`); canonical notes are spaced Title-Case (`Dark Plum`).
// We match by lowercased set-intersection, so the historical hyphen-vs-space bug
// (chip `dark-fruit` never equalled tag `dark fruit`) cannot recur. Both sides are
// lowercased at compare time (product notes via `norm`, family notes via `.map(norm)`
// in the matcher) — so the invariant is self-enforcing, not comment-enforced: a
// future Title-Case note added here still matches. Every note below was verified to
// exist (>0 rows) in `flavor_tags_canonical`; zero-count notes (passion fruit,
// baking spice, blossom, flint, chalk, smoky, peat, almond) were dropped so the
// note universe doesn't overstate the matcher's reach.
// Exported so a later coverage test can import and assert the key/note universe.
export const FLAVOR_FAMILY: Record<string, string[]> = {
  'red-fruit':  ['red fruit','cherry','strawberry','raspberry'],
  'dark-fruit': ['dark plum','plum','blackcurrant','blackberry','black cherry'],
  citrus:       ['citrus','citrus zest','lemon','lime','grapefruit'],
  'stone-fruit':['stone fruit','peach','apricot','green apple','pear'],
  tropical:     ['tropical','pineapple','mango'],
  oak:          ['oak','vanilla','cedar','toast'],
  spice:        ['spice','black pepper','cinnamon','clove'],
  earthy:       ['earth','tobacco','leather','mushroom','graphite'],
  floral:       ['floral','rose','violet'],
  mineral:      ['minerality','wet stone','sea salt'],
  smoky:        ['smoke'],
  nutty:        ['hazelnut','brioche','cocoa','caramel','honey'],
};

function grapeScore(token: string | undefined, grapeVariety: string | undefined): number {
  if (!token) return 0;
  const family = GRAPE_FAMILY[token];
  if (!family) return 0; // 'surprise' / unknown → no constraint
  const hay = norm(grapeVariety);
  return family.some((t) => hay.includes(t)) ? 2 : 0;
}

// WINE axis2 (character) → flavor families that signal it (audit finding W3). This
// axis was previously profile-only (shaped the archetype copy but ranked nothing),
// so the wine "character" question was decorative. It is now a real taste-tier term:
// it set-intersects flavor_tags_canonical via the SAME FLAVOR_FAMILY note sets used
// by the flavor chips, so the mechanism (and its hyphen-vs-space safety) is reused,
// not reinvented. 'balanced' has no entry → no constraint (a deliberate neutral, like
// the chips' unmapped tokens). Backed by real data: 3,045 in-stock wines carry a
// fruity-family note, 1,545 an earthy-family note.
const WINE_CHARACTER_TO_FAMILIES: Record<string, string[]> = {
  fruity: ['red-fruit', 'dark-fruit', 'stone-fruit', 'tropical', 'citrus'],
  earthy: ['earthy', 'oak', 'spice', 'mineral'],
  // balanced: intentionally absent → imposes no constraint.
};

/** Points a wine earns from the axis2 character answer (taste-tier; 0 when no signal). */
function wineCharacterScore(token: string | undefined, canonical: string[] | undefined): number {
  if (!token) return 0;
  const families = WINE_CHARACTER_TO_FAMILIES[token];
  if (!families) return 0; // 'balanced' / unknown → no constraint
  const notes = new Set((canonical ?? []).map(norm));
  // Any family in the character group that intersects the product's notes scores it.
  for (const fam of families) {
    const noteSet = FLAVOR_FAMILY[fam];
    if (noteSet && noteSet.some((n) => notes.has(norm(n)))) return 2;
  }
  return 0;
}

// GIN tasteFeel (style) → keyword signal for a RANK-ONLY lean (audit finding W3). Unlike
// wine character there is NO structured field for classic vs modern gin, so this reads
// name/description keywords (noisier). It is therefore kept RANK-ONLY (deep-dive bump,
// never the taste-tier `s`): a keyword hit can re-order but must NOT clear the quality
// gate. Data: 49 in-stock gins signal "london dry"; 125 signal a contemporary/botanical/
// floral cue.
//
// Phase-2 rewire (TASK B): gin Layer-1 moved from the axis1 classic/contemporary step to a
// plain `tasteFeel` step (classic/modern). This reads a.tasteFeel now, mapping the 'modern'
// token onto the same contemporary keyword branch (and 'classic' onto the london-dry branch)
// — the keyword logic is unchanged, only the answer field + token name changed.
const GIN_CLASSIC_KEYWORDS = ['london dry', 'london'];
const GIN_CONTEMPORARY_KEYWORDS = ['contemporary', 'botanical', 'floral', 'citrus-forward', 'new western'];

function ginStyleBump(a: Answers, p: PublicProduct): number {
  if (a.category !== 'gin' || !a.tasteFeel) return 0;
  // Rule 12: do NOT read p.classification — it is a stale TYPE duplicate (junk "Wine product"
  // for ~72 in-stock gins), never a real style signal. Name + descriptions only.
  const hay = norm(
    [p.name, p.desc_en_short, p.full_description].filter(Boolean).join(' '),
  );
  if (!hay) return 0;
  if (a.tasteFeel === 'classic') return GIN_CLASSIC_KEYWORDS.some((k) => hay.includes(k)) ? 1 : 0;
  if (a.tasteFeel === 'modern') {
    return GIN_CONTEMPORARY_KEYWORDS.some((k) => hay.includes(k)) ? 1 : 0;
  }
  return 0;
}

// SPIRITS (other) Layer-1 tasteFeel → POSITIVE-ONLY age/grade rank lean (TASK A). Spirits
// have no structured body/acidity worth ranking on (unlike wine), so the 'rich'/'aged'
// feel reads age/grade keywords from name + desc (reposado/añejo/VSOP/XO/aged/gran reserva/
// 'year') — the same noisy-text approach as ginStyleBump, kept RANK-ONLY (deep-dive bump,
// never the taste-tier `s`): a keyword hit re-orders but cannot clear the quality gate.
// 'light'/'smooth' impose NO text requirement (they describe a clean unaged style, which is
// the absence of these markers, not a positive keyword) → 0 here, so a plain bottle is
// never penalized. Rule 12: name/desc only, NEVER classification.
const SPIRITS_AGE_KEYWORDS = [
  'reposado', 'añejo', 'anejo', 'vsop', 'xo', 'x.o', 'aged', 'gran reserva', 'year',
];
function spiritsFeelScore(a: Answers, p: PublicProduct): number {
  if (a.category !== 'spirits') return 0;
  if (a.tasteFeel !== 'rich' && a.tasteFeel !== 'aged') return 0;
  const hay = norm([p.name, p.desc_en_short].filter(Boolean).join(' '));
  if (!hay) return 0;
  return SPIRITS_AGE_KEYWORDS.some((k) => hay.includes(k)) ? 2 : 0;
}

// SAKE Layer-1 tasteFeel → aroma class from the STRUCTURED `variety` (TASK B). Unlike the
// spirits keyword lean this reads a structured field, so it is reliable: ginjo/daiginjo
// signal the fragrant (aromatic/fruity) class; junmai (without ginjo) / honjozo signal the
// clean (dry/crisp) class. +2 when the bottle's class matches the shopper's aroma feel
// ('fragrant'/'clean'). Missing/unrecognised variety → 0 (neutral, never penalized).
// Kept in the deep-dive bump (rank-only) so it re-orders but doesn't gate; the sweetness
// (axis1) Layer-2 path in scoreProducts is untouched.
function sakeVarietyClass(variety: string | undefined): 'fragrant' | 'clean' | null {
  const v = norm(variety);
  if (!v) return null;
  // ginjo/daiginjo → fragrant. Check ginjo first so 'Junmai Ginjo' is fragrant, not clean.
  if (v.includes('ginjo')) return 'fragrant'; // also matches 'daiginjo'
  if (v.includes('junmai') || v.includes('honjozo')) return 'clean';
  return null;
}
function sakeAromaScore(a: Answers, p: PublicProduct): number {
  if (a.category !== 'sake') return 0;
  if (a.tasteFeel !== 'fragrant' && a.tasteFeel !== 'clean') return 0;
  const cls = sakeVarietyClass(p.variety);
  if (!cls) return 0;
  return cls === a.tasteFeel ? 2 : 0;
}

// Age scoring. vintage is a STRING at runtime ("Current vintage", "2005",
// "2005 [**VINTAGE MAY CHANGE]"). CURRENT_YEAR is a hardcoded const (not
// `new Date()`) so age scoring is deterministic and test-stable across the
// year boundary — bump it on the annual catalog refresh.
const CURRENT_YEAR = 2026;
const AGE_THRESHOLD = 8; // years old at/after which a wine reads as "mature"

/** Classify a runtime vintage string into 'young' | 'mature' | null (unparseable/any). */
function vintageAge(vintage: string | undefined): 'young' | 'mature' | null {
  if (!vintage) return null;
  const raw = vintage.trim();
  if (/current vintage/i.test(raw)) return 'young';
  const cleaned = raw.replace(/\[\*\*VINTAGE MAY CHANGE\]/i, '').trim();
  const m = cleaned.match(/^(\d{4})$/);
  if (!m) return null;
  const year = Number(m[1]);
  return CURRENT_YEAR - year >= AGE_THRESHOLD ? 'mature' : 'young';
}

function ageScore(token: string | undefined, vintage: string | undefined): number {
  if (!token) return 0;
  const age = vintageAge(vintage);
  if (!age) return 0; // unparseable / 'any' → no signal
  return age === token ? 1 : 0;
}

// Regions famous enough to anchor the classic/discovery adventurousness axis
// (validated to exist in the live export's `region` field).
const FAMOUS_REGIONS = new Set(
  ['Bordeaux','Burgundy','Champagne','Tuscany','Piedmont','Mendoza',
   'Napa Valley','Marlborough','Rioja','Mosel','Douro'].map((r) => r.toLowerCase()),
);

function adventureScore(token: string | undefined, region: string | undefined): number {
  if (token !== 'classic' && token !== 'discovery') return 0; // 'twist'/any → no rule
  const famous = FAMOUS_REGIONS.has(norm(region));
  if (token === 'classic') return famous ? 2 : 0;
  return famous ? 0 : 2; // discovery: reward NON-famous regions
}

// Whisky peat. The peat answer (none | light | heavy) is now scored as a POSITIVE-ONLY
// boost on REAL smoke evidence — never on region (spec §11.8).
//
// HISTORY (Rule 5): the old version guessed from region=Islay (heavy→+2 Islay, none→+2
// non-Islay). That was WRONG: the export false-negatives genuinely-smoky NON-Islay malts
// (Talisker=Skye, Ledaig=Mull tagged smokiness='none') and mislabels clean Islay bottles.
// Region is not the peat signal.
//   heavy → +2 ONLY when smokiness='heavy' OR the name is on the peated allow-list.
//   none / light / any → 0. We do NOT penalize or reward smokiness='none': a 'none' tag is
//     unreliable (false-negatives), so we never assert "this is smooth" from it, and we
//     never exclude on it.
// Like every deep-dive term this is ADDITIVE (rank-only) and never touches `degraded`.
function peatScore(token: string | undefined, smokiness: string | undefined, name: string | undefined): number {
  if (token !== 'heavy') return 0; // 'none' / 'light' / any → no positive signal asserted
  return norm(smokiness) === 'heavy' || isLikelyPeated(name) ? 2 : 0;
}

// Prestige lean for a gift/special occasion (audit finding C2). The existing
// score_summary +2 bonus (a critic-score quality signal) is WINE-ONLY: score_summary
// is 0% populated for whisky, spirits and sake, so for those categories "a gift" /
// "special occasion" added nothing and the final order collapsed to cheapest-first.
// popularity_tier is the client-SAFE bestseller bucket (0 none / 1 sells / 2 top
// seller; derived server-side, the raw popularity_score never ships). A top-seller
// is a defensible gift proxy where no critic score exists.
//
// Kept RANK-ONLY (in the deep-dive bump, not the taste-tier `s`) ON PURPOSE: a
// popular bottle that does NOT match the user's taste answer must not clear the
// quality gate (`degraded` is computed from `s` alone). +1 only (weaker than the
// critic-score +2, since popularity is a noisier signal than an expert score).
function prestigeBump(a: Answers, p: PublicProduct): number {
  if (a.occasion !== 'gift' && a.occasion !== 'special') return 0;
  return p.popularity_tier === 2 ? 1 : 0;
}

/** Sum of all deep-dive terms for one product (each 0 when its answer is absent). */
function deepDiveBump(a: Answers, p: PublicProduct): number {
  return (
    intensityScore('acidity', a.acidity, p.acidity) +
    intensityScore('tannin', a.tannin, p.tannin) +
    // Grape scoring is WINE-ONLY (Rule 12 / spec): a spirit's `variety` is its base material
    // (grain, agave, sometimes a grape name like Ugni Blanc for Cognac) — NOT a wine grape.
    // Gate on the canonical SKU-derived group so a spirit variety is never read as a grape.
    (groupForProduct(p) === 'Wine' ? grapeScore(a.grape, p.variety) : 0) +
    ageScore(a.age, p.vintage) +
    adventureScore(a.adventure, p.region) +
    peatScore(a.peat, p.smokiness, p.name) +
    whiskyFeelSmokyBump(a, p) +
    prestigeBump(a, p) +
    ginStyleBump(a, p) +
    // Phase-2 Layer-1 rank leans (additive, rank-only — never the taste-tier gate):
    spiritsFeelScore(a, p) + // spirits 'rich'/'aged' → positive-only age/grade keyword lean
    sakeAromaScore(a, p)     // sake 'fragrant'/'clean' → aroma class from structured variety
  );
}

// ── TASTE-FEEL → archetype scoring (Layer-1 plain-language flow, red & white).
// The shopper's plain `tasteFeel` token resolves to a curated archetype (taste-feel.ts);
// that archetype's definingAttributes drive the score against the product's structured
// body / tannin / acidity. BODY is primary (weight 4, same ladder/weight as the old axis1
// body term so genuine matches still clear QUALITY_MIN); the secondary axis (tannin for
// red, acidity for white) is a SMALLER nudge (weight 2).
//
// CRITICAL (spec §11.1): body and the secondary axis are INDEPENDENT, ADDITIVE nudges —
// NEVER an AND-filter. Only ~10 low-tannin reds exist, so requiring BOTH a Light body AND
// Low tannin would starve the pool. A product that matches body but misses tannin (or vice
// versa) still earns the half it matches. No-signal (missing/off-ladder) values score 0.
// Rosé joins the body/acidity-led path legitimately: its archetypes carry body+acidity (no
// tannin), so BODY is the discriminator (crisp=Light vs fruity=Medium) and acidity the nudge —
// the SAME mechanism as white/sparkling. Rosé sweetness is 0/95 in stock so it is never scored.
const TASTE_FEEL_CATEGORIES = new Set(['red', 'white', 'rose', 'sparkling']);
// Secondary nudge axis per category: red leans on tannin, white & sparkling on acidity.
// Sparkling archetypes have no structured tannin (definingAttributes carry body+acidity),
// so BODY is the discriminator (festive=Light vs fine=Full) and acidity the soft nudge.
const FEEL_SECONDARY_AXIS: Record<string, 'tannin' | 'acidity'> = {
  red: 'tannin',
  white: 'acidity',
  rose: 'acidity', // rosé archetypes carry body+acidity (no tannin) → acidity is the nudge
  sparkling: 'acidity',
};

// WHISKY Layer-1 tasteFeel='smoky' (spec §11.8). Positive-only smoky boost from REAL
// evidence: smokiness='heavy' OR the peated-distillery name allow-list. NEVER excludes or
// penalizes smokiness='none' (the export false-negatives Talisker/Ledaig), NEVER reads
// region, NEVER asserts 'smooth' from 'none'. Kept in the deep-dive bump (rank-only): a
// keyword/tag smoky lean re-orders but the whisky core taste-tier stays origin-driven.
// 'smooth' and 'rich' tasteFeel tokens resolve to archetypes for COPY (taste-feel.ts) but
// have no structured smoke field to score, so only 'smoky' earns a rank boost here.
function whiskyFeelSmokyBump(a: Answers, p: PublicProduct): number {
  if (a.category !== 'whisky' || a.tasteFeel !== 'smoky') return 0;
  return norm(p.smokiness) === 'heavy' || isLikelyPeated(p.name) ? 2 : 0;
}

/** Points a wine earns from its tasteFeel answer vs the resolved archetype (0 = no signal). */
function tasteFeelScore(a: Answers, p: PublicProduct): number {
  if (!a.tasteFeel || !TASTE_FEEL_CATEGORIES.has(a.category)) return 0;
  const archetypeId = resolveArchetypeId(a.category, a.tasteFeel);
  const archetype = STYLE_PROFILES.find((sp) => sp.id === archetypeId);
  if (!archetype) return 0;
  const da = archetype.definingAttributes;
  let s = 0;
  // BODY — primary term, full weight (4), reusing the 5-level body ladder.
  if (da.body && p.body) {
    s += ladderScore(bodyLadderDistance(da.body, p.body), 4);
  }
  // SECONDARY — tannin (red) or acidity (white), a SMALLER nudge (weight 2). Independent
  // of the body term (additive, never gated on body matching) — spec §11.1.
  const axis = FEEL_SECONDARY_AXIS[a.category];
  const targetSecondary = axis === 'tannin' ? da.tannin : da.acidity;
  const haveSecondary = axis === 'tannin' ? p.tannin : p.acidity;
  if (targetSecondary && haveSecondary) {
    s += ladderScore(intensityLadderDistance(targetSecondary, haveSecondary), 2);
  }
  return s;
}

/**
 * Did the user give at least one REAL taste/preference signal (not the all-neutral
 * "not sure — guide me" path)? Drives the match-band honesty floor (match-band.ts):
 * with no taste signal we cap every band at "Good match" so the page never claims a
 * strong personalised fit the answers didn't actually produce.
 *
 * "Taste signal" = any of the structured taste questions carrying a real, constraining
 * value: a taste-feel that isn't 'unsure'; an axis1/axis2 token; flavour chips; food
 * chips; or any deep-dive answer. Occasion/budget alone are NOT taste signal (they shape
 * value/prestige, not the flavour profile), matching the band's intent.
 */
export function hadTasteSignal(a: Answers): boolean {
  const feel = a.tasteFeel && a.tasteFeel !== 'unsure' ? a.tasteFeel : undefined;
  return Boolean(
    feel ||
      a.axis1 ||
      a.axis2 ||
      (a.flavorChips?.length ?? 0) > 0 ||
      (a.food?.length ?? 0) > 0 ||
      a.acidity ||
      a.tannin ||
      a.grape ||
      a.age ||
      a.adventure ||
      a.peat,
  );
}

export interface ScoreResult {
  products: PublicProduct[];  // top N, ranked
  /** true when fewer than MIN_RESULTS cleared QUALITY_MIN → UI shows the honest
   *  "Closest matches in your budget" label (spec §5 relax step). */
  degraded: boolean;
  /**
   * Honest per-bottle match band, keyed by sku (spec §11.9). Computed from each
   * shown bottle's TASTE-TIER score (`s`) relative to the best taste score in the
   * result, then floored by `hadTasteSignal` (no signal → every band "Good match").
   * A banded label — never a fabricated precise %. Only covers the shown products.
   */
  bandBySku: Record<string, MatchBandLabel>;
}

export function scoreProducts(a: Answers, products: PublicProduct[]): ScoreResult {
  const pool = finderPrefilter(products, a);

  const scored = pool.map((p) => {
    let s = 0;
    if (a.axis1 && BODY_TOKEN[a.axis1] && p.body) {
      s += ladderScore(bodyLadderDistance(BODY_TOKEN[a.axis1], p.body), 4);
    }
    // TASTE-FEEL (Layer-1 plain-language flow, red & white) — body primary + tannin/acidity
    // nudge vs the resolved archetype. Taste-tier term (counts toward `s` / the quality gate)
    // exactly like the old axis1 body term it replaces for those categories.
    s += tasteFeelScore(a, p);
    // SAKE sweetness — the category's primary taste term (axis1), scored on the same
    // ladder shape as wine body so it clears QUALITY_MIN for genuine matches. No-signal
    // sake (no taste_profile.axes.sweetness, ~74%) returns null → 0 (neutral, not
    // penalized). 'any' has no SWEETNESS_TARGET entry → no constraint.
    if (a.category === 'sake' && a.axis1 && SWEETNESS_TARGET[a.axis1]) {
      const have = sakeSweetness(p);
      if (have) {
        s += ladderScore(sweetnessLadderDistance(SWEETNESS_TARGET[a.axis1], have), 4);
      }
    }
    if (a.flavorChips?.length) {
      // Set-intersection against flavor_tags_canonical (Title-Case notes). Reading the
      // canonical field + matching via FLAVOR_FAMILY fixes the historical bug where the
      // old code did `tags.includes(norm(chip))` — hyphenated chips (red-fruit, dark-fruit)
      // never equalled spaced tags (red fruit), so those chips scored 0 in production.
      const notes = new Set((p.flavor_tags_canonical ?? []).map(norm));
      for (const chip of a.flavorChips) {
        const fam = FLAVOR_FAMILY[chip];
        // norm() both sides so the match is case/whitespace-insensitive — a future
        // Title-Case note in FLAVOR_FAMILY still matches (invariant self-enforcing).
        if (fam && fam.some((n) => notes.has(norm(n)))) s += 2;
      }
    }
    // WINE character (axis2) — now a real taste-tier term (W3). Only for wine categories
    // (whisky/spirits/sake use axis2 differently or not at all). 'balanced' → no constraint.
    if ((a.category === 'red' || a.category === 'white' || a.category === 'sparkling') && a.axis2) {
      s += wineCharacterScore(a.axis2, p.flavor_tags_canonical);
    }
    // TIER-2 origin/type for non-wine categories (whisky origin→country, spirits
    // type→category_type). Replaces the old axis2-vs-country line, which was inert for
    // whisky/spirits/sake (axis2 there was never a country).
    s += tier2Score(a, p);
    if ((a.occasion === 'gift' || a.occasion === 'special') &&
        typeof p.score_summary === 'string' && p.score_summary.trim() !== '') s += 2;
    // spec §5 Tier-3: everyday occasion + a low budget tier (0–1) gets a small value lean.
    if (a.occasion === 'everyday' && a.budget != null && a.budget <= 1) s += 1;
    s += foodChipMatches(p, a.food);
    // `s` is the v1 TASTE-TIER score — the SOLE basis for the honest-label `degraded`
    // flag (unchanged from v1). The deep-dive bump is kept SEPARATE so it can only
    // re-order results, never clear the quality gate.
    const tasteScore = s;
    const rankScore = tasteScore + deepDiveBump(a, p);
    return { p, s: tasteScore, rankScore };
  });

  scored.sort((x, y) =>
    y.rankScore - x.rankScore ||
    Number(!!y.p.score_summary) - Number(!!x.p.score_summary) ||
    // bestseller bucket breaks ties before price — meaningful for whisky/spirits/sake
    // where score_summary is always absent (so the key above is inert there). Wine still
    // sorts by critic-score presence first; popularity only decides genuine ties (C2).
    (y.p.popularity_tier ?? 0) - (x.p.popularity_tier ?? 0) ||
    (x.p.price ?? 0) - (y.p.price ?? 0),
  );

  // dedupe by sku (pool is already in-stock + category + budget).
  const seen = new Set<string>();
  const ranked: Array<{ p: PublicProduct; s: number; rankScore: number }> = [];
  for (const row of scored) {
    if (seen.has(row.p.sku)) continue;
    seen.add(row.p.sku); ranked.push(row);
  }

  // SPEC §5 quality-gate + relax. If fewer than MIN_RESULTS cleared QUALITY_MIN, flag
  // degraded so the UI shows the honest "Closest matches in your budget" label. The pool
  // is already in-budget/in-stock/in-category, so we still show the top-ranked products.
  const wellMatched = ranked.filter((r) => r.s >= QUALITY_MIN).length;
  // SPEC §5 honest-label flag. "degraded" = we have products to show, but NOT ONE of
  // them actually clears the quality bar for what the user asked — so the UI says
  // "Closest matches in your budget" instead of "Your matches". This is honest for
  // thin pools in BOTH directions and independent of pool size:
  //   • 2-bottle pool, one genuinely matches (e.g. the Scotch the user wanted) → not degraded
  //   • 2-bottle pool, none match (user wants Scotch, only Bourbon in budget) → degraded
  //   • large pool, nothing clears (all far-body) → degraded
  //   • empty pool → not degraded (never label "closest matches" over nothing)
  // (MIN_RESULTS/TOP_N govern how many we SHOW, not whether the label is honest.)
  //
  // W3 gin-label fix: GIN has NO taste-tier scoring term — its only taste question
  // (classic/contemporary) is a rank-only keyword lean (ginStyleBump), deliberately
  // not in `s` (the keyword signal is too noisy to gate quality on). So `wellMatched`
  // is ALWAYS 0 for gin and every gin search was wrongly flagged "Closest matches".
  // That is dishonest in the OTHER direction: the pool genuinely matches (in-stock,
  // in-budget gin is exactly what the user asked for). A category with no gate-able
  // taste term cannot be "degraded" — there is no bar to fall short of.
  const hasGateableTasteTerm = a.category !== 'gin';
  const degraded = hasGateableTasteTerm && ranked.length > 0 && wellMatched === 0;

  const shown = ranked.slice(0, TOP_N);

  // Per-bottle honest match band (spec §11.9). Reference = the best taste-tier score
  // among the SHOWN bottles (the strongest match we actually found). Each bottle's `s`
  // is banded against that reference, so the best reads "Great/Strong" and weaker ones
  // step down — no fabricated %. hadTasteSignal floors every band to "Good match" on the
  // all-neutral path. maxScore 0 (e.g. gin: no gate-able taste term) → ratio 0 → "Good".
  const signal = hadTasteSignal(a);
  const topTasteScore = shown.reduce((m, r) => Math.max(m, r.s), 0);
  const bandBySku: Record<string, MatchBandLabel> = {};
  for (const r of shown) {
    bandBySku[r.p.sku] = matchBand({
      score: r.s,
      maxScore: topTasteScore,
      hadTasteSignal: signal,
    });
  }

  return { products: shown.map((r) => r.p), degraded, bandBySku };
}
