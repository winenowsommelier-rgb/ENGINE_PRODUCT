import { NextResponse } from 'next/server';
import { addChangelogEntries, appendMappingMemory, getCleanedProducts, getSupplierIntakeRows, getSupplierIntakeRuns, getSuppliers, saveCleanedProduct, saveSupplierIntakeRows, saveSupplierIntakeRun } from '@/lib/db/client';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const [products, rows, runs, suppliers] = await Promise.all([
    getCleanedProducts(),
    getSupplierIntakeRows(params.id),
    getSupplierIntakeRuns(),
    getSuppliers(),
  ]);
  const run = runs.find(r => r.id === params.id);
  const supplier = suppliers.find(s => s.id === run?.supplier_id);
  const supplierCode = supplier?.supplier_code ?? '';

  const approved = rows.filter(row => row.status === 'approved' && row.match?.selected_product_id && row.price);
  const changelogEntries: any[] = [];

  for (const row of approved) {
    const product = products.find(p => p.id === row.match?.selected_product_id || p.sku === row.match?.selected_sku);
    if (!product) continue;

    const oldCost = product.cost ?? product.cost_price ?? null;
    const oldPrice = product.price ?? null;
    const nextCost = row.normalized_payload.cost;
    const nextPrice = row.price!.final_selling_price;

    await saveCleanedProduct({ ...product, cost: nextCost, cost_price: nextCost, price: nextPrice });

    if (String(oldCost ?? '') !== String(nextCost)) {
      changelogEntries.push({ product_id: product.id, sku: product.sku, source: 'supplier_intake', field: 'cost', old_value: oldCost == null ? null : String(oldCost), new_value: String(nextCost), note: `Supplier intake ${params.id} row ${row.row_number}` });
    }

    if (String(oldPrice ?? '') !== String(nextPrice)) {
      changelogEntries.push({ product_id: product.id, sku: product.sku, source: 'supplier_pricing', field: 'price', old_value: oldPrice == null ? null : String(oldPrice), new_value: String(nextPrice), note: `Supplier intake ${params.id} row ${row.row_number}` });
    }
  }

  if (changelogEntries.length > 0) await addChangelogEntries(changelogEntries);

  const now = new Date().toISOString();
  const committedRows = rows.map(row =>
    approved.some(a => a.id === row.id) ? { ...row, status: 'committed' as const } : row
  );
  await saveSupplierIntakeRows(params.id, committedRows);

  if (run) await saveSupplierIntakeRun({ ...run, status: 'committed', updated_at: now });

  // Write approved matches back to mapping memory so future runs hit L1
  if (supplierCode) {
    const memoryEntries = approved
      .filter(row => row.normalized_payload.supplier_item_code && row.match?.selected_sku)
      .map(row => ({
        supplier_code: supplierCode,
        supplier_item_code: row.normalized_payload.supplier_item_code!,
        current_sku: row.match!.selected_sku!,
        approval_status: 'human_confirmed',
        vintage_locked: false,
        brand: row.normalized_payload.brand,
        bottle_size: row.normalized_payload.bottle_size,
        vintage: row.normalized_payload.vintage,
      }));
    await appendMappingMemory(memoryEntries);
  }

  return NextResponse.json({ committed: approved.length, changelog_entries: changelogEntries.length, memory_entries_written: approved.filter(r => r.normalized_payload.supplier_item_code).length });
}
