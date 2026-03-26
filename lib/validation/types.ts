// lib/validation/types.ts

export type Segment = 'wine' | 'spirits' | 'beer' | 'accessories' | 'other';

export type ValidationStatus = 'raw' | 'needs_review' | 'needs_attention' | 'validated';

export type Product = Record<string, any>;

// What the pipeline writes back — only fields it extracted (null-only protection applied by engine)
export interface EnrichmentPatch {
  classification?:     string;
  segment?:            string;
  vintage?:            string;
  alcohol?:            string;
  grape_variety?:      string;
  brand?:              string;
  country?:            string;
  region?:             string;
  subregion?:          string;
  appellation?:        string;
  wine_classification?: string;
  wine_body?:          string;
  wine_acidity?:       string;
  wine_tannin?:        string;
  food_matching?:      string;
  flavor_tags?:        string;   // JSON array string
  validation_status?:  ValidationStatus;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  enrichment_note?:    string;
}

export interface TaxonomyProposal {
  type:           'country' | 'region' | 'sub_region' | 'appellation' | 'classification_tier';
  proposed_value: string;
  parent_path:    string;   // NOT NULL — use '' when no parent context; matches DB column
  source_sku:     string;
}

export interface StageResult {
  patch:     EnrichmentPatch;
  proposals: TaxonomyProposal[];
}

export interface RuleSet {
  skuPrefixes:          Array<{ prefix: string; classification: string; segment: string }>;
  grapeVarieties:       Array<{ name: string; aliases: string[] }>;
  brands:               string[];
  regions:              Record<string, Record<string, { aliases: string[]; sub_regions: string[] }>>;
  appellations:         Record<string, string[]>;
  classificationTiers:  Record<string, Record<string, string[]>>;
  bodyKeywords:         Record<string, Record<string, string[]>>;
  flavorKeywords:       Record<string, string[]>;
  foodKeywords:         Record<string, string[]>;
}
