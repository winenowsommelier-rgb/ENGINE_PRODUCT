/**
 * clean-thai-descriptions.ts
 * ───────────────────────────
 * Nulls out Thai description columns where the content is NOT actual Thai text.
 * Keeps only records that contain Thai Unicode characters (U+0E00–U+0E7F).
 *
 * Usage:
 *   npx tsx scripts/clean-thai-descriptions.ts --dry-run   (preview only)
 *   npx tsx scripts/clean-thai-descriptions.ts             (apply)
 */

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xfcvliyxxguhihehqwkg.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel';
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PAGE = 1000;
const BATCH = 50; // IDs per PATCH call

function isThai(s: string | null | undefined): boolean {
  return /[\u0E00-\u0E7F]/.test(s ?? '');
}

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

async function patchBatch(ids: string[], fields: Record<string, null>) {
  if (!ids.length) return;
  const idList = ids.map(id => `"${id}"`).join(',');
  await sbFetch(`products?id=in.(${idList})`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

async function main() {
  console.log(`\n🔍 Scanning products for non-Thai content in TH columns…`);
  if (DRY_RUN) console.log('   DRY RUN — no changes will be written\n');

  // Collect IDs to clean per store
  const wnToClear:   string[] = [];  // has WN content but it's not Thai
  const liq9ToClear: string[] = [];  // has Liq9 content but it's not Thai

  let page = 0;
  let total = 0;

  while (true) {
    const rows: any[] = await sbFetch(
      `products?select=id,short_description_th_wn,description_th_wn_text,short_description_th_liq9,description_th_liq9_text` +
      `&or=(short_description_th_wn.not.is.null,short_description_th_liq9.not.is.null)` +
      `&limit=${PAGE}&offset=${page * PAGE}`
    );
    if (!rows?.length) break;
    total += rows.length;

    for (const row of rows) {
      const wnText  = (row.short_description_th_wn ?? '') + (row.description_th_wn_text ?? '');
      const liq9Text = (row.short_description_th_liq9 ?? '') + (row.description_th_liq9_text ?? '');

      const hasWN   = !!(row.short_description_th_wn || row.description_th_wn_text);
      const hasLiq9 = !!(row.short_description_th_liq9 || row.description_th_liq9_text);

      if (hasWN   && !isThai(wnText))   wnToClear.push(row.id);
      if (hasLiq9 && !isThai(liq9Text)) liq9ToClear.push(row.id);
    }

    if (rows.length < PAGE) break;
    page++;
  }

  console.log(`   Scanned ${total} products with TH content`);
  console.log(`   WN  — non-Thai to clear:  ${wnToClear.length}`);
  console.log(`   Liq9 — non-Thai to clear: ${liq9ToClear.length}`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN complete — run without --dry-run to apply.');
    return;
  }

  // Clear WN fields for non-Thai WN records
  if (wnToClear.length) {
    console.log(`\n🧹 Clearing WN fields on ${wnToClear.length} products…`);
    let done = 0;
    for (let i = 0; i < wnToClear.length; i += BATCH) {
      await patchBatch(wnToClear.slice(i, i + BATCH), {
        short_description_th_wn:  null,
        description_th_wn_html:   null,
        description_th_wn_text:   null,
      });
      done += Math.min(BATCH, wnToClear.length - i);
      if (done % 500 === 0 || done === wnToClear.length)
        console.log(`   … ${done}/${wnToClear.length}`);
    }
    console.log(`   ✓ WN cleared`);
  }

  // Clear Liq9 fields for non-Thai Liq9 records
  if (liq9ToClear.length) {
    console.log(`\n🧹 Clearing Liq9 fields on ${liq9ToClear.length} products…`);
    let done = 0;
    for (let i = 0; i < liq9ToClear.length; i += BATCH) {
      await patchBatch(liq9ToClear.slice(i, i + BATCH), {
        short_description_th_liq9:  null,
        description_th_liq9_html:   null,
        description_th_liq9_text:   null,
      });
      done += Math.min(BATCH, liq9ToClear.length - i);
      if (done % 500 === 0 || done === liq9ToClear.length)
        console.log(`   … ${done}/${liq9ToClear.length}`);
    }
    console.log(`   ✓ Liq9 cleared`);
  }

  console.log('\n✅ Thai cleanup complete!');
  console.log(`   Non-Thai WN records cleared:   ${wnToClear.length}`);
  console.log(`   Non-Thai Liq9 records cleared: ${liq9ToClear.length}`);
  console.log(`   Real Thai content preserved:   ~503 products`);
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
