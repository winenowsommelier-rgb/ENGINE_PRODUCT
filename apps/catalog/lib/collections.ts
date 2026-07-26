/**
 * collections — load curated collection definitions and map them to shop-filter
 * params.
 *
 * Task 1/2 produce `data/collections_export.json`: a JSON array of
 * `{slug, name, description, filter}` where `filter` is a plain object of
 * allowlisted shop-filter keys.
 *
 * DEFENSE IN DEPTH (spec §7): the Python exporter already restricts `filter` to
 * the allowlist below, but `collectionToShopParams` re-applies the SAME allowlist
 * at read time so that even a bad key that somehow reaches the JSON (grape/variety
 * — BLOCKED by §7 — or the wrong `category` key) can never become a shop param.
 * The shop engine's category key is `class` (category_type), NOT `category`.
 */
import fs from 'fs';
import path from 'path';
import type { ShopParams } from './shop-query';

export interface CollectionDef {
  slug: string;
  name: string;
  description: string;
  filter: Record<string, string>;
}

/**
 * The read-side allowlist — MUST mirror the Python exporter's allowlist.
 * `class` is the category_type key (NOT `category`); grape/variety are
 * deliberately absent (spec §7 BLOCKED).
 */
const ALLOWED_KEYS = new Set([
  'country', 'region', 'subregion', 'class', 'body', 'acidity', 'tannin', 'price',
]);

/**
 * Resolve the absolute path to collections_export.json. cwd differs between local
 * dev (apps/catalog) and the Vercel build (repo root), so probe both known
 * locations — same dual-path pattern as catalog-data.ts:exportPath().
 * Returns null when the file does not exist anywhere (build must not break before
 * the file is generated).
 */
function collectionsPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'data', 'collections_export.json'),             // cwd = repo root
    path.join(process.cwd(), '..', '..', 'data', 'collections_export.json'), // cwd = apps/catalog
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

// Module-level singleton: parse the file ONCE per process, then serve from memory.
let _collections: CollectionDef[] | null = null;

/**
 * All collection definitions, parsed and cached for the process lifetime.
 * Returns [] when the export file is absent (do NOT throw — the build must not
 * break before Task 1/2 generate the file).
 */
export function getCollections(): CollectionDef[] {
  if (_collections !== null) return _collections;
  const file = collectionsPath();
  if (!file) {
    _collections = [];
    return _collections;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  _collections = Array.isArray(raw) ? (raw as CollectionDef[]) : [];
  return _collections;
}

/** Look up a single collection by slug; undefined for an unknown slug. */
export function getCollectionBySlug(slug: string): CollectionDef | undefined {
  return getCollections().find((c) => c.slug === slug);
}

/**
 * Map a collection's filter to ShopParams, keeping ONLY allowlisted keys.
 * Drops category/grape/variety and anything unknown (defense in depth, §7).
 */
export function collectionToShopParams(def: CollectionDef): ShopParams {
  const out: ShopParams = {};
  for (const [k, v] of Object.entries(def.filter)) {
    if (ALLOWED_KEYS.has(k)) out[k] = v;
  }
  return out;
}
