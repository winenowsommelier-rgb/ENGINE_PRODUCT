/**
 * lib/taxonomy/maps.ts
 * Flat taxonomy maps and CSV upload utilities.
 * Consolidated from: lib/taxonomy.ts + lib/taxonomy-mappings.ts
 */

import { type RawImportRow } from '@/lib/data';
import countriesJson from '@/data/taxonomy/countries.json';
import regionsJson from '@/data/taxonomy/regions.json';
import ingredientMasterJson from '@/data/taxonomy/ingredient_master.json';

// ─── Types from taxonomy.ts ───────────────────────────────────────────────────

export type TaxonomySheet = {
  name: string;
  purpose: string;
};

export type TaxonomyCountry = {
  id: number;
  name: string;
  iso: string;
};

export type TaxonomyAuditIssue = {
  severity: 'warning' | 'info';
  area: string;
  message: string;
  recommendation: string;
};

export const taxonomySheets: TaxonomySheet[] = [
  { name: 'countries', purpose: 'Canonical origin-country lookup with IDs and ISO codes.' },
  { name: 'regions', purpose: 'Primary regional taxonomy used for origin and merchandising filters.' },
  { name: 'subregions', purpose: 'Nested appellations or secondary location groupings.' },
  { name: 'Origin', purpose: 'Origin-facing mapping layer that should be aligned with regions/countries.' },
  { name: 'classification_master', purpose: 'Product classification and taxonomy control rules.' },
  { name: 'ingredient_master', purpose: 'Controlled ingredient vocabulary for products and blends.' },
  { name: 'flavor_note_master', purpose: 'Approved tasting-note vocabulary for enrichment and rendering.' },
  { name: 'category_render_config', purpose: 'UI/render configuration by product category.' },
  { name: 'expert_sources', purpose: 'External validation references and citation sources.' },
  { name: 'Magento item data', purpose: 'Commerce/export-oriented column mapping layer.' }
];

export const taxonomyCountries: TaxonomyCountry[] = [
  { id: 1, name: 'France', iso: 'FR' },
  { id: 2, name: 'Italy', iso: 'IT' },
  { id: 3, name: 'Spain', iso: 'ES' },
  { id: 4, name: 'Germany', iso: 'DE' },
  { id: 5, name: 'Portugal', iso: 'PT' },
  { id: 6, name: 'USA', iso: 'US' },
  { id: 7, name: 'Chile', iso: 'CL' },
  { id: 8, name: 'Argentina', iso: 'AR' },
  { id: 9, name: 'Australia', iso: 'AU' },
  { id: 10, name: 'New Zealand', iso: 'NZ' },
  { id: 11, name: 'South Africa', iso: 'ZA' },
  { id: 12, name: 'Austria', iso: 'AT' },
  { id: 13, name: 'Greece', iso: 'GR' },
  { id: 14, name: 'Hungary', iso: 'HU' },
  { id: 15, name: 'Canada', iso: 'CA' },
  { id: 16, name: 'Japan', iso: 'JP' },
  { id: 17, name: 'Mexico', iso: 'MX' },
  { id: 18, name: 'Scotland', iso: 'GB-SCT' },
  { id: 19, name: 'Ireland', iso: 'IE' },
  { id: 20, name: 'China', iso: 'CN' },
  { id: 21, name: 'England', iso: 'GB-ENG' },
  { id: 22, name: 'Brazil', iso: 'BR' },
  { id: 23, name: 'Uruguay', iso: 'UY' },
  { id: 24, name: 'Lebanon', iso: 'LB' },
  { id: 25, name: 'Israel', iso: 'IL' },
  { id: 26, name: 'Georgia', iso: 'GE' },
  { id: 27, name: 'Thailand', iso: 'TH' },
  { id: 28, name: 'Other (N/A)', iso: 'NA' }
];

export const taxonomyAuditIssues: TaxonomyAuditIssue[] = [
  {
    severity: 'warning',
    area: 'Tab naming',
    message: 'The workbook mixes snake_case tabs with human-readable names such as Origin and Magento item data.',
    recommendation: 'Standardize tab slugs, or add a sheet registry with stable machine keys and display labels.'
  },
  {
    severity: 'warning',
    area: 'Country row formatting',
    message: 'The visible countries tab renders the final entry as Other (N/A)NA, which suggests a missing delimiter between the label and ISO value.',
    recommendation: 'Normalize that record to name = Other (N/A) and iso = NA before importing.'
  },
  {
    severity: 'info',
    area: 'ISO strategy',
    message: 'Most country codes are ISO alpha-2, but Scotland and England use sub-national ISO forms (GB-SCT and GB-ENG).',
    recommendation: 'Keep an explicit geography level field so country and constituent-country records validate predictably.'
  }
];

export const knownRegionCountryMap: Record<string, string> = {
  'Napa Valley': 'USA',
  Marlborough: 'New Zealand',
  'Willamette Valley': 'USA',
  'Jalisco Highlands': 'Mexico'
};

export const knownRegionAliases: Record<string, string> = {
  napa: 'Napa Valley',
  'napa valley': 'Napa Valley',
  marlboro: 'Marlborough',
  marlborough: 'Marlborough',
  willamette: 'Willamette Valley',
  'willamette valley': 'Willamette Valley',
  jalisco: 'Jalisco Highlands',
  'jalisco highlands': 'Jalisco Highlands'
};

export const knownGrapeAliases: Record<string, string> = {
  'cab sauv': 'Cabernet Sauvignon',
  cabernet: 'Cabernet Sauvignon',
  'cabernet sauvignon': 'Cabernet Sauvignon',
  'sauv blanc': 'Sauvignon Blanc',
  'sauvignon blanc': 'Sauvignon Blanc',
  'pinot noir': 'Pinot Noir',
  agave: 'Blue Weber Agave',
  'blue weber agave': 'Blue Weber Agave'
};

export const knownStyleAliases: Record<string, string> = {
  'structured oak aged': 'Structured & Oak-Aged',
  'structured & oak-aged': 'Structured & Oak-Aged',
  'crisp aromatic': 'Crisp & Aromatic',
  'crisp & aromatic': 'Crisp & Aromatic',
  'elegant earthy': 'Elegant & Earthy',
  'elegant & earthy': 'Elegant & Earthy',
  'barrel rested': 'Barrel Rested'
};

// ─── Types from taxonomy-mappings.ts ─────────────────────────────────────────

export type CountryRecord = { id: number; name: string; iso: string };
export type RegionRecord = { id: number; country_id: number; name: string; [key: string]: unknown };
export type IngredientRecord = { ingredient_id: number; ingredient: string; synonyms?: string | null };

const _countries: CountryRecord[] = (countriesJson.data ?? []) as CountryRecord[];
const _regions: RegionRecord[] = (regionsJson.data ?? []) as RegionRecord[];
const _ingredients: IngredientRecord[] = (ingredientMasterJson.data ?? []) as IngredientRecord[];

export const countryIsoMap: Record<string, string> = _countries.reduce((acc, row) => {
  if (row.name && row.iso) acc[row.name.trim()] = row.iso.trim();
  return acc;
}, {} as Record<string, string>);

const _countryById = _countries.reduce((acc, row) => {
  if (row.id != null) acc[row.id] = row.name;
  return acc;
}, {} as Record<number, string>);

export const regionCountryMap: Record<string, string> = _regions.reduce((acc, row) => {
  const region = String(row.name ?? '').trim();
  const country = row.country_id != null ? _countryById[row.country_id as number] : undefined;
  if (region && country) acc[region] = country;
  return acc;
}, {} as Record<string, string>);

export const grapeAliasMap: Record<string, string> = _ingredients.reduce((acc, row) => {
  const canonical = String(row.ingredient ?? '').trim();
  const synonyms = String(row.synonyms ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const alias of [canonical, ...synonyms]) {
    const key = alias.toLowerCase();
    if (key) acc[key] = canonical;
  }
  return acc;
}, {} as Record<string, string>);

export const taxonomyMappings = {
  countryIsoMap,
  regionCountryMap,
  grapeAliasMap
};

// ─── CSV upload utilities ─────────────────────────────────────────────────────

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
