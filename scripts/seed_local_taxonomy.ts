/**
 * Seed local SQLite taxonomy DB from the enrichment data + product export.
 * Run: npx tsx scripts/seed_local_taxonomy.ts
 */
import { getTaxonomyDb } from '../lib/taxonomy-db';

const db = getTaxonomyDb();

console.log('Seeding local taxonomy DB...');

// ── Scopes ────────────────────────────────────────────────────────────────────
const insertScope = db.prepare(`
  INSERT OR IGNORE INTO scopes (id, label, description, icon, sort_order)
  VALUES (?, ?, ?, ?, ?)
`);

const scopes = [
  ['wine', 'Wine', 'Grape-based wines including still, sparkling, fortified, and dessert', '🍷', 1],
  ['spirits', 'Spirits', 'Distilled spirits including whisky, gin, vodka, rum, tequila, brandy', '🥃', 2],
  ['sake', 'Sake & Shochu', 'Japanese rice-based beverages', '🍶', 3],
  ['beer', 'Beer', 'Brewed beverages from grain and hops', '🍺', 4],
  ['asian_spirits', 'Asian Spirits', 'Traditional Asian spirits: soju, baijiu, Thai white spirits', '🫗', 5],
  ['non_alc', 'Non-Alcoholic', 'Non-alcoholic beverages and dealcoholized products', '🧃', 6],
  ['accessories', 'Accessories', 'Glassware, tools, cigars, and related accessories', '🔧', 7],
];
for (const s of scopes) insertScope.run(...s);
console.log(`  Scopes: ${scopes.length}`);

// ── Classification → Scope map ──────────────────────────────────────────────
const insertCSM = db.prepare(`
  INSERT OR IGNORE INTO classification_scope_map (classification, scope_id, sort_order) VALUES (?, ?, ?)
`);
const classMap: [string, string, number][] = [
  ['Red Wine', 'wine', 1], ['White Wine', 'wine', 2], ['Rose Wine', 'wine', 3],
  ['Sparkling Wine', 'wine', 4], ['Champagne', 'wine', 5], ['Dessert Wine', 'wine', 6],
  ['Orange Wine', 'wine', 7], ['Port Wine', 'wine', 8], ['Fruit Wine', 'wine', 9],
  ['Whisky', 'spirits', 10], ['Gin', 'spirits', 11], ['Vodka', 'spirits', 12],
  ['Rum', 'spirits', 13], ['Tequila', 'spirits', 14], ['Brandy', 'spirits', 15],
  ['Liqueur', 'spirits', 16], ['White Spirits', 'spirits', 17],
  ['Sake/Shochu', 'sake', 18], ['Beer', 'beer', 19],
  ['Korean Wine', 'asian_spirits', 20], ['Chinese Spirits', 'asian_spirits', 21],
  ['Thai White Spirits', 'asian_spirits', 22],
  ['Ready to Drink', 'non_alc', 23], ['Non-Alcoholic', 'non_alc', 24], ['Mineral Water', 'non_alc', 25],
  ['Accessories', 'accessories', 26], ['Glassware', 'accessories', 27],
  ['Cigar', 'accessories', 28], ['Events', 'accessories', 29], ['Others', 'accessories', 30],
];
for (const c of classMap) insertCSM.run(...c);
console.log(`  Classifications: ${classMap.length}`);

// ── Character Dimensions ────────────────────────────────────────────────────
const insertDim = db.prepare(`
  INSERT OR IGNORE INTO character_dimensions (id, scope_id, dimension_key, label, description, min_value, max_value, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const dims: [string, string, string, string, string, number, number, number][] = [
  // Wine
  ['wine.body', 'wine', 'body', 'Body', 'Perceived weight and richness on the palate', 0, 5, 1],
  ['wine.acidity', 'wine', 'acidity', 'Acidity', 'Crispness and freshness', 0, 5, 2],
  ['wine.tannin', 'wine', 'tannin', 'Tannin', 'Astringent drying sensation from grape skins and oak', 0, 5, 3],
  ['wine.sweetness', 'wine', 'sweetness', 'Sweetness', 'Residual sugar level', 0, 5, 4],
  ['wine.alcohol', 'wine', 'alcohol', 'Alcohol', 'Warmth and viscosity from alcohol', 0, 5, 5],
  ['wine.intensity', 'wine', 'intensity', 'Intensity', 'Aromatic and flavor concentration', 0, 5, 6],
  ['wine.complexity', 'wine', 'complexity', 'Complexity', 'Number and interplay of distinct flavors', 0, 5, 7],
  ['wine.finish', 'wine', 'finish', 'Finish', 'How long flavors linger after swallowing', 0, 5, 8],
  // Spirits
  ['spirits.body', 'spirits', 'body', 'Body', 'Weight and mouthfeel', 0, 5, 1],
  ['spirits.sweetness', 'spirits', 'sweetness', 'Sweetness', 'Perceived sweetness', 0, 5, 2],
  ['spirits.smoke', 'spirits', 'smoke', 'Smoke', 'Smoky character from peat or char', 0, 5, 3],
  ['spirits.spice', 'spirits', 'spice', 'Spice', 'Warm spice notes', 0, 5, 4],
  ['spirits.complexity', 'spirits', 'complexity', 'Complexity', 'Layered evolving character', 0, 5, 5],
  ['spirits.finish', 'spirits', 'finish', 'Finish', 'Length and character of aftertaste', 0, 5, 6],
  ['spirits.oak', 'spirits', 'oak', 'Oak', 'Barrel aging influence', 0, 5, 7],
  ['spirits.fruit', 'spirits', 'fruit', 'Fruit', 'Fruit-forward character', 0, 5, 8],
  // Sake
  ['sake.body', 'sake', 'body', 'Body', 'Weight from light to rich', 0, 5, 1],
  ['sake.umami', 'sake', 'umami', 'Umami', 'Savory depth', 0, 5, 2],
  ['sake.sweetness', 'sake', 'sweetness', 'Sweetness', 'Residual sweetness', 0, 5, 3],
  ['sake.acidity', 'sake', 'acidity', 'Acidity', 'Crispness that balances sweetness', 0, 5, 4],
  ['sake.fragrance', 'sake', 'fragrance', 'Fragrance', 'Aromatic intensity', 0, 5, 5],
  ['sake.finish', 'sake', 'finish', 'Finish', 'Lingering aftertaste', 0, 5, 6],
  // Beer
  ['beer.body', 'beer', 'body', 'Body', 'Mouthfeel from thin to thick', 0, 5, 1],
  ['beer.bitterness', 'beer', 'bitterness', 'Bitterness', 'Hop bitterness', 0, 5, 2],
  ['beer.sweetness', 'beer', 'sweetness', 'Sweetness', 'Malt-derived sweetness', 0, 5, 3],
  ['beer.carbonation', 'beer', 'carbonation', 'Carbonation', 'Effervescence', 0, 5, 4],
  ['beer.roast', 'beer', 'roast', 'Roast', 'Roasted malt character', 0, 5, 5],
  ['beer.fruit', 'beer', 'fruit', 'Fruit', 'Fruity esters', 0, 5, 6],
];
for (const d of dims) insertDim.run(...d);
console.log(`  Dimensions: ${dims.length}`);

// ── Scope Attribute Defs ────────────────────────────────────────────────────
const insertAttr = db.prepare(`
  INSERT OR IGNORE INTO scope_attribute_defs (id, scope_id, attribute_key, label, data_type, is_required, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const attrs: [string, string, string, string, string, number, number][] = [
  ['wine.key_grapes', 'wine', 'key_grapes', 'Key Grape Varieties', 'text[]', 1, 1],
  ['wine.terroir', 'wine', 'terroir', 'Terroir', 'text', 0, 2],
  ['wine.climate', 'wine', 'climate', 'Climate', 'text', 0, 3],
  ['wine.soil', 'wine', 'soil', 'Soil Types', 'text', 0, 4],
  ['wine.classification_system', 'wine', 'classification_system', 'Classification System', 'text', 0, 5],
  ['wine.aging_potential', 'wine', 'aging_potential', 'Aging Potential', 'text', 0, 6],
  ['wine.production_method', 'wine', 'production_method', 'Production Method', 'text', 0, 7],
  ['spirits.distillation_method', 'spirits', 'distillation_method', 'Distillation Method', 'text', 1, 1],
  ['spirits.base_ingredient', 'spirits', 'base_ingredient', 'Base Ingredient', 'text', 1, 2],
  ['spirits.aging_tradition', 'spirits', 'aging_tradition', 'Aging Tradition', 'text', 0, 3],
  ['spirits.cask_types', 'spirits', 'cask_types', 'Cask Types', 'text[]', 0, 4],
  ['spirits.key_styles', 'spirits', 'key_styles', 'Key Styles', 'text[]', 0, 5],
  ['spirits.regulation', 'spirits', 'regulation', 'Regulation', 'text', 0, 6],
  ['sake.rice_varieties', 'sake', 'rice_varieties', 'Rice Varieties', 'text[]', 1, 1],
  ['sake.water_source', 'sake', 'water_source', 'Water Source', 'text', 0, 2],
  ['sake.polishing_ratio', 'sake', 'polishing_ratio', 'Polishing Ratio', 'text', 0, 3],
  ['sake.brewing_style', 'sake', 'brewing_style', 'Brewing Style', 'text', 0, 4],
  ['sake.grade_system', 'sake', 'grade_system', 'Grade System', 'text', 0, 5],
];
for (const a of attrs) insertAttr.run(...a);
console.log(`  Attribute defs: ${attrs.length}`);

// ── Entities + Contexts from product data ───────────────────────────────────
// Read the exported product library
import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 't1_t2_product_library.json');
let products: any[] = [];
if (fs.existsSync(dataPath)) {
  products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`  Products loaded: ${products.length}`);
} else {
  console.log('  WARNING: t1_t2_product_library.json not found, skipping entity seeding from products');
}

// Also try loading all enrichment results for broader coverage
const enrichDir = path.join(process.cwd(), 'data', 'enrichment_results');
if (fs.existsSync(enrichDir)) {
  const files = fs.readdirSync(enrichDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(enrichDir, file), 'utf-8'));
      if (data.sku && !products.find((p: any) => p.sku === data.sku)) {
        products.push({
          sku: data.sku,
          sku_base: data.sku_base,
          name: data.name,
          classification: data.classification,
        });
      }
    } catch {}
  }
  console.log(`  Total products with enrichment: ${products.length}`);
}

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function safe(v: any) { return (v || '').trim(); }

const insertEntity = db.prepare(`
  INSERT OR IGNORE INTO taxonomy_entities (entity_type, name, slug, parent_id)
  VALUES (?, ?, ?, ?)
`);
const getEntityId = db.prepare(`
  SELECT id FROM taxonomy_entities WHERE entity_type = ? AND slug = ?
`);
const insertContext = db.prepare(`
  INSERT OR IGNORE INTO taxonomy_contexts (entity_id, scope_id, status)
  VALUES (?, ?, 'draft')
`);

// Build scope map
const scopeMap = new Map<string, string>();
for (const c of classMap) scopeMap.set(c[0], c[1]);

// Track parent mappings
const countryForRegion = new Map<string, string>();
const regionForSubregion = new Map<string, string>();
for (const p of products) {
  const country = safe(p.country);
  const region = safe(p.region);
  const subregion = safe(p.subregion);
  if (region && country) countryForRegion.set(region, country);
  if (subregion && region) regionForSubregion.set(subregion, region);
}

// Collect unique values
const countries = new Set<string>();
const regions = new Set<string>();
const subregions = new Set<string>();
const appellations = new Set<string>();
const brands = new Set<string>();
const entityScopes = new Map<string, Set<string>>();

for (const p of products) {
  const scope = scopeMap.get(safe(p.classification));
  if (!scope) continue;
  for (const [field, set] of [['country', countries], ['region', regions], ['subregion', subregions], ['appellation', appellations], ['brand', brands]] as const) {
    const v = safe(p[field]);
    if (v) {
      (set as Set<string>).add(v);
      const key = `${field}:${v}`;
      if (!entityScopes.has(key)) entityScopes.set(key, new Set());
      entityScopes.get(key)!.add(scope);
    }
  }
}

function ensureEntity(type: string, name: string, parentId: number | null = null): number {
  const slug = slugify(name);
  insertEntity.run(type, name, slug, parentId);
  return (getEntityId.get(type, slug) as any).id;
}

// Insert entities with hierarchy
const countryIds = new Map<string, number>();
for (const c of countries) countryIds.set(c, ensureEntity('country', c));

const regionIds = new Map<string, number>();
for (const r of regions) {
  const parentCountry = countryForRegion.get(r);
  const parentId = parentCountry ? countryIds.get(parentCountry) ?? null : null;
  regionIds.set(r, ensureEntity('region', r, parentId));
}

const subregionIds = new Map<string, number>();
for (const s of subregions) {
  const parentRegion = regionForSubregion.get(s);
  const parentId = parentRegion ? regionIds.get(parentRegion) ?? null : null;
  subregionIds.set(s, ensureEntity('subregion', s, parentId));
}

const appellationIds = new Map<string, number>();
for (const a of appellations) appellationIds.set(a, ensureEntity('appellation', a));

const brandIds = new Map<string, number>();
for (const b of brands) brandIds.set(b, ensureEntity('brand', b));

// Create contexts
let ctxCount = 0;
const allMaps: [string, Map<string, number>][] = [
  ['country', countryIds], ['region', regionIds], ['subregion', subregionIds],
  ['appellation', appellationIds], ['brand', brandIds],
];
for (const [field, idMap] of allMaps) {
  for (const [name, eid] of idMap) {
    const scps = entityScopes.get(`${field}:${name}`);
    if (scps) {
      for (const scope of scps) {
        insertContext.run(eid, scope);
        ctxCount++;
      }
    }
  }
}

const entityCount = (db.prepare('SELECT count(*) as n FROM taxonomy_entities').get() as any).n;
const contextCount = (db.prepare('SELECT count(*) as n FROM taxonomy_contexts').get() as any).n;
console.log(`  Entities: ${entityCount}`);
console.log(`  Contexts: ${contextCount}`);

console.log('\nDone! Database at: data/taxonomy.db');
