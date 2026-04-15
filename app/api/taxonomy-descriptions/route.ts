/**
 * GET /api/taxonomy-descriptions?type=country
 * GET /api/taxonomy-descriptions?type=region&name=Bordeaux
 *
 * Returns descriptions from the taxonomy description libraries.
 * Types: country, region, subregion, classification, brand, origin
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const DATA_DIR = join(process.cwd(), 'data');

const FILE_MAP: Record<string, string> = {
  country: 'country_description_library.csv',
  region: 'region_description_library.csv',
  subregion: 'subregion_description_library.csv',
  classification: 'classification_description_library.csv',
  brand: 'brand_description_library.csv',
  origin: 'origin_description_library.csv',
};

interface DescEntry {
  entity_type: string;
  entity_name: string;
  parent_country: string;
  parent_region: string;
  product_count: string;
  segments_seen: string;
  copy_status: string;
  description_short_en: string;
  description_full_en: string;
  notes: string;
}

function parseCSV(text: string): DescEntry[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const results: DescEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const entry: any = {};
    headers.forEach(function (h, idx) { entry[h] = values[idx] || ''; });
    results.push(entry);
  }
  return results;
}

interface ExpertEntry {
  pack_type: string;
  canonical_name: string;
  parent_country: string;
  parent_region: string;
  scope: string;
  knowledge_short_en: string;
  knowledge_full_en: string;
  signature_varieties_or_styles: string;
  signature_regions_or_appellations: string;
  house_or_category_traits: string;
  use_cases: string;
  validation_status: string;
  confidence_level: string;
  source_basis: string;
  last_reviewed: string;
  notes: string;
}

// Cache the expert library in memory — reloaded per request but parsed once
let _expertCache: { mtime: number; byType: Map<string, Map<string, ExpertEntry>> } | null = null;

function loadExpertLibrary(type: string): Map<string, ExpertEntry> {
  const expertPath = join(DATA_DIR, 'expert_knowledge_library.csv');
  if (!existsSync(expertPath)) return new Map();

  try {
    const stat = require('fs').statSync(expertPath);
    const mtime = stat.mtimeMs;

    if (!_expertCache || _expertCache.mtime !== mtime) {
      const text = readFileSync(expertPath, 'utf-8');
      const lines = text.split('\n');
      const headers = parseCSVLine(lines[0]);
      const byType = new Map<string, Map<string, ExpertEntry>>();

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        const entry: any = {};
        headers.forEach(function (h, idx) { entry[h] = values[idx] || ''; });
        const t = entry.pack_type;
        if (!byType.has(t)) byType.set(t, new Map());
        byType.get(t)!.set(entry.canonical_name.toLowerCase(), entry);
      }

      _expertCache = { mtime, byType };
    }

    // Map API type ('country') to pack_type (same name usually)
    return _expertCache.byType.get(type) || new Map();
  } catch {
    return new Map();
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const type = sp.get('type') ?? '';
    const name = sp.get('name') ?? '';

    if (!type || !FILE_MAP[type]) {
      return NextResponse.json({
        error: 'Provide ?type= (country, region, subregion, classification, brand, origin)',
        available: Object.keys(FILE_MAP),
      }, { status: 400 });
    }

    const filePath = join(DATA_DIR, FILE_MAP[type]);
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Description file not found', entries: [] });
    }

    const text = readFileSync(filePath, 'utf-8');
    let entries = parseCSV(text);

    // Deduplicate: keep only the highest product-count entry per entity name
    // This fixes Bordeaux->France (726) instead of Bordeaux->Uruguay (1)
    const bestByName = new Map<string, DescEntry>();
    for (const e of entries) {
      const key = e.entity_name.toLowerCase();
      const existing = bestByName.get(key);
      const count = parseInt(e.product_count) || 0;
      const existingCount = existing ? (parseInt(existing.product_count) || 0) : -1;
      if (count > existingCount) {
        bestByName.set(key, e);
      }
    }
    entries = Array.from(bestByName.values());

    // OVERLAY EXPERT LIBRARY — expert-authored entries take priority over templates
    const expertMap = loadExpertLibrary(type);

    if (name) {
      const q = name.toLowerCase();
      entries = entries.filter(function (e) {
        return e.entity_name.toLowerCase().includes(q);
      });
    }

    return NextResponse.json({
      type,
      total: entries.length,
      expertCount: expertMap.size,
      entries: entries.map(function (e) {
        const expert = expertMap.get(e.entity_name.toLowerCase());
        if (expert) {
          // Expert-authored entry: use expert content, keep catalog metadata
          return {
            name: e.entity_name,
            parentCountry: expert.parent_country || e.parent_country,
            parentRegion: expert.parent_region || e.parent_region,
            productCount: parseInt(e.product_count) || 0,
            segments: e.segments_seen,
            status: expert.validation_status || 'expert_authored',
            shortDesc: expert.knowledge_short_en,
            fullDesc: expert.knowledge_full_en,
            notes: expert.notes || '',
            isExpert: true,
            confidence: expert.confidence_level,
            signatureVarieties: expert.signature_varieties_or_styles,
            signatureRegions: expert.signature_regions_or_appellations,
            houseTraits: expert.house_or_category_traits,
            useCases: expert.use_cases,
            lastReviewed: expert.last_reviewed,
            sourceBasis: expert.source_basis,
          };
        }
        // Template-generated fallback
        return {
          name: e.entity_name,
          parentCountry: e.parent_country,
          parentRegion: e.parent_region,
          productCount: parseInt(e.product_count) || 0,
          segments: e.segments_seen,
          status: e.copy_status,
          shortDesc: e.description_short_en,
          fullDesc: e.description_full_en,
          notes: e.notes,
          isExpert: false,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
