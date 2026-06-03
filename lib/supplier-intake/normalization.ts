import * as XLSX from 'xlsx';
import type { SupplierDefinition, SupplierNormalizedRow } from './types';

function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pick(row: Record<string, unknown>, names: string[]): unknown {
  const lowered = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const name of names) {
    const value = lowered[name.toLowerCase()];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function parseSupplierWorkbook(buffer: Buffer, filename: string): Record<string, unknown>[] {
  if (filename.toLowerCase().endsWith('.csv')) {
    const workbook = XLSX.read(buffer.toString('utf-8'), { type: 'string' });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}

export function normalizeSupplierRows(input: {
  runId: string;
  supplier: SupplierDefinition;
  rows: Record<string, unknown>[];
}): SupplierNormalizedRow[] {
  return input.rows.map((row, index) => {
    const cost = cleanNumber(pick(row, ['cost', 'cost price', 'net cost', 'buy price', 'wholesale price']));
    const rsp = cleanNumber(pick(row, ['rsp', 'rrp', 'retail suggest price', 'retail suggested price', 'suggested retail price']));
    const name = String(pick(row, ['name', 'product name', 'item name', 'description']) ?? '').trim();
    const issues: string[] = [];

    if (!name) issues.push('Missing product name');
    if (!cost || cost <= 0) issues.push('Missing valid cost');

    return {
      id: `${input.runId}-${index + 1}`,
      run_id: input.runId,
      row_number: index + 1,
      raw_payload: row,
      normalized_payload: {
        supplier_item_code: String(pick(row, ['supplier item code', 'item code', 'code']) ?? '').trim() || undefined,
        sku: String(pick(row, ['sku', 'product code']) ?? '').trim() || undefined,
        barcode: String(pick(row, ['barcode', 'ean', 'upc']) ?? '').trim() || undefined,
        name,
        brand: String(pick(row, ['brand', 'producer']) ?? '').trim() || undefined,
        category: String(pick(row, ['category', 'type']) ?? '').trim() || undefined,
        bottle_size: String(pick(row, ['size', 'bottle size', 'volume']) ?? '').trim() || undefined,
        vintage: String(pick(row, ['vintage', 'year']) ?? '').trim() || undefined,
        country: String(pick(row, ['country', 'origin country']) ?? '').trim() || undefined,
        region: String(pick(row, ['region']) ?? '').trim() || undefined,
        cost: cost ?? 0,
        rsp,
        currency: input.supplier.default_currency,
      },
      status: issues.length ? 'blocked' : 'pending',
      issues,
    };
  });
}
