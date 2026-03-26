/**
 * run-validation.ts
 * ─────────────────
 * Runs the local rules-based enrichment pipeline over all (or filtered) products.
 *
 * Usage:
 *   npx tsx scripts/run-validation.ts --dry-run --limit=10
 *   npx tsx scripts/run-validation.ts --status=raw
 *   npx tsx scripts/run-validation.ts
 */

import { runPipeline } from '../lib/validation/engine';
import type { TaxonomyProposal } from '../lib/validation/types';

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN    = process.argv.includes('--dry-run');
const STATUS_ARG = process.argv.find(a => a.startsWith('--status='))?.split('=')[1];
const SKU_ARG    = process.argv.find(a => a.startsWith('--sku='))?.split('=')[1];
const LIMIT_ARG  = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
}

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE        = 500;
const PATCH_BATCH = 50;

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(`[${res.status}] ${path} → ${await res.text()}`);
  if (res.status === 204 || res.status === 201) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function patchProducts(ids: string[], fields: Record<string, any>): Promise<void> {
  const idList = ids.map(id => `"${id}"`).join(',');
  await sbFetch(`products?id=in.(${idList})`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

async function upsertProposal(p: TaxonomyProposal): Promise<void> {
  // Uses a server-side RPC to atomically increment occurrences on conflict.
  // PostgREST's resolution=merge-duplicates does a simple column overwrite —
  // it cannot perform arithmetic and would reset occurrences to 1 every time.
  await sbFetch('rpc/upsert_taxonomy_proposal', {
    method: 'POST',
    body: JSON.stringify({
      p_type:           p.type,
      p_proposed_value: p.proposed_value,
      p_parent_path:    p.parent_path ?? '',
      p_source_sku:     p.source_sku,
    }),
  });
}

// ── Fetch products ────────────────────────────────────────────────────────────

async function fetchAllProducts(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;

  const filters = [];
  if (STATUS_ARG) filters.push(`validation_status=eq.${STATUS_ARG}`);
  if (SKU_ARG)    filters.push(`sku=eq.${SKU_ARG}`);
  const filterStr = filters.length ? '&' + filters.join('&') : '';

  while (true) {
    const rows = await sbFetch(
      `products?select=*&order=id&limit=${PAGE}&offset=${offset}${filterStr}`
    );
    if (!rows?.length) break;
    all.push(...rows);
    if (LIMIT_ARG && all.length >= LIMIT_ARG) { all.splice(LIMIT_ARG); break; }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔧 Validation Pipeline');
  if (DRY_RUN) console.log('   DRY RUN — no writes to Supabase\n');

  console.log('📦 Fetching products…');
  const products = await fetchAllProducts();
  console.log(`   ${products.length} products to process\n`);

  let countValidated = 0, countNeedsReview = 0, countRaw = 0, countTaxFlag = 0;
  const patchGroups = new Map<string, { ids: string[]; patch: Record<string, any> }>();
  const allProposals: TaxonomyProposal[] = [];

  // ── Process each product ──────────────────────────────────────────────────
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const { patch, proposals } = runPipeline(product);

    if (proposals.length) {
      countTaxFlag += proposals.length;
      allProposals.push(...proposals);
      if (!patch.enrichment_note) {
        patch.enrichment_note = proposals.map(p =>
          `unknown taxonomy: ${p.type} '${p.proposed_value}'${p.parent_path ? ` under ${p.parent_path}` : ''} — pending approval`
        ).join('; ');
      }
    }

    const status = patch.validation_status;
    if (status === 'validated')    countValidated++;
    else if (status === 'needs_review') countNeedsReview++;
    else countRaw++;

    // Group products by identical patch content for batch PATCH
    const patchKey = JSON.stringify(patch);
    if (!patchGroups.has(patchKey)) patchGroups.set(patchKey, { ids: [], patch });
    patchGroups.get(patchKey)!.ids.push(product.id);

    if ((i + 1) % 500 === 0 || i === products.length - 1) {
      process.stdout.write(
        `\r[${i + 1}/${products.length}] validated: +${countValidated} | needs_review: +${countNeedsReview} | raw: ${countRaw} | taxonomy flags: ${countTaxFlag}`
      );
    }
  }

  console.log('\n');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN — sample of first patch:');
    const first = products[0];
    if (first) {
      const { patch } = runPipeline(first);
      console.log(JSON.stringify({ sku: first.sku, patch }, null, 2));
    }
    return;
  }

  // ── Write patches to Supabase ─────────────────────────────────────────────
  console.log(`📤 Writing patches (${patchGroups.size} unique patch shapes)…`);
  let written = 0;
  for (const { ids, patch } of patchGroups.values()) {
    for (let i = 0; i < ids.length; i += PATCH_BATCH) {
      await patchProducts(ids.slice(i, i + PATCH_BATCH), patch);
    }
    written += ids.length;
    process.stdout.write(`\r   Written: ${written}/${products.length}`);
  }
  console.log('\n   ✓ Patches written');

  // ── Write taxonomy proposals ───────────────────────────────────────────────
  if (allProposals.length) {
    console.log(`\n🚩 Writing ${allProposals.length} taxonomy proposals…`);
    for (const p of allProposals) {
      try { await upsertProposal(p); } catch (e: any) { console.error(`  ✗ ${e.message}`); }
    }
    console.log('   ✓ Proposals written');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n✅ Pipeline complete!');
  console.log(`   → validated:    ${countValidated}`);
  console.log(`   → needs_review: ${countNeedsReview}`);
  console.log(`   → raw:          ${countRaw}`);
  console.log(`   → taxonomy flags: ${countTaxFlag}`);
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
