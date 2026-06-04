import { NextResponse } from 'next/server';
import { getCleanedProducts, getMappingMemory, getSupplierIntakeRows, getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { buildBrandIndex, buildMatchProposal } from '@/lib/supplier-intake/matching';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  const supplierCode = supplier?.supplier_code ?? '';

  const [products, rows, memory] = await Promise.all([
    getCleanedProducts(),
    getSupplierIntakeRows(run.id),
    getMappingMemory(supplierCode),
  ]);

  // Build brand index once for the whole run (avoids O(n²) per-row scan)
  const brandIndex = buildBrandIndex(products);
  const currentYear = new Date().getFullYear();

  const nextRows = rows.map(row => {
    if (row.status === 'blocked') return row;
    const match = buildMatchProposal(row.normalized_payload, products, {
      supplierCode,
      memory,
      brandIndex,
      currentYear,
    });

    let status: typeof row.status;
    if (match.status === 'strong_match') status = 'matched_auto';
    else if (match.status === 'no_match') status = 'new_code_required';
    else status = 'matched_needs_review';

    return { ...row, match, status };
  });

  await saveSupplierIntakeRows(run.id, nextRows);
  await saveSupplierIntakeRun({ ...run, status: 'matched', updated_at: new Date().toISOString() });

  // Summary stats for response
  const stats = {
    strong_match: nextRows.filter(r => r.match?.status === 'strong_match').length,
    likely_match: nextRows.filter(r => r.match?.status === 'likely_match').length,
    no_match: nextRows.filter(r => r.match?.status === 'no_match').length,
    l1_memory: nextRows.filter(r => r.match?.reasons?.some(s => s.includes('memory'))).length,
  };

  return NextResponse.json({ rows: nextRows, stats });
}
