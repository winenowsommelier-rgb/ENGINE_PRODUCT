import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Source',
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const SEGMENT_PREFIXES: Record<string, (sku: string) => boolean> = {
  wine:        sku => sku.startsWith('W'),
  spirits:     sku => sku.startsWith('L') && !sku.startsWith('LBE') && !sku.startsWith('LSK'),
  beer:        sku => sku.startsWith('LBE'),
  sake:        sku => sku.startsWith('LSK'),
  accessories: sku => /^[AGN]/i.test(sku),
};

const SORT_COLS: Record<string, string> = {
  name:       'name',
  price:      'price',
  confidence: 'enrichment_confidence',
  tier:       'enrichment_priority',
  vintage:    'vintage',
  created:    'created_at',
  sku:        'sku',
};

// ── Local data cache (loaded once per process) ────────────────────────────────

type LocalProduct = Record<string, unknown>;

let _localCache: LocalProduct[] | null = null;
let _localCacheAt = 0;
const LOCAL_TTL = 5 * 60 * 1000; // 5 min

function loadLocalProducts(): LocalProduct[] {
  if (_localCache && Date.now() - _localCacheAt < LOCAL_TTL) return _localCache;

  // Primary: live_products_export.json — has enrichment fields (flavor_tags, wine_body, etc.)
  const livePath = path.join(process.cwd(), 'data', 'live_products_export.json');
  // Secondary: db/products.json — has id, image_url, enrichment_note, created_at
  const dbPath = path.join(process.cwd(), 'data', 'db', 'products.json');

  let liveProducts: LocalProduct[] = [];
  let dbProducts: LocalProduct[] = [];

  try {
    const raw = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    liveProducts = Array.isArray(raw) ? raw : (raw.products ?? []);
  } catch (_e) { /* file missing */ }

  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    dbProducts = Array.isArray(raw) ? raw : [];
  } catch (_e) { /* file missing */ }

  // Build a SKU → db row map for the merge
  const dbBySku = new Map<string, LocalProduct>();
  for (const p of dbProducts) {
    if (p.sku) dbBySku.set(String(p.sku), p);
  }

  // Merge: live is base, db supplements id / image_url / enrichment_note / created_at / queue_priority
  const DB_SUPPLEMENT_FIELDS = [
    'id', 'image_url', 'image_scraped_url', 'image_local_path',
    'enrichment_note', 'created_at', 'updated_at',
    'queue_priority', 'enrichment_source',
    'cost', 'margin_thb', 'margin_pct',
    'b2b_price', 'b2b_margin_thb', 'b2b_margin_pct', 'b2b_discount_pct',
    'promotion_price', 'promotion_tier_price',
    'quantity_in_stock', 'is_in_stock',
  ];

  const merged = liveProducts.map(live => {
    const db = dbBySku.get(String(live.sku ?? ''));
    if (!db) return live;
    const patch: LocalProduct = {};
    for (const f of DB_SUPPLEMENT_FIELDS) {
      if (live[f] == null && db[f] != null) patch[f] = db[f];
    }
    return { ...live, ...patch };
  });

  // Add any db-only products (not in live export)
  const liveSkus = new Set(liveProducts.map(p => String(p.sku ?? '')));
  for (const db of dbProducts) {
    if (!liveSkus.has(String(db.sku ?? ''))) merged.push(db);
  }

  _localCache = merged;
  _localCacheAt = Date.now();
  return merged;
}

// ── Supabase fetch (parallel, best-effort) ────────────────────────────────────

async function fetchSupabase(qs: string): Promise<{ items: LocalProduct[]; total: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*&${qs}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) return null;
    const items = await res.json();
    const contentRange = res.headers.get('content-range') ?? '';
    const total = contentRange.includes('/') ? parseInt(contentRange.split('/')[1]) : items.length;
    return { items, total };
  } catch (_e) {
    return null;
  }
}

// ── In-memory filter / sort / page over local products ────────────────────────

function applyFilters(
  products: LocalProduct[],
  filters: {
    search: string; brand: string; country: string; region: string;
    appellation: string; validation_status: string; classification: string;
    wine_classification: string; segment: string; tier: string;
    priceMin: number | null; priceMax: number | null; confMin: number | null;
  },
): LocalProduct[] {
  return products.filter(p => {
    const str = (v: unknown) => String(v ?? '').toLowerCase();
    const eq  = (a: unknown, b: string) => str(a) === b.toLowerCase();
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!str(p.name).includes(q) && !str(p.sku).includes(q) && !str(p.brand).includes(q)) return false;
    }
    if (filters.brand && !str(p.brand).includes(filters.brand.toLowerCase())) return false;
    if (filters.country && !eq(p.country, filters.country)) return false;
    if (filters.region && !eq(p.region, filters.region)) return false;
    if (filters.appellation && !eq(p.appellation, filters.appellation)) return false;
    if (filters.validation_status && !eq(p.validation_status, filters.validation_status)) return false;
    if (filters.classification) {
      const cls = String(p.classification ?? '').split('|')[0].trim();
      if (cls.toLowerCase() !== filters.classification.toLowerCase()) return false;
    }
    if (filters.wine_classification && !eq(p.wine_classification, filters.wine_classification)) return false;
    if (filters.segment) {
      const fn = SEGMENT_PREFIXES[filters.segment];
      if (fn && !fn(String(p.sku ?? ''))) return false;
    }
    if (filters.tier) {
      const ep = p.enrichment_priority ?? p.queue_priority;
      if (String(ep) !== filters.tier) return false;
    }
    if (filters.priceMin !== null && parseFloat(String(p.price ?? 0)) < filters.priceMin) return false;
    if (filters.priceMax !== null && parseFloat(String(p.price ?? 0)) > filters.priceMax) return false;
    if (filters.confMin !== null && parseFloat(String(p.enrichment_confidence ?? 0)) < filters.confMin) return false;
    return true;
  });
}

function sortProducts(products: LocalProduct[], sortCol: string, sortDir: string): LocalProduct[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...products].sort((a, b) => {
    const av = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity);
    const bv = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity);
    if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
    return dir * String(av).localeCompare(String(bv));
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search             = searchParams.get('search') ?? '';
    const brand              = searchParams.get('brand') ?? '';
    const country            = searchParams.get('country') ?? '';
    const validation_status  = searchParams.get('validation_status') ?? '';
    const classification     = searchParams.get('classification') ?? '';
    const region             = searchParams.get('region') ?? '';
    const appellation        = searchParams.get('appellation') ?? '';
    const wine_classification = searchParams.get('wine_classification') ?? '';
    const segment            = searchParams.get('segment') ?? '';
    const tier               = searchParams.get('tier') ?? '';
    const sortKey            = searchParams.get('sort') ?? 'created';
    const sortCol            = SORT_COLS[sortKey] ?? 'created_at';
    const sortDir            = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
    const page               = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit              = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const explicitOffset     = searchParams.get('offset');
    const offset             = explicitOffset ? parseInt(explicitOffset) : (page - 1) * limit;

    const rawPriceMin = searchParams.get('priceMin');
    const rawPriceMax = searchParams.get('priceMax');
    const rawConfMin  = searchParams.get('confMin');
    const priceMin = rawPriceMin ? parseFloat(rawPriceMin) : null;
    const priceMax = rawPriceMax ? parseFloat(rawPriceMax) : null;
    const confMin  = rawConfMin  ? parseFloat(rawConfMin) / 100 : null;

    const filterArgs = {
      search, brand, country, region, appellation,
      validation_status, classification, wine_classification, segment, tier,
      priceMin, priceMax, confMin,
    };

    // Build Supabase query string for parallel fetch
    const sbFilters: string[] = [];
    if (brand)              sbFilters.push(`brand=ilike.*${encodeURIComponent(brand)}*`);
    if (country)            sbFilters.push(`country=eq.${encodeURIComponent(country)}`);
    if (validation_status)  sbFilters.push(`validation_status=eq.${encodeURIComponent(validation_status)}`);
    if (classification)     sbFilters.push(`classification=eq.${encodeURIComponent(classification)}`);
    if (region)             sbFilters.push(`region=eq.${encodeURIComponent(region)}`);
    if (appellation)        sbFilters.push(`appellation=eq.${encodeURIComponent(appellation)}`);
    if (wine_classification) sbFilters.push(`wine_classification=eq.${encodeURIComponent(wine_classification)}`);
    if (tier)               sbFilters.push(`enrichment_priority=eq.${encodeURIComponent(tier)}`);
    if (segment) {
      const SEG: Record<string, string> = {
        wine: 'sku=like.W*', spirits: 'sku=like.L*', beer: 'sku=like.LBE*',
        sake: 'sku=like.LSK*', accessories: 'or=(sku.like.A*,sku.like.G*,sku.like.N*)',
      };
      if (SEG[segment]) sbFilters.push(SEG[segment]);
    }
    if (search) {
      sbFilters.push(`or=(name.ilike.*${encodeURIComponent(search)}*,sku.ilike.*${encodeURIComponent(search)}*,brand.ilike.*${encodeURIComponent(search)}*)`);
    }
    const sbQs = [
      ...sbFilters,
      `order=${sortCol}.${sortDir}.nullslast`,
      `limit=${limit}`,
      `offset=${offset}`,
    ].join('&');

    // ── Run local filter + Supabase in parallel ──────────────────────────────
    const [sbResult, localFiltered] = await Promise.all([
      fetchSupabase(sbQs).catch(() => null),
      Promise.resolve().then(() =>
        sortProducts(applyFilters(loadLocalProducts(), filterArgs), sortCol, sortDir)
      ).catch(() => [] as LocalProduct[]),
    ]);

    // ── If Supabase returned data, merge it with local (Supabase wins per field) ──
    if (sbResult && sbResult.items.length > 0) {
      const sbBySku = new Map<string, LocalProduct>();
      for (const p of sbResult.items) {
        if (p.sku) sbBySku.set(String(p.sku), p);
      }

      // Merge local enrichment fields into Supabase items (local wins for taste/taxonomy fields)
      const LOCAL_ENRICH_FIELDS = [
        'wine_body', 'wine_acidity', 'wine_tannin', 'flavor_tags', 'food_matching',
        'wine_classification', 'full_description', 'desc_en_short',
      ];
      const localBySku = new Map<string, LocalProduct>();
      for (const p of localFiltered) {
        if (p.sku) localBySku.set(String(p.sku), p);
      }

      const items = sbResult.items.map((sb: LocalProduct) => {
        const local = localBySku.get(String(sb.sku ?? ''));
        if (!local) return sb;
        const patch: LocalProduct = {};
        for (const f of LOCAL_ENRICH_FIELDS) {
          if (sb[f] == null && local[f] != null) patch[f] = local[f];
        }
        return {
          ...sb,
          ...patch,
          product_tier: sb.enrichment_priority == null ? null : `T${sb.enrichment_priority}`,
          product_tier_definition: sb.enrichment_note ?? null,
        };
      });

      return NextResponse.json({
        items,
        total: sbResult.total,
        page,
        pageSize: limit,
        totalPages: Math.ceil(sbResult.total / limit),
        source: 'supabase+local',
      }, { headers: CORS_HEADERS });
    }

    // ── Local-only fallback ──────────────────────────────────────────────────
    const total = localFiltered.length;
    const items = localFiltered.slice(offset, offset + limit).map(p => ({
      ...p,
      product_tier: p.enrichment_priority == null
        ? (p.queue_priority == null ? null : `T${p.queue_priority}`)
        : `T${p.enrichment_priority}`,
      product_tier_definition: p.enrichment_note ?? null,
    }));

    return NextResponse.json({
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
      source: 'local',
    }, { headers: CORS_HEADERS });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Request failed';
    const stack = error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : '';
    console.error('[/api/products] ERROR:', msg, stack);
    return NextResponse.json(
      { error: msg, stack },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
