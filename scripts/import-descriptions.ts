/**
 * import-descriptions.ts
 * ──────────────────────
 * Reads Upload/export_Description25mar2026.xlsx (3 sheets) and:
 *   1. PATCHes existing Supabase products with descriptions + tasting notes
 *   2. INSERTs new products from EN Store (Default) that don't yet exist
 *
 * Prerequisites:
 *   • Run scripts/migration_add_descriptions.sql in the Supabase SQL Editor first
 *
 * Usage:
 *   npx tsx scripts/import-descriptions.ts
 *   npx tsx scripts/import-descriptions.ts --dry-run
 */

import * as XLSX from 'xlsx';
import * as path from 'path';

// ── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const EXCEL_PATH = path.resolve(__dirname, '../Upload/export_Description25mar2026.xlsx');
const BATCH_SIZE = 200;
const PATCH_CONCURRENCY = 15;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? 'https://xfcvliyxxguhihehqwkg.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? 'sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel';

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function str(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  return String(v).trim() || null;
}


async function sbFetch(urlPath: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${urlPath}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`[${res.status}] ${urlPath} → ${txt}`);
  }
  if (res.status === 204 || res.status === 201) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function runConcurrent<T>(
  items: T[],
  fn: (item: T, idx: number) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ── Row types ─────────────────────────────────────────────────────────────────

type ENRow = {
  ID: number;
  is_in_stock: string;
  sku: string;
  brand: string;
  name: string;
  bottle_size: string;
  vintage: string | number;
  cost: number;
  price: number;
  country: string;
  region_wine: string;
  wine_type: string;
  liquor_main_type: string;
  other_type: string;
  grape_variety: string;
  'short_description (EN Store)': string;
  'description (EN Store)': string;
  wine_color: string;
  wine_aroma: string;
  wine_palate: string;
  wine_body: string;
  wine_acidity: string;
  wine_tanin: string;
  food_matching: string;
};

type THRow = {
  sku: string;
  name: string;
  short_description: string;
  description: string;
  wine_color?: string;
  wine_aroma?: string;
  wine_palate?: string;
};

type DescPatch = {
  sku: string;
  short_description_en?: string | null;
  description_en_html?: string | null;
  description_en_text?: string | null;
  short_description_th_wn?: string | null;
  description_th_wn_html?: string | null;
  description_th_wn_text?: string | null;
  short_description_th_liq9?: string | null;
  description_th_liq9_html?: string | null;
  description_th_liq9_text?: string | null;
  wine_color?: string | null;
  wine_aroma?: string | null;
  wine_palate?: string | null;
  wine_body?: string | null;
  wine_acidity?: string | null;
  wine_tannin?: string | null;
  food_matching?: string | null;
  updated_at: string;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Step 1 — Read Excel
  console.log('\n📂 Reading Excel file…');
  const wb = XLSX.readFile(EXCEL_PATH);
  console.log('   Sheets:', wb.SheetNames.join(', '));

  const enRows     = XLSX.utils.sheet_to_json<ENRow>(wb.Sheets['EN Store (Default)']);
  const thWNRows   = XLSX.utils.sheet_to_json<THRow>(wb.Sheets['Store TH WN']);
  const thLiq9Rows = XLSX.utils.sheet_to_json<THRow>(wb.Sheets['Store TH Liq9']);

  console.log(`   EN Store: ${enRows.length} rows`);
  console.log(`   TH WN:    ${thWNRows.length} rows`);
  console.log(`   TH Liq9:  ${thLiq9Rows.length} rows`);

  const enMap     = new Map(enRows.map(r => [r.sku, r]));
  const thWNMap   = new Map(thWNRows.map(r => [r.sku, r]));
  const thLiq9Map = new Map(thLiq9Rows.map(r => [r.sku, r]));

  // Step 2 — Fetch all existing SKUs from Supabase
  console.log('\n🔍 Fetching existing products from Supabase…');
  const existingProducts: Array<{ id: string; sku: string }> = [];
  let page = 0;
  const PAGE = 1000;

  while (true) {
    const rows = await sbFetch(
      `products?select=id,sku&order=id&limit=${PAGE}&offset=${page * PAGE}`,
    );
    if (!rows || rows.length === 0) break;
    existingProducts.push(...rows);
    if (rows.length < PAGE) break;
    page++;
  }

  const existingSkuSet = new Set(existingProducts.map(p => p.sku));
  console.log(`   Found ${existingProducts.length} existing products`);

  // Step 3 — Build PATCH payloads for existing products
  console.log('\n🔧 Building PATCH payloads for existing products…');
  const now = new Date().toISOString();
  const patches: DescPatch[] = [];

  for (const { sku } of existingProducts) {
    const en    = enMap.get(sku);
    const thWN  = thWNMap.get(sku);
    const thLiq = thLiq9Map.get(sku);

    if (!en && !thWN && !thLiq) continue;

    const enDescHtml    = str(en?.['description (EN Store)']);
    const thWNDescHtml  = str(thWN?.description);
    const thLiqDescHtml = str(thLiq?.description);

    patches.push({
      sku,
      short_description_en:      str(en?.['short_description (EN Store)']),
      description_en_html:       enDescHtml,
      description_en_text:       enDescHtml ? stripHtml(enDescHtml) : null,
      short_description_th_wn:   str(thWN?.short_description),
      description_th_wn_html:    thWNDescHtml,
      description_th_wn_text:    thWNDescHtml ? stripHtml(thWNDescHtml) : null,
      short_description_th_liq9: str(thLiq?.short_description),
      description_th_liq9_html:  thLiqDescHtml,
      description_th_liq9_text:  thLiqDescHtml ? stripHtml(thLiqDescHtml) : null,
      wine_color:    str(en?.wine_color),
      wine_aroma:    str(en?.wine_aroma),
      wine_palate:   str(en?.wine_palate),
      wine_body:     str(en?.wine_body),
      wine_acidity:  str(en?.wine_acidity),
      wine_tannin:   str(en?.wine_tanin),
      food_matching: str(en?.food_matching),
      updated_at:    now,
    });
  }

  console.log(`   ${patches.length} existing products have description data`);

  // Step 4 — Build INSERT payloads for new products
  console.log('\n🆕 Building INSERT payloads for new products…');

  function deriveClassification(row: ENRow): string {
    if (str(row.wine_type))        return row.wine_type;
    if (str(row.liquor_main_type)) return row.liquor_main_type;
    if (str(row.other_type))       return row.other_type;
    return 'Unknown';
  }

  const newProducts = enRows
    .filter(r => !existingSkuSet.has(r.sku))
    .map(r => {
      const enDescHtml    = str(r['description (EN Store)']);
      const thWN          = thWNMap.get(r.sku);
      const thLiq         = thLiq9Map.get(r.sku);
      const thWNDescHtml  = str(thWN?.description);
      const thLiqDescHtml = str(thLiq?.description);

      return {
        id:                `row-${r.ID}-${Date.now()}`,
        sku:               r.sku,
        name:              r.name,
        brand:             str(r.brand),
        bottle_size:       str(r.bottle_size),
        vintage:           str(r.vintage),
        price:             r.price != null ? Math.round(Number(r.price)) : null,
        cost_price:        r.cost  != null ? Math.round(Number(r.cost))  : null,
        currency:          'thb',
        country:           str(r.country),
        region:            str(r.region_wine),
        classification:    deriveClassification(r),
        grape_variety:     str(r.grape_variety),
        quantity_in_stock: r.is_in_stock === 'in stock' ? 1 : 0,
        validation_status:   'raw',
        taxonomy_confidence: 0,
        overall_confidence:  0,
        // Descriptions
        short_description_en:      str(r['short_description (EN Store)']),
        description_en_html:       enDescHtml,
        description_en_text:       enDescHtml ? stripHtml(enDescHtml) : null,
        short_description_th_wn:   str(thWN?.short_description),
        description_th_wn_html:    thWNDescHtml,
        description_th_wn_text:    thWNDescHtml ? stripHtml(thWNDescHtml) : null,
        short_description_th_liq9: str(thLiq?.short_description),
        description_th_liq9_html:  thLiqDescHtml,
        description_th_liq9_text:  thLiqDescHtml ? stripHtml(thLiqDescHtml) : null,
        // Tasting notes
        wine_color:    str(r.wine_color),
        wine_aroma:    str(r.wine_aroma),
        wine_palate:   str(r.wine_palate),
        wine_body:     str(r.wine_body),
        wine_acidity:  str(r.wine_acidity),
        wine_tannin:   str(r.wine_tanin),
        food_matching: str(r.food_matching),
        source_file:   'export_Description25mar2026.xlsx',
        created_at:    now,
        updated_at:    now,
      };
    });

  console.log(`   ${newProducts.length} new products to insert`);

  // Dry-run preview
  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no data written to Supabase');
    if (patches[0]) console.log('   Sample PATCH:\n', JSON.stringify(patches[0], null, 2));
    if (newProducts[0]) console.log('   Sample INSERT:\n', JSON.stringify(newProducts[0], null, 2));
    return;
  }

  // Step 5 — PATCH existing products
  console.log(`\n📤 Patching ${patches.length} existing products (concurrency ${PATCH_CONCURRENCY})…`);
  let patchOK = 0, patchErr = 0;

  await runConcurrent(patches, async (patch, i) => {
    const { sku, ...fields } = patch;
    try {
      await sbFetch(`products?sku=eq.${encodeURIComponent(sku)}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      patchOK++;
    } catch (e: any) {
      patchErr++;
      console.error(`   ✗ PATCH sku=${sku}: ${e.message}`);
    }
    if ((i + 1) % 200 === 0) {
      console.log(`   … ${i + 1}/${patches.length} patched`);
    }
  }, PATCH_CONCURRENCY);

  console.log(`   ✓ Patched: ${patchOK}  ✗ Errors: ${patchErr}`);

  // Step 6 — INSERT new products in batches
  console.log(`\n📥 Inserting ${newProducts.length} new products (batch ${BATCH_SIZE})…`);
  let insertOK = 0, insertErr = 0;

  for (let i = 0; i < newProducts.length; i += BATCH_SIZE) {
    const batch = newProducts.slice(i, i + BATCH_SIZE);
    try {
      await sbFetch('products', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(batch),
      });
      insertOK += batch.length;
      console.log(`   … ${Math.min(i + BATCH_SIZE, newProducts.length)}/${newProducts.length} inserted`);
    } catch (e: any) {
      insertErr += batch.length;
      console.error(`   ✗ INSERT batch at ${i}: ${e.message}`);
    }
  }

  console.log(`   ✓ Inserted: ${insertOK}  ✗ Errors: ${insertErr}`);

  // Done
  console.log('\n✅ Import complete!');
  console.log(`   Existing products patched: ${patchOK}`);
  console.log(`   New products inserted:     ${insertOK}`);
  if (patchErr + insertErr > 0) {
    console.log(`   Total errors:              ${patchErr + insertErr}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
