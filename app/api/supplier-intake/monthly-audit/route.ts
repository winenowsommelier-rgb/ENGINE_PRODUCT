import { NextResponse } from 'next/server';
import { getCleanedProducts, getSupplierIntakeRows } from '@/lib/db/client';

export async function POST() {
  const products = await getCleanedProducts();
  const rows = await getSupplierIntakeRows();
  const issues: Array<{ severity: 'critical' | 'warning' | 'info'; sku?: string; message: string }> = [];

  const skuCounts = new Map<string, number>();
  for (const product of products) {
    if (product.sku) skuCounts.set(product.sku, (skuCounts.get(product.sku) ?? 0) + 1);
    if (product.price && (product.cost ?? product.cost_price) && product.price <= (product.cost ?? product.cost_price)) {
      issues.push({ severity: 'critical', sku: product.sku, message: 'Selling price is not above cost' });
    }
    if (!product.validation_status || product.validation_status !== 'validated') {
      issues.push({ severity: 'warning', sku: product.sku, message: 'Product is not validated' });
    }
  }

  for (const [sku, count] of skuCounts.entries()) {
    if (count > 1) issues.push({ severity: 'critical', sku, message: `Duplicate SKU appears ${count} times` });
  }

  const uncommittedApproved = rows.filter(row => row.status === 'approved');
  for (const row of uncommittedApproved) {
    issues.push({ severity: 'warning', message: `Approved supplier intake row not committed: ${row.run_id} row ${row.row_number}` });
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    total_issues: issues.length,
    issues,
  });
}
