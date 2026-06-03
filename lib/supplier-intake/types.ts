export type SupplierStatus = 'active' | 'inactive';
export type PricingMode = 'supplier_rsp' | 'formula' | 'hybrid';
export type SupplierPricingStructure = 'rsp_price' | 'no_rsp_price' | 'retail_cash_store';
export type RoundingMode = 'none' | 'nearest_1' | 'nearest_5' | 'nearest_9' | 'nearest_10';
export type IntakeRunStatus = 'registered' | 'normalized' | 'matched' | 'priced' | 'approved' | 'committed' | 'blocked';
export type IntakeRowStatus = 'pending' | 'matched_auto' | 'matched_needs_review' | 'new_code_required' | 'priced' | 'approved' | 'blocked' | 'committed';
export type PriceDecisionSource = 'supplier_rsp' | 'formula' | 'manual_override';
export type SupplierFileFormat = 'csv' | 'xlsx' | 'google_sheet' | 'pdf';

export interface SupplierPricingRule {
  mode: PricingMode;
  target_margin_pct: number;
  minimum_margin_pct: number;
  markup_multiplier?: number;
  vat_pct?: number;
  rounding: RoundingMode;
  review_price_change_pct: number;
}

export interface SupplierDefinition {
  id: string;
  name: string;
  supplier_code: string;
  status: SupplierStatus;
  pricing_structure: SupplierPricingStructure;
  drive_bucket_folder_id?: string;
  drive_folder_id?: string;
  allowed_formats: SupplierFileFormat[];
  default_currency: string;
  pricing_rule: SupplierPricingRule;
  created_at: string;
  updated_at: string;
}

export interface SupplierIntakeRun {
  id: string;
  supplier_id: string;
  supplier_name: string;
  source_filename: string;
  source_format: SupplierFileFormat;
  pricing_structure: SupplierPricingStructure;
  source_bucket_folder_id?: string;
  source_supplier_folder_id?: string;
  source_month_folder_id?: string;
  source_drive_file_id?: string;
  source_file_hash?: string;
  normalized_filename?: string;
  normalized_file_hash?: string;
  status: IntakeRunStatus;
  total_rows: number;
  approved_rows: number;
  blocked_rows: number;
  created_at: string;
  updated_at: string;
  notes?: string;
}

export interface SupplierNormalizedPayload {
  supplier_item_code?: string;
  sku?: string;
  barcode?: string;
  name: string;
  brand?: string;
  category?: string;
  bottle_size?: string;
  vintage?: string;
  country?: string;
  region?: string;
  cost: number;
  rsp?: number;
  currency: string;
}

export interface SupplierNormalizedRow {
  id: string;
  run_id: string;
  row_number: number;
  raw_payload: Record<string, unknown>;
  normalized_payload: SupplierNormalizedPayload;
  status: IntakeRowStatus;
  issues: string[];
  match?: SupplierMatchProposal;
  price?: SupplierPriceProposal;
  approved_by?: string;
  approved_at?: string;
}

export interface SupplierMatchCandidate {
  product_id: string;
  sku: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface SupplierMatchProposal {
  status: 'no_match' | 'strong_match' | 'likely_match' | 'conflict';
  selected_product_id?: string;
  selected_sku?: string;
  confidence: number;
  candidates: SupplierMatchCandidate[];
  reasons: string[];
}

export interface SupplierPriceProposal {
  cost: number;
  supplier_rsp?: number;
  calculated_price: number;
  final_selling_price: number;
  margin_amount: number;
  margin_pct: number;
  decision_source: PriceDecisionSource;
  status: 'auto_approved' | 'needs_review' | 'blocked';
  issues: string[];
}
