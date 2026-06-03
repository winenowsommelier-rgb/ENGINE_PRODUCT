import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun } from '@/lib/db/client';

export async function GET() {
  return NextResponse.json({ runs: await getSupplierIntakeRuns() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const suppliers = await getSuppliers();
  const supplier = suppliers.find(s => s.id === body.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const now = new Date().toISOString();
  const run = {
    id: `intake-${Date.now()}`,
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    source_filename: String(body.source_filename ?? 'supplier-file.csv'),
    source_format: body.source_format === 'pdf' ? 'pdf' as const : body.source_format === 'google_sheet' ? 'google_sheet' as const : String(body.source_format ?? 'csv').toLowerCase() === 'xlsx' ? 'xlsx' as const : 'csv' as const,
    pricing_structure: supplier.pricing_structure,
    source_bucket_folder_id: body.source_bucket_folder_id ? String(body.source_bucket_folder_id) : supplier.drive_bucket_folder_id,
    source_supplier_folder_id: body.source_supplier_folder_id ? String(body.source_supplier_folder_id) : supplier.drive_folder_id,
    source_month_folder_id: body.source_month_folder_id ? String(body.source_month_folder_id) : undefined,
    source_drive_file_id: body.source_drive_file_id ? String(body.source_drive_file_id) : undefined,
    status: 'registered' as const,
    total_rows: 0,
    approved_rows: 0,
    blocked_rows: 0,
    created_at: now,
    updated_at: now,
    notes: body.notes ? String(body.notes) : undefined,
  };

  await saveSupplierIntakeRun(run);
  return NextResponse.json({ run });
}
