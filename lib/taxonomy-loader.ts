import countriesData from '@/data/taxonomy/countries.json';
import regionsData from '@/data/taxonomy/regions.json';
import subregionsData from '@/data/taxonomy/subregions.json';
import originData from '@/data/taxonomy/origin.json';
import classificationData from '@/data/taxonomy/classification_master.json';
import ingredientData from '@/data/taxonomy/ingredient_master.json';
import flavorData from '@/data/taxonomy/flavor_note_master.json';
import categoryConfigData from '@/data/taxonomy/category_render_config.json';
import expertSourcesData from '@/data/taxonomy/expert_sources.json';

export type TaxonomyMap = {
  countryIdMap: Map<number, string>;
  countryNameMap: Map<string, string>; // lowercase name/iso -> canonical name
  regionIdMap: Map<number, string>;
  regionNameMap: Map<string, string>; // lowercase -> canonical
  regionCountryMap: Map<string, string>; // region lowercase -> country name
  subregionMap: Map<string, string>;
  originMap: Map<string, string>;
  classificationMap: Map<string, any>;
  ingredientMap: Map<string, any>; // lowercase name/synonym -> ingredient record
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

  // Countries
  (countriesData.data as any[] ?? []).forEach((c: any) => {
    if (c.id != null && c.name) {
      countryIdMap.set(Number(c.id), c.name);
      countryNameMap.set(c.name.toLowerCase(), c.name);
      if (c.iso) countryNameMap.set(c.iso.toLowerCase(), c.name);
    }
  });

  // Regions
  (regionsData.data as any[] ?? []).forEach((r: any) => {
    if (r.id != null && r.name) {
      regionIdMap.set(Number(r.id), r.name);
      regionNameMap.set(r.name.toLowerCase(), r.name);
      const countryName = r.country_id != null ? countryIdMap.get(Number(r.country_id)) : undefined;
      if (countryName) regionCountryMap.set(r.name.toLowerCase(), countryName);
    }
  });

  // Subregions
  (subregionsData.data as any[] ?? []).forEach((s: any) => {
    if (s.name) subregionMap.set(s.name.toLowerCase(), s.name);
  });

  // Origins
  (originData.data as any[] ?? []).forEach((o: any) => {
    if (o.name) originMap.set(o.name.toLowerCase(), o.name);
  });

  // Classifications
  (classificationData.data as any[] ?? []).forEach((c: any) => {
    if (c.classification) classificationMap.set(c.classification.toLowerCase(), c);
  });

  // Ingredients — synonyms separated by semicolons
  (ingredientData.data as any[] ?? []).forEach((i: any) => {
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

  // Flavors
  (flavorData.data as any[] ?? []).forEach((f: any) => {
    if (!f.note) return;
    flavorMap.set(f.note.toLowerCase(), f);
    if (f.note_slug) flavorMap.set(f.note_slug.toLowerCase(), f);
    if (f.note_family) {
      const fam = flavorFamilyMap.get(f.note_family) ?? [];
      fam.push(f.note);
      flavorFamilyMap.set(f.note_family, fam);
    }
  });

  // Category Config
  (categoryConfigData.data as any[] ?? []).forEach((c: any) => {
    if (c.category) categoryConfigMap.set(c.category.toLowerCase(), c);
  });

  // Expert Sources
  (expertSourcesData.data as any[] ?? []).forEach((e: any) => {
    if (e.name) expertSourcesMap.set(e.name.toLowerCase(), Number(e.Score ?? 0));
  });

  return {
    countryIdMap, countryNameMap, regionIdMap, regionNameMap,
    regionCountryMap, subregionMap, originMap, classificationMap,
    ingredientMap, flavorMap, flavorFamilyMap, categoryConfigMap, expertSourcesMap,
  };
}

export type FieldSuggestion = {
  field: string;
  originalValue: string;
  confidence: number; // 0-1
  suggestions: string[];
  metadata?: Record<string, any>;
};

export function suggestCountry(value: string, maps: TaxonomyMap): FieldSuggestion {
  const norm = value.trim().toLowerCase();
  if (!norm) return { field: 'country', originalValue: value, confidence: 0, suggestions: [] };

  if (maps.countryNameMap.has(norm)) {
    return { field: 'country', originalValue: value, confidence: 1, suggestions: [maps.countryNameMap.get(norm)!] };
  }
  // Partial match
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

export function suggestFlavors(value: string, category: string, maps: TaxonomyMap): string[] {
  // Return relevant flavor notes based on category/type
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
