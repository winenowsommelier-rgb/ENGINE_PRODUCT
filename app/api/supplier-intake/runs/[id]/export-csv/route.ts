import { NextRequest, NextResponse } from 'next/server';
import { getSupplierIntakeRows } from '@/lib/db/client';

function csvEscape(value: string | number | undefined): string {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const rows = await getSupplierIntakeRows(params.id);

  const header = [
    'row_number',
    'supplier_item_code',
    'name',
    'matched_sku',
    'match_confidence',
    'match_status',
    'cost',
    'supplier_rsp',
    'calculated_price',
    'final_selling_price',
    'margin_pct',
    'price_status',
    'issues',
  ];

  const lines = [header.join(',')];

  for (const row of rows) {
    const p = row.normalized_payload;
    const m = row.match;
    const pr = row.price;
    const values = [
      row.row_number,
      p.supplier_item_code ?? '',
      p.name,
      m?.selected_sku ?? '',
      m?.confidence ?? '',
      m?.status ?? '',
      p.cost,
      p.rsp ?? '',
      pr?.calculated_price ?? '',
      pr?.final_selling_price ?? '',
      pr?.margin_pct ?? '',
      pr?.status ?? row.status,
      (row.issues ?? []).join(' | '),
    ];
    lines.push(values.map(csvEscape).join(','));
  }

  const csv = lines.join('\n');
  const headers = new Headers();
  headers.set('Content-Type', 'text/csv');
  headers.set('Content-Disposition', `attachment; filename="intake-${params.id}-review.csv"`);
  return new NextResponse(csv, { headers });
}
