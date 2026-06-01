// lib/validation/taxonomy-research.ts
//
// For the PROBLEM items surfaced by the upload validator (unknown taxonomy
// values), this cross-checks each value against our own large database and
// canonical lists — no external API. It gathers evidence to help a reviewer:
//   - how many existing products already use this value (occurrences), and
//   - the closest canonical name we already have ("did you mean…?").
//
// Nothing is added or decided automatically. Every proposal is filed to the
// local review queue (data/db/taxonomy-proposals.json) with status `pending`
// for the review process to handle further.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { TaxonomyProposal } from './types';
import { countryByName, regionByName, subregionById } from '../taxonomy/service';
import { dbOccurrences, fold } from './upload-pipeline';

const PROPOSALS_PATH = join(process.cwd(), 'data', 'db', 'taxonomy-proposals.json');

// Canonical names we already hold, per level — used for "did you mean" suggestions.
const CANON: Partial<Record<TaxonomyProposal['type'], string[]>> = {
  country: Array.from(new Set(Array.from(countryByName.values()).map((c) => c.name))),
  region: Array.from(new Set(Array.from(regionByName.values()).map((r) => r.name))),
  sub_region: Array.from(new Set(Array.from(subregionById.values()).map((s) => s.name))),
};

const DB_FIELD: Partial<Record<TaxonomyProposal['type'], 'country' | 'region' | 'subregion'>> = {
  country: 'country',
  region: 'region',
  sub_region: 'subregion',
};

// Normalized Levenshtein similarity (0..1) — catches typos/accents a token
// overlap would miss (e.g. "Curico Valley" ≈ "Curicó Valley").
function editSim(a: string, b: string): number {
  const s = fold(a);
  const t = fold(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return 1 - dp[m] / Math.max(m, n);
}

function closestCanonical(type: TaxonomyProposal['type'], value: string): { name: string; score: number } | null {
  const list = CANON[type];
  if (!list?.length) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of list) {
    const score = editSim(value, name);
    if (!best || score > best.score) best = { name, score };
  }
  return best && best.score >= 0.7 ? best : null;
}

export type DbAssessment = {
  occurrences: number;          // products in our DB already using this exact value
  suggestion: string;           // closest canonical name we already hold (or '')
  suggestion_score: number;     // 0..1 similarity to that suggestion
  evidence: string;             // human-readable summary for the reviewer
};

export function assessAgainstDatabase(
  type: TaxonomyProposal['type'],
  value: string,
): DbAssessment {
  const field = DB_FIELD[type];
  const occurrences = field ? dbOccurrences(field, value) : 0;
  const close = closestCanonical(type, value);

  const bits: string[] = [];
  if (occurrences > 0) bits.push(`seen ${occurrences}× in product DB`);
  else bits.push('not seen in product DB');
  if (close) bits.push(`closest canonical: "${close.name}" (${close.score.toFixed(2)})`);

  return {
    occurrences,
    suggestion: close?.name ?? '',
    suggestion_score: close?.score ?? 0,
    evidence: bits.join('; '),
  };
}

// ── Local proposal queue (review-before-commit; mirrors taxonomy_proposals) ───
export type StoredProposal = TaxonomyProposal & {
  id: string;
  status: 'pending';            // always pending — the review process decides
  occurrences: number;
  suggestion: string;
  suggestion_score: number;
  evidence: string;
  count: number;                // how many uploaded rows hit this proposal
  created_at: string;
};

function loadProposals(): StoredProposal[] {
  if (!existsSync(PROPOSALS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(PROPOSALS_PATH, 'utf-8')) as StoredProposal[];
  } catch {
    return [];
  }
}

function key(p: { type: string; proposed_value: string; parent_path: string }) {
  return `${p.type}::${p.proposed_value.toLowerCase()}::${p.parent_path.toLowerCase()}`;
}

/**
 * Cross-check each unique problem value against our database and upsert it into
 * the local review queue. De-duplicates against existing entries (bumping
 * `count`). Adds nothing to the canonical taxonomy — review handles that.
 */
export function fileProposals(proposals: TaxonomyProposal[]): StoredProposal[] {
  const existing = loadProposals();
  const byKey = new Map(existing.map((p) => [key(p), p]));

  const uniques = new Map<string, TaxonomyProposal>();
  for (const p of proposals) if (p.proposed_value) uniques.set(key(p), p);

  const filed: StoredProposal[] = [];
  for (const [k, p] of uniques) {
    const prior = byKey.get(k);
    if (prior) {
      prior.count += 1;
      filed.push(prior);
      continue;
    }
    const assessment = assessAgainstDatabase(p.type, p.proposed_value);
    const stored: StoredProposal = {
      ...p,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      occurrences: assessment.occurrences,
      suggestion: assessment.suggestion,
      suggestion_score: assessment.suggestion_score,
      evidence: assessment.evidence,
      count: 1,
      created_at: new Date().toISOString(),
    };
    byKey.set(k, stored);
    filed.push(stored);
  }

  const all = Array.from(byKey.values());
  mkdirSync(dirname(PROPOSALS_PATH), { recursive: true });
  writeFileSync(PROPOSALS_PATH, JSON.stringify(all, null, 2), 'utf-8');
  return filed;
}

export function getProposals(): StoredProposal[] {
  return loadProposals();
}
