import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRows, getSupplierIntakeRuns, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const approvedIds = new Set<string>(Array.isArray(body.row_ids) ? body.row_ids : []);
  const approver = String(body.approved_by ?? 'internal');
  const rows = await getSupplierIntakeRows(params.id);
  const now = new Date().toISOString();

  const nextRows = rows.map(row => {
    if (!approvedIds.has(row.id)) return row;
    if (!row.price || row.price.status === 'blocked') return { ...row, status: 'blocked' as const, issues: [...row.issues, 'Blocked price cannot be approved'] };
    return { ...row, status: 'approved' as const, approved_by: approver, approved_at: now };
  });

  await saveSupplierIntakeRows(params.id, nextRows);
  const run = (await getSupplierIntakeRuns()).find(r => r.id === params.id);
  if (run) await saveSupplierIntakeRun({ ...run, status: 'approved', approved_rows: nextRows.filter(r => r.status === 'approved').length, updated_at: now });
  return NextResponse.json({ rows: nextRows });
}
