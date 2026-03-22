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
async function readProducts(): Promise<CleanedProduct[]> {
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
  
  return products.slice(0, 1000); // Paginate
}

export async function getProductStats() {
  const products = await readProducts();
  
  const stats = {
    total: products.length,
    validated: products.filter(p => p.validation_status === 'validated').length,
    pending: products.filter(p => p.validation_status === 'pending').length,
    needs_review: products.filter(p => p.validation_status === 'needs_review').length,
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

export async function loadTaxonomy() {
  // Taxonomy is pre-loaded from JSON files in data/taxonomy/
  console.log('✓ Taxonomy preloaded from JSON files');
}

export function initializeDatabase() {
  // Ensure database directory exists
  ensureDbDir().catch(console.error);
  console.log(`✓ Database initialized at ${dbDir}`);
}
