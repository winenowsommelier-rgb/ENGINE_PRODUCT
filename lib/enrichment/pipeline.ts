import { enrichWithRules } from './rules';
// Claude batch enrichment disabled — use "Ask Claude" button per product in the queue.
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
const CHUNK_SIZE = 200; // Save to disk after every N products — keeps work safe across restarts

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

    const allProducts = await readProducts();

    // Determine targets
    // Resumability: skip products already enriched (enrichment_source set) unless forceReEnrich
    let targets = productIds
      ? allProducts.filter(p => productIds.includes(String(p.id)))
      : allProducts.filter(p => {
          const vs = p.validation_status;
          if (includeBlocked && vs === 'blocked') return true;
          return vs === 'needs_review' || vs === 'needs_attention' || !vs;
        });

    if (!forceReEnrich) {
      // Skip products already rule-enriched — safe to resume from interruption
      targets = targets.filter(p => !p.enrichment_source || p.validation_status === 'blocked');
    }

    const total = targets.length;

    await savePipelineStatus({
      current_step: 'enriching',
      progress: { done: 0, total },
    });

    let done = 0;
    let totalEnriched = 0;

    // Process in chunks of CHUNK_SIZE — write after each chunk so restarts skip completed work
    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      const chunk = targets.slice(i, i + CHUNK_SIZE);
      const updates: EnrichmentUpdate[] = [];

      for (const p of chunk) {
        const existingConf = parseFloat(String(p.overall_confidence ?? 0));

        // Already confident enough — just validate
        if (existingConf >= AUTO_VALIDATE_THRESHOLD && p.country && !forceReEnrich) {
          updates.push({
            id: String(p.id),
            validation_status: 'validated',
            enrichment_source: p.enrichment_source ?? 'rules',
            enrichment_note: p.enrichment_note ?? 'Pre-existing high confidence',
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

        // Only overwrite empty fields
        if (result.country && (!p.country || p.country === '')) update.country = result.country;
        if (result.classification && !p.classification) update.classification = result.classification;

        // Route by confidence
        if (maxConf >= AUTO_VALIDATE_THRESHOLD) {
          update.validation_status = 'validated';
        } else if (maxConf >= NEEDS_ATTENTION_THRESHOLD) {
          update.validation_status = 'needs_review';
        } else {
          update.validation_status = 'needs_attention';
        }

        updates.push(update);
      }

      // Write chunk to disk immediately — safe point for restart
      if (updates.length > 0) await batchUpdateEnrichment(updates);
      totalEnriched += updates.length;
      done += chunk.length;

      // Update progress after each chunk
      await savePipelineStatus({
        progress: { done, total },
        current_step: `enriching (${done}/${total})`,
      });
    }

    // Final summary from live DB
    const now = new Date().toISOString();
    const finalProducts = await readProducts();
    const summary: PipelineSummary = {
      enriched: totalEnriched,
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
      progress: { done: total, total },
      tokens_used: 0,
      last_run: now,
      last_summary: summary,
    });

    return summary;
  } catch (err) {
    await savePipelineStatus({ status: 'error', current_step: String(err) });
    throw err;
  }
}
