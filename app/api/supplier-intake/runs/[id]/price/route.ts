import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows, getSupplierIntakeRuns, getSuppliers, saveSupplierIntakeRun, saveSupplierIntakeRows } from '@/lib/db/client';
import { calculateSupplierPrice } from '@/lib/supplier-intake/pricing';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const supplier = (await getSuppliers()).find(s => s.id === run.supplier_id);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows(run.id);
  const nextRows = rows.map(row => {
    if (row.status === 'blocked') return row;
    const product = products.find(p => p.id === row.match?.selected_product_id || p.sku === row.match?.selected_sku);
    const price = calculateSupplierPrice({
      cost: row.normalized_payload.cost,
      supplierRsp: row.normalized_payload.rsp,
      currentWebsitePrice: product?.price,
      rule: supplier.pricing_rule,
    });
    return { ...row, price, status: price.status === 'blocked' ? 'blocked' as const : 'priced' as const, issues: [...row.issues, ...price.issues] };
  });

  await saveSupplierIntakeRows(run.id, nextRows);
  await saveSupplierIntakeRun({ ...run, status: 'priced', blocked_rows: nextRows.filter(r => r.status === 'blocked').length, updated_at: new Date().toISOString() });
  return NextResponse.json({ rows: nextRows });
}
