/**
 * Local database implementation using JSON file storage
 * This serves as a lightweight alternative to SQLite for development
 * Can be upgraded to SQLite3 or other database later
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

// ── New types ──────────────────────────────────────────────────────────────────

export interface ProductChangelog {
  id: string;
  product_id: string;
  sku: string;
  changed_at: string;
  source: 'batch_process' | 'taxonomy_queue' | 'manual_edit' | 'override_import' | 'masterfile_import';
  field: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

export interface OverrideBatch {
  id: string;
  created_at: string;
  source_file: string;
  note: string;
  rows_updated: number;
  rows_skipped: number;
}

export interface BrandListEntry {
  id: string;
  name: string;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface CleanedProduct {
  id?: string;
  sku?: string;
  name?: string;
  country?: string;
  region?: string;
  classification?: string;
  price?: number;
  cost?: number;
  currency?: string;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  validation_status?: string;
  full_description?: string;
  flavor_profile?: string;
  // Image support
  image_url?: string;
  image_scraped_url?: string;
  image_local_path?: string;
  image_alt_text?: string;
  [key: string]: any;
}

interface BatchLog {
  id?: string;
  source_file?: string;
  status?: string;
  total_rows?: number;
  processed_rows?: number;
  timestamp?: string;
  [key: string]: any;
}

const dbDir = path.join(process.cwd(), 'data', 'db');
const productsFile = path.join(dbDir, 'products.json');
const logsFile = path.join(dbDir, 'batch-logs.json');

// Ensure db directory exists
async function ensureDbDir() {
  try {
    await mkdir(dbDir, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

// Read all products
export async function readProducts(): Promise<CleanedProduct[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(productsFile)) {
      const data = await readFile(productsFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading products:', error);
  }
  return [];
}

// Save products
async function saveProducts(products: CleanedProduct[]) {
  await ensureDbDir();
  await writeFile(productsFile, JSON.stringify(products, null, 2), 'utf-8');
}

// Read all batch logs
async function readBatchLogs(): Promise<BatchLog[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(logsFile)) {
      const data = await readFile(logsFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading batch logs:', error);
  }
  return [];
}

// Save batch logs
async function saveBatchLogs(logs: BatchLog[]) {
  await ensureDbDir();
  await writeFile(logsFile, JSON.stringify(logs, null, 2), 'utf-8');
}

export async function saveCleanedProduct(productData: Record<string, any>) {
  const products = await readProducts();
  const existingIdx = products.findIndex(p => p.id === productData.id);
  
  if (existingIdx >= 0) {
    products[existingIdx] = { ...products[existingIdx], ...productData, updated_at: new Date().toISOString() };
  } else {
    products.push({ ...productData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  
  await saveProducts(products);
  return { success: true, id: productData.id };
}

export async function getCleanedProducts(filters?: Record<string, any>) {
  let products = await readProducts();
  
  if (filters?.validation_status) {
    products = products.filter(p => p.validation_status === filters.validation_status);
  }
  
  if (filters?.country) {
    products = products.filter(p => p.country === filters.country);
  }
  
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    products = products.filter(p =>
      (p.sku || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.country || '').toLowerCase().includes(q)
    );
  }
  
  if (filters?.confidence_min) {
    products = products.filter(p => (p.overall_confidence || 0) >= filters.confidence_min);
  }
  
  return products;
}

export async function getProductStats() {
  const products = await readProducts();
  
  const stats = {
    total: products.length,
    validated: products.filter(p => p.validation_status === 'validated').length,
    pending: products.filter(p => p.validation_status === 'pending').length,
    needs_review: products.filter(p => p.validation_status === 'needs_review').length,
    needs_attention: products.filter(p => p.validation_status === 'needs_attention').length,
    blocked: products.filter(p => p.validation_status === 'blocked').length,
    avg_confidence: products.length > 0
      ? products.reduce((sum, p) => sum + (p.overall_confidence || 0), 0) / products.length
      : 0,
    avg_taxonomy_confidence: products.length > 0
      ? products.reduce((sum, p) => sum + (p.taxonomy_confidence || 0), 0) / products.length
      : 0,
    avg_description_confidence: products.length > 0
      ? products.reduce((sum, p) => sum + (p.description_confidence || 0), 0) / products.length
      : 0,
  };
  
  return stats;
}

export async function saveBatchLog(log: Record<string, any>) {
  const logs = await readBatchLogs();
  logs.unshift({ ...log, timestamp: new Date().toISOString() });
  await saveBatchLogs(logs.slice(0, 50)); // Keep last 50
  return { success: true, id: log.id };
}

export async function getBatchLogs() {
  return await readBatchLogs();
}

export async function addDataIssue(issue: Record<string, any>) {
  // Store in a separate issues file
  const issuesFile = path.join(dbDir, 'data-issues.json');
  let issues: Record<string, any>[] = [];
  
  try {
    if (fs.existsSync(issuesFile)) {
      const data = await readFile(issuesFile, 'utf-8');
      issues = JSON.parse(data);
    }
  } catch (error) {
    // File doesn't exist yet
  }
  
  issues.unshift({ ...issue, id: `issue-${Date.now()}`, created_at: new Date().toISOString() });
  await writeFile(issuesFile, JSON.stringify(issues, null, 2), 'utf-8');
}

export async function getDataIssues(filters?: Record<string, any>) {
  const issuesFile = path.join(dbDir, 'data-issues.json');
  
  try {
    if (fs.existsSync(issuesFile)) {
      let issues = JSON.parse(await readFile(issuesFile, 'utf-8'));
      
      if (filters?.severity) {
        issues = issues.filter((i: any) => i.severity === filters.severity);
      }
      
      if (filters?.product_id) {
        issues = issues.filter((i: any) => i.product_id === filters.product_id);
      }
      
      return issues.slice(0, 500);
    }
  } catch (error) {
    console.error('Error reading issues:', error);
  }
  
  return [];
}

export async function readScrapingQueue() {
  await ensureDbDir();
  const queueFile = path.join(dbDir, 'scraping-queue.json');
  try {
    if (fs.existsSync(queueFile)) {
      return JSON.parse(await readFile(queueFile, 'utf-8')) as Record<string, any>[];
    }
  } catch (error) {
    console.error('Error reading scraping queue:', error);
  }
  return [];
}

export async function addToScrapingQueue(item: Record<string, any>) {
  await ensureDbDir();
  const queueFile = path.join(dbDir, 'scraping-queue.json');
  let queue: Record<string, any>[] = [];

  try {
    if (fs.existsSync(queueFile)) {
      queue = JSON.parse(await readFile(queueFile, 'utf-8'));
    }
  } catch (error) {
    console.error('Error reading scraping queue:', error);
  }

  const exists = queue.find(q => q.id === item.id);
  if (!exists) {
    queue.push({ ...item, queuedAt: new Date().toISOString(), status: 'pending' });
    await writeFile(queueFile, JSON.stringify(queue, null, 2), 'utf-8');
    return { success: true, queued: true };
  }

  return { success: true, queued: false }; 
}

export async function updateScrapingQueueItem(id: string, status: 'pending' | 'in_progress' | 'completed' | 'failed', payload: Record<string, any> = {}) {
  await ensureDbDir();
  const queueFile = path.join(dbDir, 'scraping-queue.json');
  let queue: Record<string, any>[] = [];

  try {
    if (fs.existsSync(queueFile)) {
      queue = JSON.parse(await readFile(queueFile, 'utf-8'));
    }
  } catch (error) {
    console.error('Error reading scraping queue:', error);
  }

  const itemIndex = queue.findIndex(item => item.id === id);

  if (itemIndex >= 0) {
    queue[itemIndex] = {
      ...queue[itemIndex],
      ...payload,
      status,
      updated_at: new Date().toISOString(),
    };
    await writeFile(queueFile, JSON.stringify(queue, null, 2), 'utf-8');
    return { success: true, item: queue[itemIndex] };
  }

  return { success: false, error: 'Queue item not found' };
}

// ── Changelog ─────────────────────────────────────────────────────────────────

const changelogFile = path.join(dbDir, 'product-changelog.json');

async function readChangelog(): Promise<ProductChangelog[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(changelogFile)) {
      return JSON.parse(await readFile(changelogFile, 'utf-8'));
    }
  } catch { /* empty file or parse error */ }
  return [];
}

async function saveChangelog(entries: ProductChangelog[]) {
  await ensureDbDir();
  await writeFile(changelogFile, JSON.stringify(entries, null, 2), 'utf-8');
}

export async function addChangelogEntries(entries: Omit<ProductChangelog, 'id' | 'changed_at'>[]) {
  const existing = await readChangelog();
  const now = new Date().toISOString();
  const newEntries: ProductChangelog[] = entries.map(e => ({
    ...e,
    id: randomId(),
    changed_at: now,
  }));
  await saveChangelog([...existing, ...newEntries]);
  return newEntries;
}

export async function getChangelogForProduct(productId: string): Promise<ProductChangelog[]> {
  const all = await readChangelog();
  return all.filter(e => e.product_id === productId).sort(
    (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
  );
}

// ── Override batches ───────────────────────────────────────────────────────────

const overrideBatchesFile = path.join(dbDir, 'override-batches.json');

async function readOverrideBatches(): Promise<OverrideBatch[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(overrideBatchesFile)) {
      return JSON.parse(await readFile(overrideBatchesFile, 'utf-8'));
    }
  } catch { /* empty */ }
  return [];
}

export async function saveOverrideBatch(batch: Omit<OverrideBatch, 'id' | 'created_at'>) {
  const batches = await readOverrideBatches();
  const entry: OverrideBatch = { ...batch, id: randomId(), created_at: new Date().toISOString() };
  batches.unshift(entry);
  await writeFile(overrideBatchesFile, JSON.stringify(batches, null, 2), 'utf-8');
  return entry;
}

export async function getOverrideBatches(): Promise<OverrideBatch[]> {
  return readOverrideBatches();
}

// ── Brand list ─────────────────────────────────────────────────────────────────

const brandListFile = path.join(dbDir, 'brand-list.json');

async function readBrandList(): Promise<BrandListEntry[]> {
  await ensureDbDir();
  try {
    if (fs.existsSync(brandListFile)) {
      return JSON.parse(await readFile(brandListFile, 'utf-8'));
    }
  } catch { /* empty */ }
  return [];
}

export async function getBrands(): Promise<BrandListEntry[]> {
  return readBrandList();
}

export async function addBrand(name: string): Promise<BrandListEntry> {
  const brands = await readBrandList();
  if (brands.some(b => b.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Brand "${name}" already exists.`);
  }
  const entry: BrandListEntry = { id: randomId(), name: name.trim() };
  brands.push(entry);
  await writeFile(brandListFile, JSON.stringify(brands, null, 2), 'utf-8');
  await computeAndSaveQueuePriorities(true);
  return entry;
}

export async function deleteBrand(id: string): Promise<void> {
  const brands = await readBrandList();
  const filtered = brands.filter(b => b.id !== id);
  await writeFile(brandListFile, JSON.stringify(filtered, null, 2), 'utf-8');
  await computeAndSaveQueuePriorities(true);
}

// ── Queue priority ─────────────────────────────────────────────────────────────

function computePriority(product: CleanedProduct, brandNames: string[]): number {
  let score = 0;
  const conf = parseFloat(String(product.overall_confidence ?? product.taxonomy_confidence ?? 0));
  score += Math.min(40, Math.round(conf * 8));
  if ((product.notes && String(product.notes).trim()) || product.is_in_stock) score += 20;
  const nameLower = String(product.name ?? '').toLowerCase();
  if (brandNames.some(b => nameLower.includes(b.toLowerCase()))) score += 20;
  const price = parseFloat(String(product.price ?? 0));
  if (price >= 3000) score += 10;
  else if (price >= 1000) score += 5;
  return Math.min(100, score);
}

export async function computeAndSaveQueuePriorities(forceAll = false): Promise<void> {
  const products = await readProducts();
  const brands = await readBrandList();
  const brandNames = brands.map(b => b.name);
  let changed = false;
  for (const p of products) {
    if (forceAll || p.queue_priority == null || p.queue_priority === 0) {
      p.queue_priority = computePriority(p, brandNames);
      changed = true;
    }
  }
  if (changed) await saveProducts(products);
}

export async function getQueueProducts(filters: {
  validation_status?: string;
  page?: number;
  page_size?: number;
}) {
  await computeAndSaveQueuePriorities();
  let products = await readProducts();

  if (filters.validation_status) {
    products = products.filter(p => (p.validation_status ?? 'unvalidated') === filters.validation_status);
  } else {
    products = products.filter(p => !p.validation_status || p.validation_status === 'unvalidated');
  }

  products.sort((a, b) => (b.queue_priority ?? 0) - (a.queue_priority ?? 0));

  const page = filters.page ?? 1;
  const pageSize = filters.page_size ?? 50;
  const total = products.length;
  const items = products.slice((page - 1) * pageSize, page * pageSize);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function validateProducts(ids: string[], note?: string): Promise<{ updated: number }> {
  const products = await readProducts();
  const changelog: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];
  let updated = 0;

  for (const product of products) {
    if (!ids.includes(product.id!)) continue;
    if ((product.validation_status ?? 'unvalidated') === 'validated') continue;
    const old = product.validation_status ?? 'unvalidated';
    product.validation_status = 'validated';
    changelog.push({
      product_id: product.id!,
      sku: product.sku ?? '',
      source: 'taxonomy_queue',
      field: 'validation_status',
      old_value: old,
      new_value: 'validated',
      note: note ?? null,
    });
    updated++;
  }

  if (updated > 0) {
    await saveProducts(products);
    await addChangelogEntries(changelog);
  }
  return { updated };
}

export async function batchValidateTopN(n: number): Promise<{ updated: number }> {
  const products = await readProducts();
  const brands = await readBrandList();
  const brandNames = brands.map(b => b.name);

  const eligible = products
    .filter(p => {
      const conf = parseFloat(String(p.overall_confidence ?? p.taxonomy_confidence ?? 0));
      return conf >= 4.0 && (!p.validation_status || p.validation_status === 'unvalidated');
    })
    .sort((a, b) => (b.queue_priority ?? 0) - (a.queue_priority ?? 0))
    .slice(0, n);

  const ids = eligible.map(p => p.id!).filter(Boolean);
  return validateProducts(ids);
}

export async function updateProductFields(
  productId: string,
  fields: Record<string, string>,
  note?: string
): Promise<{ updated: boolean }> {
  const products = await readProducts();
  const idx = products.findIndex(p => p.id === productId);
  if (idx < 0) return { updated: false };

  const product = products[idx];
  const changelog: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];

  for (const [field, newValue] of Object.entries(fields)) {
    const oldValue = product[field] != null ? String(product[field]) : null;
    if (oldValue !== newValue) {
      product[field] = newValue;
      changelog.push({
        product_id: productId,
        sku: product.sku ?? '',
        source: 'manual_edit',
        field,
        old_value: oldValue,
        new_value: newValue,
        note: note ?? null,
      });
    }
  }

  products[idx] = { ...product, updated_at: new Date().toISOString() };
  await saveProducts(products);
  if (changelog.length > 0) await addChangelogEntries(changelog);
  return { updated: true };
}

export async function getProductWithChangelog(productId: string) {
  const products = await readProducts();
  const product = products.find(p => p.id === productId);
  if (!product) return null;
  const changelog = await getChangelogForProduct(productId);
  return { product, changelog };
}

export async function getPaginatedProducts(filters: {
  search?: string;
  category?: string;
  country?: string;
  validation_status?: string;
  page?: number;
}) {
  let products = await readProducts();

  if (filters.search) {
    const q = filters.search.toLowerCase();
    products = products.filter(p =>
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.name ?? '').toLowerCase().includes(q)
    );
  }
  if (filters.country) products = products.filter(p => p.country === filters.country);
  if (filters.category) {
    const cat = filters.category.toLowerCase();
    products = products.filter(p => (p.mainCategory ?? '').toLowerCase() === cat);
  }
  if (filters.validation_status) products = products.filter(p =>
    (p.validation_status ?? 'unvalidated') === filters.validation_status
  );

  const page = filters.page ?? 1;
  const pageSize = 50;
  const total = products.length;
  const items = products.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function loadTaxonomy() {
  // Taxonomy is pre-loaded from JSON files in data/taxonomy/
  console.log('✓ Taxonomy preloaded from JSON files');
}

export function initializeDatabase() {
  // Ensure database directory exists
  ensureDbDir().catch(console.error);
  console.log(`✓ Database initialized at ${dbDir}`);
}

// ── Pipeline status ────────────────────────────────────────────────────────────

const pipelineStatusFile = path.join(dbDir, 'pipeline-status.json');
const syncStatusFile = path.join(dbDir, 'sync-status.json');

export type PipelineStatus = {
  status: 'idle' | 'running' | 'error';
  migration_done: boolean;
  current_step: string | null;
  progress: { done: number; total: number };
  tokens_used: number;
  last_run: string | null;
  last_summary: Record<string, any> | null;
};

export async function getPipelineStatus(): Promise<PipelineStatus> {
  try {
    if (fs.existsSync(pipelineStatusFile)) {
      return JSON.parse(await readFile(pipelineStatusFile, 'utf-8'));
    }
  } catch {}
  return { status: 'idle', migration_done: false, current_step: null, progress: { done: 0, total: 0 }, tokens_used: 0, last_run: null, last_summary: null };
}

export async function savePipelineStatus(update: Partial<PipelineStatus>): Promise<void> {
  const current = await getPipelineStatus();
  const next = { ...current, ...update };
  const tmp = pipelineStatusFile + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, pipelineStatusFile);
}

export type SyncStatus = { last_synced_at: string | null; last_synced_count: number };

export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    if (fs.existsSync(syncStatusFile)) {
      return JSON.parse(await readFile(syncStatusFile, 'utf-8'));
    }
  } catch {}
  return { last_synced_at: null, last_synced_count: 0 };
}

export async function saveSyncStatus(s: SyncStatus): Promise<void> {
  await writeFile(syncStatusFile, JSON.stringify(s, null, 2), 'utf-8');
}

export type EnrichmentUpdate = {
  id: string;
  enrichment_source?: string;
  enrichment_note?: string;
  claude_enriched_at?: string;
  synced_at?: string;
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  validation_status?: string;
};

export async function batchUpdateEnrichment(updates: EnrichmentUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const products = await readProducts();
  const map = new Map(products.map(p => [p.id, p]));
  for (const u of updates) {
    const existing = map.get(u.id);
    if (!existing) continue;
    map.set(u.id, { ...existing, ...u, updated_at: new Date().toISOString() });
  }
  const next = Array.from(map.values());
  const tmp = productsFile + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, productsFile);
}
