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

    if (name) {
      const q = name.toLowerCase();
      entries = entries.filter(function (e) {
        return e.entity_name.toLowerCase().includes(q);
      });
    }

    return NextResponse.json({
      type,
      total: entries.length,
      entries: entries.map(function (e) {
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
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
