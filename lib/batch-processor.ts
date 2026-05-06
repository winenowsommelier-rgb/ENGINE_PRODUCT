import { taxonomyMaps, suggestCountry, suggestRegion, suggestSubregion, suggestOrigin, suggestIngredient, suggestFlavors, type FieldSuggestion } from '@/lib/taxonomy/service';

export type { FieldSuggestion };

export type NormalizedRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  // Category
  mainCategory: string;    // wine | spirits | beer | etc
  wine_type: string;       // Red Wine, White Wine, etc
  liquor_main_type: string; // Rum, Whisky, Tequila, etc
  whisky_type: string;
  other_type: string;
  // Origin
  country: string;
  region: string;
  subregion: string;
  origin: string;
  // Product
  grape_class: string;
  grape_variety: string;
  classification: string;
  origin_source: string;
  classification_source: string;
  vintage: string;
  bottle_size: string;
  alcohol: string;
  // Pricing (THB)
  price: number;
  cost: number;
  currency: string;
  is_in_stock: number;
  // Flavor
  flavorNotes: string[];
  flavorFamilies: string[];
  // Meta
  confidence: number;
  fieldSuggestions: Record<string, FieldSuggestion>;
  appliedCorrections: Record<string, string>;
  errors: string[];
  warnings: string[];
  status: 'ready' | 'review' | 'blocked';
};

export type BatchProcessing = {
  id: string;
  sourceName: string;
  createdAt: string;
  totalRows: number;
  readyRows: number;
  reviewRows: number;
  blockedRows: number;
  rows: NormalizedRow[];
};

// Determine main category from raw fields
function detectCategory(row: Record<string, any>): string {
  const wineType = String(row.wine_type || row.type || '').toLowerCase();
  const liquorType = String(row.liquor_main_type || '').toLowerCase();
  const name = String(row.name || '').toLowerCase();
  if (wineType.includes('wine') || wineType.includes('sparkling') || wineType.includes('champagne')) return 'wine';
  if (liquorType.includes('whisky') || liquorType.includes('whiskey')) return 'whisky';
  if (liquorType.includes('rum')) return 'rum';
  if (liquorType.includes('tequila') || liquorType.includes('mezcal')) return 'tequila';
  if (liquorType.includes('gin')) return 'gin';
  if (liquorType.includes('vodka')) return 'vodka';
  if (liquorType.includes('cognac') || liquorType.includes('brandy')) return 'cognac';
  if (liquorType.includes('liqueur')) return 'liqueur';
  if (liquorType.includes('sake')) return 'sake';
  if (liquorType) return 'spirits';
  if (name.includes('wine')) return 'wine';
  return 'unknown';
}

export function normalizeRow(rawRow: Record<string, any>, index: number): NormalizedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fieldSuggestions: Record<string, FieldSuggestion> = {};
  const appliedCorrections: Record<string, string> = {};
  let confidencePoints = 0;
  let maxPoints = 0;

  function score(got: boolean, weight = 1) { maxPoints += weight; if (got) confidencePoints += weight; }

  // SKU
  const sku = String(rawRow.sku || rawRow.SKU || '').trim().toUpperCase();
  if (!sku) errors.push('SKU is required');
  score(!!sku, 2);

  // Name
  const name = String(rawRow.name || '').trim();
  if (!name) errors.push('Product name is required');
  score(!!name, 2);

  const brand = String(rawRow.brand || '').trim();
  const vintage = String(rawRow.vintage || '').trim();
  const bottle_size = String(rawRow.bottle_size || '').trim();
  const alcohol = String(rawRow.alcohol || '').trim();
  const is_in_stock = Number(rawRow.is_in_stock ?? 1);

  // Category
  const mainCategory = detectCategory(rawRow);
  score(mainCategory !== 'unknown');

  const wine_type = String(rawRow.wine_type || '').trim();
  const liquor_main_type = String(rawRow.liquor_main_type || '').trim();
  const whisky_type = String(rawRow.whisky_type || '').trim();
  const other_type = String(rawRow.other_type || '').trim();

  // Country
  let country = String(rawRow.country || '').trim();
  if (country) {
    const cs = suggestCountry(country, taxonomyMaps);
    fieldSuggestions['country'] = cs;
    if (cs.confidence >= 0.9 && cs.suggestions[0]) { appliedCorrections['country'] = cs.suggestions[0]; country = cs.suggestions[0]; }
    else if (cs.confidence >= 0.7 && cs.suggestions[0]) { warnings.push(`Country "${country}" → "${cs.suggestions[0]}" (${Math.round(cs.confidence*100)}% match)`); country = cs.suggestions[0]; }
    else if (!cs.suggestions.length) warnings.push(`Country "${country}" not found in taxonomy`);
    score(cs.confidence >= 0.7, 2);
  } else {
    if (mainCategory === 'wine') warnings.push('Country not provided for wine product');
    errors.push('Country is required');
    score(false, 2);
  }

  // Region
  let region = String(rawRow.region_wine || rawRow.region || rawRow.region_wine_1 || '').trim();
  let inferredCountry = country;
  if (region) {
    const rs = suggestRegion(region, taxonomyMaps);
    fieldSuggestions['region'] = rs;
    if (rs.confidence >= 0.9 && rs.suggestions[0]) { appliedCorrections['region'] = rs.suggestions[0]; region = rs.suggestions[0]; }
    else if (rs.confidence >= 0.7 && rs.suggestions[0]) { warnings.push(`Region "${region}" → "${rs.suggestions[0]}"`); region = rs.suggestions[0]; }
    if (!country && rs.metadata?.country) { inferredCountry = rs.metadata.country; appliedCorrections['country'] = inferredCountry; }
    score(rs.confidence >= 0.7, 2);
  } else {
    warnings.push('Region not provided');
    score(false, 2);
  }

  // Subregion
  let subregion = String(rawRow.subregion || rawRow.region_wine_2 || '').trim();
  if (subregion) {
    const ss = suggestSubregion(subregion, taxonomyMaps);
    fieldSuggestions['subregion'] = ss;
    if (ss.confidence >= 0.9 && ss.suggestions[0]) { appliedCorrections['subregion'] = ss.suggestions[0]; subregion = ss.suggestions[0]; }
    else if (ss.confidence >= 0.7 && ss.suggestions[0]) { warnings.push(`Subregion "${subregion}" → "${ss.suggestions[0]}"`); subregion = ss.suggestions[0]; }
    else if (!ss.suggestions.length) warnings.push(`Subregion "${subregion}" not found in taxonomy`);
    score(ss.confidence >= 0.7);
  } else {
    score(false);
  }

  // Origin
  let origin = String(rawRow.origin || '').trim();
  if (origin) {
    const os = suggestOrigin(origin, taxonomyMaps);
    fieldSuggestions['origin'] = os;
    if (os.confidence >= 0.9 && os.suggestions[0]) { appliedCorrections['origin'] = os.suggestions[0]; origin = os.suggestions[0]; }
    else if (os.confidence >= 0.7 && os.suggestions[0]) { warnings.push(`Origin "${origin}" → "${os.suggestions[0]}"`); origin = os.suggestions[0]; }
    else if (!os.suggestions.length) warnings.push(`Origin "${origin}" not found in taxonomy`);
    score(os.confidence >= 0.7);
  } else {
    score(false);
  }

  // Grape / ingredient
  const grapeRaw = String(rawRow.grape_variety || rawRow.grape_class || rawRow.grape || '').trim();
  let grape_variety = grapeRaw;
  const grape_class = String(rawRow.grape_class || '').trim();
  if (grapeRaw) {
    const is = suggestIngredient(grapeRaw, taxonomyMaps);
    fieldSuggestions['ingredient'] = is;
    if (is.confidence >= 0.9 && is.suggestions[0]) { grape_variety = is.suggestions[0]; }
    else if (is.confidence >= 0.7 && is.suggestions[0]) { grape_variety = is.suggestions[0]; }
    score(is.confidence >= 0.7);
  } else score(false);

  // Item category
  let classification = String(rawRow.classification || '').trim();
  let classificationSource = 'input';
  if (!classification) {
    // Try to derive from category / name heuristics
    classification = mainCategory !== 'unknown' ? `${mainCategory.charAt(0).toUpperCase()}${mainCategory.slice(1)} product` : '';
    classificationSource = classification ? 'derived' : 'unknown';
  }
  if (!classification) {
    errors.push('Item Category is required');
  }

  // Price / cost
  const price = parseFloat(String(rawRow.price || '0').replace(/[^0-9.]/g, '')) || 0;
  const cost = parseFloat(String(rawRow.cost || rawRow.costPrice || '0').replace(/[^0-9.]/g, '')) || 0;
  if (price <= 0) errors.push('Price must be greater than 0');
  score(price > 0, 2);

  // Flavor notes
  const flavorNotes = suggestFlavors(mainCategory, wine_type || liquor_main_type, taxonomyMaps);
  const flavorFamilies = [...new Set(flavorNotes.map(n => {
    const rec = taxonomyMaps.flavorMap.get(n.toLowerCase());
    return rec?.note_family ?? 'unknown';
  }))].filter(f => f !== 'unknown');

  const confidence = maxPoints > 0 ? confidencePoints / maxPoints : 0;
  const status: NormalizedRow['status'] = errors.length > 0 ? 'blocked' : confidence >= 0.75 ? 'ready' : 'review';

  return {
    id: `row-${index}-${Date.now()}`,
    sku, name, brand, mainCategory, wine_type, liquor_main_type,
    whisky_type, other_type,
    country: inferredCountry, region,
    subregion, origin,
    grape_class, grape_variety,
    classification,
    origin_source: rawRow.origin ? 'input' : 'derived',
    classification_source: classificationSource,
    vintage, bottle_size, alcohol,
    price, cost, currency: String(rawRow.currency || 'THB').trim(),
    is_in_stock, flavorNotes, flavorFamilies,
    confidence, fieldSuggestions, appliedCorrections,
    errors, warnings, status,
  };
}

const CHANGELOG_FIELDS = ['country', 'region', 'classification', 'grape_variety',
  'subregion', 'origin', 'wine_type', 'liquor_main_type'];

export function processBatch(rows: Record<string, any>[], sourceName = 'upload'): BatchProcessing {
  const normalized = rows.map((r, i) => normalizeRow(r, i));

  // Write changelog entries server-side only (dynamic import avoids fs errors in client bundles)
  if (typeof window === 'undefined') {
    const allEntries = normalized.flatMap((row) =>
      CHANGELOG_FIELDS
        .filter(f => (row as any)[f])
        .map(f => ({
          product_id: row.id,
          sku: row.sku,
          source: 'batch_process' as const,
          field: f,
          old_value: null as string | null,
          new_value: String((row as any)[f]),
          note: null as string | null,
        }))
    );
    if (allEntries.length > 0) {
      import('@/lib/db/client').then(({ addChangelogEntries }) => {
        addChangelogEntries(allEntries).catch(console.error);
      });
    }
  }

  return {
    id: `batch-${Date.now()}`,
    sourceName,
    createdAt: new Date().toISOString(),
    totalRows: normalized.length,
    readyRows: normalized.filter(r => r.status === 'ready').length,
    reviewRows: normalized.filter(r => r.status === 'review').length,
    blockedRows: normalized.filter(r => r.status === 'blocked').length,
    rows: normalized,
  };
}

// Export to Magento CSV matching the exact template columns
export function exportToMagentoCSV(rows: NormalizedRow[]): string {
  const COLS = [
    'sku', 'name', 'is_in_stock', 'manufacturer', 'brand',
    'wine_type', 'country', 'region_wine', 'grape_class', 'grape_variety',
    'alcohol', 'vintage', 'bottle_size', 'price', 'cost',
    'liquor_main_type', 'other_type', 'whisky_type',
    'flavor_notes', 'confidence_score', 'status',
  ];
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.join(',')];
  for (const r of rows) {
    lines.push([
      r.sku, r.name, r.is_in_stock, r.brand, r.brand,
      r.wine_type, r.country, r.region, r.grape_class, r.grape_variety,
      r.alcohol, r.vintage, r.bottle_size, r.price, r.cost,
      r.liquor_main_type, r.other_type, r.whisky_type,
      r.flavorNotes.join('; '), (r.confidence * 100).toFixed(0) + '%', r.status,
    ].map(escape).join(','));
  }
  return lines.join('\n');
}

// Export basic CSV for review
export function exportToReviewCSV(rows: NormalizedRow[]): string {
  const COLS = ['sku', 'name', 'status', 'confidence', 'country', 'region', 'grape_variety', 'wine_type', 'liquor_main_type', 'price', 'errors', 'warnings'];
  const escape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.join(',')];
  for (const r of rows) {
    lines.push([
      r.sku, r.name, r.status, (r.confidence * 100).toFixed(0) + '%',
      r.country, r.region, r.grape_variety, r.wine_type, r.liquor_main_type,
      r.price, r.errors.join('; '), r.warnings.join('; '),
    ].map(escape).join(','));
  }
  return lines.join('\n');
}
