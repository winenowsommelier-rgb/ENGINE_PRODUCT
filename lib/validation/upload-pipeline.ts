// lib/validation/upload-pipeline.ts
//
// Server-side orchestrator for the "drop a supplier CSV → get a validated CSV"
// flow used by the /validate page.
//
// It reuses the existing pieces rather than reinventing them:
//   - lib/validation/engine.ts   → field normalization (brand/vintage/grape/geo)
//   - lib/taxonomy/service.ts     → canonical country/region/subregion resolution
//   - data/db/products.json       → match each supplier item to an existing product
//
// Per the agreed design:
//   - name normalization = match to an existing product first; compose only if no match
//   - validate brand (not producer; producer is unpopulated in the product schema)
//   - unknown taxonomy is NEVER auto-written here — it becomes an evidence-backed
//     proposal for the human-approved taxonomy_proposals queue.

import { readFileSync } from 'fs';
import { join } from 'path';
import { runPipeline } from './engine';
import {
  resolveCountry,
  resolveRegion,
  getSubregionsByRegion,
  countryById,
} from '../taxonomy/service';
import type { TaxonomyProposal } from './types';

// ── Text folding for accent/case-insensitive matching ────────────────────────
export function fold(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Supplier column detection (suppliers all name columns differently) ────────
const COLUMN_ALIASES: Record<string, string[]> = {
  sku: ['sku', 'sku_1', 'item code', 'item_code', 'code', 'product code', 'productcode'],
  name: ['name', 'item name', 'item_name', 'product name', 'product', 'title', 'description'],
  brand: ['brand', 'winery', 'producer', 'maker', 'house'],
  country: ['country', 'country_name', 'origin country', 'origin_country', 'nation'],
  region: ['region', 'region_wine', 'region_wine_1', 'wine region', 'province'],
  subregion: ['subregion', 'sub_region', 'sub region', 'sub-region', 'subzone', 'sub zone'],
  classification: ['classification', 'type', 'wine_type', 'liquor_main_type', 'category'],
  grape_variety: ['grape_variety', 'grape', 'grape_class', 'varietal', 'variety'],
  vintage: ['vintage', 'year'],
  price: ['price', 'srp', 'retail'],
};

function normHeader(h: string): string {
  return String(h).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectColumns(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normed = headers.map((h) => ({ orig: h, norm: normHeader(h) }));
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const aliasNorms = new Set(aliases.map(normHeader));
    const hit = normed.find((h) => aliasNorms.has(h.norm));
    if (hit) mapping[field] = hit.orig;
  }
  return mapping;
}

// ── Existing-product index (for name normalization by match) ──────────────────
type ProductLite = {
  sku: string;
  name: string;
  brand: string;
  country: string;
  region: string;
  subregion: string;
};

let _productIndex: {
  bySku: Map<string, ProductLite>;
  byName: Map<string, ProductLite>;
  byTokens: Array<{ tokens: Set<string>; brandFold: string; product: ProductLite }>;
  brandSet: Set<string>;
} | null = null;

function tokenize(s: string): Set<string> {
  return new Set(
    fold(s)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

function loadProductIndex() {
  if (_productIndex) return _productIndex;
  const path = join(process.cwd(), 'data', 'db', 'products.json');
  const products = JSON.parse(readFileSync(path, 'utf-8')) as Array<Record<string, any>>;

  const bySku = new Map<string, ProductLite>();
  const byName = new Map<string, ProductLite>();
  const byTokens: Array<{ tokens: Set<string>; brandFold: string; product: ProductLite }> = [];
  const brandSet = new Set<string>();

  for (const p of products) {
    const lite: ProductLite = {
      sku: String(p.sku ?? ''),
      name: String(p.name ?? ''),
      brand: String(p.brand ?? ''),
      country: String(p.country ?? ''),
      region: String(p.region ?? ''),
      subregion: String(p.subregion ?? ''),
    };
    if (lite.sku) bySku.set(fold(lite.sku), lite);
    if (lite.name) byName.set(fold(lite.name), lite);
    if (lite.name) byTokens.push({ tokens: tokenize(lite.name), brandFold: fold(lite.brand), product: lite });
    if (lite.brand) brandSet.add(fold(lite.brand));
  }
  _productIndex = { bySku, byName, byTokens, brandSet };
  return _productIndex;
}

// Jaccard token similarity for fuzzy name match
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export type NameMatch = {
  // matched  = confident link to an existing product (exact, or high-sim + brand agrees)
  // fuzzy    = a plausible candidate that a human should confirm (don't trust blindly)
  // composed = no good match; we built a clean name from the resolved parts
  status: 'matched' | 'fuzzy' | 'composed';
  canonical_name: string;
  matched_sku: string;
  score: number;
  candidate_name?: string; // for fuzzy: the suggested existing product
};

// Thresholds chosen so distinct châteaux / houses don't collapse into one another.
const FUZZY_FLOOR = 0.62;  // below this → no candidate worth showing
const MATCH_FLOOR = 0.85;  // at/above this (or with brand agreement) → confident match

export function normalizeName(
  rawName: string,
  rawSku: string,
  resolvedBrand: string,
  vintage: string,
): NameMatch {
  const idx = loadProductIndex();

  // 1) exact SKU match
  if (rawSku) {
    const hit = idx.bySku.get(fold(rawSku));
    if (hit) return { status: 'matched', canonical_name: hit.name, matched_sku: hit.sku, score: 1 };
  }
  // 2) exact (folded) name match
  const nameHit = idx.byName.get(fold(rawName));
  if (nameHit) return { status: 'matched', canonical_name: nameHit.name, matched_sku: nameHit.sku, score: 1 };

  // 3) best fuzzy candidate, tracking whether the brand agrees
  const inTokens = tokenize(rawName);
  const brandFold = fold(resolvedBrand);
  let best: { score: number; brandAgrees: boolean; product: ProductLite } | null = null;
  for (const cand of idx.byTokens) {
    const score = similarity(inTokens, cand.tokens);
    const brandAgrees = !!brandFold && cand.brandFold === brandFold;
    if (!best || score > best.score) best = { score, brandAgrees, product: cand.product };
  }

  if (best && best.score >= FUZZY_FLOOR) {
    // Confident only when the name is very close, OR close-ish AND the brand matches.
    const confident = best.score >= MATCH_FLOOR || (best.brandAgrees && best.score >= 0.7);
    if (confident) {
      return { status: 'matched', canonical_name: best.product.name, matched_sku: best.product.sku, score: Math.min(best.score, 1) };
    }
    // Plausible but unconfirmed — keep our composed name, surface the candidate for review.
    const parts = [resolvedBrand, rawName.replace(resolvedBrand, '').trim(), vintage].filter(Boolean);
    const composed = Array.from(new Set(parts.join(' ').split(/\s+/))).join(' ').trim() || rawName.trim();
    return { status: 'fuzzy', canonical_name: composed, matched_sku: best.product.sku, score: best.score, candidate_name: best.product.name };
  }

  // 4) no match → compose a clean name from resolved parts
  const parts = [resolvedBrand, rawName.replace(resolvedBrand, '').trim(), vintage].filter(Boolean);
  const composed = Array.from(new Set(parts.join(' ').split(/\s+/))).join(' ').trim() || rawName.trim();
  return { status: 'composed', canonical_name: composed, matched_sku: '', score: best?.score ?? 0 };
}

// ── Per-level geography validation (hierarchy-aware) ──────────────────────────
type LevelStatus = 'valid' | 'corrected' | 'wrong_parent' | 'unknown' | 'blank';

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'USA', 'u.s.a.': 'USA', us: 'USA', 'united states': 'USA',
  'united states of america': 'USA', america: 'USA',
  uk: 'England', 'united kingdom': 'England', 'great britain': 'England',
};

export type ValidatedRow = {
  row: number;
  item: string;
  input_name: string;
  canonical_name: string;
  name_status: NameMatch['status'];
  matched_sku: string;
  match_candidate: string;
  input_country: string;
  input_region: string;
  input_subregion: string;
  input_brand: string;
  country: string;
  region: string;
  subregion: string;
  brand: string;
  country_status: LevelStatus;
  region_status: LevelStatus;
  subregion_status: LevelStatus;
  brand_status: 'known' | 'new' | 'blank';
  overall_status: 'matched' | 'validated' | 'corrected' | 'pending_new_taxonomy' | 'needs_review';
  notes: string;
};

const SEVERITY: Record<LevelStatus, number> = { unknown: 4, wrong_parent: 3, corrected: 2, valid: 1, blank: 0 };

export type ValidateResult = {
  results: ValidatedRow[];
  proposals: TaxonomyProposal[];
  detectedColumns: Record<string, string>;
  summary: Record<string, number>;
};

export function validateRows(rawRows: Array<Record<string, any>>, headers: string[]): ValidateResult {
  const cols = detectColumns(headers);
  const get = (row: Record<string, any>, field: string) => {
    const c = cols[field];
    return c ? String(row[c] ?? '').trim() : '';
  };

  const idx = loadProductIndex();
  const results: ValidatedRow[] = [];
  const proposals: TaxonomyProposal[] = [];
  const summary: Record<string, number> = {};

  rawRows.forEach((row, i) => {
    const inName = get(row, 'name');
    const inSku = get(row, 'sku');
    const inCountry = get(row, 'country');
    const inRegion = get(row, 'region');
    const inSubregion = get(row, 'subregion');
    const inBrand = get(row, 'brand');
    const inVintage = get(row, 'vintage');

    // Field normalization via the existing engine (fills brand/grape/vintage/geo from name)
    const pipe = runPipeline({
      sku: inSku, name: inName, brand: inBrand, country: inCountry,
      region: inRegion, subregion: inSubregion, vintage: inVintage,
      classification: get(row, 'classification'), grape_variety: get(row, 'grape_variety'),
    });
    const patch = pipe.patch;
    const resolvedBrand = inBrand || patch.brand || '';

    // ── Country ──
    let countryStatus: LevelStatus = 'blank';
    let countryName = '';
    let countryId: number | undefined;
    if (inCountry) {
      let rec = resolveCountry(inCountry);
      if (!rec && COUNTRY_ALIASES[fold(inCountry)]) rec = resolveCountry(COUNTRY_ALIASES[fold(inCountry)]);
      if (rec) {
        countryName = rec.name;
        countryId = rec.id;
        countryStatus = inCountry === rec.name ? 'valid' : 'corrected';
      } else {
        countryStatus = 'unknown';
      }
    }

    // ── Region (must belong to country) ──
    let regionStatus: LevelStatus = 'blank';
    let regionName = '';
    let regionId: number | undefined;
    let resolvedCountryName = countryName;
    if (inRegion) {
      const inCountryRec = countryId ? resolveRegion(inRegion, countryId) : undefined;
      const anyRec = inCountryRec ?? resolveRegion(inRegion);
      if (inCountryRec) {
        regionName = inCountryRec.name;
        regionId = inCountryRec.id;
        regionStatus = inRegion === inCountryRec.name ? 'valid' : 'corrected';
      } else if (anyRec) {
        regionName = anyRec.name;
        regionId = anyRec.id;
        const owner = countryById.get(anyRec.country_id);
        resolvedCountryName = owner?.name ?? '';
        regionStatus = countryId ? 'wrong_parent' : (inRegion === anyRec.name ? 'valid' : 'corrected');
      } else {
        regionStatus = 'unknown';
      }
    }

    // ── Subregion (must belong to region) ──
    let subregionStatus: LevelStatus = 'blank';
    let subregionName = '';
    if (inSubregion) {
      const candidates = regionId ? getSubregionsByRegion(regionId) : [];
      const hit = candidates.find((s) => fold(s.name) === fold(inSubregion));
      if (hit) {
        subregionName = hit.name;
        subregionStatus = inSubregion === hit.name ? 'valid' : 'corrected';
      } else {
        subregionStatus = 'unknown';
      }
    }

    // ── Brand (validate only; producer not used in product schema) ──
    let brandStatus: ValidatedRow['brand_status'] = 'blank';
    if (resolvedBrand) brandStatus = idx.brandSet.has(fold(resolvedBrand)) ? 'known' : 'new';

    // ── Name normalization (match existing product first) ──
    const nameMatch = normalizeName(inName, inSku, resolvedBrand, inVintage || patch.vintage || '');

    // ── Proposals for unknowns (human-approved queue; never auto-written) ──
    const notes: string[] = [];
    if (countryStatus === 'unknown') {
      proposals.push({ type: 'country', proposed_value: inCountry, parent_path: '', source_sku: inSku });
      notes.push('country not in taxonomy → proposed');
    }
    if (regionStatus === 'unknown') {
      proposals.push({ type: 'region', proposed_value: inRegion, parent_path: countryName || inCountry, source_sku: inSku });
      notes.push('region not in taxonomy → proposed');
    }
    if (regionStatus === 'wrong_parent') {
      notes.push(`region belongs to ${resolvedCountryName || 'another country'}, not ${inCountry}`);
    }
    if (subregionStatus === 'unknown') {
      proposals.push({ type: 'sub_region', proposed_value: inSubregion, parent_path: regionName || inRegion, source_sku: inSku });
      notes.push('subregion not in taxonomy → proposed');
    }
    if (brandStatus === 'new') notes.push('brand not in library → proposed');

    // ── Overall status ──
    const geoWorst = (['country_status','region_status','subregion_status'] as const)
      .map((k) => ({ country_status: countryStatus, region_status: regionStatus, subregion_status: subregionStatus }[k]))
      .filter((s) => s !== 'blank') as LevelStatus[];
    const worst = geoWorst.length ? geoWorst.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a)) : 'blank';

    if (nameMatch.status === 'fuzzy') {
      notes.push(`possible match to "${nameMatch.candidate_name}" — confirm`);
    }

    let overall: ValidatedRow['overall_status'];
    if (worst === 'unknown' || worst === 'wrong_parent' || brandStatus === 'new') {
      overall = 'pending_new_taxonomy';
    } else if (nameMatch.status === 'fuzzy') {
      overall = 'needs_review';
    } else if (nameMatch.status === 'matched' && worst !== 'corrected') {
      overall = 'matched';
    } else if (worst === 'corrected') {
      overall = 'corrected';
    } else {
      overall = 'validated';
    }
    if (worst === 'corrected' && nameMatch.status !== 'matched') notes.push('normalized to canonical spelling');

    const out: ValidatedRow = {
      row: i + 1,
      item: inSku || inName,
      input_name: inName,
      canonical_name: nameMatch.canonical_name,
      name_status: nameMatch.status,
      matched_sku: nameMatch.matched_sku,
      match_candidate: nameMatch.candidate_name ?? '',
      input_country: inCountry,
      input_region: inRegion,
      input_subregion: inSubregion,
      input_brand: inBrand,
      country: countryName,
      region: regionName,
      subregion: subregionName,
      brand: resolvedBrand,
      country_status: countryStatus,
      region_status: regionStatus,
      subregion_status: subregionStatus,
      brand_status: brandStatus,
      overall_status: overall,
      notes: notes.join('; '),
    };
    results.push(out);
    summary[overall] = (summary[overall] ?? 0) + 1;
  });

  return { results, proposals, detectedColumns: cols, summary };
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
const CSV_FIELDS: Array<keyof ValidatedRow> = [
  'row', 'item', 'input_name', 'canonical_name', 'name_status', 'matched_sku', 'match_candidate',
  'input_country', 'input_region', 'input_subregion', 'input_brand',
  'country', 'region', 'subregion', 'brand',
  'country_status', 'region_status', 'subregion_status', 'brand_status',
  'overall_status', 'notes',
];

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function resultsToCsv(results: ValidatedRow[]): string {
  const head = CSV_FIELDS.join(',');
  const rows = results.map((r) => CSV_FIELDS.map((f) => csvCell(r[f])).join(','));
  return [head, ...rows].join('\n');
}

// ── Minimal CSV parser (quoted fields, commas, newlines) ──────────────────────
export function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }

  const headers = records.shift() ?? [];
  const rows = records.map((rec) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = rec[idx] ?? ''; });
    return obj;
  });
  return { headers, rows };
}
