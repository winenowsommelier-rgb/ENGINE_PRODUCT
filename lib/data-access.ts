import fs from 'fs';
import path from 'path';

export interface Product {
  id: string;
  sku: string;
  name: string;
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  vintage?: string;
  price?: number;
  cost?: number;
  currency?: string;
  bottle_size?: string;
  alcohol?: string;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  description_confidence?: number;
  validation_status?: string;
  full_description?: string;
  flavor_profile?: string;
  brand?: string;
  image_url?: string;
  image_local_path?: string;
  image_alt_text?: string;
  enrichment_source?: string;
  enrichment_note?: string;
  [key: string]: any;
}

export interface DataQualityMetrics {
  totalProducts: number;
  validatedProducts: number;
  productsNeedingReview: number;
  fieldsWithMissing: Record<string, number>;
  averageConfidence: number;
  coverageByField: Record<string, number>;
}

export interface EnrichmentGap {
  field: string;
  missingCount: number;
  coverage: number;
  priority: number;
}

const dbDir = path.join(process.cwd(), 'data', 'db');
const productsFile = path.join(dbDir, 'products.json');

export class DataAccessService {
  private products: Product[] = [];
  private loaded = false;

  async loadProducts(): Promise<Product[]> {
    if (this.loaded && this.products.length > 0) {
      return this.products;
    }

    try {
      if (fs.existsSync(productsFile)) {
        const data = fs.readFileSync(productsFile, 'utf-8');
        this.products = JSON.parse(data);
        this.loaded = true;
        return this.products;
      }
    } catch (error) {
      console.error('Error loading products:', error);
    }

    return [];
  }

  async getProducts(): Promise<Product[]> {
    return this.loadProducts();
  }

  async getProductBySku(sku: string): Promise<Product | undefined> {
    const products = await this.getProducts();
    return products.find(p => p.sku === sku);
  }

  async getProductsBySkus(skus: string[]): Promise<Product[]> {
    const products = await this.getProducts();
    const skuSet = new Set(skus);
    return products.filter(p => skuSet.has(p.sku));
  }

  async filterProducts(criteria: {
    country?: string;
    region?: string;
    classification?: string;
    validationStatus?: string;
    priceMin?: number;
    priceMax?: number;
    missingField?: string;
    hasField?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ products: Product[]; total: number }> {
    let products = await this.getProducts();

    if (criteria.country) {
      products = products.filter(p => p.country === criteria.country);
    }

    if (criteria.region) {
      products = products.filter(p => p.region === criteria.region);
    }

    if (criteria.classification) {
      products = products.filter(p => p.classification === criteria.classification);
    }

    if (criteria.validationStatus) {
      products = products.filter(p => p.validation_status === criteria.validationStatus);
    }

    if (criteria.priceMin !== undefined) {
      products = products.filter(p => (p.price ?? 0) >= criteria.priceMin!);
    }

    if (criteria.priceMax !== undefined) {
      products = products.filter(p => (p.price ?? 0) <= criteria.priceMax!);
    }

    if (criteria.missingField) {
      products = products.filter(p => !p[criteria.missingField!] || p[criteria.missingField!] === '');
    }

    if (criteria.hasField) {
      products = products.filter(p => p[criteria.hasField!] && p[criteria.hasField!] !== '');
    }

    const total = products.length;
    const offset = criteria.offset ?? 0;
    const limit = criteria.limit ?? 50;

    return {
      products: products.slice(offset, offset + limit),
      total
    };
  }

  async getDataQualityMetrics(): Promise<DataQualityMetrics> {
    const products = await this.getProducts();

    const fieldNames = [
      'country', 'region', 'grape_variety', 'vintage', 'classification',
      'full_description', 'flavor_profile', 'alcohol', 'bottle_size'
    ];

    const fieldsWithMissing: Record<string, number> = {};
    const coverageByField: Record<string, number> = {};

    for (const field of fieldNames) {
      const missing = products.filter(p => !p[field] || p[field] === '').length;
      fieldsWithMissing[field] = missing;
      coverageByField[field] = ((products.length - missing) / products.length) * 100;
    }

    const validatedProducts = products.filter(p => p.validation_status === 'validated').length;
    const productsNeedingReview = products.filter(p => p.validation_status === 'needs_review').length;
    const averageConfidence = products.reduce((sum, p) => sum + (p.overall_confidence ?? 0), 0) / products.length;

    return {
      totalProducts: products.length,
      validatedProducts,
      productsNeedingReview,
      fieldsWithMissing,
      averageConfidence,
      coverageByField
    };
  }

  async getEnrichmentGaps(): Promise<EnrichmentGap[]> {
    const metrics = await this.getDataQualityMetrics();
    const gaps: EnrichmentGap[] = [];

    const priorityMap: Record<string, number> = {
      'full_description': 10,
      'flavor_profile': 8,
      'grape_variety': 7,
      'region': 6,
      'vintage': 5,
      'alcohol': 4,
      'bottle_size': 3
    };

    for (const [field, missing] of Object.entries(metrics.fieldsWithMissing)) {
      if (missing > 0) {
        gaps.push({
          field,
          missingCount: missing,
          coverage: metrics.coverageByField[field] ?? 0,
          priority: priorityMap[field] ?? 1
        });
      }
    }

    return gaps.sort((a, b) => b.priority - a.priority);
  }

  async getProductsForEnrichment(field: string, limit = 20): Promise<Product[]> {
    const { products } = await this.filterProducts({
      missingField: field,
      limit,
      offset: 0
    });
    return products;
  }

  async updateProduct(productId: string, updates: Partial<Product>): Promise<Product | null> {
    const products = await this.getProducts();
    const index = products.findIndex(p => p.id === productId);

    if (index === -1) {
      return null;
    }

    const updatedProduct = {
      ...products[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    products[index] = updatedProduct;

    try {
      fs.writeFileSync(productsFile, JSON.stringify(products, null, 2), 'utf-8');
      this.products = products;
      return updatedProduct;
    } catch (error) {
      console.error('Error updating product:', error);
      return null;
    }
  }

  async updateProductBySku(sku: string, updates: Partial<Product>): Promise<Product | null> {
    const products = await this.getProducts();
    const product = products.find(p => p.sku === sku);

    if (!product) {
      return null;
    }

    return this.updateProduct(product.id, updates);
  }

  async batchUpdateProducts(updates: Array<{ id: string; fields: Partial<Product> }>): Promise<number> {
    let updated = 0;

    for (const { id, fields } of updates) {
      const result = await this.updateProduct(id, fields);
      if (result) {
        updated++;
      }
    }

    return updated;
  }

  async getProductsByConfidenceScore(minConfidence: number, limit = 50): Promise<Product[]> {
    const products = await this.getProducts();
    return products
      .filter(p => (p.overall_confidence ?? 0) >= minConfidence)
      .slice(0, limit);
  }

  async getProductsByValidationStatus(status: string, limit = 50, offset = 0): Promise<{ products: Product[]; total: number }> {
    return this.filterProducts({
      validationStatus: status,
      limit,
      offset
    });
  }

  async searchProducts(query: string, limit = 20): Promise<Product[]> {
    const products = await this.getProducts();
    const lowerQuery = query.toLowerCase();

    return products
      .filter(p =>
        p.sku?.toLowerCase().includes(lowerQuery) ||
        p.name?.toLowerCase().includes(lowerQuery) ||
        p.brand?.toLowerCase().includes(lowerQuery) ||
        p.grape_variety?.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit);
  }

  async getDistinctValues(field: string): Promise<string[]> {
    const products = await this.getProducts();
    const values = new Set<string>();

    for (const product of products) {
      const value = product[field];
      if (value && value !== '') {
        values.add(String(value));
      }
    }

    return Array.from(values).sort();
  }

  async getProductStats(): Promise<{
    byClassification: Record<string, number>;
    byCountry: Record<string, number>;
    byValidationStatus: Record<string, number>;
    priceRange: { min: number; max: number; avg: number };
  }> {
    const products = await this.getProducts();

    const byClassification: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    const byValidationStatus: Record<string, number> = {};
    let minPrice = Infinity;
    let maxPrice = 0;
    let totalPrice = 0;
    let priceCount = 0;

    for (const product of products) {
      if (product.classification) {
        byClassification[product.classification] = (byClassification[product.classification] ?? 0) + 1;
      }
      if (product.country) {
        byCountry[product.country] = (byCountry[product.country] ?? 0) + 1;
      }
      if (product.validation_status) {
        byValidationStatus[product.validation_status] = (byValidationStatus[product.validation_status] ?? 0) + 1;
      }
      if (product.price) {
        minPrice = Math.min(minPrice, product.price);
        maxPrice = Math.max(maxPrice, product.price);
        totalPrice += product.price;
        priceCount++;
      }
    }

    return {
      byClassification,
      byCountry,
      byValidationStatus,
      priceRange: {
        min: minPrice === Infinity ? 0 : minPrice,
        max: maxPrice,
        avg: priceCount > 0 ? totalPrice / priceCount : 0
      }
    };
  }
}

export const dataAccess = new DataAccessService();
