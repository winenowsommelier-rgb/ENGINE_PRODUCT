import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { normalizeSupplierRows, parseSupplierWorkbook } from '@/lib/supplier-intake/normalization';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  if (run.source_format === 'pdf' && !file.name.toLowerCase().match(/\.(csv|xlsx)$/)) {
    return NextResponse.json({
      error: 'PDF evidence requires an attached normalized CSV/XLSX file before automated normalization',
    }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawRows = parseSupplierWorkbook(buffer, file.name);
  const rows = normalizeSupplierRows({ runId: run.id, supplier, rows: rawRows });

  await saveSupplierIntakeRows(run.id, rows);
  await saveSupplierIntakeRun({ ...run, status: 'normalized', total_rows: rows.length, blocked_rows: rows.filter(r => r.status === 'blocked').length, updated_at: new Date().toISOString() });

  return NextResponse.json({ rows });
}
