// scripts/migrate-style-fields.ts
// One-time: split grape_variety data → style + style_detail.
// Run AFTER SQL migration (columns must exist) and BEFORE triage scan.
//
// Usage:
//   npx tsx scripts/migrate-style-fields.ts
//   npx tsx scripts/migrate-style-fields.ts --dry-run
//   npx tsx scripts/migrate-style-fields.ts --limit=100

import fs from 'fs';
import path from 'path';

const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT    = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const PAGE     = 500;
const PATCH_BATCH = 50;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

// Load approved wine style values for taxonomy proposal check
const WINE_STYLES: string[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'rules/styles/wine.json'), 'utf-8')
);
const WINE_STYLE_SET = new Set(WINE_STYLES.map(s => s.toLowerCase()));

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

/** Extract primary variety name from a potentially-percentage-mixed string */
function extractPrimaryVariety(raw: string): string {
  // "85% Cab Sauv / 15% Merlot" → "Cab Sauv"
  // "Cabernet Sauvignon" → "Cabernet Sauvignon"
  const pctMatch = raw.match(/^(\d+)%\s*(.+?)(?:\s*\/|$)/);
  if (pctMatch) {
    return pctMatch[2].trim();
  }
  // "60% Cabernet Sauvignon / 40% Merlot" → "Cabernet Sauvignon"
  const pctMatch2 = raw.match(/\d+%\s*(.+?)(?:\s*\/)/);
  if (pctMatch2) return pctMatch2[1].trim();
  return raw.trim();
}

/** Normalise to Title Case */
function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function fetchProducts(offset: number, limit: number): Promise<any[]> {
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,grape_variety,classification&grape_variety=not.is.null&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchBatch(patches: Array<{ id: string; style?: string; style_detail?: string; grape_variety: null }>): Promise<void> {
  if (DRY_RUN || patches.length === 0) return;
  for (let i = 0; i < patches.length; i += PATCH_BATCH) {
    const chunk = patches.slice(i, i + PATCH_BATCH);
    // Individual PATCH per record to set different style/style_detail values
    await Promise.all(chunk.map(async (p) => {
      const body: Record<string, any> = { grape_variety: null };
      if (p.style) body.style = p.style;
      if (p.style_detail) body.style_detail = p.style_detail;
      const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error(`  PATCH failed for ${p.id}: ${res.status}`);
    }));
  }
}

async function emitTaxonomyProposal(style: string, sku: string): Promise<void> {
  if (DRY_RUN) return;
  const res = await sbFetch(`${BASE_URL}/rest/v1/taxonomy_proposals`, {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ type: 'style', value: style, source_sku: sku, status: 'pending' }),
  });
  if (!res.ok && res.status !== 409) {
    console.error(`  taxonomy_proposals insert failed: ${res.status}`);
  }
}

async function main() {
  console.log(`migrate-style-fields${DRY_RUN ? ' [DRY RUN]' : ''}`);
  let offset = 0;
  let totalMigrated = 0;
  let totalProposals = 0;
  const patches: Array<{ id: string; style?: string; style_detail?: string; grape_variety: null }> = [];
  const proposals: Array<{ style: string; sku: string }> = [];

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchProducts(offset, limit);
    if (rows.length === 0) break;

    for (const row of rows) {
      const raw: string = row.grape_variety;
      const hasPercent = /\d+%/.test(raw);
      let style: string | undefined;
      let style_detail: string | undefined;

      if (hasPercent) {
        const primary = extractPrimaryVariety(raw);
        style = toTitleCase(primary);
        style_detail = raw.trim();
      } else {
        style = toTitleCase(raw.trim());
      }

      // Check against wine taxonomy (only wines have grape varieties)
      if (style && !WINE_STYLE_SET.has(style.toLowerCase())) {
        proposals.push({ style, sku: row.sku });
      }

      patches.push({ id: row.id, style, style_detail, grape_variety: null });
    }

    totalMigrated += rows.length;
    offset += rows.length;
    if (rows.length < PAGE) break;
    process.stdout.write(`  Fetched ${totalMigrated} products...\r`);
  }

  console.log(`\n  Total products to migrate: ${totalMigrated}`);
  console.log(`  Taxonomy proposals: ${proposals.length}`);

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] First 5 patches:');
    patches.slice(0, 5).forEach(p => console.log('  ', JSON.stringify(p)));
    console.log('\n  [DRY RUN] First 5 proposals:');
    proposals.slice(0, 5).forEach(p => console.log('  ', JSON.stringify(p)));
    return;
  }

  // Write patches in batches
  for (let i = 0; i < patches.length; i += PATCH_BATCH) {
    await patchBatch(patches.slice(i, i + PATCH_BATCH));
    process.stdout.write(`  Written ${Math.min(i + PATCH_BATCH, patches.length)}/${patches.length}\r`);
  }

  // Write taxonomy proposals
  for (const p of proposals) {
    await emitTaxonomyProposal(p.style, p.sku);
    totalProposals++;
  }

  console.log(`\n  Done. Migrated: ${totalMigrated} | Proposals emitted: ${totalProposals}`);
}

main().catch(e => { console.error(e); process.exit(1); });
