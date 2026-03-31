// scripts/run-triage.ts
// Stage 2: scan primary variants, write triage_flags.
// Pre-scan: seeds desc_source = 'original' for products with existing descriptions.
//
// Usage:
//   npx tsx scripts/run-triage.ts
//   npx tsx scripts/run-triage.ts --dry-run
//   npx tsx scripts/run-triage.ts --limit=200

export {};

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const PAGE     = 500;
const PATCH_BATCH = 50;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) { console.error('Missing env vars'); process.exit(1); }

async function sbFetch(url: string, opts: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal', ...(opts.headers ?? {}) },
      });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000 * (i+1))); continue; }
      return res;
    } catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, 1000*(i+1)));
    }
  }
  throw new Error('sbFetch exhausted retries');
}

const BRAND_VOICE_RE = /\b(we|our|we've|we craft|we produce)\b/i;
const HTML_TAG_RE    = /<[a-z][^>]*>/i;
const WINE_CLASSIFICATIONS = new Set([
  'red wine','white wine','rosé wine','rosé','rose wine','dessert wine',
  'sparkling wine','champagne','prosecco','cava','crémant',
]);
const SENSORY_FIELDS = ['wine_body','wine_acidity','wine_tannin'] as const;

function computeFlags(row: Record<string, any>): string {
  const short = row.short_description_en ?? '';
  const full  = row.description_en_text ?? '';
  const combined = `${short} ${full}`.trim();
  const cls = (row.classification ?? '').toLowerCase();

  const flags: string[] = [];

  // Description flags
  if (!short && !full) {
    flags.push('desc_missing');
  } else if (short && !full) {
    flags.push('desc_short_only');
  } else {
    if (BRAND_VOICE_RE.test(combined)) flags.push('desc_brand_voice');
    if (HTML_TAG_RE.test(combined))    flags.push('desc_html');
    if (flags.length === 0)            flags.push('desc_ok');
  }

  // Taxonomy completeness
  const taxoMissing: string[] = [];
  if (!row.country)  taxoMissing.push('country');
  if (!row.region)   taxoMissing.push('region');
  const isAccessory = /access|glassware|glass|decant|opener/i.test(cls);
  if (!isAccessory && !row.style) taxoMissing.push('style');
  if (!row.brand)    taxoMissing.push('brand');
  const isWine = WINE_CLASSIFICATIONS.has(cls);
  if (isWine) {
    for (const f of SENSORY_FIELDS) {
      if (!row[f]) taxoMissing.push(f);
    }
  }
  if (taxoMissing.length > 0) flags.push('taxonomy_incomplete');

  return flags.join(',');
}

type TriageRow = { id: string; triage_flags: string; desc_source?: string };

async function fetchPrimaryBatch(offset: number, limit: number): Promise<any[]> {
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,classification,short_description_en,description_en_text,country,region,style,brand,wine_body,wine_acidity,wine_tannin,desc_source&is_primary_variant=eq.true&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchBatch(rows: TriageRow[]): Promise<number> {
  if (DRY_RUN || rows.length === 0) return 0;
  let failCount = 0;
  for (let i = 0; i < rows.length; i += PATCH_BATCH) {
    const chunk = rows.slice(i, i + PATCH_BATCH);
    await Promise.all(chunk.map(async (r) => {
      const body: Record<string, any> = { triage_flags: r.triage_flags };
      if (r.desc_source !== undefined) body.desc_source = r.desc_source;
      const res = await sbFetch(`${BASE_URL}/rest/v1/products?id=eq.${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error(`  PATCH failed for ${r.id}: ${res.status}`);
        failCount++;
      }
    }));
  }
  return failCount;
}

async function main() {
  console.log(`run-triage${DRY_RUN ? ' [DRY RUN]' : ''}`);

  // Summary counters: { classification → { flag → count } }
  const summary: Record<string, Record<string, number>> = {};
  let offset = 0;
  let total = 0;
  let totalFails = 0;

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchPrimaryBatch(offset, limit);
    if (rows.length === 0) break;

    const patches: TriageRow[] = [];

    for (const row of rows) {
      const flags = computeFlags(row);
      const cls = row.classification ?? 'Unknown';

      // Pre-scan seeding: set desc_source = 'original' if it's null but descriptions exist
      const descSource = (!row.desc_source && (row.short_description_en || row.description_en_text))
        ? 'original'
        : undefined;

      patches.push({ id: row.id, triage_flags: flags, ...(descSource ? { desc_source: descSource } : {}) });

      // Accumulate summary
      if (!summary[cls]) summary[cls] = {};
      for (const flag of flags.split(',')) {
        summary[cls][flag] = (summary[cls][flag] ?? 0) + 1;
      }
    }

    totalFails += await patchBatch(patches);
    total += rows.length;
    offset += rows.length;
    process.stdout.write(`  Scanned ${total} primaries...\r`);
    if (rows.length < PAGE) break;
  }

  console.log(`\n  Done. Scanned ${total} primary variants.`);
  if (totalFails > 0) {
    console.error(`  WARNING: ${totalFails} PATCH(es) failed.`);
    process.exit(1);
  }
  console.log('\nTriage summary:');
  console.log('  Classification          | desc_missing | desc_short_only | desc_brand_voice | desc_html | desc_ok | taxonomy_incomplete');
  console.log('  ' + '-'.repeat(110));
  for (const [cls, counts] of Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = [
      cls.padEnd(23),
      String(counts['desc_missing'] ?? 0).padStart(12),
      String(counts['desc_short_only'] ?? 0).padStart(15),
      String(counts['desc_brand_voice'] ?? 0).padStart(16),
      String(counts['desc_html'] ?? 0).padStart(9),
      String(counts['desc_ok'] ?? 0).padStart(7),
      String(counts['taxonomy_incomplete'] ?? 0).padStart(19),
    ].join(' | ');
    console.log('  ' + row);
  }

  // Write summary JSON for the UI to read
  if (!DRY_RUN) {
    const fs = await import('fs');
    const p = await import('path');
    const dir = p.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p.join(dir, 'triage_summary.json'), JSON.stringify({ total, summary, generated_at: new Date().toISOString() }, null, 2));
    console.log('  Written data/triage_summary.json');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
