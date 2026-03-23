/**
 * lib/taxonomy/service.ts
 * Rich taxonomy entity types, parsed data, lookup maps, and suggestion logic.
 * Consolidated from: lib/taxonomy-service.ts + lib/taxonomy-loader.ts
 * Hierarchy: Country → Region → Sub-region → Origin → Classification → Ingredient → Flavour
 */

import countriesRaw from '@/data/taxonomy/countries.json';
import regionsRaw from '@/data/taxonomy/regions.json';
import subregionsRaw from '@/data/taxonomy/subregions.json';
import originsRaw from '@/data/taxonomy/origin.json';
import classificationsRaw from '@/data/taxonomy/classification_master.json';
import ingredientsRaw from '@/data/taxonomy/ingredient_master.json';
import flavoursRaw from '@/data/taxonomy/flavor_note_master.json';
import categoryConfigRaw from '@/data/taxonomy/category_render_config.json';
import expertSourcesRaw from '@/data/taxonomy/expert_sources.json';

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
  aliases: string[];
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
  category_scope: string;
  priority: number;
  description: string;
  is_active: boolean;
};

export type TaxIngredient = {
  ingredient_id: number;
  ingredient: string;
  ingredient_slug: string;
  ingredient_group: string;
  category_scope: string;
  is_primary_default: boolean;
  synonyms: string[];
  description: string;
  is_active: boolean;
};

export type TaxFlavour = {
  note_id: number;
  note: string;
  note_slug: string;
  note_family: string;
  is_active: boolean;
};

export type TaxCategory = {
  category: string;
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

export function resolveIngredientAlias(value: string): TaxIngredient | undefined {
  const norm = value.trim().toLowerCase();
  return ingredients.find(i =>
    i.ingredient.toLowerCase() === norm ||
    i.ingredient_slug.toLowerCase() === norm ||
    i.synonyms.some(syn => syn.toLowerCase() === norm)
  );
}

export function resolveCountry(value: string): TaxCountry | undefined {
  const norm = value.trim().toLowerCase();
  return countries.find(c =>
    c.name.toLowerCase() === norm || c.iso.toLowerCase() === norm
  );
}

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

export const ingredientByAlias = new Map<string, TaxIngredient>();
for (const ing of ingredients) {
  ingredientByAlias.set(ing.ingredient.toLowerCase(), ing);
  if (ing.ingredient_slug) ingredientByAlias.set(ing.ingredient_slug.toLowerCase(), ing);
  for (const syn of ing.synonyms) {
    if (syn) ingredientByAlias.set(syn.toLowerCase(), ing);
  }
}

export const regionCountryLookup = new Map<string, string>();
for (const r of regions) {
  const c = countryById.get(r.country_id);
  if (c) regionCountryLookup.set(r.name.toLowerCase(), c.name);
}

// ─── TaxonomyMap type and builder (from taxonomy-loader) ─────────────────────

export type TaxonomyMap = {
  countryIdMap: Map<number, string>;
  countryNameMap: Map<string, string>;
  regionIdMap: Map<number, string>;
  regionNameMap: Map<string, string>;
  regionCountryMap: Map<string, string>;
  subregionMap: Map<string, string>;
  originMap: Map<string, string>;
  classificationMap: Map<string, any>;
  ingredientMap: Map<string, any>;
  flavorMap: Map<string, any>;
  flavorFamilyMap: Map<string, string[]>;
  categoryConfigMap: Map<string, any>;
  expertSourcesMap: Map<string, number>;
};

export function buildTaxonomyMaps(): TaxonomyMap {
  const countryIdMap = new Map<number, string>();
  const countryNameMap = new Map<string, string>();
  const regionIdMap = new Map<number, string>();
  const regionNameMap = new Map<string, string>();
  const regionCountryMap = new Map<string, string>();
  const subregionMap = new Map<string, string>();
  const originMap = new Map<string, string>();
  const classificationMap = new Map<string, any>();
  const ingredientMap = new Map<string, any>();
  const flavorMap = new Map<string, any>();
  const flavorFamilyMap = new Map<string, string[]>();
  const categoryConfigMap = new Map<string, any>();
  const expertSourcesMap = new Map<string, number>();

  (countriesRaw.data as any[] ?? []).forEach((c: any) => {
    if (c.id != null && c.name) {
      countryIdMap.set(Number(c.id), c.name);
      countryNameMap.set(c.name.toLowerCase(), c.name);
      if (c.iso) countryNameMap.set(c.iso.toLowerCase(), c.name);
    }
  });

  (regionsRaw.data as any[] ?? []).forEach((r: any) => {
    if (r.id != null && r.name) {
      regionIdMap.set(Number(r.id), r.name);
      regionNameMap.set(r.name.toLowerCase(), r.name);
      const countryName = r.country_id != null ? countryIdMap.get(Number(r.country_id)) : undefined;
      if (countryName) regionCountryMap.set(r.name.toLowerCase(), countryName);
    }
  });

  (subregionsRaw.data as any[] ?? []).forEach((sr: any) => {
    if (sr.name) subregionMap.set(sr.name.toLowerCase(), sr.name);
  });

  (originsRaw.data as any[] ?? []).forEach((o: any) => {
    if (o.name) originMap.set(o.name.toLowerCase(), o.name);
  });

  (classificationsRaw.data as any[] ?? []).forEach((c: any) => {
    if (c.classification) classificationMap.set(c.classification.toLowerCase(), c);
  });

  (ingredientsRaw.data as any[] ?? []).forEach((i: any) => {
    if (!i.ingredient) return;
    ingredientMap.set(i.ingredient.toLowerCase(), i);
    if (i.ingredient_slug) ingredientMap.set(i.ingredient_slug.toLowerCase(), i);
    if (i.synonyms) {
      String(i.synonyms).split(';').forEach((syn: string) => {
        const k = syn.trim().toLowerCase();
        if (k) ingredientMap.set(k, i);
      });
    }
  });

  (flavoursRaw.data as any[] ?? []).forEach((f: any) => {
    if (!f.note) return;
    flavorMap.set(f.note.toLowerCase(), f);
    if (f.note_slug) flavorMap.set(f.note_slug.toLowerCase(), f);
    if (f.note_family) {
      const fam = flavorFamilyMap.get(f.note_family) ?? [];
      fam.push(f.note);
      flavorFamilyMap.set(f.note_family, fam);
    }
  });

  (categoryConfigRaw.data as any[] ?? []).forEach((c: any) => {
    if (c.category) categoryConfigMap.set(c.category.toLowerCase(), c);
  });

  (expertSourcesRaw.data as any[] ?? []).forEach((e: any) => {
    if (e.name) expertSourcesMap.set(e.name.toLowerCase(), Number(e.Score ?? 0));
  });

  return {
    countryIdMap, countryNameMap, regionIdMap, regionNameMap,
    regionCountryMap, subregionMap, originMap, classificationMap,
    ingredientMap, flavorMap, flavorFamilyMap, categoryConfigMap, expertSourcesMap,
  };
}

// ─── Field suggestion helpers (from taxonomy-loader) ─────────────────────────

export type FieldSuggestion = {
  field: string;
  originalValue: string;
  confidence: number;
  suggestions: string[];
  metadata?: Record<string, any>;
};

export function suggestCountry(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'country', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.countryNameMap.has(norm)) {
    return { field: 'country', originalValue: value, confidence: 1, suggestions: [maps.countryNameMap.get(norm)!] };
  }
  const partial = [...maps.countryNameMap.entries()].filter(([k]) => k.includes(norm) || norm.includes(k)).map(([, v]) => v);
  return { field: 'country', originalValue: value, confidence: partial.length ? 0.75 : 0, suggestions: [...new Set(partial)].slice(0, 3) };
}

export function suggestRegion(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'region', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.regionNameMap.has(norm)) {
    const canonical = maps.regionNameMap.get(norm)!;
    const country = maps.regionCountryMap.get(norm);
    return { field: 'region', originalValue: value, confidence: 1, suggestions: [canonical], metadata: { country } };
  }
  const partial = [...maps.regionNameMap.entries()].filter(([k]) => k.includes(norm) || norm.includes(k)).map(([, v]) => v);
  return { field: 'region', originalValue: value, confidence: partial.length ? 0.7 : 0, suggestions: [...new Set(partial)].slice(0, 3) };
}

export function suggestIngredient(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'ingredient', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.ingredientMap.has(norm)) {
    const ing = maps.ingredientMap.get(norm)!;
    return { field: 'ingredient', originalValue: value, confidence: 1, suggestions: [ing.ingredient], metadata: { group: ing.ingredient_group, scope: ing.category_scope } };
  }
  const partial = [...maps.ingredientMap.values()].filter((i: any, idx, arr) => arr.indexOf(i) === idx && (i.ingredient.toLowerCase().includes(norm) || norm.includes(i.ingredient.toLowerCase()))).slice(0, 3);
  return { field: 'ingredient', originalValue: value, confidence: partial.length ? 0.65 : 0, suggestions: partial.map((i: any) => i.ingredient) };
}

export function suggestSubregion(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'subregion', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.subregionMap.has(norm)) {
    return { field: 'subregion', originalValue: value, confidence: 1, suggestions: [maps.subregionMap.get(norm)!] };
  }
  const partial = [...maps.subregionMap.entries()].filter(([k]) => k.includes(norm) || norm.includes(k)).map(([, v]) => v);
  return { field: 'subregion', originalValue: value, confidence: partial.length ? 0.7 : 0, suggestions: [...new Set(partial)].slice(0, 3) };
}

export function suggestOrigin(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'origin', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.originMap.has(norm)) {
    return { field: 'origin', originalValue: value, confidence: 1, suggestions: [maps.originMap.get(norm)!] };
  }
  const partial = [...maps.originMap.entries()].filter(([k]) => k.includes(norm) || norm.includes(k)).map(([, v]) => v);
  return { field: 'origin', originalValue: value, confidence: partial.length ? 0.7 : 0, suggestions: [...new Set(partial)].slice(0, 3) };
}

export function suggestFlavors(value: string, category: string, maps: TaxonomyMap): string[] {
  const catKey = category.toLowerCase().replace(/\s+/g, '_');
  const families: Record<string, string[]> = {
    wine: ['fruit', 'floral', 'earth_savory', 'oak_wood', 'mineral_saline'],
    whisky: ['oak_wood', 'smoky', 'spice', 'sweet', 'nutty'],
    rum: ['sweet', 'spice', 'fruit', 'oak_wood'],
    tequila: ['herbal', 'fruit', 'spice', 'earth_savory'],
    gin: ['herbal', 'floral', 'spice', 'fresh'],
    default: ['fruit', 'spice', 'herbal', 'oak_wood'],
  };
  const key = Object.keys(families).find(k => catKey.includes(k)) ?? 'default';
  const relevantFamilies = families[key];
  const notes: string[] = [];
  relevantFamilies.forEach(fam => {
    const famNotes = maps.flavorFamilyMap.get(fam) ?? [];
    notes.push(...famNotes.slice(0, 3));
  });
  return notes.slice(0, 8);
}

export const taxonomyMaps = buildTaxonomyMaps();
