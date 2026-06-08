import fs from 'fs/promises';
import path from 'path';

export type CurationStatus = 'draft' | 'approved' | 'published';

export type StoredCurationRun = {
  id: string;
  brief: string;
  resolved_query: Record<string, unknown>;
  candidate_count: number;
  products: Array<Record<string, unknown>>;
  run_time_s?: number;
  llm_cost_usd?: number;
  approved_skus: string[];
  skipped_skus: string[];
  operator_note?: string;
  created_at: string;
  updated_at: string;
};

export type StoredCurationCollection = {
  id: string;
  name: string;
  purpose: string;
  source_run_id?: string;
  approved_items: Array<Record<string, unknown>>;
  status: CurationStatus;
  created_at: string;
  updated_at: string;
};

export type CurationFeedbackAction = 'approve' | 'skip' | 'replace';

export type StoredCurationFeedback = {
  id: string;
  action: CurationFeedbackAction;
  reason_code: string;
  reason_label: string;
  note?: string;
  run_id?: string;
  brief?: string;
  source_sku: string;
  source_name?: string;
  target_sku?: string;
  target_name?: string;
  relationship_type?: string;
  recommendation_score?: number;
  recommendation_matrix?: Record<string, number>;
  recommendation_risks?: string[];
  created_at: string;
};

const dbDir = path.join(process.cwd(), 'data', 'db');
const runsFile = path.join(dbDir, 'curation-runs.json');
const collectionsFile = path.join(dbDir, 'curation-collections.json');
const feedbackFile = path.join(dbDir, 'curation-feedback.json');

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDbDir() {
  await fs.mkdir(dbDir, { recursive: true });
}

async function readJsonArray<T>(file: string): Promise<T[]> {
  await ensureDbDir();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') console.error(`[curation-storage] read failed: ${file}`, error);
    return [];
  }
}

async function writeJsonArray<T>(file: string, rows: T[]) {
  await ensureDbDir();
  await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
}

export async function readCurationRuns(): Promise<StoredCurationRun[]> {
  const rows = await readJsonArray<StoredCurationRun>(runsFile);
  return rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function saveCurationRun(input: {
  id?: string;
  brief: string;
  resolved_query: Record<string, unknown>;
  candidate_count: number;
  products: Array<Record<string, unknown>>;
  run_time_s?: number;
  llm_cost_usd?: number;
  approved_skus?: string[];
  skipped_skus?: string[];
  operator_note?: string;
}): Promise<StoredCurationRun> {
  const now = new Date().toISOString();
  const rows = await readJsonArray<StoredCurationRun>(runsFile);
  const existingIdx = input.id ? rows.findIndex(row => row.id === input.id) : -1;
  const existing = existingIdx >= 0 ? rows[existingIdx] : null;
  const row: StoredCurationRun = {
    id: input.id || id('curation-run'),
    brief: input.brief,
    resolved_query: input.resolved_query,
    candidate_count: input.candidate_count,
    products: input.products,
    run_time_s: input.run_time_s ?? existing?.run_time_s,
    llm_cost_usd: input.llm_cost_usd ?? existing?.llm_cost_usd,
    approved_skus: input.approved_skus ?? existing?.approved_skus ?? [],
    skipped_skus: input.skipped_skus ?? existing?.skipped_skus ?? [],
    operator_note: input.operator_note ?? existing?.operator_note,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (existingIdx >= 0) rows[existingIdx] = row;
  else rows.push(row);
  await writeJsonArray(runsFile, rows);
  return row;
}

export async function readCurationCollections(): Promise<StoredCurationCollection[]> {
  const rows = await readJsonArray<StoredCurationCollection>(collectionsFile);
  return rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function saveCurationCollection(input: {
  id?: string;
  name: string;
  purpose: string;
  source_run_id?: string;
  approved_items: Array<Record<string, unknown>>;
  status?: CurationStatus;
}): Promise<StoredCurationCollection> {
  const now = new Date().toISOString();
  const rows = await readJsonArray<StoredCurationCollection>(collectionsFile);
  const existingIdx = input.id ? rows.findIndex(row => row.id === input.id) : -1;
  const existing = existingIdx >= 0 ? rows[existingIdx] : null;
  const row: StoredCurationCollection = {
    id: input.id || id('curation-collection'),
    name: input.name,
    purpose: input.purpose,
    source_run_id: input.source_run_id,
    approved_items: input.approved_items,
    status: input.status ?? existing?.status ?? 'draft',
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (existingIdx >= 0) rows[existingIdx] = row;
  else rows.push(row);
  await writeJsonArray(collectionsFile, rows);
  return row;
}

export async function readCurationFeedback(): Promise<StoredCurationFeedback[]> {
  const rows = await readJsonArray<StoredCurationFeedback>(feedbackFile);
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export async function saveCurationFeedback(input: {
  action: CurationFeedbackAction;
  reason_code: string;
  reason_label: string;
  note?: string;
  run_id?: string;
  brief?: string;
  source_sku: string;
  source_name?: string;
  target_sku?: string;
  target_name?: string;
  relationship_type?: string;
  recommendation_score?: number;
  recommendation_matrix?: Record<string, number>;
  recommendation_risks?: string[];
}): Promise<StoredCurationFeedback> {
  const rows = await readJsonArray<StoredCurationFeedback>(feedbackFile);
  const row: StoredCurationFeedback = {
    id: id('curation-feedback'),
    action: input.action,
    reason_code: input.reason_code,
    reason_label: input.reason_label,
    note: input.note,
    run_id: input.run_id,
    brief: input.brief,
    source_sku: input.source_sku,
    source_name: input.source_name,
    target_sku: input.target_sku,
    target_name: input.target_name,
    relationship_type: input.relationship_type,
    recommendation_score: input.recommendation_score,
    recommendation_matrix: input.recommendation_matrix,
    recommendation_risks: input.recommendation_risks,
    created_at: new Date().toISOString(),
  };
  rows.push(row);
  await writeJsonArray(feedbackFile, rows);
  return row;
}
