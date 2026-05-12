import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getTaxonomyDb } from '@/lib/taxonomy-db';
import type { WineSensedRecord } from './winesensed';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const dbDir = path.join(process.cwd(), 'data', 'db');
const evidenceFile = path.join(dbDir, 'external-winesensed-geography-evidence.json');
const curationFile = path.join(dbDir, 'external-winesensed-geography-curation.json');

export type GeographyCurationStatus =
  | 'new'
  | 'needs_research'
  | 'confirmed_region'
  | 'confirmed_subregion'
  | 'confirmed_appellation'
  | 'rejected_generic'
  | 'promoted';

export type GeographyCuration = {
  evidence_id: string;
  status: GeographyCurationStatus;
  reviewer: string;
  notes: string;
  source_urls: string[];
  confirmed_name: string | null;
  confirmed_parent_name: string | null;
  promoted_entity_id: number | null;
  updated_at: string;
};

export type GeographyEvidence = {
  id: string;
  source: 'winesensed';
  usage_policy: 'research_only';
  license: 'CC BY-NC-ND 4.0';
  observed_name: string;
  normalized_name: string;
  observed_country: string | null;
  evidence_count: number;
  review_count: number;
  avg_rating: number | null;
  avg_price: number | null;
  top_grapes: Array<{ name: string; count: number }>;
  matched_entity_type: 'region' | 'subregion' | 'appellation' | null;
  matched_entity_id: number | null;
  matched_entity_name: string | null;
  match_status: 'matched' | 'ambiguous' | 'needs_classification';
  suggested_target_type: 'region' | 'subregion' | 'appellation' | 'unknown';
  sample_review_signals: string[];
  source_notes: string[];
  curation?: GeographyCuration;
};

export type GeographyEvidenceSummary = {
  generated_at: string;
  source_records: number;
  evidence_rows: number;
  matched: number;
  ambiguous: number;
  needs_classification: number;
  by_suggested_type: Record<string, number>;
  top_needs_classification: GeographyEvidence[];
};

type TaxonomyEntity = {
  id: number;
  entity_type: 'region' | 'subregion' | 'appellation';
  name: string;
  parent_id: number | null;
  country_name: string | null;
};

const GEOGRAPHY_ALIASES: Record<string, string> = {
  toscana: 'tuscany',
  piemonte: 'piedmont',
};

const TYPE_HINTS: Record<string, GeographyEvidence['suggested_target_type']> = {
  'costa toscana': 'appellation',
  'montagne saint emilion': 'appellation',
  taurasi: 'appellation',
  'peninsula de setubal': 'region',
  stellenbosch: 'region',
  alentejo: 'region',
  biferno: 'appellation',
  'terre siciliane': 'appellation',
  salta: 'region',
  'sardon de duero': 'subregion',
};

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCountry(value: string | null): string | null {
  return value ? normalizeName(value) : null;
}

function topValues(values: Array<string | null>, limit = 8) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) return null;
  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2));
}

function getCountryForEntity(entity: any, byId: Map<number, any>): string | null {
  let current = entity;
  let guard = 0;
  while (current && guard < 5) {
    if (current.entity_type === 'country') return current.name;
    current = current.parent_id ? byId.get(current.parent_id) : null;
    guard += 1;
  }
  return null;
}

function getTaxonomyEntities(): TaxonomyEntity[] {
  const db = getTaxonomyDb();
  const all = db.prepare(`
    SELECT id, entity_type, name, parent_id
    FROM taxonomy_entities
    WHERE entity_type IN ('country', 'region', 'subregion', 'appellation')
  `).all() as any[];
  const byId = new Map(all.map(entity => [entity.id, entity]));
  return all
    .filter(entity => entity.entity_type !== 'country')
    .map(entity => ({
      ...entity,
      country_name: getCountryForEntity(entity, byId),
    }));
}

function suggestType(name: string): GeographyEvidence['suggested_target_type'] {
  const n = normalizeName(name);
  if (TYPE_HINTS[n]) return TYPE_HINTS[n];
  if (/\b(doc|docg|aoc|aop|ava|do|doca|igt|igp|grand cru|premier cru|classico|riserva)\b/.test(n)) {
    return 'appellation';
  }
  if (/\bvalley|coast|river|hills|mountain|valle|vallee|cote|cotes|duero|rioja|chianti|barolo|barbaresco|sancerre|chablis\b/.test(n)) {
    return 'subregion';
  }
  return 'unknown';
}

function groupRecords(records: WineSensedRecord[]) {
  const groups = new Map<string, WineSensedRecord[]>();
  for (const record of records) {
    if (!record.region) continue;
    const key = `${normalizeCountry(record.country)}|${normalizeName(record.region)}`;
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  }
  return groups;
}

function chooseMatch(records: WineSensedRecord[], matches: TaxonomyEntity[]) {
  if (matches.length === 0) return { status: 'needs_classification' as const, entity: null };
  const observedCountry = normalizeCountry(records[0]?.country ?? null);
  const sameCountry = matches.filter(match => normalizeCountry(match.country_name) === observedCountry);
  const candidates = sameCountry.length > 0 ? sameCountry : matches;
  if (candidates.length === 1) return { status: 'matched' as const, entity: candidates[0] };

  const priority = ['appellation', 'subregion', 'region'];
  const sorted = [...candidates].sort((a, b) => priority.indexOf(a.entity_type) - priority.indexOf(b.entity_type));
  const firstType = sorted[0]?.entity_type;
  const firstTypeMatches = sorted.filter(match => match.entity_type === firstType);
  if (firstTypeMatches.length === 1) return { status: 'matched' as const, entity: firstTypeMatches[0] };
  return { status: 'ambiguous' as const, entity: firstTypeMatches[0] ?? sorted[0] ?? null };
}

export function buildGeographyEvidence(records: WineSensedRecord[]): { evidence: GeographyEvidence[]; summary: GeographyEvidenceSummary } {
  const taxonomy = getTaxonomyEntities();
  const taxonomyByName = new Map<string, TaxonomyEntity[]>();
  for (const entity of taxonomy) {
    const key = normalizeName(entity.name);
    taxonomyByName.set(key, [...(taxonomyByName.get(key) ?? []), entity]);
  }

  const evidence: GeographyEvidence[] = [];
  const groups = groupRecords(records);

  for (const [key, rows] of groups) {
    const [, normalizedName] = key.split('|');
    const observedName = rows[0].region ?? normalizedName;
    const observedCountry = rows[0].country ?? null;
    const aliasName = GEOGRAPHY_ALIASES[normalizedName];
    const matches = taxonomyByName.get(normalizedName) ?? (aliasName ? taxonomyByName.get(aliasName) : undefined) ?? [];
    const match = chooseMatch(rows, matches);
    const matched = match.entity;

    evidence.push({
      id: `winesensed-geo-${normalizeCountry(observedCountry) ?? 'unknown'}-${normalizedName.replace(/\s+/g, '-')}`,
      source: 'winesensed',
      usage_policy: 'research_only',
      license: 'CC BY-NC-ND 4.0',
      observed_name: observedName,
      normalized_name: normalizedName,
      observed_country: observedCountry,
      evidence_count: rows.length,
      review_count: rows.filter(row => row.review).length,
      avg_rating: avg(rows.map(row => row.rating)),
      avg_price: avg(rows.map(row => row.price)),
      top_grapes: topValues(rows.map(row => row.grape)),
      matched_entity_type: matched?.entity_type ?? null,
      matched_entity_id: matched?.id ?? null,
      matched_entity_name: matched?.name ?? null,
      match_status: match.status,
      suggested_target_type: matched?.entity_type ?? suggestType(observedName),
      sample_review_signals: rows
        .map(row => row.review)
        .filter((review): review is string => Boolean(review))
        .slice(0, 3),
      source_notes: [
        'External WineSensed geography evidence; review-only before canonical taxonomy changes.',
        'Source field is named region, but observed values may represent region, subregion, or appellation.',
        ...(aliasName ? [`Matched by conservative geography alias: ${observedName} → ${matched?.name ?? aliasName}.`] : []),
      ],
    });
  }

  evidence.sort((a, b) => {
    if (a.match_status !== b.match_status) return a.match_status > b.match_status ? -1 : 1;
    return b.evidence_count - a.evidence_count;
  });

  const bySuggestedType = evidence.reduce<Record<string, number>>((acc, row) => {
    acc[row.suggested_target_type] = (acc[row.suggested_target_type] ?? 0) + 1;
    return acc;
  }, {});

  const summary: GeographyEvidenceSummary = {
    generated_at: new Date().toISOString(),
    source_records: records.length,
    evidence_rows: evidence.length,
    matched: evidence.filter(row => row.match_status === 'matched').length,
    ambiguous: evidence.filter(row => row.match_status === 'ambiguous').length,
    needs_classification: evidence.filter(row => row.match_status === 'needs_classification').length,
    by_suggested_type: bySuggestedType,
    top_needs_classification: evidence
      .filter(row => row.match_status === 'needs_classification')
      .slice(0, 20),
  };

  return { evidence, summary };
}

export async function saveGeographyEvidence(evidence: GeographyEvidence[], summary: GeographyEvidenceSummary) {
  await mkdir(dbDir, { recursive: true });
  await writeFile(evidenceFile, JSON.stringify({ summary, evidence }, null, 2), 'utf8');
}

export async function readGeographyEvidence(): Promise<{ summary: GeographyEvidenceSummary | null; evidence: GeographyEvidence[] }> {
  await mkdir(dbDir, { recursive: true });
  try {
    if (!fs.existsSync(evidenceFile)) return { summary: null, evidence: [] };
    return JSON.parse(await readFile(evidenceFile, 'utf8')) as { summary: GeographyEvidenceSummary; evidence: GeographyEvidence[] };
  } catch (_error) {
    return { summary: null, evidence: [] };
  }
}

async function readCurationMap(): Promise<Record<string, GeographyCuration>> {
  await mkdir(dbDir, { recursive: true });
  try {
    if (!fs.existsSync(curationFile)) return {};
    return JSON.parse(await readFile(curationFile, 'utf8')) as Record<string, GeographyCuration>;
  } catch (_error) {
    return {};
  }
}

async function saveCurationMap(curation: Record<string, GeographyCuration>) {
  await mkdir(dbDir, { recursive: true });
  await writeFile(curationFile, JSON.stringify(curation, null, 2), 'utf8');
}

export async function readGeographyEvidenceWithCuration(): Promise<{ summary: GeographyEvidenceSummary | null; evidence: GeographyEvidence[] }> {
  const [{ summary, evidence }, curation] = await Promise.all([
    readGeographyEvidence(),
    readCurationMap(),
  ]);
  return {
    summary,
    evidence: evidence.map(row => ({ ...row, curation: curation[row.id] })),
  };
}

export async function updateGeographyCuration(evidenceId: string, patch: Partial<Omit<GeographyCuration, 'evidence_id' | 'updated_at'>>) {
  const { evidence } = await readGeographyEvidence();
  const exists = evidence.some(row => row.id === evidenceId);
  if (!exists) throw new Error(`Evidence row not found: ${evidenceId}`);

  const curation = await readCurationMap();
  const existing = curation[evidenceId];
  const next: GeographyCuration = {
    evidence_id: evidenceId,
    status: patch.status ?? existing?.status ?? 'new',
    reviewer: patch.reviewer ?? existing?.reviewer ?? '',
    notes: patch.notes ?? existing?.notes ?? '',
    source_urls: patch.source_urls ?? existing?.source_urls ?? [],
    confirmed_name: patch.confirmed_name ?? existing?.confirmed_name ?? null,
    confirmed_parent_name: patch.confirmed_parent_name ?? existing?.confirmed_parent_name ?? null,
    promoted_entity_id: patch.promoted_entity_id ?? existing?.promoted_entity_id ?? null,
    updated_at: new Date().toISOString(),
  };

  curation[evidenceId] = next;
  await saveCurationMap(curation);
  return next;
}

export function filterGeographyEvidence(evidence: GeographyEvidence[], filters: {
  q?: string;
  status?: string;
  targetType?: string;
  entityType?: string;
  curationStatus?: string;
  name?: string;
  limit?: number;
  offset?: number;
}) {
  const q = filters.q?.trim().toLowerCase() ?? '';
  const status = filters.status?.trim();
  const targetType = filters.targetType?.trim();
  const entityType = filters.entityType?.trim();
  const curationStatus = filters.curationStatus?.trim();
  const name = filters.name ? normalizeName(filters.name) : '';
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));

  let rows = evidence;
  if (status) rows = rows.filter(row => row.match_status === status);
  if (targetType) rows = rows.filter(row => row.suggested_target_type === targetType);
  if (entityType) rows = rows.filter(row => row.matched_entity_type === entityType);
  if (curationStatus) {
    rows = rows.filter(row => (row.curation?.status ?? 'new') === curationStatus);
  }
  if (name) rows = rows.filter(row => row.normalized_name === name || normalizeName(row.matched_entity_name ?? '') === name);
  if (q) {
    rows = rows.filter(row =>
      [row.observed_name, row.observed_country, row.matched_entity_name, row.matched_entity_type, row.suggested_target_type]
        .some(value => value?.toLowerCase().includes(q)),
    );
  }

  return {
    evidence: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    hasMore: offset + limit < rows.length,
  };
}
