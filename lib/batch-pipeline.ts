import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import { type ProductRecord, type RawImportRow } from '@/lib/data';
import {
  knownGrapeAliases,
  knownRegionAliases,
  knownRegionCountryMap,
  knownStyleAliases,
  taxonomyCountries
} from '@/lib/taxonomy';

export type PipelineStage = {
  name: string;
  outcome: string;
  status: 'complete' | 'attention' | 'queued';
};

export type Correction = {
  field: string;
  from: string;
  to: string;
  reason: string;
};

export type ValidationIssue = {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
};

export type ProcessedImportRow = {
  original: RawImportRow;
  normalized: ProductRecord;
  corrections: Correction[];
  issues: ValidationIssue[];
  confidence: number;
};

export type BatchProcessingResult = {
  stages: PipelineStage[];
  rows: ProcessedImportRow[];
  summary: {
    totalRows: number;
    autoCorrected: number;
    readyToImport: number;
    blocked: number;
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const compact = (value: string) => value.trim().replace(/\s+/g, ' ');
const keyify = (value: string) => compact(value).toLowerCase();
const titleCase = (value: string) => compact(value).replace(/\b\w/g, (match) => match.toUpperCase());

function addCorrection(corrections: Correction[], field: string, from: string, to: string, reason: string) {
  if (from !== to) {
    corrections.push({ field, from, to, reason });
  }
}

function normalizeCategory(value: string, corrections: Correction[]): ProductRecord['category'] {
  const from = compact(value);
  const normalized = keyify(value).includes('spirit') ? 'Spirits' : 'Wine';
  addCorrection(corrections, 'category', from, normalized, 'Normalized category to supported product family.');
  return normalized;
}

function normalizeStatus(value: string, corrections: Correction[]): ProductRecord['status'] {
  const from = compact(value);
  const normalized = keyify(value) === 'ready' ? 'Ready' : keyify(value).includes('review') ? 'Needs review' : 'Draft';
  addCorrection(corrections, 'status', from, normalized, 'Normalized workflow status.');
  return normalized;
}

function normalizeCurrency(value: string, corrections: Correction[]): string {
  const from = compact(value);
  const normalized = from ? from.toUpperCase() : 'USD';
  addCorrection(corrections, 'currency', from, normalized, 'Uppercased currency code and defaulted blank values to USD.');
  return normalized;
}

function normalizeAlias(value: string, aliases: Record<string, string>, field: string, corrections: Correction[]): string {
  const from = compact(value);
  const normalized = aliases[keyify(value)] ?? titleCase(from);
  addCorrection(corrections, field, from, normalized, 'Mapped alias to canonical taxonomy value.');
  return normalized;
}

function parseMoney(field: string, value: string, corrections: Correction[], issues: ValidationIssue[]): number {
  const from = compact(value);
  const parsed = Number(from);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({ severity: 'error', field, message: `${field} must be a non-negative number.` });
    return 0;
  }
  const normalized = Number(parsed.toFixed(2));
  addCorrection(corrections, field, from, String(normalized), 'Coerced numeric text into a decimal value.');
  return normalized;
}

function parseScore(field: string, value: string, corrections: Correction[], issues: ValidationIssue[]): number {
  const from = compact(value);
  const parsed = Number(from);
  if (!Number.isFinite(parsed)) {
    issues.push({ severity: 'warning', field, message: `${field} was blank or invalid; defaulted to 0.` });
    addCorrection(corrections, field, from, '0', 'Invalid sensory value defaulted to zero.');
    return 0;
  }
  const normalized = clamp(parsed, 0, 5);
  addCorrection(corrections, field, from, String(normalized), 'Clamped sensory score into the required 0-5 range.');
  return normalized;
}

function inferCountry(region: string, issues: ValidationIssue[]): string | undefined {
  const country = knownRegionCountryMap[region];
  if (!country) {
    issues.push({ severity: 'warning', field: 'country', message: 'Unable to infer country from region. Add a taxonomy mapping before import.' });
  }
  return country;
}

function validateCountry(country: string | undefined, issues: ValidationIssue[]) {
  if (!country) {
    return;
  }
  if (!taxonomyCountries.some((entry) => entry.name === country)) {
    issues.push({ severity: 'warning', field: 'country', message: `Country ${country} is not present in the visible countries taxonomy.` });
  }
}

function normalizeRow(row: RawImportRow): ProcessedImportRow {
  const corrections: Correction[] = [];
  const issues: ValidationIssue[] = [];

  const sku = compact(row.sku).toUpperCase();
  addCorrection(corrections, 'sku', row.sku, sku, 'Trimmed whitespace and uppercased the SKU.');
  if (!sku) {
    issues.push({ severity: 'error', field: 'sku', message: 'SKU is required for batch import.' });
  }

  const category = normalizeCategory(row.category, corrections);
  const normalized: ProductRecord = {
    sku,
    name: compact(row.name),
    category,
    type: titleCase(row.type),
    grape: normalizeAlias(row.grape, knownGrapeAliases, 'grape', corrections),
    region: normalizeAlias(row.region, knownRegionAliases, 'region', corrections),
    style: normalizeAlias(row.style, knownStyleAliases, 'style', corrections),
    price: parseMoney('price', row.price, corrections, issues),
    costPrice: parseMoney('costPrice', row.costPrice, corrections, issues),
    currency: normalizeCurrency(row.currency, corrections),
    status: normalizeStatus(row.status, corrections),
    oak: parseScore('oak', row.oak, corrections, issues)
  };

  normalized.country = inferCountry(normalized.region, issues);
  validateCountry(normalized.country, issues);

  if (!normalized.name) {
    issues.push({ severity: 'error', field: 'name', message: 'Name is required for rendering and export.' });
  }
  if (normalized.price <= 0) {
    issues.push({ severity: 'error', field: 'price', message: 'Price must be greater than zero.' });
  }

  const confidence = calculateConfidence(normalized);
  if (confidence < 3.5) {
    issues.push({ severity: 'warning', field: 'confidence', message: 'Row remains below the confidence threshold and should be reviewed.' });
  } else {
    issues.push({ severity: 'info', field: 'confidence', message: 'Confidence meets the auto-import threshold.' });
  }

  return {
    original: row,
    normalized,
    corrections,
    issues,
    confidence
  };
}

export function runBatchProcessing(rows: RawImportRow[]): BatchProcessingResult {
  const processedRows = rows.map(normalizeRow);
  const blocked = processedRows.filter((row) => row.issues.some((issue) => issue.severity === 'error')).length;
  const autoCorrected = processedRows.filter((row) => row.corrections.length > 0).length;
  const readyToImport = processedRows.length - blocked;
  const enriched = processedRows.filter((row) => buildFlavorProfile(row.normalized).intensity > 0).length;

  return {
    stages: [
      {
        name: 'Validate required columns',
        outcome: blocked === 0 ? 'All rows contain the minimum required identifiers for processing.' : `${blocked} rows are blocked by required-field errors.`,
        status: blocked === 0 ? 'complete' : 'attention'
      },
      {
        name: 'Self-heal taxonomy values',
        outcome: `${autoCorrected} rows received automated corrections for SKU casing, aliases, or score clamping.`,
        status: autoCorrected > 0 ? 'complete' : 'queued'
      },
      {
        name: 'Apply DNA engine',
        outcome: `${enriched} normalized rows can be enriched using grape DNA, style DNA, and regional modifiers.`,
        status: 'complete'
      },
      {
        name: 'Validate render payload',
        outcome: `${readyToImport} rows remain eligible for UI rendering/export after validation.`,
        status: blocked > 0 ? 'attention' : 'complete'
      },
      {
        name: 'Export to Magento / CSV / XLSX',
        outcome: 'Only approved rows should proceed into final export bundles.',
        status: readyToImport > 0 ? 'queued' : 'attention'
      }
    ],
    rows: processedRows,
    summary: {
      totalRows: processedRows.length,
      autoCorrected,
      readyToImport,
      blocked
    }
  };
}
