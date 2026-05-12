import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const dbDir = path.join(process.cwd(), 'data', 'db');
const researchFile = path.join(dbDir, 'external-winesensed-records.json');
const summaryFile = path.join(dbDir, 'external-winesensed-summary.json');

export type WineSensedRecord = {
  id: string;
  source: 'winesensed';
  source_dataset: string;
  source_file: string;
  usage_policy: 'research_only';
  license: 'CC BY-NC-ND 4.0';
  vintage_id: number | null;
  experiment_id: number | null;
  image: string | null;
  review: string | null;
  year: number | null;
  winery_id: number | null;
  wine_alcohol: number | null;
  country: string | null;
  region: string | null;
  price: number | null;
  rating: number | null;
  grape: string | null;
  normalized_country: string | null;
  normalized_region: string | null;
  normalized_grape: string | null;
  review_language_hint: string;
  created_at: string;
};

export type WineSensedSummary = {
  source: 'winesensed';
  source_url: string;
  paper_url: string;
  license: 'CC BY-NC-ND 4.0';
  usage_policy: 'research_only';
  imported_at: string;
  source_file: string;
  imported_rows: number;
  rows_with_review: number;
  rows_with_country: number;
  rows_with_region: number;
  rows_with_grape: number;
  rows_with_rating: number;
  top_countries: Array<{ name: string; count: number }>;
  top_grapes: Array<{ name: string; count: number }>;
  top_regions: Array<{ name: string; count: number }>;
};

export type WineSensedListFilters = {
  q?: string;
  country?: string;
  region?: string;
  grape?: string;
  hasReview?: boolean;
  limit?: number;
  offset?: number;
};

async function ensureDbDir() {
  await mkdir(dbDir, { recursive: true });
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalize(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeGrape(value: unknown): string | null {
  const text = normalize(value);
  if (!text) return null;
  return text.replace(/\\\//g, '/');
}

function languageHint(review: string | null): string {
  if (!review) return 'none';
  if (/[\u0E00-\u0E7F]/.test(review)) return 'thai';
  if (/[\u0400-\u04FF]/.test(review)) return 'cyrillic';
  if (/[\u4E00-\u9FFF]/.test(review)) return 'cjk';
  if (/[\u00C0-\u024F]/.test(review)) return 'latin_extended';
  return 'latin';
}

function makeId(raw: Record<string, unknown>, index: number): string {
  const vintage = raw.vintage_id ?? 'unknown';
  const image = raw.image ?? 'no-image';
  return `winesensed-${vintage}-${image}-${index}`;
}

export function parseWineSensedJsonl(text: string, sourceFile: string, limit = 1000): WineSensedRecord[] {
  const now = new Date().toISOString();
  const rows: WineSensedRecord[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (rows.length >= limit) break;
    if (!line.trim()) continue;

    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const review = cleanText(raw.review);
      const country = normalize(raw.country);
      const region = normalize(raw.region);
      const grape = normalizeGrape(raw.grape);

      rows.push({
        id: makeId(raw, rows.length),
        source: 'winesensed',
        source_dataset: 'Dakhoo/L2T-NeurIPS-2023',
        source_file: sourceFile,
        usage_policy: 'research_only',
        license: 'CC BY-NC-ND 4.0',
        vintage_id: toNumber(raw.vintage_id),
        experiment_id: toNumber(raw.experiment_id),
        image: cleanText(raw.image),
        review,
        year: toNumber(raw.year),
        winery_id: toNumber(raw.winery_id),
        wine_alcohol: toNumber(raw.wine_alcohol),
        country,
        region,
        price: toNumber(raw.price),
        rating: toNumber(raw.rating),
        grape,
        normalized_country: country?.toLowerCase() ?? null,
        normalized_region: region?.toLowerCase() ?? null,
        normalized_grape: grape?.toLowerCase() ?? null,
        review_language_hint: languageHint(review),
        created_at: now,
      });
    } catch (_error) {
      // Skip malformed JSONL rows; imported source files are external research artifacts.
    }
  }

  return rows;
}

function topValues(records: WineSensedRecord[], key: 'country' | 'region' | 'grape') {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = record[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
}

export function buildWineSensedSummary(records: WineSensedRecord[], sourceFile: string): WineSensedSummary {
  return {
    source: 'winesensed',
    source_url: 'https://huggingface.co/datasets/Dakhoo/L2T-NeurIPS-2023',
    paper_url: 'https://arxiv.org/abs/2308.16900',
    license: 'CC BY-NC-ND 4.0',
    usage_policy: 'research_only',
    imported_at: new Date().toISOString(),
    source_file: sourceFile,
    imported_rows: records.length,
    rows_with_review: records.filter(record => record.review).length,
    rows_with_country: records.filter(record => record.country).length,
    rows_with_region: records.filter(record => record.region).length,
    rows_with_grape: records.filter(record => record.grape).length,
    rows_with_rating: records.filter(record => record.rating != null).length,
    top_countries: topValues(records, 'country'),
    top_grapes: topValues(records, 'grape'),
    top_regions: topValues(records, 'region'),
  };
}

export async function saveWineSensedResearch(records: WineSensedRecord[], summary: WineSensedSummary) {
  await ensureDbDir();
  await writeFile(researchFile, JSON.stringify(records, null, 2), 'utf8');
  await writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
}

export async function readWineSensedResearch(): Promise<WineSensedRecord[]> {
  await ensureDbDir();
  try {
    if (!fs.existsSync(researchFile)) return [];
    return JSON.parse(await readFile(researchFile, 'utf8')) as WineSensedRecord[];
  } catch (_error) {
    return [];
  }
}

export async function readWineSensedSummary(): Promise<WineSensedSummary | null> {
  await ensureDbDir();
  try {
    if (!fs.existsSync(summaryFile)) return null;
    return JSON.parse(await readFile(summaryFile, 'utf8')) as WineSensedSummary;
  } catch (_error) {
    return null;
  }
}

export function listWineSensedResearch(records: WineSensedRecord[], filters: WineSensedListFilters) {
  const q = filters.q?.trim().toLowerCase() ?? '';
  const country = filters.country?.trim().toLowerCase() ?? '';
  const region = filters.region?.trim().toLowerCase() ?? '';
  const grape = filters.grape?.trim().toLowerCase() ?? '';
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

  let filtered = records;
  if (country) filtered = filtered.filter(record => record.normalized_country === country);
  if (region) filtered = filtered.filter(record => record.normalized_region === region);
  if (grape) filtered = filtered.filter(record => record.normalized_grape === grape);
  if (filters.hasReview) filtered = filtered.filter(record => Boolean(record.review));
  if (q) {
    filtered = filtered.filter(record =>
      [record.review, record.country, record.region, record.grape, String(record.vintage_id ?? '')]
        .some(value => value?.toLowerCase().includes(q)),
    );
  }

  return {
    records: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
  };
}
