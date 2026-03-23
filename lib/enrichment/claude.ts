import Anthropic from '@anthropic-ai/sdk';
import type { EnrichmentResult } from './rules';

const BATCH_SIZE = 20;
const MAX_TOKENS_PER_RUN = 500_000;

export type ClaudeEnrichmentProgress = {
  tokensUsed: number;
  budgetExceeded: boolean;
};

type ProductInput = {
  sku: string;
  name: string;
  wine_type?: string;
  liquor_main_type?: string;
  current_country?: string;
  current_region?: string;
};

type ClaudeProductResult = {
  sku: string;
  country: string;
  region: string;
  subregion: string;
  classification: string;
  grape_variety: string;
  confidence: number;
  source_note: string;
};

async function enrichBatch(
  products: ProductInput[],
  progress: ClaudeEnrichmentProgress
): Promise<Map<string, EnrichmentResult>> {
  const results = new Map<string, EnrichmentResult>();
  if (progress.budgetExceeded) return results;

  const client = new Anthropic();

  const prompt = `You are a wine and spirits product data expert.

For each product below, fill in missing taxonomy fields using your knowledge.
Return ONLY a valid JSON array — no prose, no markdown, no code fences.

Products:
${JSON.stringify(products)}

For each product return exactly:
{"sku":"string","country":"string or empty","region":"string or empty","subregion":"string or empty","classification":"string or empty","grape_variety":"string or empty","confidence":0.0,"source_note":"brief explanation"}`;

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      progress.tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
      if (progress.tokensUsed > MAX_TOKENS_PER_RUN) progress.budgetExceeded = true;

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const clean = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
      const parsed: ClaudeProductResult[] = JSON.parse(clean);

      for (const item of parsed) {
        results.set(item.sku, {
          country: item.country || undefined,
          region: item.region || undefined,
          subregion: item.subregion || undefined,
          classification: item.classification || undefined,
          grape_variety: item.grape_variety || undefined,
          confidence: item.confidence,
          source: 'claude',
          note: item.source_note,
        });
      }
      return results;
    } catch (err) {
      attempt++;
      if (attempt >= 3) {
        console.error(`Claude batch failed after 3 attempts:`, err);
        return results;
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return results;
}

export async function enrichBatchWithClaude(
  products: Array<Record<string, any>>,
  progress: ClaudeEnrichmentProgress,
  onBatchDone?: (done: number, total: number) => void
): Promise<Map<string, EnrichmentResult>> {
  const allResults = new Map<string, EnrichmentResult>();
  const inputs: ProductInput[] = products.map(p => ({
    sku: String(p.sku ?? ''),
    name: String(p.name ?? ''),
    wine_type: String(p.wine_type ?? ''),
    liquor_main_type: String(p.liquor_main_type ?? ''),
    current_country: String(p.country ?? ''),
    current_region: String(p.region ?? ''),
  }));

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    if (progress.budgetExceeded) break;
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const batchResults = await enrichBatch(batch, progress);
    batchResults.forEach((v, k) => allResults.set(k, v));
    onBatchDone?.(Math.min(i + BATCH_SIZE, inputs.length), inputs.length);
  }

  return allResults;
}

export async function enrichSingleWithClaude(
  product: Record<string, any>
): Promise<EnrichmentResult | { error: string; raw_response?: string }> {
  const progress: ClaudeEnrichmentProgress = { tokensUsed: 0, budgetExceeded: false };
  const input: ProductInput = {
    sku: String(product.sku ?? ''),
    name: String(product.name ?? ''),
    wine_type: String(product.wine_type ?? ''),
    liquor_main_type: String(product.liquor_main_type ?? ''),
    current_country: String(product.country ?? ''),
    current_region: String(product.region ?? ''),
  };

  try {
    const results = await enrichBatch([input], progress);
    const result = results.get(input.sku);
    if (!result) return { error: 'Claude returned no result for this product' };
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Claude API error' };
  }
}
