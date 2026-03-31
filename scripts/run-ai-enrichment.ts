// scripts/run-ai-enrichment.ts
// Stage 3: Claude API enrichment — descriptions + taxonomy in one pass.
//
// Usage:
//   npx tsx scripts/run-ai-enrichment.ts
//   npx tsx scripts/run-ai-enrichment.ts --dry-run
//   npx tsx scripts/run-ai-enrichment.ts --category="Red Wine" --limit=10
//   npx tsx scripts/run-ai-enrichment.ts --batch=1   (batch numbers from spec Section 8)

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT    = (() => { const m = process.argv.find(a => a.startsWith('--limit=')); return m ? parseInt(m.split('=')[1]) : 0; })();
const CATEGORY = (() => { const m = process.argv.find(a => a.startsWith('--category=')); return m ? m.split('=').slice(1).join('=') : null; })();
const BATCH_N  = (() => { const m = process.argv.find(a => a.startsWith('--batch=')); return m ? parseInt(m.split('=')[1]) : 0; })();

const CONCURRENCY = 5;
const PAGE        = 500;

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_KEY  = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!BASE_URL || !API_KEY) { console.error('Missing Supabase env vars'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Batch definitions: number → [classifications]
const BATCHES: Record<number, string[]> = {
  1: ['Red Wine'],
  2: ['White Wine'],
  3: ['Rosé Wine', 'Rosé', 'Rose Wine', 'Dessert Wine'],
  4: ['Sparkling Wine', 'Champagne', 'Prosecco', 'Cava', 'Crémant'],
  5: ['Whisky', 'Whiskey'],
  6: ['Gin', 'Rum', 'Tequila', 'Vodka', 'Brandy', 'Liqueur', 'Other Spirit'],
  7: ['Beer'],
  8: ['Sake'],
  9: ['Accessory', 'Glassware', 'Non-Alcoholic', 'Other'],
};

const TEMPLATE_MAP: Record<string, string> = {
  'red wine': 'wine', 'white wine': 'wine', 'rosé wine': 'wine', 'rosé': 'wine',
  'rose wine': 'wine', 'dessert wine': 'wine',
  'sparkling wine': 'sparkling', 'champagne': 'sparkling', 'prosecco': 'sparkling',
  'cava': 'sparkling', 'crémant': 'sparkling',
  'whisky': 'whisky', 'whiskey': 'whisky',
  'gin': 'spirits', 'rum': 'spirits', 'tequila': 'spirits', 'vodka': 'spirits',
  'brandy': 'spirits', 'liqueur': 'spirits', 'other spirit': 'spirits',
  'beer': 'beer', 'sake': 'sake',
  'accessory': 'accessories', 'glassware': 'accessories',
  'non-alcoholic': 'accessories', 'other': 'accessories',
};

function getTemplate(classification: string): string {
  return TEMPLATE_MAP[classification.toLowerCase()] ?? 'wine';
}

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

const SYSTEM_PROMPT = `You are a product content writer for an online wine and spirits retailer in Thailand serving both Wine-now and LIQ9. Write in clear, engaging English as an expert retailer recommending products to customers — third-party voice, never brand voice. Never use "we", "our", or first-person. The page template already displays all structured attributes (style, vintage, ABV, body, food matching, etc.) so do not repeat them as lists. Instead write storytelling content: producer context, what makes this product distinctive, evocative tasting prose, and specific occasion or pairing guidance. Include specific named entities (producer names, appellations, grape varieties, techniques) naturally in prose — this improves SEO and AI discoverability.`;

function buildUserPrompt(row: Record<string, any>): string {
  const n = (v: any) => (v == null || v === '') ? 'NULL' : String(v);
  const template = getTemplate(row.classification ?? '');
  return `Product: ${row.name}
SKU base: ${row.sku_base ?? row.sku?.substring(0,7)}
Category: ${row.classification}
Existing data (KNOWN = do not change; NULL = infer from name and descriptions):
  country:           ${n(row.country)}
  region:            ${n(row.region)}
  style:             ${n(row.style)}
  style_detail:      ${n(row.style_detail)}
  vintage:           ${n(row.vintage)}
  brand:             ${n(row.brand)}
  wine_body:         ${n(row.wine_body)}
  wine_acidity:      ${n(row.wine_acidity)}
  wine_tannin:       ${n(row.wine_tannin)}
  subregion:         ${n(row.subregion)}
  appellation:       ${n(row.appellation)}
  wine_classification: ${n(row.wine_classification)}
  flavor_tags:       ${n(row.flavor_tags)}
  food_matching:     ${n(row.food_matching)}

Source descriptions (raw — may be brand voice, HTML, or empty):
  Short: "${row.short_description_en ?? ''}"
  Full:  "${row.description_en_text ?? ''}"

Write the full description using the HTML template for ${template}.
Return a JSON object with these exact keys:
{
  "desc_en_short": "string, 1-2 sentences, 30-60 words, no HTML",
  "desc_en_full":  "string, HTML using ${template} template, 180-300 words, must start with <div class=\\"prod-desc\\">",
  "desc_confidence": number 0.0-1.0,
  "style":         "string or null",
  "style_detail":  "string or null",
  "vintage":       "4-digit year string or null",
  "brand":         "string or null",
  "country":       "string or null",
  "region":        "string or null",
  "subregion":     "string or null",
  "appellation":   "string or null",
  "wine_classification": "string or null",
  "wine_body":     "light or medium or full or null",
  "wine_acidity":  "low or medium or high or null",
  "wine_tannin":   "low or medium or high or null",
  "flavor_tags":   ["fruit","spice","oak","earth","floral","mineral","herbal"] (array or null),
  "food_matching": "pipe-separated from: Red Meat|Poultry|Seafood|Cheese|Pork|Dessert|Pasta|Vegetables|Spicy Food|Aperitif or null"
}
For KNOWN fields, echo back the existing value. For NULL fields, infer from the product name and source descriptions.`;
}

async function callClaude(row: Record<string, any>): Promise<Record<string, any>> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(row) }],
  });
  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  // Find the last top-level JSON object (handles prose before/after JSON)
  const matches = [...text.matchAll(/\{[\s\S]*?\}/g)];
  // Try each match from largest to smallest to find valid JSON
  const sorted = matches.sort((a, b) => b[0].length - a[0].length);
  for (const m of sorted) {
    try { return JSON.parse(m[0]); } catch { continue; }
  }
  // Fallback: try greedy match as last resort
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) {
    try { return JSON.parse(greedy[0]); } catch { /* fall through */ }
  }
  throw new Error(`No valid JSON in response for ${row.sku}`);
}

function validateResponse(ai: Record<string, any>, row: Record<string, any>): Record<string, any> {
  const VALID_BODY     = new Set(['light','medium','full']);
  const VALID_ACIDITY  = new Set(['low','medium','high']);
  const VALID_TANNIN   = new Set(['low','medium','high']);
  const VALID_FOOD     = new Set(['Red Meat','Poultry','Seafood','Cheese','Pork','Dessert','Pasta','Vegetables','Spicy Food','Aperitif']);

  const result: Record<string, any> = {
    desc_en_short: ai.desc_en_short ?? null,
    desc_en_full:  ai.desc_en_full ?? null,
    desc_confidence: Math.max(0, Math.min(1, Number(ai.desc_confidence) || 0)),
  };

  // Validate desc_en_full has required wrapper
  if (result.desc_en_full && !result.desc_en_full.includes('<div class="prod-desc">')) {
    console.warn(`  WARNING: desc_en_full missing <div class="prod-desc"> wrapper for ${row.sku} — flagging`);
    result.desc_confidence = Math.min(result.desc_confidence, 0.5);
  }

  // Taxonomy: only write if current value is null/empty
  const taxFields = ['style','style_detail','vintage','brand','country','region','subregion','appellation','wine_classification'];
  for (const f of taxFields) {
    const current = row[f];
    if (current == null || current === '') {
      // vintage: strip non-numeric
      if (f === 'vintage' && ai[f]) {
        const m = String(ai[f]).match(/\d{4}/);
        result[f] = m ? m[0] : null;
      } else {
        result[f] = ai[f] ?? null;
      }
    }
  }

  const sensory: Record<string, Set<string>> = { wine_body: VALID_BODY, wine_acidity: VALID_ACIDITY, wine_tannin: VALID_TANNIN };
  for (const [f, valid] of Object.entries(sensory)) {
    if (!row[f]) {
      const v = ai[f]?.toLowerCase();
      result[f] = valid.has(v) ? v : null;
    }
  }

  // flavor_tags: array → JSON string
  if (!row.flavor_tags && ai.flavor_tags) {
    const arr = Array.isArray(ai.flavor_tags) ? ai.flavor_tags : null;
    result.flavor_tags = arr ? JSON.stringify(arr) : null;
  }

  // food_matching: validate pipe-separated values
  if (!row.food_matching && ai.food_matching) {
    const items = String(ai.food_matching).split('|').map(s => s.trim()).filter(s => VALID_FOOD.has(s));
    result.food_matching = items.length > 0 ? items.join('|') : null;
  }

  return result;
}

async function fetchProductBatch(classifications: string[], offset: number, limit: number): Promise<any[]> {
  // Build OR filter for classifications
  const clsFilter = classifications.map(c => `classification.eq.${encodeURIComponent(c)}`).join(',');
  const url = `${BASE_URL}/rest/v1/products?select=id,sku,sku_base,name,classification,country,region,subregion,appellation,style,style_detail,vintage,brand,wine_body,wine_acidity,wine_tannin,wine_classification,flavor_tags,food_matching,short_description_en,description_en_text,desc_source&is_primary_variant=eq.true&or=(${clsFilter})&offset=${offset}&limit=${limit}`;
  const res = await sbFetch(url, { method: 'GET', headers: { Prefer: 'count=none' } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function saveResult(productId: string, result: Record<string, any>): Promise<void> {
  // Save to data/enrichment_results/ as JSON files for review queue
  const dir = path.join(process.cwd(), 'data', 'enrichment_results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${productId}.json`), JSON.stringify(result, null, 2));
}

async function processProduct(row: Record<string, any>, stats: { processed: number; errors: number; rate_limited: number }): Promise<void> {
  try {
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would process: ${row.sku} — ${row.name?.substring(0, 60)}`);
      stats.processed++;
      return;
    }
    let ai: Record<string, any> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ai = await callClaude(row);
        break;
      } catch (e: any) {
        if ((e.message?.includes('rate_limit') || e.status === 429) && attempt < 2) {
          const wait = 10000 * (attempt + 1); // 10s, 20s
          console.warn(`  RATE LIMIT ${row.sku}, retrying in ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw e;
        }
      }
    }
    if (!ai) throw new Error(`callClaude returned null for ${row.sku}`);
    const validated = validateResponse(ai, row);
    await saveResult(row.id, {
      product_id: row.id,
      sku: row.sku,
      sku_base: row.sku_base,
      name: row.name,
      classification: row.classification,
      status: 'pending_review',
      processed_at: new Date().toISOString(),
      desc_confidence: validated.desc_confidence,
      // Preserve original desc_source so review queue can apply manual-edit protection
      // to products that had desc_source = 'manual' before AI processing.
      original_desc_source: row.desc_source ?? null,
      result: validated,
      original: {
        short_description_en: row.short_description_en,
        description_en_text: row.description_en_text,
      },
    });
    stats.processed++;
  } catch (e: any) {
    if (e.message?.includes('rate_limit') || e.status === 429) {
      stats.rate_limited++;
    } else {
      stats.errors++;
    }
    console.error(`  ERROR ${row.sku}: ${e.message}`);
  }
}

async function runBatch(classifications: string[]): Promise<void> {
  const stats = { processed: 0, errors: 0, rate_limited: 0 };
  const label = classifications[0];
  let offset = 0;
  let total = 0;

  // Count total for progress display
  const countRes = await sbFetch(
    `${BASE_URL}/rest/v1/products?is_primary_variant=eq.true&or=(${classifications.map(c => `classification.eq.${encodeURIComponent(c)}`).join(',')})&select=id`,
    { method: 'GET', headers: { Prefer: 'count=exact', Range: '0-0' } }
  );
  const contentRange = countRes.headers.get('content-range') ?? '';
  const grandTotal = parseInt(contentRange.split('/')[1] ?? '0') || 0;

  while (true) {
    const limit = LIMIT > 0 ? Math.min(PAGE, LIMIT - offset) : PAGE;
    if (LIMIT > 0 && offset >= LIMIT) break;
    const rows = await fetchProductBatch(classifications, offset, limit);
    if (rows.length === 0) break;

    // Process CONCURRENCY at a time
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(r => processProduct(r, stats)));
      total = offset + Math.min(i + CONCURRENCY, rows.length);
      process.stdout.write(`  [${label}] ${total}/${grandTotal} — processed: ${stats.processed} | errors: ${stats.errors} | rate_limited: ${stats.rate_limited}\r`);
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  console.log(`\n  [${label}] Complete — processed: ${stats.processed} | errors: ${stats.errors} | rate_limited: ${stats.rate_limited}`);
}

async function main() {
  console.log(`run-ai-enrichment${DRY_RUN ? ' [DRY RUN]' : ''}`);

  let batchesToRun: Record<number, string[]> = { ...BATCHES };

  if (BATCH_N > 0) {
    if (!BATCHES[BATCH_N]) { console.error(`Invalid batch number: ${BATCH_N}. Valid: 1-9`); process.exit(1); }
    batchesToRun = { [BATCH_N]: BATCHES[BATCH_N] };
  } else if (CATEGORY) {
    // Find which batch contains this classification
    const found = Object.entries(BATCHES).find(([, clss]) =>
      clss.some(c => c.toLowerCase() === CATEGORY!.toLowerCase())
    );
    if (!found) { console.error(`Unknown category: ${CATEGORY}`); process.exit(1); }
    batchesToRun = { [Number(found[0])]: found[1] };
  }

  for (const [batchNum, classifications] of Object.entries(batchesToRun).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`\nBatch ${batchNum}: ${classifications.join(', ')}`);
    await runBatch(classifications);
  }

  console.log('\nAll batches complete. Results saved to data/enrichment_results/');
  console.log('Run Stage 4 review in the PIM app: AI Review Queue page');
}

main().catch(e => { console.error(e); process.exit(1); });
