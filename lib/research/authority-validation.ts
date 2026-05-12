import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { readProducts } from '@/lib/db/client';
import { getTaxonomyDb } from '@/lib/taxonomy-db';
import { readGeographyEvidenceWithCuration } from './geography-evidence';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const dbDir = path.join(process.cwd(), 'data', 'db');
const decisionsFile = path.join(dbDir, 'authority-validation-decisions.json');
const gaPriorityFile = path.join(process.cwd(), 'data', 'ga_priority_products.csv');

export type AuthorityStatus =
  | 'new'
  | 'needs_authority_source'
  | 'source_found'
  | 'approved_for_taxonomy'
  | 'approved_for_product_update'
  | 'rejected'
  | 'published';

export type AuthorityDecision = {
  candidate_id: string;
  status: AuthorityStatus;
  authority_urls: string[];
  authority_notes: string;
  reviewer: string;
  validated_value: string | null;
  validated_field: 'country' | 'region' | 'subregion' | 'appellation' | null;
  confidence: 'low' | 'medium' | 'high' | null;
  updated_at: string;
};

export type AuthorityCandidate = {
  id: string;
  sku: string;
  sku_tier: string | null;
  sales_tier: 'S1' | 'S2' | 'S3';
  price_tier: string | null;
  product_id: string | null;
  product_name: string;
  brand: string | null;
  country: string | null;
  classification: string | null;
  grape_variety: string | null;
  missing_fields: Array<'region' | 'subregion' | 'appellation'>;
  current_region: string | null;
  current_subregion: string | null;
  current_appellation: string | null;
  winesensed_signals: Array<{
    evidence_id: string;
    observed_name: string;
    observed_country: string | null;
    suggested_target_type: string;
    evidence_count: number;
    top_grapes: Array<{ name: string; count: number }>;
    curation_status: string;
  }>;
  suggested_next_field: 'region' | 'subregion' | 'appellation';
  decision?: AuthorityDecision;
};

type Product = {
  id?: string;
  sku?: string;
  name?: string;
  brand?: string;
  country?: string;
  region?: string;
  subregion?: string;
  appellation?: string;
  classification?: string;
  grape_variety?: string;
  price?: number;
  price_group?: string;
  sales_tier?: string;
  tier?: string;
  salesTier?: string;
  priority_band?: string;
  sold_orders?: number | string;
  sold_qty?: number | string;
  overall_confidence?: number;
};

async function readDecisionMap(): Promise<Record<string, AuthorityDecision>> {
  await mkdir(dbDir, { recursive: true });
  try {
    if (!fs.existsSync(decisionsFile)) return {};
    return JSON.parse(await readFile(decisionsFile, 'utf8')) as Record<string, AuthorityDecision>;
  } catch (_error) {
    return {};
  }
}

async function saveDecisionMap(decisions: Record<string, AuthorityDecision>) {
  await mkdir(dbDir, { recursive: true });
  await writeFile(decisionsFile, JSON.stringify(decisions, null, 2), 'utf8');
}

function norm(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function isWineLike(product: Product): boolean {
  const sku = String(product.sku ?? '').trim().toLowerCase();
  if (sku.startsWith('w')) return true;

  const classification = norm(product.classification);
  const wineClasses = new Set([
    'red wine',
    'white wine',
    'rose wine',
    'rose',
    'sparkling wine',
    'champagne',
    'dessert wine',
    'fortified wine',
    'port wine',
    'port',
    'orange wine',
    'fruit wine',
  ]);

  return wineClasses.has(classification);
}

function missingFields(product: Product): AuthorityCandidate['missing_fields'] {
  const missing: AuthorityCandidate['missing_fields'] = [];
  if (!String(product.region ?? '').trim()) missing.push('region');
  if (String(product.region ?? '').trim() && !String(product.subregion ?? '').trim()) missing.push('subregion');
  if (!String(product.appellation ?? '').trim()) missing.push('appellation');
  return missing;
}

function candidateId(product: Product): string {
  return `authority-geo-${product.sku ?? product.id}`;
}

function skuTier(product: Product): string | null {
  const sku = String(product.sku ?? '').trim().toUpperCase();
  const match = sku.match(/[A-Z]{2}$/);
  return match?.[0] ?? null;
}

function priceTier(product: Product): string | null {
  const explicit = String(product.price_group ?? '').trim();
  if (explicit) return explicit;
  const price = Number(product.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price < 1000) return 'A 0-1000';
  if (price < 2000) return 'B 1000-2000';
  if (price < 3000) return 'C 2000-3000';
  if (price < 4000) return 'D 3000-4000';
  if (price < 5000) return 'E 4000-5000';
  if (price < 10000) return 'F 5K-10K';
  if (price < 50000) return 'G 10K-50K';
  return 'H 50K+';
}

let cachedGaTierBySku: Map<string, 'S1' | 'S2'> | null = null;

function readGaTierBySku(): Map<string, 'S1' | 'S2'> {
  if (cachedGaTierBySku) return cachedGaTierBySku;
  const tiers = new Map<string, 'S1' | 'S2'>();
  if (!fs.existsSync(gaPriorityFile)) {
    cachedGaTierBySku = tiers;
    return tiers;
  }

  const text = fs.readFileSync(gaPriorityFile, 'utf8');
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  const skuIndex = headers.indexOf('sku');
  const bandIndex = headers.indexOf('priority_band');
  if (skuIndex < 0 || bandIndex < 0) {
    cachedGaTierBySku = tiers;
    return tiers;
  }

  for (const line of lines) {
    const columns = parseCsvLine(line);
    const sku = columns[skuIndex]?.trim().toUpperCase();
    const band = columns[bandIndex]?.trim().toLowerCase();
    if (!sku) continue;
    if (band === 'high') tiers.set(sku, 'S1');
    if (band === 'medium' && !tiers.has(sku)) tiers.set(sku, 'S2');
  }
  cachedGaTierBySku = tiers;
  return tiers;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function salesTier(product: Product): 'S1' | 'S2' | 'S3' {
  const explicit = String(product.sales_tier ?? product.salesTier ?? product.tier ?? '').trim().toUpperCase();
  if (explicit === 'S1' || explicit === 'S2' || explicit === 'S3') return explicit;

  const sku = String(product.sku ?? '').trim().toUpperCase();
  const gaTier = readGaTierBySku().get(sku);
  if (gaTier) return gaTier;

  const priorityBand = String(product.priority_band ?? '').trim().toLowerCase();
  if (priorityBand === 'high') return 'S1';
  if (priorityBand === 'medium') return 'S2';

  const soldQty = num(product.sold_qty);
  const soldOrders = num(product.sold_orders);
  if (soldQty >= 12 || soldOrders >= 3) return 'S1';
  if (soldQty >= 1 || soldOrders >= 1) return 'S2';
  return 'S3';
}

function taxonomyEntityExists(entityType: 'country' | 'region' | 'subregion' | 'appellation', name: string, product: Product): boolean {
  const db = getTaxonomyDb();
  const value = name.trim();
  if (!value) return false;

  if (entityType === 'country') {
    const row = db.prepare(`
      SELECT id FROM taxonomy_entities
      WHERE entity_type = 'country' AND lower(name) = lower(?)
      LIMIT 1
    `).get(value) as { id: number } | undefined;
    return Boolean(row);
  }

  if (entityType === 'region') {
    const country = String(product.country ?? '').trim();
    if (!country) return false;
    const row = db.prepare(`
      SELECT e.id
      FROM taxonomy_entities e
      JOIN taxonomy_entities c ON c.id = e.parent_id
      WHERE e.entity_type = 'region'
        AND lower(e.name) = lower(?)
        AND c.entity_type = 'country'
        AND lower(c.name) = lower(?)
      LIMIT 1
    `).get(value, country) as { id: number } | undefined;
    return Boolean(row);
  }

  if (entityType === 'subregion') {
    const region = String(product.region ?? '').trim();
    if (!region) return false;
    const row = db.prepare(`
      SELECT e.id
      FROM taxonomy_entities e
      JOIN taxonomy_entities r ON r.id = e.parent_id
      WHERE e.entity_type = 'subregion'
        AND lower(e.name) = lower(?)
        AND r.entity_type = 'region'
        AND lower(r.name) = lower(?)
      LIMIT 1
    `).get(value, region) as { id: number } | undefined;
    return Boolean(row);
  }

  const row = db.prepare(`
    SELECT id FROM taxonomy_entities
    WHERE entity_type = 'appellation' AND lower(name) = lower(?)
    LIMIT 1
  `).get(value) as { id: number } | undefined;
  return Boolean(row);
}

export async function buildAuthorityCandidates(filters: {
  status?: string;
  q?: string;
  country?: string;
  missing_field?: string;
  sku_tier?: string;
  sales_tier?: string;
  price_tier?: string;
  limit?: number;
  offset?: number;
}) {
  const [{ evidence }, products, decisions] = await Promise.all([
    readGeographyEvidenceWithCuration(),
    readProducts() as Promise<Product[]>,
    readDecisionMap(),
  ]);

  const evidenceByCountry = new Map<string, typeof evidence>();
  for (const row of evidence) {
    const key = norm(row.observed_country);
    if (!key) continue;
    evidenceByCountry.set(key, [...(evidenceByCountry.get(key) ?? []), row]);
  }

  const candidates: AuthorityCandidate[] = [];
  for (const product of products) {
    if (!product.sku || !isWineLike(product) || !product.country) continue;
    const missing = missingFields(product);
    if (missing.length === 0) continue;

    const countryEvidence = evidenceByCountry.get(norm(product.country)) ?? [];
    const grapeNorm = norm(product.grape_variety);
    const signals = countryEvidence
      .map(row => {
        const grapeScore = row.top_grapes.some(g => grapeNorm && norm(g.name) && grapeNorm.includes(norm(g.name))) ? 1 : 0;
        const statusScore = row.curation?.status?.startsWith('confirmed') || row.curation?.status === 'promoted' ? 2 : 0;
        return { row, score: row.evidence_count + grapeScore * 20 + statusScore * 40 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ row }) => ({
        evidence_id: row.id,
        observed_name: row.observed_name,
        observed_country: row.observed_country,
        suggested_target_type: row.suggested_target_type,
        evidence_count: row.evidence_count,
        top_grapes: row.top_grapes,
        curation_status: row.curation?.status ?? 'new',
      }));

    const id = candidateId(product);
    candidates.push({
      id,
      sku: product.sku,
      sku_tier: skuTier(product),
      sales_tier: salesTier(product),
      price_tier: priceTier(product),
      product_id: product.id ?? null,
      product_name: product.name ?? '',
      brand: product.brand ?? null,
      country: product.country ?? null,
      classification: product.classification ?? null,
      grape_variety: product.grape_variety ?? null,
      missing_fields: missing,
      current_region: product.region ?? null,
      current_subregion: product.subregion ?? null,
      current_appellation: product.appellation ?? null,
      winesensed_signals: signals,
      suggested_next_field: missing[0],
      decision: decisions[id],
    });
  }

  let filtered = candidates;
  if (filters.status) filtered = filtered.filter(candidate => (candidate.decision?.status ?? 'new') === filters.status);
  if (filters.country) filtered = filtered.filter(candidate => norm(candidate.country) === norm(filters.country));
  if (filters.sku_tier) filtered = filtered.filter(candidate => norm(candidate.sku_tier) === norm(filters.sku_tier));
  if (filters.sales_tier) filtered = filtered.filter(candidate => norm(candidate.sales_tier) === norm(filters.sales_tier));
  if (filters.price_tier) filtered = filtered.filter(candidate => norm(candidate.price_tier) === norm(filters.price_tier));
  if (filters.missing_field) {
    filtered = filtered.filter(candidate => candidate.missing_fields.includes(filters.missing_field as 'region' | 'subregion' | 'appellation'));
  }
  if (filters.q) {
    const q = norm(filters.q);
    filtered = filtered.filter(candidate =>
      [candidate.sku, candidate.product_name, candidate.brand, candidate.country, candidate.grape_variety]
        .some(value => norm(value).includes(q)),
    );
  }

  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const byStatus = candidates.reduce<Record<string, number>>((acc, candidate) => {
    const status = candidate.decision?.status ?? 'new';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const byMissingField = candidates.reduce<Record<string, number>>((acc, candidate) => {
    for (const field of candidate.missing_fields) acc[field] = (acc[field] ?? 0) + 1;
    return acc;
  }, {});
  const bySkuTier = candidates.reduce<Record<string, number>>((acc, candidate) => {
    const tier = candidate.sku_tier ?? 'unknown';
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});
  const byPriceTier = candidates.reduce<Record<string, number>>((acc, candidate) => {
    const tier = candidate.price_tier ?? 'unknown';
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});
  const bySalesTier = candidates.reduce<Record<string, number>>((acc, candidate) => {
    acc[candidate.sales_tier] = (acc[candidate.sales_tier] ?? 0) + 1;
    return acc;
  }, {});

  return {
    summary: {
      total_candidates: candidates.length,
      filtered_candidates: filtered.length,
      by_status: byStatus,
      by_missing_field: byMissingField,
      by_sku_tier: bySkuTier,
      by_sales_tier: bySalesTier,
      by_price_tier: byPriceTier,
      write_policy: 'authority_validation_only',
    },
    candidates: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
  };
}

export async function updateAuthorityDecision(candidateId: string, patch: Partial<Omit<AuthorityDecision, 'candidate_id' | 'updated_at'>>) {
  const decisions = await readDecisionMap();
  const existing = decisions[candidateId];
  const next: AuthorityDecision = {
    candidate_id: candidateId,
    status: patch.status ?? existing?.status ?? 'new',
    authority_urls: patch.authority_urls ?? existing?.authority_urls ?? [],
    authority_notes: patch.authority_notes ?? existing?.authority_notes ?? '',
    reviewer: patch.reviewer ?? existing?.reviewer ?? '',
    validated_value: patch.validated_value ?? existing?.validated_value ?? null,
    validated_field: patch.validated_field ?? existing?.validated_field ?? null,
    confidence: patch.confidence ?? existing?.confidence ?? null,
    updated_at: new Date().toISOString(),
  };
  decisions[candidateId] = next;
  await saveDecisionMap(decisions);
  return next;
}

export async function buildAuthorityProductUpdatePreview() {
  const [products, decisions] = await Promise.all([
    readProducts() as Promise<Product[]>,
    readDecisionMap(),
  ]);
  const byCandidateId = new Map(products.map(product => [candidateId(product), product]));
  const rows: Array<Record<string, unknown>> = [];
  const blocked: Array<Record<string, unknown>> = [];

  for (const decision of Object.values(decisions)) {
    if (decision.status !== 'approved_for_product_update') continue;

    const product = byCandidateId.get(decision.candidate_id);
    const blockers: string[] = [];
    if (!product) blockers.push('Product not found in local product database');
    if (!decision.validated_field) blockers.push('validated_field is required');
    if (!decision.validated_value?.trim()) blockers.push('validated_value is required');
    if (decision.authority_urls.length === 0) blockers.push('At least one authority URL is required');
    if (!decision.confidence || decision.confidence === 'low') blockers.push('Medium or high confidence is required');

    if (product && decision.validated_field && decision.validated_value?.trim()) {
      const current = String(product[decision.validated_field] ?? '').trim();
      if (current && norm(current) !== norm(decision.validated_value) && decision.validated_field !== 'country') {
        blockers.push(`Product already has ${decision.validated_field}: ${current}`);
      }
      if (current && norm(current) !== norm(decision.validated_value) && decision.validated_field === 'country' && decision.confidence !== 'high') {
        blockers.push(`Country correction from "${current}" to "${decision.validated_value}" requires high confidence`);
      }
      if (!taxonomyEntityExists(decision.validated_field, decision.validated_value, product)) {
        blockers.push(`${decision.validated_field} is not yet present in canonical taxonomy`);
      }
    }

    const base = {
      candidate_id: decision.candidate_id,
      sku: product?.sku ?? null,
      product_id: product?.id ?? null,
      product_name: product?.name ?? null,
      country: product?.country ?? null,
      field_name: decision.validated_field,
      new_value: decision.validated_value,
      confidence: decision.confidence,
      authority_urls: decision.authority_urls,
      authority_notes: decision.authority_notes,
      updated_at: decision.updated_at,
      blockers,
    };

    if (blockers.length > 0 || !product || !decision.validated_field || !decision.validated_value) {
      blocked.push(base);
      continue;
    }

    rows.push({
      ...base,
      current_value: String(product[decision.validated_field] ?? '').trim(),
      bulk_patch_update: {
        sku: product.sku,
        fields: {
          [decision.validated_field]: decision.validated_value.trim(),
          enrichment_source: 'authority_validation',
          enrichment_note: `Authority-validated geography: ${decision.authority_urls.join(', ')}`,
        },
      },
    });
  }

  const byField = rows.reduce<Record<string, number>>((acc, row) => {
    const field = String(row.field_name ?? 'unknown');
    acc[field] = (acc[field] ?? 0) + 1;
    return acc;
  }, {});

  return {
    summary: {
      approved_decisions: rows.length + blocked.length,
      ready_rows: rows.length,
      blocked_rows: blocked.length,
      by_field: byField,
      write_policy: 'read_only_preview',
      next_step: 'Send ready rows through /api/products/bulk-patch with X-Source: enrichment only after final review.',
    },
    candidates: rows,
    blocked,
    bulk_patch_payload: {
      note: 'Authority-validated geography update',
      updates: rows.map(row => row.bulk_patch_update),
    },
  };
}
