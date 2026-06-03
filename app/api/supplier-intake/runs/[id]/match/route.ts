import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows, getSupplierIntakeRuns, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { buildMatchProposal } from '@/lib/supplier-intake/matching';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows(run.id);
  const nextRows = rows.map(row => {
    if (row.status === 'blocked') return row;
    const match = buildMatchProposal(row.normalized_payload, products);
    return {
      ...row,
      match,
      status: match.status === 'strong_match' ? 'matched_auto' as const : match.status === 'no_match' ? 'new_code_required' as const : 'matched_needs_review' as const,
    };
  });

  await saveSupplierIntakeRows(run.id, nextRows);
  await saveSupplierIntakeRun({ ...run, status: 'matched', updated_at: new Date().toISOString() });
  return NextResponse.json({ rows: nextRows });
}
