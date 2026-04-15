/**
 * Local SQLite taxonomy knowledge library.
 * Self-contained — no external database dependency.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'taxonomy.db');
const EXPERT_PATH = path.join(process.cwd(), 'data', 'expert_knowledge_library.csv');

let _db: Database.Database | null = null;

// ── Expert library overlay ───────────────────────────────────────────────────

interface ExpertEntry {
  pack_type: string;
  canonical_name: string;
  scope: string;
  knowledge_short_en: string;
  knowledge_full_en: string;
  signature_varieties_or_styles: string;
  signature_regions_or_appellations: string;
  house_or_category_traits: string;
  use_cases: string;
  confidence_level: string;
  source_basis: string;
  last_reviewed: string;
}

let _expertCache: { mtime: number; byTypeAndName: Map<string, ExpertEntry> } | null = null;

function parseCSVLineExpert(line: string): string[] {
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

function getExpertLibrary(): Map<string, ExpertEntry> {
  if (!fs.existsSync(EXPERT_PATH)) return new Map();
  const stat = fs.statSync(EXPERT_PATH);
  const mtime = stat.mtimeMs;
  if (_expertCache && _expertCache.mtime === mtime) return _expertCache.byTypeAndName;

  const text = fs.readFileSync(EXPERT_PATH, 'utf-8');
  const lines = text.split('\n');
  const headers = parseCSVLineExpert(lines[0]);
  const byTypeAndName = new Map<string, ExpertEntry>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLineExpert(lines[i]);
    const entry: any = {};
    headers.forEach((h, idx) => { entry[h] = values[idx] || ''; });
    // Key: "packType|name" lowercase
    const key = `${entry.pack_type}|${entry.canonical_name.toLowerCase()}`;
    byTypeAndName.set(key, entry);
  }

  _expertCache = { mtime, byTypeAndName };
  return byTypeAndName;
}

/** Overlay expert content onto contexts for a given entity */
function overlayExpertContexts(entity: any, contexts: any[]): any[] {
  const expertLib = getExpertLibrary();
  if (expertLib.size === 0) return contexts;

  const key = `${entity.entity_type}|${entity.name.toLowerCase()}`;
  const expert = expertLib.get(key);
  if (!expert) return contexts;

  // Find the context matching the expert's scope, or use the first one
  const targetScope = expert.scope || (contexts[0]?.scope_id);
  if (!targetScope) return contexts;

  return contexts.map(c => {
    if (c.scope_id !== targetScope) return c;
    // Overlay: prefer expert content, keep metadata
    return {
      ...c,
      description_short: expert.knowledge_short_en || c.description_short,
      description_en: expert.knowledge_full_en || c.description_en,
      status: c.status === 'published' ? c.status : 'validated',
      expert_overlay: true,
      expert_confidence: expert.confidence_level,
      expert_source: expert.source_basis,
      expert_signature_varieties: expert.signature_varieties_or_styles,
      expert_signature_regions: expert.signature_regions_or_appellations,
      expert_house_traits: expert.house_or_category_traits,
      expert_use_cases: expert.use_cases,
      expert_last_reviewed: expert.last_reviewed,
    };
  });
}

export function getTaxonomyDb(): Database.Database {
  if (_db) return _db;

  // Ensure data dir exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Initialize schema
  _db.exec(SCHEMA);

  return _db;
}

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scopes (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS classification_scope_map (
  classification TEXT PRIMARY KEY,
  scope_id       TEXT NOT NULL REFERENCES scopes(id),
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_dimensions (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  dimension_key TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  min_value     REAL NOT NULL DEFAULT 0,
  max_value     REAL NOT NULL DEFAULT 5,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(scope_id, dimension_key)
);

CREATE TABLE IF NOT EXISTS scope_attribute_defs (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  attribute_key TEXT NOT NULL,
  label         TEXT NOT NULL,
  data_type     TEXT NOT NULL DEFAULT 'text',
  options       TEXT,
  is_required   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(scope_id, attribute_key)
);

CREATE TABLE IF NOT EXISTS taxonomy_entities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  parent_id   INTEGER REFERENCES taxonomy_entities(id),
  latitude    REAL,
  longitude   REAL,
  iso_code    TEXT,
  image_url   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, slug)
);

CREATE INDEX IF NOT EXISTS idx_te_type ON taxonomy_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_te_parent ON taxonomy_entities(parent_id);

CREATE TABLE IF NOT EXISTS taxonomy_contexts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id         INTEGER NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  scope_id          TEXT NOT NULL REFERENCES scopes(id),
  description_short TEXT,
  description_en    TEXT,
  attributes        TEXT DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft',
  validated_by      TEXT,
  validated_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_id, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_tc_scope ON taxonomy_contexts(scope_id);
CREATE INDEX IF NOT EXISTS idx_tc_status ON taxonomy_contexts(status);

CREATE TABLE IF NOT EXISTS taxonomy_benchmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  context_id    INTEGER NOT NULL REFERENCES taxonomy_contexts(id) ON DELETE CASCADE,
  dimension_id  TEXT NOT NULL REFERENCES character_dimensions(id),
  typical_value REAL NOT NULL,
  range_low     REAL,
  range_high    REAL,
  UNIQUE(context_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS taxonomy_relationships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity_id  INTEGER NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  to_entity_id    INTEGER NOT NULL REFERENCES taxonomy_entities(id) ON DELETE CASCADE,
  relationship    TEXT NOT NULL,
  scope_id        TEXT REFERENCES scopes(id),
  metadata        TEXT DEFAULT '{}',
  UNIQUE(from_entity_id, to_entity_id, relationship, scope_id)
);

CREATE TABLE IF NOT EXISTS product_vintages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_base        TEXT NOT NULL,
  vintage_year    INTEGER NOT NULL,
  description_en  TEXT,
  character       TEXT,
  price           REAL,
  cost_price      REAL,
  availability    TEXT DEFAULT 'available',
  is_current      INTEGER NOT NULL DEFAULT 0,
  rating_score    REAL,
  rating_source   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sku_base, vintage_year)
);
`;

// ── Query helpers ────────────────────────────────────────────────────────────

export function getScopes() {
  return getTaxonomyDb().prepare('SELECT * FROM scopes ORDER BY sort_order').all();
}

export function getScopeForClassification(classification: string): string | null {
  const row = getTaxonomyDb().prepare(
    'SELECT scope_id FROM classification_scope_map WHERE classification = ?'
  ).get(classification) as any;
  return row?.scope_id ?? null;
}

export function getCharacterDimensions(scopeId: string) {
  return getTaxonomyDb().prepare(
    'SELECT * FROM character_dimensions WHERE scope_id = ? ORDER BY sort_order'
  ).all(scopeId);
}

export function getAttributeDefs(scopeId: string) {
  return getTaxonomyDb().prepare(
    'SELECT * FROM scope_attribute_defs WHERE scope_id = ? ORDER BY sort_order'
  ).all(scopeId);
}

export function listEntities(opts: {
  entityType?: string;
  scopeId?: string;
  status?: string;
  search?: string;
  parentId?: number | null;
  limit?: number;
}) {
  const db = getTaxonomyDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.entityType) { conditions.push('e.entity_type = ?'); params.push(opts.entityType); }
  if (opts.parentId) { conditions.push('e.parent_id = ?'); params.push(opts.parentId); }
  if (opts.search) { conditions.push('e.name LIKE ?'); params.push(`%${opts.search}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 200;

  const entities = db.prepare(`
    SELECT e.* FROM taxonomy_entities e ${where} ORDER BY e.name ASC LIMIT ?
  `).all(...params, limit) as any[];

  if (entities.length === 0) return [];

  const ids = entities.map(e => e.id);
  const placeholders = ids.map(() => '?').join(',');

  let ctxWhere = `entity_id IN (${placeholders})`;
  const ctxParams: any[] = [...ids];
  if (opts.scopeId) { ctxWhere += ' AND scope_id = ?'; ctxParams.push(opts.scopeId); }
  if (opts.status) { ctxWhere += ' AND status = ?'; ctxParams.push(opts.status); }

  const contexts = db.prepare(`
    SELECT * FROM taxonomy_contexts WHERE ${ctxWhere}
  `).all(...ctxParams) as any[];

  // Parse JSON attributes
  const parsedContexts = contexts.map(c => ({
    ...c,
    attributes: c.attributes ? JSON.parse(c.attributes) : {},
  }));

  // Filter entities if scope/status filter active
  let result = entities;
  if (opts.scopeId || opts.status) {
    const matchedIds = new Set(parsedContexts.map(c => c.entity_id));
    result = entities.filter(e => matchedIds.has(e.id));
  }

  return result.map(e => ({
    ...e,
    contexts: overlayExpertContexts(e, parsedContexts.filter(c => c.entity_id === e.id)),
  }));
}

export function getEntityDetail(id: number) {
  const db = getTaxonomyDb();

  const entity = db.prepare('SELECT * FROM taxonomy_entities WHERE id = ?').get(id) as any;
  if (!entity) return null;

  // Build breadcrumb
  const breadcrumb: any[] = [];
  let current = entity;
  while (current) {
    breadcrumb.unshift({ id: current.id, name: current.name, entity_type: current.entity_type });
    if (current.parent_id) {
      current = db.prepare('SELECT * FROM taxonomy_entities WHERE id = ?').get(current.parent_id) as any;
    } else {
      current = null;
    }
  }

  // Get all contexts
  const contexts = db.prepare(
    'SELECT * FROM taxonomy_contexts WHERE entity_id = ?'
  ).all(id) as any[];

  const parsedContexts = contexts.map(c => ({
    ...c,
    attributes: c.attributes ? JSON.parse(c.attributes) : {},
  }));

  return { entity, breadcrumb, contexts: overlayExpertContexts(entity, parsedContexts) };
}

export function updateContext(contextId: number, data: {
  description_short?: string;
  description_en?: string;
  attributes?: Record<string, any>;
  status?: string;
}) {
  const db = getTaxonomyDb();
  const sets: string[] = [];
  const params: any[] = [];

  if (data.description_short !== undefined) { sets.push('description_short = ?'); params.push(data.description_short); }
  if (data.description_en !== undefined) { sets.push('description_en = ?'); params.push(data.description_en); }
  if (data.attributes !== undefined) { sets.push('attributes = ?'); params.push(JSON.stringify(data.attributes)); }
  if (data.status !== undefined) {
    sets.push('status = ?');
    params.push(data.status);
    if (data.status === 'validated' || data.status === 'published') {
      sets.push('validated_at = datetime("now")');
    }
  }
  sets.push('updated_at = datetime("now")');

  params.push(contextId);
  return db.prepare(`UPDATE taxonomy_contexts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getTaxonomyContextForEntity(entityType: string, entityName: string, scopeId: string) {
  const db = getTaxonomyDb();
  return db.prepare(`
    SELECT c.* FROM taxonomy_contexts c
    JOIN taxonomy_entities e ON e.id = c.entity_id
    WHERE e.entity_type = ? AND e.name = ? AND c.scope_id = ?
  `).get(entityType, entityName, scopeId) as any;
}

export function getTaxonomyStats() {
  const db = getTaxonomyDb();
  const total = (db.prepare('SELECT count(*) as n FROM taxonomy_contexts').get() as any).n;
  const validated = (db.prepare("SELECT count(*) as n FROM taxonomy_contexts WHERE status = 'validated'").get() as any).n;
  const published = (db.prepare("SELECT count(*) as n FROM taxonomy_contexts WHERE status = 'published'").get() as any).n;
  const entities = (db.prepare('SELECT count(*) as n FROM taxonomy_entities').get() as any).n;
  return { total, validated, published, draft: total - validated - published, entities };
}
