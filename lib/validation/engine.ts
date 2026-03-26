// lib/validation/engine.ts
// Composes the five stages; applies null-only protection; collects proposals.

import { getRules } from './rules';
import { stage1Sku, stage2Name, stage3Description, stage4Geography, stage5Score } from './stages';
import type { Product, EnrichmentPatch, TaxonomyProposal } from './types';

export interface PipelineResult {
  patch:     EnrichmentPatch;
  proposals: TaxonomyProposal[];
}

export function runPipeline(product: Product): PipelineResult {
  const rules = getRules();
  const allProposals: TaxonomyProposal[] = [];

  // Accumulate patch across stages
  let accumulated: EnrichmentPatch = {};

  const s1 = stage1Sku(product, rules);
  accumulated = { ...accumulated, ...s1.patch };

  const s2 = stage2Name(product, rules, accumulated);
  accumulated = { ...accumulated, ...s2.patch };

  const s3 = stage3Description(product, rules);
  accumulated = { ...accumulated, ...s3.patch };
  allProposals.push(...s3.proposals);

  const s4 = stage4Geography(product, rules, accumulated);
  accumulated = { ...accumulated, ...s4.patch };
  allProposals.push(...s4.proposals);

  const s5 = stage5Score(product, accumulated, allProposals);
  accumulated = { ...accumulated, ...s5.patch };

  // Null-only protection: remove keys where product already has a non-null value
  // `segment` is internal to the pipeline (used for scoring) — not a DB column
  const neverWrite = ['segment'];
  const safePatch: EnrichmentPatch = {};
  for (const [key, value] of Object.entries(accumulated)) {
    if (neverWrite.includes(key)) continue;
    const existing = product[key];
    // Always write confidence + status + enrichment_note (these are always updated)
    const alwaysWrite = ['overall_confidence', 'taxonomy_confidence', 'validation_status', 'enrichment_note'];
    if (alwaysWrite.includes(key) || existing === null || existing === undefined || existing === '') {
      (safePatch as any)[key] = value;
    }
  }

  return { patch: safePatch, proposals: allProposals };
}
