import { NextRequest, NextResponse } from 'next/server';
import {
  getTaxonomyDb,
  getScopes,
  getCharacterDimensions,
} from '@/lib/taxonomy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ── Supabase REST helpers ─────────────────────────────────────────────── */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

/* ── Simple in-memory cache for product counts ─────────────────────────── */

interface ProductCountCache {
  data: { country: string; region: string }[];
  ts: number;
}

let _countCache: ProductCountCache | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchProductCounts(): Promise<
  { country: string; region: string }[]
> {
  if (_countCache && Date.now() - _countCache.ts < CACHE_TTL) {
    return _countCache.data;
  }

  // Paginate through all primary variants (Supabase caps at 1000 per request)
  const all: { country: string; region: string }[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/products?select=country,region&is_primary_variant=eq.true&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { ...HEADERS, Prefer: 'count=exact' } });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }

  _countCache = { data: all, ts: Date.now() };
  return all;
}

/* ── GET handler ───────────────────────────────────────────────────────── */

export async function GET(_req: NextRequest) {
  try {
    const db = getTaxonomyDb();

    // 1. Scopes
    const scopes = getScopes();

    // 2. Character dimensions grouped by scope
    const allDims = db
      .prepare('SELECT * FROM character_dimensions ORDER BY sort_order')
      .all() as any[];

    const characterDimensions: Record<string, any[]> = {};
    for (const d of allDims) {
      if (!characterDimensions[d.scope_id]) characterDimensions[d.scope_id] = [];
      characterDimensions[d.scope_id].push(d);
    }

    // 3. All entities
    const entities = db
      .prepare(
        `SELECT id, entity_type, name, slug, parent_id, latitude, longitude, iso_code, sort_order
         FROM taxonomy_entities
         WHERE entity_type IN ('country', 'region', 'subregion')
         ORDER BY sort_order, name`
      )
      .all() as any[];

    // 4. All contexts
    const contexts = db
      .prepare(
        `SELECT tc.entity_id, tc.scope_id, tc.description_short, tc.description_en, tc.attributes, tc.status
         FROM taxonomy_contexts tc
         JOIN taxonomy_entities te ON te.id = tc.entity_id
         WHERE te.entity_type IN ('country', 'region', 'subregion')`
      )
      .all() as any[];

    // 5. All benchmarks keyed by context
    const benchmarks = db
      .prepare(
        `SELECT tb.context_id, tb.dimension_id, tb.typical_value, tb.range_low, tb.range_high
         FROM taxonomy_benchmarks tb
         JOIN taxonomy_contexts tc ON tc.id = tb.context_id
         JOIN taxonomy_entities te ON te.id = tc.entity_id
         WHERE te.entity_type IN ('country', 'region', 'subregion')`
      )
      .all() as any[];

    // Build lookup maps
    const contextsByEntity = new Map<number, any[]>();
    const contextById = new Map<number, any>();
    for (const c of contexts) {
      if (!contextsByEntity.has(c.entity_id))
        contextsByEntity.set(c.entity_id, []);
      contextsByEntity.get(c.entity_id)!.push(c);
    }
    // We need context rows with their IDs for benchmark lookup
    const contextsWithId = db
      .prepare(
        `SELECT tc.id, tc.entity_id, tc.scope_id
         FROM taxonomy_contexts tc
         JOIN taxonomy_entities te ON te.id = tc.entity_id
         WHERE te.entity_type IN ('country', 'region', 'subregion')`
      )
      .all() as any[];
    for (const c of contextsWithId) contextById.set(c.id, c);

    const benchmarksByContext = new Map<number, any[]>();
    for (const b of benchmarks) {
      if (!benchmarksByContext.has(b.context_id))
        benchmarksByContext.set(b.context_id, []);
      benchmarksByContext.get(b.context_id)!.push(b);
    }

    // 6. Product counts from Supabase
    const products = await fetchProductCounts();
    const countByCountry = new Map<string, number>();
    const countByRegion = new Map<string, number>();

    for (const p of products) {
      const c = (p.country || '').trim();
      const r = (p.region || '').trim();
      if (c) countByCountry.set(c, (countByCountry.get(c) || 0) + 1);
      if (r) countByRegion.set(r, (countByRegion.get(r) || 0) + 1);
    }

    // 7. Build entity lookups
    const entityMap = new Map<number, any>();
    for (const e of entities) entityMap.set(e.id, e);

    // Helper: build context object for an entity
    function buildContexts(entityId: number) {
      const ctxs = contextsByEntity.get(entityId) || [];
      const result: Record<string, any> = {};
      for (const c of ctxs) {
        const parsed: any = {
          description_short: c.description_short,
          description_en: c.description_en,
          status: c.status,
        };
        if (c.attributes) {
          try {
            parsed.attributes = JSON.parse(c.attributes);
          } catch {
            parsed.attributes = {};
          }
        }
        // Attach benchmarks
        const matchCtx = contextsWithId.find(
          (x: any) => x.entity_id === entityId && x.scope_id === c.scope_id
        );
        if (matchCtx) {
          const bms = benchmarksByContext.get(matchCtx.id);
          if (bms && bms.length > 0) {
            parsed.benchmarks = bms.map((b: any) => ({
              dimension_id: b.dimension_id,
              typical_value: b.typical_value,
              range_low: b.range_low,
              range_high: b.range_high,
            }));
          }
        }
        result[c.scope_id] = parsed;
      }
      return result;
    }

    // 8. Group entities into hierarchy
    const countries: any[] = [];
    const regionsByParent = new Map<number, any[]>();
    const subregionsByParent = new Map<number, any[]>();

    for (const e of entities) {
      if (e.entity_type === 'region' && e.parent_id) {
        if (!regionsByParent.has(e.parent_id))
          regionsByParent.set(e.parent_id, []);
        regionsByParent.get(e.parent_id)!.push(e);
      }
      if (e.entity_type === 'subregion' && e.parent_id) {
        if (!subregionsByParent.has(e.parent_id))
          subregionsByParent.set(e.parent_id, []);
        subregionsByParent.get(e.parent_id)!.push(e);
      }
    }

    for (const e of entities) {
      if (e.entity_type !== 'country') continue;

      const regions = (regionsByParent.get(e.id) || []).map((r: any) => {
        const subregions = (subregionsByParent.get(r.id) || []).map(
          (sr: any) => ({
            id: sr.id,
            name: sr.name,
            slug: sr.slug,
            lat: sr.latitude ?? null,
            lng: sr.longitude ?? null,
            product_count: countByRegion.get(sr.name) || 0,
            contexts: buildContexts(sr.id),
          })
        );

        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          lat: r.latitude ?? null,
          lng: r.longitude ?? null,
          product_count: countByRegion.get(r.name) || 0,
          contexts: buildContexts(r.id),
          subregions,
        };
      });

      countries.push({
        id: e.id,
        name: e.name,
        slug: e.slug,
        lat: e.latitude ?? null,
        lng: e.longitude ?? null,
        iso_code: e.iso_code ?? null,
        product_count: countByCountry.get(e.name) || 0,
        contexts: buildContexts(e.id),
        regions,
      });
    }

    return NextResponse.json({
      scopes,
      countries,
      character_dimensions: characterDimensions,
      _meta: {
        generated_at: new Date().toISOString(),
        total_products: products.length,
        total_countries: countries.length,
      },
    });
  } catch (err: any) {
    console.error('[map-data] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
