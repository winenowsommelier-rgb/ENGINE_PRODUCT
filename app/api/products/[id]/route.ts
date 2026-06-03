import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { filterByOwnership, parseSource, type Source } from '@/lib/products/ownership';
import { validateProductFields } from '@/lib/products/field-validation';
import { addChangelogEntries, type ProductChangelog } from '@/lib/db/client';
import { getSupabaseServerConfig } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function sourceToChangelog(source: Source): ProductChangelog['source'] {
  if (source === 'bi') return 'bi_sync';
  if (source === 'enrichment') return 'enrichment';
  if (source === 'system') return 'system';
  return 'manual_edit';
}

// Use the shared server config so server-only routes can use the
// SUPABASE_SERVICE_ROLE_KEY (and fall back to publishable if missing).
// Lazily evaluated so build-time imports don't fail when env is absent.
function supabaseConfig() {
  return getSupabaseServerConfig();
}

async function sbGet(path: string) {
  const { url, headers } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) return [];
  return res.json();
}

type BiAffinityRow = {
  rank: number;
  base_product_code: string;
  product_name: string;
  rate: number;
  id?: string;
  sku?: string;
  price?: number | string | null;
  currency?: string | null;
};

type BiAffinityEntry = {
  co_order_affinities?: BiAffinityRow[];
  co_customer_affinities?: BiAffinityRow[];
};

let affinityCache: Record<string, BiAffinityEntry> | null = null;

function loadBiAffinities(): Record<string, BiAffinityEntry> {
  if (affinityCache) return affinityCache;
  const filePath = path.join(process.cwd(), 'data', 'bi-product-affinities.json');
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    affinityCache = raw.affinities ?? {};
  } catch (_error) {
    affinityCache = {};
  }
  return affinityCache ?? {};
}

function baseSku(product: Record<string, any>): string {
  if (product.sku_base) return String(product.sku_base).toUpperCase();
  const sku = String(product.sku ?? '').toUpperCase();
  return sku.length > 2 && /^[A-Z]{2}$/.test(sku.slice(-2)) ? sku.slice(0, -2) : sku;
}

function priceBand(value: unknown): string {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return '';
  if (price < 1000) return 'under_1000';
  if (price < 2000) return '1000_1999';
  if (price < 3000) return '2000_2999';
  if (price < 5000) return '3000_4999';
  return '5000_plus';
}

function tierDefinition(product: Record<string, any>): string {
  const note = product.enrichment_note;
  if (note) return String(note).replace(/\s*\|\s*/g, ' · ');
  const tier = product.enrichment_priority == null ? '' : String(product.enrichment_priority);
  if (tier === '1') return 'Highest BI priority: focus first for content, taxonomy, and merchandising work.';
  if (tier === '2') return 'Strong BI signal: important product or cluster, but behind T1 urgent focus.';
  if (tier === '3') return 'Normal catalog priority with useful signals but lower immediate focus.';
  if (tier === '5') return 'Low current demand signal or no recent sales signal.';
  return 'No BI priority explanation is attached yet.';
}

function scoreRelated(product: Record<string, any>, candidate: Record<string, any>) {
  const reasons: string[] = [];
  let score = 0;
  if (product.brand && candidate.brand === product.brand) {
    score += 40;
    reasons.push('same brand');
  }
  if (product.classification && candidate.classification === product.classification) {
    score += 25;
    reasons.push('same item category');
  }
  if (product.country && candidate.country === product.country) {
    score += 15;
    reasons.push('same country');
  }
  if (product.region && candidate.region === product.region) {
    score += 20;
    reasons.push('same region');
  }
  if (product.sku_base && candidate.sku_base === product.sku_base) {
    score += 45;
    reasons.push('same SKU family');
  }
  if (priceBand(product.price) && priceBand(product.price) === priceBand(candidate.price)) {
    score += 18;
    reasons.push('same price range');
  }
  const candidateTier = Number(candidate.enrichment_priority ?? 9);
  if (Number.isFinite(candidateTier)) score += Math.max(0, 8 - candidateTier);
  return { score, reasons };
}

async function relatedProducts(product: Record<string, any>) {
  const clauses: string[] = [];
  for (const key of ['sku_base', 'brand', 'classification', 'region'] as const) {
    if (product[key]) clauses.push(`${key}.eq.${encodeURIComponent(String(product[key]))}`);
  }
  if (!clauses.length) return [];

  const select = 'id,sku,sku_base,name,brand,classification,country,region,price,currency,image_url,enrichment_priority';
  const rows = await sbGet(`products?select=${select}&or=(${clauses.join(',')})&limit=120`);
  const productBand = priceBand(product.price);
  return rows
    .filter((row: Record<string, any>) => row.id !== product.id && row.sku !== product.sku)
    .filter((row: Record<string, any>) => !productBand || !priceBand(row.price) || priceBand(row.price) === productBand)
    .map((row: Record<string, any>) => {
      const match = scoreRelated(product, row);
      return {
        ...row,
        matchScore: match.score,
        matchReasons: match.reasons,
      };
    })
    .filter((row: Record<string, any>) => row.matchScore > 0)
    .sort((a: Record<string, any>, b: Record<string, any>) => b.matchScore - a.matchScore)
    .slice(0, 5);
}

async function productAffinities(product: Record<string, any>) {
  const base = baseSku(product);
  const entry = loadBiAffinities()[base] ?? {};
  const orderRows = entry.co_order_affinities ?? [];
  const customerRows = entry.co_customer_affinities ?? [];
  const bases = Array.from(new Set([...orderRows, ...customerRows].map(row => row.base_product_code).filter(Boolean)));

  const productMap = new Map<string, Record<string, any>>();
  if (bases.length) {
    const inList = bases.map(v => encodeURIComponent(v)).join(',');
    const rows = await sbGet(
      `products?select=id,sku,sku_base,name,price,currency&sku_base=in.(${inList})&limit=${bases.length}`
    );
    for (const row of rows) {
      if (row.sku_base && !productMap.has(String(row.sku_base))) productMap.set(String(row.sku_base), row);
    }
  }

  function enrich(rows: BiAffinityRow[]) {
    return rows.map(row => {
      const match = productMap.get(row.base_product_code);
      return {
        ...row,
        id: match?.id,
        sku: match?.sku,
        product_name: match?.name ?? row.product_name,
        price: match?.price ?? null,
        currency: match?.currency ?? 'THB',
      };
    });
  }

  return {
    base_product_code: base,
    co_order_affinities: enrich(orderRows),
    co_customer_affinities: enrich(customerRows),
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await sbGet(`products?id=eq.${encodeURIComponent(params.id)}&select=*&limit=1`);
    if (!rows.length) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const product = rows[0];
    product.product_tier = product.enrichment_priority == null ? null : `T${product.enrichment_priority}`;
    product.product_tier_definition = tierDefinition(product);

    // Resolve scope via classification_scope_map → character_dimensions
    let characterDimensions: Record<string, unknown>[] = [];
    const classification = product.classification;
    if (classification) {
      const scopeMaps = await sbGet(
        `classification_scope_map?classification=eq.${encodeURIComponent(classification)}&select=scope_id&limit=1`
      );
      const scopeId = scopeMaps?.[0]?.scope_id;
      if (scopeId) {
        characterDimensions = await sbGet(
          `character_dimensions?scope_id=eq.${encodeURIComponent(scopeId)}&select=dimension_key,label,description&order=sort_order.asc.nullslast`
        );
      }
    }

    // Fetch taxonomy_contexts for country and region
    let taxonomyContexts: Record<string, unknown>[] = [];
    const taxTerms = [product.country, product.region].filter(Boolean);
    if (taxTerms.length) {
      const orFilter = taxTerms.map(t => `term.eq.${encodeURIComponent(t)}`).join(',');
      taxonomyContexts = await sbGet(
        `taxonomy_contexts?or=(${orFilter})&select=term,description_short&limit=10`
      );
    }

    const related = await relatedProducts(product);
    const affinities = await productAffinities(product);

    return NextResponse.json({ product, characterDimensions, taxonomyContexts, relatedProducts: related, productAffinities: affinities, changelog: [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 });
    }

    // Enforce field ownership policy — see PRODUCT_DATA_API.md
    // Default source is `admin` (full access from internal dashboard).
    // External callers send `X-Source: bi` or `?source=enrichment` to restrict writes.
    const source = parseSource(req, req.nextUrl.searchParams);
    const { allowed, dropped } = filterByOwnership(body.fields, source);

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({
        error: 'No writable fields for this source',
        source,
        dropped,
      }, { status: 400 });
    }

    // Validate field values — reject pipe-separated taxonomy values, etc.
    const validation = validateProductFields(allowed);
    if (!validation.valid) {
      return NextResponse.json({
        error: 'Field validation failed',
        validation_errors: validation.errors,
        warnings: validation.warnings,
        source,
      }, { status: 400 });
    }

    const { url: SUPABASE_URL, headers: HEADERS } = supabaseConfig();

    // Fetch current values for changelog diff
    const fieldNames = Object.keys(allowed);
    const selectCols = Array.from(new Set(['id', 'sku', ...fieldNames])).join(',');
    const currentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(params.id)}&select=${selectCols}&limit=1`,
      { headers: HEADERS }
    );
    const currentRows = currentRes.ok ? await currentRes.json() : [];
    const current: Record<string, unknown> = currentRows[0] || {};

    const payload: Record<string, unknown> = { ...allowed, updated_at: new Date().toISOString() };

    // Cast price / cost_price to integer if present
    if (payload.price != null)      payload.price      = parseInt(payload.price as string)      || null;
    if (payload.cost_price != null) payload.cost_price = parseInt(payload.cost_price as string) || null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(params.id)}`,
      { method: 'PATCH', headers: HEADERS, body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(await res.text());

    // Write changelog — only for fields that actually changed
    if (current.id) {
      const note = typeof body.note === 'string' ? body.note : null;
      const changelogSource = sourceToChangelog(source);
      const entries: Omit<ProductChangelog, 'id' | 'changed_at'>[] = [];
      for (const field of fieldNames) {
        const oldStr = current[field] == null ? '' : String(current[field]);
        const newStr = payload[field] == null ? '' : String(payload[field]);
        if (oldStr !== newStr) {
          entries.push({
            product_id: String(current.id),
            sku: String(current.sku ?? ''),
            source: changelogSource,
            field,
            old_value: oldStr || null,
            new_value: newStr,
            note,
          });
        }
      }
      if (entries.length > 0) {
        try { await addChangelogEntries(entries); } catch (err) { console.error('Changelog write failed:', err); }
      }
    }

    return NextResponse.json({ updated: true, source, applied: Object.keys(allowed), dropped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
