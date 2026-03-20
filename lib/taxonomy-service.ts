/**
 * taxonomy-service.ts
 * Single source of truth for all master taxonomy data.
 * Hierarchy: Country → Region → Sub-region → Origin → Classification → Ingredient → Flavour
 * Aliases live inside each record (ingredient.synonyms, etc.)
 */

import countriesRaw from '@/data/taxonomy/countries.json';
import regionsRaw from '@/data/taxonomy/regions.json';
import subregionsRaw from '@/data/taxonomy/subregions.json';
import originsRaw from '@/data/taxonomy/origin.json';
import classificationsRaw from '@/data/taxonomy/classification_master.json';
import ingredientsRaw from '@/data/taxonomy/ingredient_master.json';
import flavoursRaw from '@/data/taxonomy/flavor_note_master.json';
import categoryConfigRaw from '@/data/taxonomy/category_render_config.json';

// ─── Entity types ─────────────────────────────────────────────────────────────

export type TaxCountry = {
  id: number;
  name: string;
  iso: string;
};

export type TaxRegion = {
  id: number;
  country_id: number;
  name: string;
  aliases: string[]; // user-managed aliases stored in memory
};

export type TaxSubregion = {
  id: number;
  region_id: number;
  name: string;
  subregion_type: string;
  aliases: string[];
};

export type TaxOrigin = {
  id: number;
  subregion_id: number;
  name: string;
  origin_type: string;
  aliases: string[];
};

export type TaxClassification = {
  classification_id: number;
  classification: string;
  classification_slug: string;
  classification_group: string;
  category_scope: string; // 'wine' | 'whisky' | 'all' | etc.
  priority: number;
  description: string;
  is_active: boolean;
};

export type TaxIngredient = {
  ingredient_id: number;
  ingredient: string;        // canonical name
  ingredient_slug: string;
  ingredient_group: string;  // 'red_grape' | 'white_grape' | 'grain' | 'agave' | etc.
  category_scope: string;    // 'wine' | 'whisky' | 'rum' | 'all' | etc.
  is_primary_default: boolean;
  synonyms: string[];        // aliases — from semicolon-separated string in source
  description: string;
  is_active: boolean;
};

export type TaxFlavour = {
  note_id: number;
  note: string;
  note_slug: string;
  note_family: string; // 'fruit' | 'floral' | 'spice' | 'oak_wood' | etc.
  is_active: boolean;
};

export type TaxCategory = {
  category: string;   // 'wine' | 'sparkling_wine' | 'whisky' | etc.
  primary_gauge_keys: string[];
  matrix_labels: { x_left: string; x_right: string; y_bottom: string; y_top: string };
  recommended_blocks: string[];
  is_active: boolean;
};

// ─── Parsed data ──────────────────────────────────────────────────────────────

function n(v: unknown): number { return Number(v) || 0; }
function s(v: unknown): string { return v == null ? '' : String(v).trim(); }
function b(v: unknown): boolean { return Number(v) === 1; }

export const countries: TaxCountry[] = (countriesRaw.data as any[]).map(r => ({
  id: n(r.id), name: s(r.name), iso: s(r.iso),
}));

export const regions: TaxRegion[] = (regionsRaw.data as any[]).map(r => ({
  id: n(r.id), country_id: n(r.country_id), name: s(r.name), aliases: [],
}));

export const subregions: TaxSubregion[] = (subregionsRaw.data as any[]).map(r => ({
  id: n(r.id), region_id: n(r.region_id), name: s(r.name),
  subregion_type: s(r.subregion_type) || 'subregion', aliases: [],
}));

export const origins: TaxOrigin[] = (originsRaw.data as any[]).map(r => ({
  id: n(r.id), subregion_id: n(r.subregion_id), name: s(r.name),
  origin_type: s(r.origin_type) || 'appellation', aliases: [],
}));

export const classifications: TaxClassification[] = (classificationsRaw.data as any[]).map(r => ({
  classification_id: n(r.classification_id),
  classification: s(r.classification),
  classification_slug: s(r.classification_slug),
  classification_group: s(r.classification_group),
  category_scope: s(r.category_scope),
  priority: n(r.priority),
  description: s(r.description),
  is_active: b(r.is_active),
}));

export const ingredients: TaxIngredient[] = (ingredientsRaw.data as any[]).map(r => ({
  ingredient_id: n(r.ingredient_id),
  ingredient: s(r.ingredient),
  ingredient_slug: s(r.ingredient_slug),
  ingredient_group: s(r.ingredient_group),
  category_scope: s(r.category_scope),
  is_primary_default: b(r.is_primary_default),
  synonyms: s(r.synonyms) ? s(r.synonyms).split(';').map(x => x.trim()).filter(Boolean) : [],
  description: s(r.description),
  is_active: b(r.is_active),
}));

export const flavours: TaxFlavour[] = (flavoursRaw.data as any[]).map(r => ({
  note_id: n(r.note_id),
  note: s(r.note),
  note_slug: s(r.note_slug),
  note_family: s(r.note_family),
  is_active: b(r.is_active),
}));

export const categoryConfigs: TaxCategory[] = (categoryConfigRaw.data as any[]).map(r => ({
  category: s(r.category),
  primary_gauge_keys: s(r.primary_gauge_keys).split('|').filter(Boolean),
  matrix_labels: {
    x_left: s(r.matrix_x_left_label),
    x_right: s(r.matrix_x_right_label),
    y_bottom: s(r.matrix_y_bottom_label),
    y_top: s(r.matrix_y_top_label),
  },
  recommended_blocks: s(r.recommended_blocks).split('|').filter(Boolean),
  is_active: b(r.is_active),
}));

// ─── Hierarchy queries ────────────────────────────────────────────────────────

export function getRegionsByCountry(countryId: number): TaxRegion[] {
  return regions.filter(r => r.country_id === countryId);
}

export function getSubregionsByRegion(regionId: number): TaxSubregion[] {
  return subregions.filter(s => s.region_id === regionId);
}

export function getOriginsBySubregion(subregionId: number): TaxOrigin[] {
  return origins.filter(o => o.subregion_id === subregionId);
}

export function getCountryForRegion(regionId: number): TaxCountry | undefined {
  const region = regions.find(r => r.id === regionId);
  if (!region) return undefined;
  return countries.find(c => c.id === region.country_id);
}

// ─── Taxonomy queries by scope / group ───────────────────────────────────────

export function getIngredientsByScope(scope: string): TaxIngredient[] {
  if (!scope || scope === 'all') return ingredients.filter(i => i.is_active);
  return ingredients.filter(i => i.is_active && (i.category_scope === scope || i.category_scope === 'all'));
}

export function getIngredientGroups(scope?: string): string[] {
  const src = scope ? getIngredientsByScope(scope) : ingredients;
  return [...new Set(src.map(i => i.ingredient_group))].sort();
}

export function getClassificationsByScope(scope: string): TaxClassification[] {
  if (!scope || scope === 'all') return classifications.filter(c => c.is_active);
  return classifications.filter(c => c.is_active && (c.category_scope === scope || c.category_scope === 'all'));
}

export function getClassificationGroups(): string[] {
  return [...new Set(classifications.map(c => c.classification_group))].sort();
}

export function getFlavoursByFamily(family?: string): TaxFlavour[] {
  if (!family) return flavours.filter(f => f.is_active);
  return flavours.filter(f => f.is_active && f.note_family === family);
}

export function getFlavourFamilies(): string[] {
  return [...new Set(flavours.map(f => f.note_family))].sort();
}

// ─── Alias resolution ─────────────────────────────────────────────────────────

/** Resolve any alias to a canonical ingredient name */
export function resolveIngredientAlias(value: string): TaxIngredient | undefined {
  const norm = value.trim().toLowerCase();
  return ingredients.find(i =>
    i.ingredient.toLowerCase() === norm ||
    i.ingredient_slug.toLowerCase() === norm ||
    i.synonyms.some(syn => syn.toLowerCase() === norm)
  );
}

/** Resolve country name or ISO code */
export function resolveCountry(value: string): TaxCountry | undefined {
  const norm = value.trim().toLowerCase();
  return countries.find(c =>
    c.name.toLowerCase() === norm || c.iso.toLowerCase() === norm
  );
}

/** Resolve region name, with optional country constraint */
export function resolveRegion(value: string, countryId?: number): TaxRegion | undefined {
  const norm = value.trim().toLowerCase();
  const candidates = countryId ? regions.filter(r => r.country_id === countryId) : regions;
  return candidates.find(r =>
    r.name.toLowerCase() === norm ||
    r.aliases.some(a => a.toLowerCase() === norm)
  );
}

// ─── Grouped views for UI ─────────────────────────────────────────────────────

export type GeographyTree = {
  country: TaxCountry;
  regions: Array<{
    region: TaxRegion;
    subregions: Array<{
      subregion: TaxSubregion;
      origins: TaxOrigin[];
    }>;
  }>;
};

export function buildGeographyTree(): GeographyTree[] {
  return countries.map(country => ({
    country,
    regions: getRegionsByCountry(country.id).map(region => ({
      region,
      subregions: getSubregionsByRegion(region.id).map(subregion => ({
        subregion,
        origins: getOriginsBySubregion(subregion.id),
      })),
    })),
  }));
}

// ─── Lookup maps for fast normalization ──────────────────────────────────────

export const countryByName = new Map(countries.map(c => [c.name.toLowerCase(), c]));
export const countryByIso  = new Map(countries.map(c => [c.iso.toLowerCase(), c]));
export const regionByName  = new Map(regions.map(r => [r.name.toLowerCase(), r]));
export const regionById    = new Map(regions.map(r => [r.id, r]));
export const subregionById = new Map(subregions.map(s => [s.id, s]));
export const countryById   = new Map(countries.map(c => [c.id, c]));

// Build ingredient alias map (all synonyms → canonical ingredient)
export const ingredientByAlias = new Map<string, TaxIngredient>();
for (const ing of ingredients) {
  ingredientByAlias.set(ing.ingredient.toLowerCase(), ing);
  if (ing.ingredient_slug) ingredientByAlias.set(ing.ingredient_slug.toLowerCase(), ing);
  for (const syn of ing.synonyms) {
    if (syn) ingredientByAlias.set(syn.toLowerCase(), ing);
  }
}

// Region → Country lookup
export const regionCountryLookup = new Map<string, string>();
for (const r of regions) {
  const c = countryById.get(r.country_id);
  if (c) regionCountryLookup.set(r.name.toLowerCase(), c.name);
}
