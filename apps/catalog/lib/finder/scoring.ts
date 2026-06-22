import type { PublicProduct } from '@/lib/types';
import type { Answers } from './answers';
import { finderPrefilter } from './category-map';
import { foodChipMatches } from './food-chips';
import { primaryValue, bucketForValue } from './scales';
import { normalizeScale } from '@/lib/taste-adapter';

const BODY_LADDER = ['light','medium-light','medium','medium-full','full'];
const norm = (s?: string) => (s ?? '').trim().toLowerCase();

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

const firstSeg = (s?: string) => norm(s).split('|')[0].trim();

// ── TIER-2 origin/style signal maps (spec §5). Kept as data, not buried magic
// strings (Rule 3). Each token comes from question-config.ts for that category. ──

// WHISKY axis1 (origin) → expected p.country. 'world' has no reliable single
// country, so no boost.
const WHISKY_ORIGIN_TO_COUNTRY: Record<string, string> = {
  scotch: 'scotland', japanese: 'japan', bourbon: 'usa', irish: 'ireland',
};

// WHISKY axis2 (style) → set of regions that signal that style.
// smoky → Islay (peated); smooth → Speyside/Highland. No region data → no boost.
const WHISKY_STYLE_TO_REGIONS: Record<string, string[]> = {
  smoky: ['islay'], smooth: ['speyside', 'highland'],
};

// SPIRITS (other) axis1 (type) → accepted classification first-segments.
// 'other' is a catch-all with no single classification, so no boost.
const SPIRITS_TYPE_TO_CLASS: Record<string, string[]> = {
  vodka: ['vodka'], rum: ['rum'], tequila: ['tequila', 'mezcal'],
  brandy: ['brandy', 'cognac'],
};

/**
 * Category-aware TIER-2 scorer for the axis answers (spec §5). Returns the points
 * a single product earns from the (axis1, axis2) origin/style answers. Wine body
 * (axis1) is scored separately via the BODY_TOKEN ladder in scoreProducts and is
 * NOT handled here.
 *
 * Profile-only axes (intentionally NOT scored — no reliable structured signal):
 *  - GIN axis1 (classic/contemporary): no field distinguishes these; profile-only.
 *  - WINE axis2 (fruity/earthy/balanced): by design profile-only; it shapes the
 *    archetype copy but does not rank products.
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
      const wantCountry = a.axis1 ? WHISKY_ORIGIN_TO_COUNTRY[a.axis1] : undefined;
      if (wantCountry && p.country && norm(p.country) === wantCountry) s += 2;
      const wantRegions = a.axis2 ? WHISKY_STYLE_TO_REGIONS[a.axis2] : undefined;
      if (wantRegions && p.region && wantRegions.includes(norm(p.region))) s += 2;
      break;
    }
    case 'spirits': {
      const wantClasses = a.axis1 ? SPIRITS_TYPE_TO_CLASS[a.axis1] : undefined;
      if (wantClasses && p.classification && wantClasses.includes(firstSeg(p.classification))) s += 2;
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

// Grape family → tokens that, if present in p.grape_variety, signal that family.
// 'surprise' (and any unmapped token) intentionally has no entry → never constrains.
const GRAPE_FAMILY: Record<string, string[]> = {
  cabernet:      ['cabernet'],
  'pinot-noir':  ['pinot noir'],
  'syrah-shiraz':['syrah', 'shiraz'],
  sangiovese:    ['sangiovese'],
  tempranillo:   ['tempranillo', 'rioja'],
  merlot:        ['merlot'],
  grenache:      ['grenache', 'garnacha'],
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

// Whisky peat. The peat answer (none | light | heavy) has structured backing via
// region: peated single malts come from Islay, so region=Islay is the peat signal.
//   heavy → +2 for an Islay bottle (the user wants smoke; Islay delivers it)
//   none  → +2 for a NON-Islay bottle (the user wants it clean; reward away-from-Islay)
//   light / absent / unknown → 0 (no confident signal either way)
// Like every deep-dive term this is ADDITIVE (rank-only) and never touches `degraded`.
function peatScore(token: string | undefined, region: string | undefined): number {
  if (token !== 'none' && token !== 'heavy') return 0; // 'light' / any → no rule
  const isIslay = norm(region) === 'islay';
  if (token === 'heavy') return isIslay ? 2 : 0;
  return isIslay ? 0 : 2; // none: reward non-Islay
}

/** Sum of all deep-dive terms for one product (each 0 when its answer is absent). */
function deepDiveBump(a: Answers, p: PublicProduct): number {
  return (
    intensityScore('acidity', a.acidity, p.wine_acidity) +
    intensityScore('tannin', a.tannin, p.wine_tannin) +
    grapeScore(a.grape, p.grape_variety) +
    ageScore(a.age, p.vintage) +
    adventureScore(a.adventure, p.region) +
    peatScore(a.peat, p.region)
  );
}

export interface ScoreResult {
  products: PublicProduct[];  // top N, ranked
  /** true when fewer than MIN_RESULTS cleared QUALITY_MIN → UI shows the honest
   *  "Closest matches in your budget" label (spec §5 relax step). */
  degraded: boolean;
}

export function scoreProducts(a: Answers, products: PublicProduct[]): ScoreResult {
  const pool = finderPrefilter(products, a);

  const scored = pool.map((p) => {
    let s = 0;
    if (a.axis1 && BODY_TOKEN[a.axis1] && p.wine_body) {
      s += ladderScore(bodyLadderDistance(BODY_TOKEN[a.axis1], p.wine_body), 4);
    }
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
    // TIER-2 origin/style for non-wine categories (whisky origin→country & style→region,
    // spirits type→classification). Replaces the old axis2-vs-country line, which was
    // inert for whisky/spirits/sake (axis2 there is smoky/smooth, never a country).
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
  const degraded = ranked.length > 0 && wellMatched === 0;

  return { products: ranked.slice(0, TOP_N).map((r) => r.p), degraded };
}
