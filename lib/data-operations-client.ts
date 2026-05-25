/**
 * Client for calling data operations API from this chat or external scripts
 * Usage: import and call the functions directly
 */

const API_BASE = 'http://localhost:3000';

export interface DataOperationsClient {
  analyze: () => Promise<any>;
  validate: (limit?: number) => Promise<any>;
  search: (query: string, limit?: number) => Promise<any>;
  enrich: (field: string, limit?: number) => Promise<any>;
  enrichBatch: (field: string, count?: number) => Promise<any>;
  getGaps: () => Promise<any>;
  getStats: () => Promise<any>;
  getProduct: (sku: string) => Promise<any>;
  updateProduct: (productId: string, updates: any, note?: string) => Promise<any>;
  getForEnrichment: (field: string, limit?: number) => Promise<any>;
}

class DataOperationsAPIClient implements DataOperationsClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async call(action: string, params: any = {}) {
    const response = await fetch(`${this.baseUrl}/api/data-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API call failed');
    }

    return response.json();
  }

  async analyze() {
    return this.call('analyze');
  }

  async validate(limit: number = 100) {
    return this.call('validate', { limit });
  }

  async search(query: string, limit: number = 20) {
    return this.call('search', { query, limit });
  }

  async enrich(field: string, limit: number = 10) {
    return this.call('enrich', { field, limit });
  }

  async enrichBatch(field: string, count: number = 50) {
    return this.call('enrich-batch', { field, count });
  }

  async getGaps() {
    return this.call('get-gaps');
  }

  async getStats() {
    return this.call('stats');
  }

  async getProduct(sku: string) {
    return this.call('get-product', { sku });
  }

  async updateProduct(productId: string, updates: any, note?: string) {
    return this.call('update-product', { productId, updates, note });
  }

  async getForEnrichment(field: string, limit: number = 20) {
    return this.call('get-for-enrichment', { field, limit });
  }
}

export const dataClient = new DataOperationsAPIClient();

// Example usage:
// const analysis = await dataClient.analyze();
// const results = await dataClient.search('pinot');
// const enriched = await dataClient.enrich('full_description', 10);
