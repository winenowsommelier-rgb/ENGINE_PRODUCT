import type { PublicProduct } from '@/lib/types';
import type { Answers } from './answers';
import { finderPrefilter } from './category-map';
import { foodChipMatches } from './food-chips';

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

function ladderScore(distance: number | null, exact: number): number {
  // A KNOWN body value on the ladder is always a real (in-category) match, so every
  // on-ladder distance clears QUALITY_MIN — closer is just ranked higher. Off-ladder /
  // missing body returns null above and scores 0 (the genuine "no signal" case).
  if (distance === null) return 0;
  if (distance === 0) return exact;       // exact     → 4
  if (distance === 1) return exact - 1;   // adjacent  → 3
  return Math.max(exact - 2, QUALITY_MIN); // 2+ steps → 2 (still well-matched, ranked last)
}

const MIN_RESULTS = 4;
const TOP_N = 8;
const QUALITY_MIN = 2;

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
    if (a.flavorChips?.length) {
      const tags = (p.flavor_tags ?? []).map(norm);
      for (const chip of a.flavorChips) if (tags.includes(norm(chip))) s += 2;
    }
    if (a.axis2 && p.country && norm(p.country).includes(norm(a.axis2))) s += 2;
    if ((a.occasion === 'gift' || a.occasion === 'special') &&
        typeof p.score_summary === 'string' && p.score_summary.trim() !== '') s += 2;
    s += foodChipMatches(p, a.food);
    return { p, s };
  });

  scored.sort((x, y) =>
    y.s - x.s ||
    Number(!!y.p.score_summary) - Number(!!x.p.score_summary) ||
    (x.p.price ?? 0) - (y.p.price ?? 0),
  );

  // dedupe by sku (pool is already in-stock + category + budget).
  const seen = new Set<string>();
  const ranked: Array<{ p: PublicProduct; s: number }> = [];
  for (const row of scored) {
    if (seen.has(row.p.sku)) continue;
    seen.add(row.p.sku); ranked.push(row);
  }

  // SPEC §5 quality-gate + relax. If fewer than MIN_RESULTS cleared QUALITY_MIN, flag
  // degraded so the UI shows the honest "Closest matches in your budget" label. The pool
  // is already in-budget/in-stock/in-category, so we still show the top-ranked products.
  const wellMatched = ranked.filter((r) => r.s >= QUALITY_MIN).length;
  const degraded = wellMatched < MIN_RESULTS;

  return { products: ranked.slice(0, TOP_N).map((r) => r.p), degraded };
}
