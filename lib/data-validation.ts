import { Product } from './data-access';

export interface ValidationRule {
  field: string;
  validate: (value: any) => boolean;
  errorMessage: string;
}

export interface ValidationIssue {
  productId: string;
  sku: string;
  field: string;
  issue: string;
  severity: 'error' | 'warning' | 'info';
  currentValue: any;
}

export interface ValidationResult {
  sku: string;
  isValid: boolean;
  confidence: number;
  issues: ValidationIssue[];
}

const VALID_CLASSIFICATIONS = [
  'Red Wine', 'White Wine', 'Rosé Wine', 'Sparkling Wine', 'Dessert Wine', 'Fortified Wine',
  'Whisky', 'Bourbon', 'Scotch', 'Gin', 'Rum', 'Tequila', 'Vodka', 'Brandy', 'Cognac', 'Liqueur',
  'Beer', 'Lager', 'IPA', 'Stout', 'Porter',
  'Sake', 'Wine', 'Spirit', 'Accessory'
];

const VALID_VALIDATION_STATUSES = ['validated', 'needs_review', 'needs_attention', 'draft'];

const WINE_BODY_LEVELS = ['Light', 'Medium', 'Medium-Full', 'Full'];
const WINE_ACIDITY_LEVELS = ['Low', 'Medium', 'Medium-High', 'High'];
const WINE_TANNIN_LEVELS = ['Low', 'Medium', 'Medium-High', 'High'];

export class DataValidator {
  private rules: ValidationRule[] = [];

  constructor() {
    this.setupDefaultRules();
  }

  private setupDefaultRules() {
    this.rules = [
      {
        field: 'sku',
        validate: (value) => typeof value === 'string' && value.length > 0,
        errorMessage: 'SKU must be a non-empty string'
      },
      {
        field: 'name',
        validate: (value) => typeof value === 'string' && value.length > 0,
        errorMessage: 'Name must be a non-empty string'
      },
      {
        field: 'brand',
        validate: (value) => value === undefined || value === '' || typeof value === 'string',
        errorMessage: 'Brand must be a string'
      },
      {
        field: 'price',
        validate: (value) => value === undefined || value === '' || (typeof value === 'number' && value >= 0),
        errorMessage: 'Price must be a positive number'
      },
      {
        field: 'cost',
        validate: (value) => value === undefined || value === '' || (typeof value === 'number' && value >= 0),
        errorMessage: 'Cost must be a positive number'
      }
    ];
  }

  validateProduct(product: Product): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Check required fields
    if (!product.sku) {
      issues.push({
        productId: product.id,
        sku: product.sku || 'unknown',
        field: 'sku',
        issue: 'Missing SKU',
        severity: 'error',
        currentValue: product.sku
      });
    }

    if (!product.name) {
      issues.push({
        productId: product.id,
        sku: product.sku || 'unknown',
        field: 'name',
        issue: 'Missing product name',
        severity: 'error',
        currentValue: product.name
      });
    }

    // Validate classification
    if (product.classification && !VALID_CLASSIFICATIONS.includes(product.classification)) {
      issues.push({
        productId: product.id,
        sku: product.sku || 'unknown',
        field: 'classification',
        issue: `Invalid classification: "${product.classification}"`,
        severity: 'warning',
        currentValue: product.classification
      });
    }

    // Validate validation_status
    if (product.validation_status && !VALID_VALIDATION_STATUSES.includes(product.validation_status)) {
      issues.push({
        productId: product.id,
        sku: product.sku || 'unknown',
        field: 'validation_status',
        issue: `Invalid validation status: "${product.validation_status}"`,
        severity: 'warning',
        currentValue: product.validation_status
      });
    }

    // Check numeric fields
    if (product.price !== undefined && product.price !== null && product.price !== '') {
      if (typeof product.price !== 'number' || product.price < 0) {
        issues.push({
          productId: product.id,
          sku: product.sku || 'unknown',
          field: 'price',
          issue: 'Price must be a non-negative number',
          severity: 'error',
          currentValue: product.price
        });
      }
    }

    // Check wine-specific fields
    if (product.classification?.includes('Wine')) {
      if (product.grape_variety) {
        const validGrape = this.validateGrapeVariety(product.grape_variety);
        if (!validGrape) {
          issues.push({
            productId: product.id,
            sku: product.sku || 'unknown',
            field: 'grape_variety',
            issue: 'Grape variety format invalid',
            severity: 'info',
            currentValue: product.grape_variety
          });
        }
      }
    }

    // Check alcohol content format
    if (product.alcohol && product.alcohol !== '') {
      if (!this.validateAlcoholContent(product.alcohol)) {
        issues.push({
          productId: product.id,
          sku: product.sku || 'unknown',
          field: 'alcohol',
          issue: 'Alcohol content should be a percentage (e.g., "12.5%")',
          severity: 'warning',
          currentValue: product.alcohol
        });
      }
    }

    // Check vintage format
    if (product.vintage && product.vintage !== '' && product.vintage !== 'NV' && product.vintage !== 'Current vintage') {
      if (!this.validateVintage(product.vintage)) {
        issues.push({
          productId: product.id,
          sku: product.sku || 'unknown',
          field: 'vintage',
          issue: 'Vintage should be a year (e.g., "2020") or "NV"',
          severity: 'info',
          currentValue: product.vintage
        });
      }
    }

    // Check confidence score
    if (product.overall_confidence !== undefined) {
      if (typeof product.overall_confidence !== 'number' || product.overall_confidence < 0 || product.overall_confidence > 1) {
        issues.push({
          productId: product.id,
          sku: product.sku || 'unknown',
          field: 'overall_confidence',
          issue: 'Confidence must be between 0 and 1',
          severity: 'error',
          currentValue: product.overall_confidence
        });
      }
    }

    // Check for missing critical enrichment fields
    const criticalFields = ['country', 'region', 'grape_variety', 'full_description'];
    for (const field of criticalFields) {
      if (!product[field] || product[field] === '') {
        issues.push({
          productId: product.id,
          sku: product.sku || 'unknown',
          field,
          issue: `Missing critical field: ${field}`,
          severity: 'warning',
          currentValue: product[field]
        });
      }
    }

    const isValid = issues.filter(i => i.severity === 'error').length === 0;
    let confidence = product.overall_confidence ?? 0.5;

    // Reduce confidence based on missing fields
    const missingCount = criticalFields.filter(f => !product[f] || product[f] === '').length;
    confidence = Math.max(0, confidence - missingCount * 0.1);

    return {
      sku: product.sku || 'unknown',
      isValid,
      confidence,
      issues
    };
  }

  private validateGrapeVariety(grape: string): boolean {
    // Check for common patterns: "Grape Name" or "Grape Name 50%, Other Name 50%"
    const parts = grape.split(',').map(s => s.trim());
    for (const part of parts) {
      if (!part || part.length === 0) return false;
      // Must have at least a word character
      if (!/[a-z]/i.test(part)) return false;
    }
    return true;
  }

  private validateAlcoholContent(alcohol: string): boolean {
    // Check for percentage format: "12.5%" or "12%"
    return /^\d+(\.\d+)?%?$/.test(alcohol.trim());
  }

  private validateVintage(vintage: string): boolean {
    // Check for 4-digit year between 1900 and current year
    const year = parseInt(vintage, 10);
    return year >= 1900 && year <= new Date().getFullYear();
  }

  validateBatch(products: Product[]): ValidationResult[] {
    return products.map(p => this.validateProduct(p));
  }

  getValidationSummary(results: ValidationResult[]): {
    totalProducts: number;
    validProducts: number;
    issueCount: number;
    errorCount: number;
    warningCount: number;
    averageConfidence: number;
  } {
    const totalProducts = results.length;
    const validProducts = results.filter(r => r.isValid).length;
    let issueCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const result of results) {
      issueCount += result.issues.length;
      errorCount += result.issues.filter(i => i.severity === 'error').length;
      warningCount += result.issues.filter(i => i.severity === 'warning').length;
    }

    const averageConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / totalProducts;

    return {
      totalProducts,
      validProducts,
      issueCount,
      errorCount,
      warningCount,
      averageConfidence
    };
  }
}

export const validator = new DataValidator();
