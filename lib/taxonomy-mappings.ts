import { type RawImportRow } from '@/lib/data';

export const requiredUploadFields: Array<keyof RawImportRow> = ['sku', 'name', 'price'];

export const uploadFieldGuide = [
  'Supports Magento-style columns such as sku, name, price, cost, product_type, region, grape, and style.',
  'Unknown columns are ignored during staging, but they are listed back to the operator for review.',
  'Rows are normalized into the self-healing import pipeline before they are staged for the product library.'
] as const;

const incomingHeaderAliases: Record<string, keyof RawImportRow> = {
  sku: 'sku',
  product_sku: 'sku',
  name: 'name',
  product_name: 'name',
  title: 'name',
  category: 'category',
  categories: 'category',
  product_type: 'type',
  type: 'type',
  grape: 'grape',
  varietal: 'grape',
  region: 'region',
  origin_region: 'region',
  style: 'style',
  wine_style: 'style',
  price: 'price',
  base_price: 'price',
  cost: 'costPrice',
  cost_price: 'costPrice',
  currency: 'currency',
  status: 'status',
  oak: 'oak'
};

export type UploadedImportDataset = {
  sourceFile: string;
  rows: RawImportRow[];
  unmappedHeaders: string[];
  missingRequiredFields: Array<keyof RawImportRow>;
  originalRowCount: number;
  mappedRowCount: number;
};

const emptyRow = (): RawImportRow => ({
  sku: '',
  name: '',
  category: 'wine',
  type: '',
  grape: '',
  region: '',
  style: '',
  price: '',
  costPrice: '0',
  currency: 'usd',
  status: 'draft',
  oak: '0'
});

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      currentCell = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function mapMagentoCsvToImportRows(text: string, sourceFile: string): UploadedImportDataset {
  const rows = parseCsvText(text);
  const headers = rows[0] ?? [];
  const normalizedHeaders = headers.map(normalizeHeader);
  const headerMappings = normalizedHeaders.map((header) => incomingHeaderAliases[header]);

  const unmappedHeaders = headers.filter((_, index) => !headerMappings[index]);
  const mappedRows = rows.slice(1).map((cells) => {
    const row = emptyRow();

    headerMappings.forEach((targetField, index) => {
      if (!targetField) {
        return;
      }
      row[targetField] = cells[index] ?? row[targetField];
    });

    if (!row.type && row.category) {
      row.type = row.category;
    }

    return row;
  }).filter((row) => Object.values(row).some((value) => value.trim().length > 0));

  const mappedFields = new Set(headerMappings.filter(Boolean));
  const missingRequiredFields = requiredUploadFields.filter((field) => !mappedFields.has(field));

  return {
    sourceFile,
    rows: mappedRows,
    unmappedHeaders,
    missingRequiredFields,
    originalRowCount: Math.max(rows.length - 1, 0),
    mappedRowCount: mappedRows.length
  };
}
