import * as XLSX from 'xlsx';
import type { SupplierDefinition, SupplierNormalizedRow } from './types';

// Canonical CSV header written by normalize_supplier_file.py.
// If an uploaded CSV has this header we skip XLSX parsing entirely and
// map columns directly — this is the Python-normalizer output path.
const CANONICAL_CSV_MARKER = 'intake_batch_id';

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

function str(v: unknown): string {
  return String(v ?? '').trim();
}

// ── CSV detection ────────────────────────────────────────────────────────────

export function isCanonicalCsv(buffer: Buffer): boolean {
  return buffer.slice(0, 256).toString('utf-8').startsWith(CANONICAL_CSV_MARKER);
}

// ── Parsers ──────────────────────────────────────────────────────────────────

export function parseSupplierWorkbook(buffer: Buffer, filename: string): Record<string, unknown>[] {
  if (filename.toLowerCase().endsWith('.csv')) {
    const workbook = XLSX.read(buffer.toString('utf-8'), { type: 'string' });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}

// Parse a CSV produced by normalize_supplier_file.py into the canonical rows
// shape expected by normalizeSupplierRows().
export function parseCanonicalCsv(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer.toString('utf-8'), { type: 'string' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}

// ── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeSupplierRows(input: {
  runId: string;
  supplier: SupplierDefinition;
  rows: Record<string, unknown>[];
  fromCanonicalCsv?: boolean;
}): SupplierNormalizedRow[] {
  return input.rows
    .filter(row => {
      // Drop the PDF warning stub row emitted by the Python script
      const name = str(row['product_name'] ?? row['name'] ?? pick(row, ['name', 'product name', 'item name', 'description']));
      return !name.startsWith('[PDF source');
    })
    .map((row, index) => {
      const isPython = input.fromCanonicalCsv === true;

      // ── Field extraction ────────────────────────────────────────────────
      // Python canonical CSV columns map directly; generic XLSX uses pick().
      const name = isPython
        ? str(row['product_name'])
        : str(pick(row, ['name', 'product name', 'item name', 'description']));

      // cost: Python supplies supplier_cost (ex-VAT) or cost_ex_vat
      const cost = isPython
        ? (cleanNumber(row['supplier_cost']) ?? cleanNumber(row['cost_ex_vat']))
        : cleanNumber(pick(row, ['cost', 'cost price', 'net cost', 'buy price', 'wholesale price', 'supplier_cost', 'cost_ex_vat']));

      const rsp = isPython
        ? cleanNumber(row['rsp_price'])
        : cleanNumber(pick(row, ['rsp', 'rsp_price', 'rrp', 'retail suggest price', 'retail suggested price', 'suggested retail price']));

      const supplierItemCode = isPython
        ? str(row['supplier_item_code'])
        : str(pick(row, ['supplier item code', 'supplier_item_code', 'item code', 'code']));

      const brand = isPython ? str(row['brand']) : str(pick(row, ['brand', 'producer']));
      const category = isPython ? str(row['category']) : str(pick(row, ['category', 'type']));
      const country = isPython ? str(row['country']) : str(pick(row, ['country', 'origin country']));
      const region = isPython ? str(row['region']) : str(pick(row, ['region']));
      const vintage = isPython ? str(row['vintage']) : str(pick(row, ['vintage', 'year']));
      const barcode = isPython ? str(row['barcode']) : str(pick(row, ['barcode', 'ean', 'upc']));

      // volume_ml from Python → convert to bottle_size string e.g. "750ml"
      const volumeMl = isPython ? cleanNumber(row['volume_ml']) : undefined;
      const bottleSize = volumeMl
        ? `${volumeMl}ml`
        : str(pick(row, ['size', 'bottle size', 'volume', 'volume_ml'])) || undefined;

      // parse_confidence from Python
      const parseConf = isPython ? str(row['parse_confidence']) : '';
      const needsReview = isPython
        ? (String(row['needs_human_review']).toLowerCase() === 'true')
        : false;
      const pythonIssues = isPython
        ? (str(row['validation_errors']).split('|').filter(Boolean))
        : [];

      // ── Validation ──────────────────────────────────────────────────────
      const issues: string[] = [...pythonIssues];
      if (!name) issues.push('missing_product_name');
      if (!cost || cost <= 0) issues.push('missing_valid_cost');

      // ── Row status ──────────────────────────────────────────────────────
      const blocked = issues.some(i =>
        i.includes('missing_product_name') || i.includes('missing_valid_cost') || i.includes('pdf_source')
      );

      return {
        id: `${input.runId}-${index + 1}`,
        run_id: input.runId,
        row_number: index + 1,
        raw_payload: row,
        normalized_payload: {
          supplier_item_code: supplierItemCode || undefined,
          sku: str(pick(row, ['sku', 'matched_sku', 'product code'])) || undefined,
          barcode: barcode || undefined,
          name,
          brand: brand || undefined,
          category: category || undefined,
          bottle_size: bottleSize,
          vintage: vintage || undefined,
          country: country || undefined,
          region: region || undefined,
          cost: cost ?? 0,
          rsp,
          currency: input.supplier.default_currency,
        },
        status: blocked ? 'blocked' : (needsReview ? 'matched_needs_review' : 'pending'),
        issues,
      };
    });
}
