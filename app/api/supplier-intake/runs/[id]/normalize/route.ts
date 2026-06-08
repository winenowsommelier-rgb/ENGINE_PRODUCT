import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { normalizeSupplierRows, parseSupplierWorkbook } from '@/lib/supplier-intake/normalization';
import { downloadDriveFile, exportGoogleSheetAsXlsx } from '@/lib/supplier-intake/google-drive';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ct = req.headers.get('content-type') ?? '';
  let uploadedFile: File | null = null;
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    uploadedFile = form.get('file') as File | null;
  }

  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  let buffer: Buffer;
  let filename: string;

  if (uploadedFile instanceof File) {
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

  const rawRows = parseSupplierWorkbook(buffer, filename);
  const rows = normalizeSupplierRows({ runId: run.id, supplier, rows: rawRows });

  await saveSupplierIntakeRows(run.id, rows);
  await saveSupplierIntakeRun({ ...run, status: 'normalized', total_rows: rows.length, blocked_rows: rows.filter(r => r.status === 'blocked').length, updated_at: new Date().toISOString() });

  return NextResponse.json({ rows });
}
