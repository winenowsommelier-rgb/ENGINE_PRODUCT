// lib/validation/taxonomy-research.ts
//
// For unknown taxonomy values surfaced by the upload validator, this:
//   1. researches the value online (via Claude) to gather evidence + the
//      correct canonical spelling and parent, and a recommendation on whether
//      it belongs in our library, and
//   2. files the result as a PROPOSAL (never a direct canonical write) into the
//      local review queue at data/db/taxonomy-proposals.json.
//
// Both steps degrade gracefully: with no ANTHROPIC_API_KEY, the proposal is
// still filed but flagged `needs_research` for a human to investigate.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { TaxonomyProposal } from './types';

const PROPOSALS_PATH = join(process.cwd(), 'data', 'db', 'taxonomy-proposals.json');

export type ResearchVerdict = {
  exists: boolean | null;        // is this a real wine geography/brand?
  canonical: string;             // corrected canonical spelling
  parent: string;                // correct parent (e.g. country for a region)
  recommend_add: boolean | null; // should it enter our library?
  confidence: number;            // 0..1
  evidence: string;              // short justification
  status: 'researched' | 'needs_research';
};

export async function researchTaxonomy(
  type: TaxonomyProposal['type'],
  value: string,
  parentPath: string,
): Promise<ResearchVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      exists: null, canonical: value, parent: parentPath, recommend_add: null,
      confidence: 0, evidence: 'No ANTHROPIC_API_KEY configured — manual research required.',
      status: 'needs_research',
    };
  }

  const client = new Anthropic();
  const prompt = `You are a wine & spirits geography/brand taxonomy expert.

Assess this proposed ${type.replace('_', '-')}: "${value}"${parentPath ? ` (claimed parent: "${parentPath}")` : ''}.

Decide, using established wine knowledge:
- is it a real, recognized ${type.replace('_', '-')}?
- what is its correct canonical spelling (with proper accents)?
- what is its correct parent (the country for a region; the region for a sub-region; empty for a country/brand)?
- should it be added to a canonical wine taxonomy library (true only if it is a genuine, distinct, recognized entity)?

Return ONLY valid JSON, no prose:
{"exists":true,"canonical":"string","parent":"string","recommend_add":true,"confidence":0.0,"evidence":"one sentence"}`;

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const clean = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    const j = JSON.parse(clean);
    return {
      exists: Boolean(j.exists),
      canonical: String(j.canonical || value),
      parent: String(j.parent || parentPath),
      recommend_add: Boolean(j.recommend_add),
      confidence: Number(j.confidence) || 0,
      evidence: String(j.evidence || ''),
      status: 'researched',
    };
  } catch (err) {
    return {
      exists: null, canonical: value, parent: parentPath, recommend_add: null,
      confidence: 0,
      evidence: `Research failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      status: 'needs_research',
    };
  }
}

// ── Local proposal queue (review-before-commit; mirrors taxonomy_proposals) ───
export type StoredProposal = TaxonomyProposal & {
  id: string;
  status: 'pending' | 'needs_research' | 'approved' | 'rejected';
  canonical?: string;
  recommend_add?: boolean | null;
  confidence?: number;
  evidence?: string;
  occurrences: number;
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
 * Research each unique proposal and upsert it into the local review queue.
 * De-duplicates against existing entries; bumps `occurrences` on repeats.
 * Returns the proposals as stored (with verdicts attached).
 */
export async function fileProposals(
  proposals: TaxonomyProposal[],
  opts: { research?: boolean; maxResearch?: number } = {},
): Promise<StoredProposal[]> {
  const { research = true, maxResearch = 25 } = opts;
  const existing = loadProposals();
  const byKey = new Map(existing.map((p) => [key(p), p]));

  // unique incoming
  const uniques = new Map<string, TaxonomyProposal>();
  for (const p of proposals) if (p.proposed_value) uniques.set(key(p), p);

  const filed: StoredProposal[] = [];
  let researched = 0;
  for (const [k, p] of uniques) {
    const prior = byKey.get(k);
    if (prior) {
      prior.occurrences += 1;
      filed.push(prior);
      continue;
    }
    let verdict: ResearchVerdict | null = null;
    if (research && researched < maxResearch) {
      verdict = await researchTaxonomy(p.type, p.proposed_value, p.parent_path);
      researched++;
    }
    const stored: StoredProposal = {
      ...p,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      status: verdict?.status === 'researched' ? 'pending' : 'needs_research',
      canonical: verdict?.canonical,
      recommend_add: verdict?.recommend_add ?? null,
      confidence: verdict?.confidence ?? 0,
      evidence: verdict?.evidence ?? '',
      occurrences: 1,
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

export function getProposals(status?: StoredProposal['status']): StoredProposal[] {
  const all = loadProposals();
  return status ? all.filter((p) => p.status === status) : all;
}
