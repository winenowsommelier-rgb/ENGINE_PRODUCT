/**
 * Canonical SKU-prefix taxonomy — TypeScript loader for the catalog app.
 * SKU is the source of truth. Reads the SAME data/taxonomy/sku_prefix_map.json
 * as the Python loader (data/lib/taxonomy/sku_taxonomy.py) and MUST produce
 * identical results — verified by the shared parity fixture in
 * tests/fixtures/sku_taxonomy_cases.json. Keep refineType() in lock-step with
 * the Python refine_type(); any divergence breaks the parity test.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// The group const + type live in a PURE (no-fs) module so client components can import
// CATEGORY_GROUPS without dragging this `fs`-importing module into the browser bundle.
// sku-taxonomy.ts remains the canonical taxonomy entrypoint by re-exporting them.
export { CATEGORY_GROUPS, type CategoryGroup } from './category-constants';
import type { CategoryGroup } from './category-constants';

type Entry = { group: string; type: string };

// Robust multi-candidate resolver — mirrors exportPath() in catalog-data.ts.
// cwd is repo root in the SSG/Vercel build, apps/catalog in local dev. Probe both.
function mapPath(): string {
  const candidates = [
    join(process.cwd(), 'data', 'taxonomy', 'sku_prefix_map.json'),
    join(process.cwd(), '..', '..', 'data', 'taxonomy', 'sku_prefix_map.json'),
    process.env.CATALOG_TAXONOMY_PATH ?? '',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('sku_prefix_map.json not found in any known location');
  return found;
}
type SkuMap = { prefixes: Record<string, Entry>; letter_fallback: Record<string, string> };
const MAP: SkuMap = JSON.parse(readFileSync(mapPath(), 'utf8'));

const FORTIFIED = /\b(port|marsala|madeira|sherry|oloroso|amontillado|fino)\b/i;

// Per-SKU taxonomy overrides — exception-only; the prefix map is the rule. MUST
// stay in lock-step with SKU_OVERRIDES in data/lib/taxonomy/sku_taxonomy.py
// (verified by the shared parity fixture). LSJ0024DG: "Kai Lemongrass Ginger" is
// a New Zealand Kai-brand flavoured vodka (siblings LVK0118-0121DG = Kai vodkas),
// not a Japanese shochu, so the LSJ (Sake & Asian/Shochu) prefix is wrong here.
const SKU_OVERRIDES: Record<string, { group: CategoryGroup; type: string }> = {
  LSJ0024DG: { group: 'Spirits', type: 'Vodka' },
};

function refineType(prefix: string, base: string, name: string): string {
  const n = name || '';
  if (prefix === 'WDW') return FORTIFIED.test(n) ? 'Fortified' : 'Sweet/Dessert';
  if (prefix === 'LBD') {
    const nl = n.toLowerCase();
    if (nl.includes('cognac')) return 'Cognac';
    if (nl.includes('armagnac')) return 'Armagnac';
    return 'Brandy';
  }
  return base;
}

export function resolve(product: { sku?: string | null; name?: string | null }): { group: CategoryGroup; type: string } {
  const sku = String(product.sku ?? '').toUpperCase();
  if (!sku.trim()) return { group: 'Unknown', type: 'Unknown' };
  const ovr = SKU_OVERRIDES[sku];
  if (ovr) return { group: ovr.group, type: ovr.type };
  const p3 = sku.slice(0, 3);
  const entry = MAP.prefixes[p3];
  if (entry) return { group: entry.group as CategoryGroup, type: refineType(p3, entry.type, product.name || '') };
  const grp = (MAP.letter_fallback[sku[0]] as CategoryGroup) || 'Unknown';
  return { group: grp, type: 'Unknown' };
}

export const groupFor = (sku: string): CategoryGroup => resolve({ sku }).group;
export const typeFor = (sku: string): string => resolve({ sku }).type;
