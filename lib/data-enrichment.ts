import { Product } from './data-access';
import Anthropic from '@anthropic-ai/sdk';

export interface EnrichmentResult {
  sku: string;
  originalData: Partial<Product>;
  enrichedData: Partial<Product>;
  confidence: number;
  changes: Array<{ field: string; oldValue: any; newValue: any }>;
  source: string;
}

const client = new Anthropic();

// Regional hierarchy and mappings
const REGION_MAPPINGS: Record<string, { region: string; subregion?: string; country: string }> = {
  'napa': { region: 'Napa Valley', country: 'USA' },
  'sonoma': { region: 'Sonoma County', country: 'USA' },
  'californi': { region: 'California', country: 'USA' },
  'bordeaux': { region: 'Bordeaux', country: 'France' },
  'burgundy': { region: 'Burgundy', country: 'France' },
  'champagne': { region: 'Champagne', country: 'France' },
  'tuscany': { region: 'Tuscany', country: 'Italy' },
  'barolo': { region: 'Piedmont', subregion: 'Barolo', country: 'Italy' },
  'marlborough': { region: 'Marlborough', country: 'New Zealand' },
  'margaret river': { region: 'Margaret River', country: 'Australia' },
  'hunter valley': { region: 'Hunter Valley', country: 'Australia' },
  'rioja': { region: 'Rioja', country: 'Spain' },
  'highland': { region: 'Highland', country: 'Scotland' },
  'islay': { region: 'Islay', country: 'Scotland' },
};

const GRAPE_VARIETIES: Record<string, string> = {
  'cab sauv': 'Cabernet Sauvignon',
  'cabernet': 'Cabernet Sauvignon',
  'merlot': 'Merlot',
  'pinot noir': 'Pinot Noir',
  'pinot': 'Pinot Noir',
  'sauv blanc': 'Sauvignon Blanc',
  'sauvignon': 'Sauvignon Blanc',
  'chardonnay': 'Chardonnay',
  'riesling': 'Riesling',
  'shiraz': 'Shiraz',
  'syrah': 'Syrah',
  'tempranillo': 'Tempranillo',
  'sangiovese': 'Sangiovese',
  'nebbiolo': 'Nebbiolo',
};

const WINE_CLASSIFICATION_KEYWORDS: Record<string, string[]> = {
  'Red Wine': ['red', 'rouge', 'rosso', 'tinto'],
  'White Wine': ['white', 'blanc', 'bianco', 'blanco'],
  'Rosé Wine': ['rose', 'rosé', 'rosato'],
  'Sparkling Wine': ['sparkling', 'champagne', 'prosecco', 'cava', 'champagne', 'effervescent'],
  'Dessert Wine': ['dessert', 'sweet', 'port', 'sherry'],
  'Fortified Wine': ['fortified', 'port', 'sherry', 'madeira'],
};

export class DataEnricher {
  async enrichProduct(product: Product): Promise<EnrichmentResult> {
    const originalData = { ...product };
    const enrichedData: Partial<Product> = {};
    const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];

    // Rule-based enrichment first
    if (!product.region && product.country) {
      const regionGuess = this.guessRegionByCountry(product.country);
      if (regionGuess && !product.region) {
        enrichedData.region = regionGuess;
        changes.push({ field: 'region', oldValue: product.region, newValue: regionGuess });
      }
    }

    // Normalize region from common misspellings
    if (product.region) {
      const normalized = this.normalizeRegion(product.region);
      if (normalized !== product.region) {
        enrichedData.region = normalized;
        changes.push({ field: 'region', oldValue: product.region, newValue: normalized });
      }
    }

    // Normalize grape variety
    if (product.grape_variety) {
      const normalized = this.normalizeGrapeVariety(product.grape_variety);
      if (normalized !== product.grape_variety) {
        enrichedData.grape_variety = normalized;
        changes.push({
          field: 'grape_variety',
          oldValue: product.grape_variety,
          newValue: normalized
        });
      }
    }

    // Infer classification from product name and type
    if (!product.classification && product.name) {
      const inferred = this.inferClassification(product.name);
      if (inferred) {
        enrichedData.classification = inferred;
        changes.push({
          field: 'classification',
          oldValue: product.classification,
          newValue: inferred
        });
      }
    }

    // Enhance with AI if there are missing critical fields
    const missingCritical = !product.full_description || !product.flavor_profile;

    if (missingCritical && product.name && product.country) {
      try {
        const aiEnrichment = await this.enrichWithAI(product);
        if (aiEnrichment.description && !product.full_description) {
          enrichedData.full_description = aiEnrichment.description;
          changes.push({
            field: 'full_description',
            oldValue: product.full_description,
            newValue: aiEnrichment.description
          });
        }
        if (aiEnrichment.flavorProfile && !product.flavor_profile) {
          enrichedData.flavor_profile = JSON.stringify(aiEnrichment.flavorProfile);
          changes.push({
            field: 'flavor_profile',
            oldValue: product.flavor_profile,
            newValue: enrichedData.flavor_profile
          });
        }
      } catch (error) {
        console.error('AI enrichment failed:', error);
      }
    }

    // Update confidence
    let confidence = product.overall_confidence ?? 0.5;
    const improvementFactor = changes.length > 0 ? 0.05 : 0;
    confidence = Math.min(1, confidence + improvementFactor);

    if (changes.length > 0) {
      enrichedData.enrichment_source = 'ai_rules';
      enrichedData.enrichment_note = `Enriched with ${changes.length} changes`;
      enrichedData.overall_confidence = confidence;
    }

    return {
      sku: product.sku,
      originalData,
      enrichedData,
      confidence,
      changes,
      source: 'enrichment_service'
    };
  }

  private async enrichWithAI(product: Product): Promise<{
    description: string;
    flavorProfile: string[];
  }> {
    const prompt = `Given this product information:
- Name: ${product.name}
- Brand: ${product.brand || 'Unknown'}
- Country: ${product.country || 'Unknown'}
- Region: ${product.region || 'Unknown'}
- Classification: ${product.classification || 'Unknown'}
- Grape Variety: ${product.grape_variety || 'Unknown'}
- Vintage: ${product.vintage || 'Unknown'}

Please provide:
1. A brief product description (2-3 sentences)
2. A JSON array of 5-8 flavor notes (e.g., ["Blackcurrant", "Cedar", "Tobacco"])

Format your response as JSON with keys "description" and "flavorProfile"`;

    try {
      const message = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = message.content[0];
      if (content.type === 'text') {
        const text = content.text.trim();
        // Try to extract JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || '',
            flavorProfile: Array.isArray(parsed.flavorProfile) ? parsed.flavorProfile : []
          };
        }
      }
    } catch (error) {
      console.error('AI enrichment error:', error);
    }

    return { description: '', flavorProfile: [] };
  }

  private normalizeRegion(region: string): string {
    const lower = region.toLowerCase().trim();

    for (const [key, value] of Object.entries(REGION_MAPPINGS)) {
      if (lower.includes(key)) {
        return value.region;
      }
    }

    return region;
  }

  private guessRegionByCountry(country: string): string | null {
    const countryMap: Record<string, string> = {
      'USA': 'California',
      'France': 'Bordeaux',
      'Italy': 'Tuscany',
      'Spain': 'Rioja',
      'Australia': 'Margaret River',
      'New Zealand': 'Marlborough',
      'Chile': 'Maipo Valley',
      'Argentina': 'Mendoza',
      'Germany': 'Mosel',
      'Portugal': 'Douro'
    };

    return countryMap[country] || null;
  }

  private normalizeGrapeVariety(grape: string): string {
    const lower = grape.toLowerCase();

    for (const [key, value] of Object.entries(GRAPE_VARIETIES)) {
      if (lower.includes(key)) {
        return value;
      }
    }

    // Capitalize first letters
    return grape
      .split(/[\s,&-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
      .trim();
  }

  private inferClassification(name: string): string | null {
    const lower = name.toLowerCase();

    for (const [classification, keywords] of Object.entries(WINE_CLASSIFICATION_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          return classification;
        }
      }
    }

    // Check for spirits
    const spiritsKeywords = ['whisky', 'gin', 'rum', 'vodka', 'tequila', 'brandy', 'cognac'];
    for (const keyword of spiritsKeywords) {
      if (lower.includes(keyword)) {
        return keyword.charAt(0).toUpperCase() + keyword.slice(1);
      }
    }

    return null;
  }

  async enrichBatch(products: Product[], limit = 20): Promise<EnrichmentResult[]> {
    const results: EnrichmentResult[] = [];

    for (let i = 0; i < Math.min(products.length, limit); i++) {
      try {
        const result = await this.enrichProduct(products[i]);
        results.push(result);
      } catch (error) {
        console.error(`Error enriching product ${products[i].sku}:`, error);
      }
    }

    return results;
  }

  async enrichMissingField(products: Product[], field: string): Promise<EnrichmentResult[]> {
    const productsNeedingEnrichment = products.filter(p => !p[field] || p[field] === '');
    return this.enrichBatch(productsNeedingEnrichment);
  }
}

export const enricher = new DataEnricher();
