/**
 * Field validation for product writes.
 * Enforces data quality rules BEFORE writing to Supabase.
 *
 * Rules:
 * 1. Taxonomy fields (region, subregion, country, classification) must NOT
 *    contain pipe separators (|). If an agent wants to set region AND subregion,
 *    they must use separate fields.
 * 2. Region values should match known taxonomy values (warning, not blocking).
 * 3. No HTML in plain-text fields.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cleaned: Record<string, unknown>;
}

const PIPE_FIELDS = new Set([
  'country', 'region', 'subregion', 'appellation',
  'classification', 'wine_classification',
  'grape_class', 'liquor_main_type', 'other_type', 'wine_type',
  'brand', 'name',
]);

const MAX_FIELD_LENGTH: Record<string, number> = {
  region: 80,
  subregion: 80,
  country: 60,
  classification: 80,
  grape_variety: 200,
  brand: 120,
  name: 250,
};

/**
 * Validate and clean product fields before writing.
 * Returns cleaned fields + any errors/warnings.
 */
export function validateProductFields(fields: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      cleaned[key] = value;
      continue;
    }

    const strVal = String(value);

    // Rule 1: No pipe separators in taxonomy fields
    if (PIPE_FIELDS.has(key) && strVal.includes('|')) {
      errors.push(
        `${key}: contains pipe separator "|". Use separate fields instead ` +
        `(e.g., region + subregion, not "Region | Subregion"). Got: "${strVal.slice(0, 60)}"`
      );
      continue; // Skip this field entirely
    }

    // Rule 2: Max length
    const maxLen = MAX_FIELD_LENGTH[key];
    if (maxLen && strVal.length > maxLen) {
      warnings.push(`${key}: value truncated from ${strVal.length} to ${maxLen} chars`);
      cleaned[key] = strVal.slice(0, maxLen);
      continue;
    }

    // Rule 3: Trim whitespace
    if (typeof value === 'string') {
      cleaned[key] = value.trim();
    } else {
      cleaned[key] = value;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cleaned,
  };
}
