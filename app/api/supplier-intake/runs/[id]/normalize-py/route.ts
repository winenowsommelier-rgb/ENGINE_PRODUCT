import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { isCanonicalCsv, normalizeSupplierRows, parseCanonicalCsv } from '@/lib/supplier-intake/normalization';
import { downloadDriveFile, exportGoogleSheetAsXlsx } from '@/lib/supplier-intake/google-drive';
import { SUPPLIER_DEFAULT_PROFILE } from '@/lib/supplier-intake/normalizer-profiles';

const execFileAsync = promisify(execFile);

// Path to the Python normalizer script and the venv interpreter
const PYTHON_SCRIPT = join(process.cwd(), 'data/supplier-intake/normalizers/normalize_supplier_file.py');
const PYTHON_BIN = join(process.cwd(), '.venv/bin/python');

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  // Resolve which Python profile to use for this supplier
  const profile = SUPPLIER_DEFAULT_PROFILE[supplier.supplier_code];
  if (!profile) {
    return NextResponse.json({
      error: `No Python normalizer profile registered for supplier code ${supplier.supplier_code}. ` +
        'Add it to lib/supplier-intake/normalizer-profiles.ts or use the generic normalize endpoint.',
    }, { status: 422 });
  }

  if (profile.endsWith('_pdf')) {
    return NextResponse.json({
      error: `Supplier ${supplier.supplier_code} uses PDF files which require manual extraction. ` +
        'Upload a pre-normalized CSV instead.',
    }, { status: 422 });
  }

  // Download source file from Drive
  if (!run.source_drive_file_id) {
    return NextResponse.json({ error: 'source_drive_file_id is required for Python normalization' }, { status: 400 });
  }

  let fileBuffer: Buffer;
  let ext: string;
  try {
    if (run.source_format === 'google_sheet') {
      fileBuffer = await exportGoogleSheetAsXlsx(run.source_drive_file_id);
      ext = '.xlsx';
    } else {
      fileBuffer = await downloadDriveFile(run.source_drive_file_id);
      ext = run.source_filename.toLowerCase().endsWith('.csv') ? '.csv' : '.xlsx';
    }
  } catch (err) {
    return NextResponse.json({ error: `Drive download failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  // Write to a temp file for Python to read
  const tmpInput = join(tmpdir(), `si-${run.id}-input${ext}`);
  const tmpOutput = join(tmpdir(), `si-${run.id}-output.csv`);
  try {
    await writeFile(tmpInput, fileBuffer);

    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [
      PYTHON_SCRIPT,
      '--profile', profile,
      '--input-file', tmpInput,
      '--supplier-code', supplier.supplier_code,
      '--batch-id', run.id,
      '--source-file-id', run.source_drive_file_id ?? '',
    ], { maxBuffer: 50 * 1024 * 1024 }); // 50MB max output

    const csvBuffer = Buffer.from(stdout, 'utf-8');

    if (!isCanonicalCsv(csvBuffer)) {
      return NextResponse.json({
        error: 'Python normalizer produced unexpected output (not canonical CSV)',
        stderr: stderr.slice(0, 500),
      }, { status: 500 });
    }

    const rawRows = parseCanonicalCsv(csvBuffer);
    const rows = normalizeSupplierRows({ runId: run.id, supplier, rows: rawRows, fromCanonicalCsv: true });
    const now = new Date().toISOString();

    await saveSupplierIntakeRows(run.id, rows);
    await saveSupplierIntakeRun({
      ...run,
      status: 'normalized',
      total_rows: rows.length,
      blocked_rows: rows.filter(r => r.status === 'blocked').length,
      updated_at: now,
    });

    return NextResponse.json({
      rows,
      source: 'python_normalizer',
      profile,
      stderr_info: stderr.slice(0, 500),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Python normalization failed: ${msg}` }, { status: 500 });
  } finally {
    // Clean up temp files regardless of success/failure
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpOutput).catch(() => {});
  }
}
