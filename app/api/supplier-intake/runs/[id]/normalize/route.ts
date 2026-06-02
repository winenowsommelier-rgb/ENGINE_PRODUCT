import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { isCanonicalCsv, normalizeSupplierRows, parseCanonicalCsv, parseSupplierWorkbook } from '@/lib/supplier-intake/normalization';
import { downloadDriveFile, exportGoogleSheetAsXlsx } from '@/lib/supplier-intake/google-drive';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  let buffer: Buffer;
  let filename: string;

  // Only call formData() when the request is actually multipart — avoids throwing
  // on empty-body POSTs from the auto-chain UI (Content-Type: application/json).
  const ct = req.headers.get('content-type') ?? '';
  let uploadedFile: File | null = null;
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const f = form.get('file');
    if (f instanceof File) uploadedFile = f;
  }

  if (uploadedFile) {
    if (run.source_format === 'pdf' && !uploadedFile.name.toLowerCase().match(/\.(csv|xlsx)$/)) {
      return NextResponse.json({
        error: 'PDF evidence requires an attached normalized CSV/XLSX file before automated normalization',
      }, { status: 422 });
    }
    buffer = Buffer.from(await uploadedFile.arrayBuffer());
    filename = uploadedFile.name;
  } else if (run.source_drive_file_id) {
    if (run.source_format === 'google_sheet') {
      buffer = await exportGoogleSheetAsXlsx(run.source_drive_file_id);
      filename = `${run.source_filename}.xlsx`;
    } else if (run.source_format === 'pdf') {
      return NextResponse.json({
        error: 'PDF evidence requires an attached normalized CSV/XLSX file; Drive PDF cannot be auto-extracted',
      }, { status: 422 });
    } else {
      buffer = await downloadDriveFile(run.source_drive_file_id);
      filename = run.source_filename;
    }
  } else {
    return NextResponse.json({ error: 'file upload or source_drive_file_id is required' }, { status: 400 });
  }

  // Detect whether this is a canonical CSV from the Python normalizer.
  // If so, map columns directly (no XLSX parsing, no alias guessing).
  const fromCanonicalCsv = isCanonicalCsv(buffer);
  const rawRows = fromCanonicalCsv
    ? parseCanonicalCsv(buffer)
    : parseSupplierWorkbook(buffer, filename);

  const rows = normalizeSupplierRows({ runId: run.id, supplier, rows: rawRows, fromCanonicalCsv });
  const now = new Date().toISOString();

  await saveSupplierIntakeRows(run.id, rows);
  await saveSupplierIntakeRun({
    ...run,
    status: 'normalized',
    total_rows: rows.length,
    blocked_rows: rows.filter(r => r.status === 'blocked').length,
    updated_at: now,
  });

  return NextResponse.json({ rows, source: fromCanonicalCsv ? 'python_canonical_csv' : 'xlsx_generic' });
}
