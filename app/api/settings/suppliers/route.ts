import { NextRequest, NextResponse } from 'next/server';
import { getSuppliers, saveSupplier } from '@/lib/db/client';

export async function GET() {
  return NextResponse.json({ suppliers: await getSuppliers() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.supplier_code) {
    return NextResponse.json({ error: 'name and supplier_code are required' }, { status: 400 });
  }

  await saveSupplier({
    id: body.id,
    name: String(body.name).trim(),
    supplier_code: String(body.supplier_code).trim().toUpperCase(),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    pricing_structure: body.pricing_structure ?? 'no_rsp_price',
    drive_bucket_folder_id: body.drive_bucket_folder_id ? String(body.drive_bucket_folder_id).trim() : undefined,
    drive_folder_id: body.drive_folder_id ? String(body.drive_folder_id).trim() : undefined,
    allowed_formats: Array.isArray(body.allowed_formats) ? (body.allowed_formats as any) : ['csv', 'xlsx', 'google_sheet', 'pdf'],
    default_currency: body.default_currency ? String(body.default_currency).trim().toUpperCase() : 'THB',
    pricing_rule: body.pricing_rule ?? {
      mode: 'hybrid',
      target_margin_pct: 35,
      minimum_margin_pct: 25,
      vat_pct: 0,
      rounding: 'nearest_10',
      review_price_change_pct: 20,
    },
  });

  return NextResponse.json({ ok: true });
}
