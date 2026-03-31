// app/api/ai-enrichment/publish/route.ts
// Stage 5: write approved enrichment results to Supabase primary + sync variants.
//
// POST body: { productIds: string[] }  — list of product IDs to publish
// Reads from data/enrichment_results/{id}.json for each product.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const RESULTS_DIR = path.join(process.cwd(), 'data', 'enrichment_results');

// Shared fields that are synced from primary → all variants
const SHARED_FIELDS = [
  'desc_en_short', 'desc_en_full', 'desc_source', 'desc_processed_at',
  'style', 'style_detail', 'vintage', 'brand', 'classification',
  'wine_classification', 'country', 'region', 'subregion', 'appellation',
  'wine_body', 'wine_acidity', 'wine_tannin', 'flavor_tags', 'food_matching',
  'overall_confidence', 'validation_status', 'enrichment_note', 'triage_flags',
] as const;

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000*(i+1))); continue; }
      return res;
    } catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, 1000*(i+1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

async function fetchProduct(id: string): Promise<Record<string, any> | null> {
  const res = await sbFetch(
    `${BASE_URL}/rest/v1/products?id=eq.${id}&select=id,sku,sku_base,overall_confidence`,
    { method: 'GET', headers: { Prefer: 'count=none' } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function fetchVariants(skuBase: string, primaryId: string): Promise<string[]> {
  const res = await sbFetch(
    `${BASE_URL}/rest/v1/products?sku_base=eq.${encodeURIComponent(skuBase)}&id=neq.${primaryId}&select=id`,
    { method: 'GET', headers: { Prefer: 'count=none' } }
  );
  if (!res.ok) return [];
  const rows: any[] = await res.json();
  return rows.map(r => r.id);
}

async function patchProduct(id: string, body: Record<string, any>): Promise<boolean> {
  const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const productIds: string[] = Array.isArray(body.productIds) ? body.productIds : [];

  if (productIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'productIds required' }, { status: 400 });
  }

  const results = {
    published: 0,
    primaryFailed: [] as string[],
    variantSyncFailed: [] as string[],
  };

  for (const productId of productIds) {
    // Guard against path traversal — only accept UUID-shaped IDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(productId)) {
      results.primaryFailed.push(productId);
      continue;
    }

    // Load enrichment result from disk
    const resultPath = path.join(RESULTS_DIR, `${productId}.json`);
    if (!fs.existsSync(resultPath)) {
      results.primaryFailed.push(productId);
      continue;
    }

    let enrichment: Record<string, any>;
    try {
      enrichment = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch {
      results.primaryFailed.push(productId);
      continue;
    }
    const aiResult: Record<string, any> = enrichment.result ?? {};
    const isManual = enrichment.manual_edited === true;

    // Fetch current product to get overall_confidence for weighted average
    const current = await fetchProduct(productId);
    if (!current) { results.primaryFailed.push(productId); continue; }

    // Compute new overall_confidence
    const prevConf = parseFloat(String(current.overall_confidence ?? 0));
    const descConf = parseFloat(String(aiResult.desc_confidence ?? 0));
    const rawConf = prevConf > 0
      ? prevConf * 0.4 + descConf * 0.6
      : descConf;
    const newConf = Math.max(0, Math.min(1, rawConf));

    const now = new Date().toISOString();
    const primaryPayload: Record<string, any> = {
      ...aiResult,
      desc_source: isManual ? 'manual' : 'ai_processed',
      desc_processed_at: now,
      overall_confidence: newConf,
    };
    // Remove desc_confidence from the DB payload (not a DB column)
    delete primaryPayload.desc_confidence;

    // Write primary
    const primaryOk = await patchProduct(productId, primaryPayload);
    if (!primaryOk) {
      results.primaryFailed.push(productId);
      continue;
    }

    results.published++;

    // Sync shared fields to all variants
    const skuBase = current.sku_base ?? enrichment.sku_base;
    if (!skuBase) continue;

    const variantIds = await fetchVariants(skuBase, productId);
    if (variantIds.length === 0) continue;

    // Build variant payload: shared fields only, from the primary payload
    const variantPayload: Record<string, any> = {};
    for (const f of SHARED_FIELDS) {
      if (f in primaryPayload) variantPayload[f] = primaryPayload[f];
    }

    for (const varId of variantIds) {
      const ok = await patchProduct(varId, variantPayload);
      if (!ok) results.variantSyncFailed.push(varId);
    }

    // Mark result as published
    enrichment.status = 'published';
    enrichment.published_at = now;
    try {
      fs.writeFileSync(resultPath, JSON.stringify(enrichment, null, 2));
    } catch (e: any) {
      console.error(`  WARNING: failed to mark ${productId} as published on disk: ${e.message}`);
    }
  }

  return NextResponse.json({
    ok: results.primaryFailed.length === 0,
    published: results.published,
    primaryFailed: results.primaryFailed,
    variantSyncFailed: results.variantSyncFailed,
  });
}
