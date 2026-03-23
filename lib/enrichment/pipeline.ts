import { enrichWithRules } from './rules';
// Claude batch enrichment disabled in dev to avoid API costs.
// Re-enable by uncommenting the import and the Pass 2 block below.
// import { enrichBatchWithClaude, type ClaudeEnrichmentProgress } from './claude';
import {
  readProducts,
  batchUpdateEnrichment,
  getPipelineStatus,
  savePipelineStatus,
  type EnrichmentUpdate,
} from '@/lib/db/client';

export const AUTO_VALIDATE_THRESHOLD = 0.75;
export const NEEDS_ATTENTION_THRESHOLD = 0.40;

export type PipelineSummary = {
  enriched: number;
  autoValidated: number;
  sentToQueue: number;
  needsAttention: number;
  tokensUsed: number;
  errors: number;
};

export type PipelineOptions = {
  productIds?: string[];
  forceReEnrich?: boolean;
};

export async function runEnrichmentPipeline(options: PipelineOptions = {}): Promise<PipelineSummary> {
  const { productIds, forceReEnrich = false } = options;

  await savePipelineStatus({
    status: 'running',
    current_step: 'loading',
    progress: { done: 0, total: 0 },
    tokens_used: 0,
  });

  try {
    const pipelineStatus = await getPipelineStatus();
    const includeBlocked = !pipelineStatus.migration_done;

    // Load products to process
    let allProducts = await readProducts();

    let targets = productIds
      ? allProducts.filter(p => productIds.includes(String(p.id)))
      : allProducts.filter(p => {
          const vs = p.validation_status;
          if (includeBlocked && vs === 'blocked') return true;
          return vs === 'needs_review' || vs === 'needs_attention' || !vs;
        });

    // Skip already Claude-enriched unless forceReEnrich
    if (!forceReEnrich) {
      targets = targets.filter(p => !p.claude_enriched_at);
    }

    await savePipelineStatus({
      current_step: 'rule_enrichment',
      progress: { done: 0, total: targets.length },
    });

    // Pass 1: Rule enrichment (in memory, batch write at end)
    const ruleUpdates: EnrichmentUpdate[] = [];
    const needsClaudeIds = new Set<string>();

    for (const p of targets) {
      const existingConf = parseFloat(String(p.overall_confidence ?? 0));

      // Already high confidence — just route it
      if (existingConf >= AUTO_VALIDATE_THRESHOLD && p.country && !forceReEnrich) {
        ruleUpdates.push({
          id: String(p.id),
          validation_status: 'validated',
          enrichment_source: p.enrichment_source ?? 'rules',
        });
        continue;
      }

      const result = enrichWithRules(p);
      const maxConf = Math.max(result.confidence, existingConf);

      const update: EnrichmentUpdate = {
        id: String(p.id),
        enrichment_source: result.confidence > existingConf ? result.source : (p.enrichment_source ?? 'rules'),
        enrichment_note: result.note,
        overall_confidence: maxConf,
        taxonomy_confidence: maxConf,
      };

      if (result.country && (!p.country || p.country === '')) update.country = result.country;
      if (result.classification && !p.classification) update.classification = result.classification;

      if (maxConf >= AUTO_VALIDATE_THRESHOLD) {
        update.validation_status = 'validated';
      } else {
        update.validation_status = 'needs_review'; // will be refined by Claude
        needsClaudeIds.add(String(p.id));
      }

      ruleUpdates.push(update);
    }

    // Batch write rule results (one write)
    if (ruleUpdates.length > 0) await batchUpdateEnrichment(ruleUpdates);

    // Pass 2: Route unresolved products by confidence (Claude batch disabled — use Ask Claude in queue instead)
    const now = new Date().toISOString();
    const claudeUpdates: EnrichmentUpdate[] = [];

    for (const p of targets.filter(p => needsClaudeIds.has(String(p.id)))) {
      const conf = parseFloat(String(p.overall_confidence ?? 0));
      claudeUpdates.push({
        id: String(p.id),
        validation_status: conf >= NEEDS_ATTENTION_THRESHOLD ? 'needs_review' : 'needs_attention',
      });
    }

    if (claudeUpdates.length > 0) await batchUpdateEnrichment(claudeUpdates);

    // Build summary
    const finalProducts = await readProducts();
    const summary: PipelineSummary = {
      enriched: ruleUpdates.length + claudeUpdates.length,
      autoValidated: finalProducts.filter(p => p.validation_status === 'validated').length,
      sentToQueue: finalProducts.filter(p => p.validation_status === 'needs_review').length,
      needsAttention: finalProducts.filter(p => p.validation_status === 'needs_attention').length,
      tokensUsed: 0,
      errors: 0,
    };

    await savePipelineStatus({
      status: 'idle',
      migration_done: true,
      current_step: null,
      progress: { done: targets.length, total: targets.length },
      tokens_used: 0,
      last_run: now,
      last_summary: summary,
    });

    return summary;
  } catch (err) {
    await savePipelineStatus({ status: 'error', current_step: null });
    throw err;
  }
}
