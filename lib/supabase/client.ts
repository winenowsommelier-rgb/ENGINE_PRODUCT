import { supabaseProject } from '@/lib/supabase/config';
import { buildFlavorProfile } from '@/lib/auto-mapping';
import { validateRenderedProduct } from '@/lib/render-validation';

type BatchProcessingResult = {
  rows: Array<{
    original: Record<string, any>;
    normalized: Record<string, any>;
    corrections: Record<string, any>[];
    issues: Array<{ severity: 'error' | 'warning'; [key: string]: any }>;
    confidence: number;
  }>;
  summary: { totalRows: number; autoCorrected: number; blocked: number; readyToImport?: number };
};

export type SupabaseBrowserClientConfig = {
  url: string;
  publishableKey: string;
  headers: Record<string, string>;
};

export type PersistImportResult = {
  importRunId: string;
  stagedRows: number;
  blockedRows: number;
  savedProducts: number;
};

export type PersistImportPayload = {
  sourceFilename: string;
  batchResult: BatchProcessingResult;
};

export function createSupabaseBrowserClient(): SupabaseBrowserClientConfig {
  return {
    url: supabaseProject.url,
    publishableKey: supabaseProject.publishableKey,
    headers: {
      apikey: supabaseProject.publishableKey,
      Authorization: `Bearer ${supabaseProject.publishableKey}`,
      'x-application-name': 'winenow-flavor-intelligence-system'
    }
  };
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const client = createSupabaseBrowserClient();
  const response = await fetch(`${client.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...client.headers,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed with status ${response.status}.`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function persistImportToSupabase({ sourceFilename, batchResult }: PersistImportPayload): Promise<PersistImportResult> {
  const importRun = await supabaseFetch('import_runs', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      source_filename: sourceFilename,
      source_format: 'csv',
      status: batchResult.summary.blocked > 0 ? 'review_required' : 'ready',
      total_rows: batchResult.summary.totalRows,
      corrected_rows: batchResult.summary.autoCorrected,
      blocked_rows: batchResult.summary.blocked
    })
  });

  const importRunId = importRun?.[0]?.id;

  if (!importRunId) {
    throw new Error('Supabase did not return an import run id.');
  }

  await supabaseFetch('import_run_rows', {
    method: 'POST',
    body: JSON.stringify(
      batchResult.rows.map((row) => ({
        import_run_id: importRunId,
        sku: row.normalized.sku || null,
        raw_payload: row.original,
        normalized_payload: row.normalized,
        corrections: row.corrections,
        issues: row.issues,
        confidence_score: row.confidence,
        is_render_safe: validateRenderedProduct(row.normalized as any, buildFlavorProfile(row.normalized as any)).every((check) => check.status === 'pass')
      }))
    )
  });

  const readyRows = batchResult.rows.filter((row) => !row.issues.some((issue) => issue.severity === 'error'));

  if (readyRows.length === 0) {
    return {
      importRunId,
      stagedRows: batchResult.rows.length,
      blockedRows: batchResult.summary.blocked,
      savedProducts: 0
    };
  }

  const savedProducts = await supabaseFetch('products', {
    method: 'POST',
    body: JSON.stringify(
      readyRows.map((row) => ({
        sku: row.normalized.sku,
        name: row.normalized.name,
        category: row.normalized.category,
        type: row.normalized.type,
        grape: row.normalized.grape,
        region: row.normalized.region,
        style: row.normalized.style,
        price: row.normalized.price,
        cost_price: row.normalized.costPrice,
        currency: row.normalized.currency,
        status: row.normalized.status,
        oak: row.normalized.oak,
        country: row.normalized.country,
        import_run_id: importRunId
      }))
    )
  });

  return {
    importRunId,
    stagedRows: batchResult.rows.length,
    blockedRows: batchResult.summary.blocked,
    savedProducts: Array.isArray(savedProducts) ? savedProducts.length : readyRows.length
  };
}
