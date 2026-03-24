import { NextResponse } from 'next/server';
import {
  getPipelineStatus,
  savePipelineStatus,
  readProducts,
  batchUpdateEnrichment,
  type EnrichmentUpdate,
} from '@/lib/db/client';

export const runtime = 'nodejs';

const CHUNK_SIZE = 20; // Claude batch size
const AUTO_VALIDATE_THRESHOLD = 0.75;
const NEEDS_ATTENTION_THRESHOLD = 0.40;

async function runClaudePass() {
  await savePipelineStatus({
    status: 'running',
    current_step: 'Claude enrichment: loading queue…',
    progress: { done: 0, total: 0 },
  });

  try {
    const allProducts = await readProducts();
    const targets = allProducts.filter(p => p.validation_status === 'needs_review');
    const total = targets.length;

    await savePipelineStatus({
      current_step: `Claude enrichment (0 / ${total})`,
      progress: { done: 0, total },
    });

    const { enrichBatchWithClaude } = await import('@/lib/enrichment/claude');
    const progress = { tokensUsed: 0, budgetExceeded: false };

    let done = 0;

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      if (progress.budgetExceeded) break;

      const chunk = targets.slice(i, i + CHUNK_SIZE);
      const resultsMap = await enrichBatchWithClaude(chunk, progress);
      const updates: EnrichmentUpdate[] = [];

      for (const p of chunk) {
        const result = resultsMap.get(String(p.sku));
        if (!result) continue;

        const existingConf = parseFloat(String(p.overall_confidence ?? 0));
        const maxConf = Math.max(result.confidence, existingConf);

        const update: EnrichmentUpdate = {
          id: String(p.id),
          enrichment_source: 'claude',
          enrichment_note: result.note,
          overall_confidence: maxConf,
          taxonomy_confidence: maxConf,
        };

        if (result.country) update.country = result.country;
        if (result.region) update.region = result.region;
        if (result.subregion) update.subregion = result.subregion;
        if (result.classification) update.classification = result.classification;
        if (result.grape_variety) update.grape_variety = result.grape_variety;

        if (maxConf >= AUTO_VALIDATE_THRESHOLD) {
          update.validation_status = 'validated';
        } else if (maxConf >= NEEDS_ATTENTION_THRESHOLD) {
          update.validation_status = 'needs_review';
        } else {
          update.validation_status = 'needs_attention';
        }

        updates.push(update);
      }

      if (updates.length > 0) await batchUpdateEnrichment(updates);

      done += chunk.length;
      await savePipelineStatus({
        progress: { done, total },
        current_step: `Claude enrichment (${done} / ${total})`,
        tokens_used: progress.tokensUsed,
      });
    }

    // Final summary
    const now = new Date().toISOString();
    const finalProducts = await readProducts();
    const summary = {
      enriched: done,
      autoValidated: finalProducts.filter(p => p.validation_status === 'validated').length,
      sentToQueue: finalProducts.filter(p => p.validation_status === 'needs_review').length,
      needsAttention: finalProducts.filter(p => p.validation_status === 'needs_attention').length,
      tokensUsed: progress.tokensUsed,
      errors: 0,
    };

    await savePipelineStatus({
      status: 'idle',
      migration_done: true,
      current_step: null,
      progress: { done: total, total },
      tokens_used: progress.tokensUsed,
      last_run: now,
      last_summary: summary,
    });
  } catch (err) {
    await savePipelineStatus({ status: 'error', current_step: String(err) });
    throw err;
  }
}

export async function POST() {
  try {
    const status = await getPipelineStatus();
    if (status.status === 'running') {
      return NextResponse.json({ error: 'Pipeline already running' }, { status: 409 });
    }

    // Fire and forget
    runClaudePass().catch(console.error);
    return NextResponse.json({ started: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    );
  }
}
