import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import champagneRules from "@/data/taxonomy/champagne-subregion-rules.json";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const SEGMENT_FILTERS: Record<string, string> = {
  wine: "sku=like.W*",
  spirits: "sku=like.L*",
  beer: "sku=like.LBE*",
  sake: "sku=like.LSK*",
};

const SEGMENT_MATCH: Record<string, (sku: string) => boolean> = {
  wine:    sku => sku.startsWith("W"),
  spirits: sku => sku.startsWith("L") && !sku.startsWith("LBE") && !sku.startsWith("LSK"),
  beer:    sku => sku.startsWith("LBE"),
  sake:    sku => sku.startsWith("LSK"),
};

const SORT_MAP: Record<string, string> = {
  popular:    "popularity_score.desc.nullslast,popularity_orders_90d.desc.nullslast,price.desc.nullslast",
  "price-asc":  "price.asc.nullslast",
  "price-desc": "price.desc.nullslast",
  newest:     "vintage.desc.nullslast,created_at.desc",
  name:       "name.asc",
};

const SELECT_FIELDS = [
  "id", "sku", "name", "brand", "classification", "grape_variety", "wine_color",
  "vintage", "price", "currency", "country", "region", "subregion", "image_url",
  "desc_en_short", "wine_body", "wine_acidity", "wine_tannin", "flavor_tags",
  "food_matching", "popularity_score", "popularity_qty_90d", "popularity_orders_90d",
  "popularity_revenue_90d", "popularity_window_days", "popularity_synced_at",
  "grape_blend_type", "wine_production_style", "score_max", "score_summary", "full_description",
].join(",");

// ── Champagne helpers ─────────────────────────────────────────────────────────

const CHAMPAGNE_COUNTRY = "France";
const CHAMPAGNE_REGION = "Champagne";
const CHAMPAGNE_SUBREGION_NAMES = new Set(champagneRules.subregions.map((item) => item.name));
const CHAMPAGNE_BLOCKED_PREFIXES = champagneRules.blocked_brand_prefixes.map(normalizeText);
const CHAMPAGNE_PREFIX_ENTRIES = Object.entries(champagneRules.brand_prefix_map).map(
  ([prefix, subregion]) => [normalizeText(prefix), subregion] as const,
);

type ExploreProduct = {
  id?: string | number;
  sku: string;
  name: string;
  brand?: string | null;
  country?: string | null;
  region?: string | null;
  subregion?: string | null;
  [key: string]: unknown;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferChampagneSubregion(product: ExploreProduct): string | null {
  const rawSubregion = String(product.subregion ?? "").trim();
  if (CHAMPAGNE_SUBREGION_NAMES.has(rawSubregion)) return rawSubregion;

  const brand = normalizeText(String(product.brand ?? ""));
  const name = normalizeText(String(product.name ?? ""));
  for (const prefix of CHAMPAGNE_BLOCKED_PREFIXES) {
    if (brand.startsWith(prefix) || name.startsWith(prefix)) return null;
  }
  for (const source of [brand, name]) {
    for (const [prefix, subregion] of CHAMPAGNE_PREFIX_ENTRIES) {
      if (source.startsWith(prefix)) return subregion;
    }
  }
  return null;
}

// ── Local data cache ──────────────────────────────────────────────────────────

let _localCache: ExploreProduct[] | null = null;

function loadLocalProducts(): ExploreProduct[] {
  if (_localCache) return _localCache;

  const livePath = path.join(process.cwd(), "data", "live_products_export.json");
  const dbPath   = path.join(process.cwd(), "data", "db", "products.json");

  let liveProducts: ExploreProduct[] = [];
  let dbProducts:   ExploreProduct[] = [];

  try {
    const raw = JSON.parse(fs.readFileSync(livePath, "utf8"));
    liveProducts = Array.isArray(raw) ? raw : (raw.products ?? []);
  } catch (_e) {}

  try {
    const raw = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    dbProducts = Array.isArray(raw) ? raw : [];
  } catch (_e) {}

  // Merge db fields (id, image_url, etc.) into live products
  const dbBySku = new Map<string, ExploreProduct>();
  for (const p of dbProducts) if (p.sku) dbBySku.set(String(p.sku), p);

  const DB_SUPPLEMENT = ["id", "image_url", "image_scraped_url", "created_at", "updated_at",
    "popularity_score", "popularity_orders_90d", "popularity_revenue_90d",
    "popularity_qty_90d", "popularity_window_days", "popularity_synced_at"];

  const merged = liveProducts.map(live => {
    const db = dbBySku.get(String(live.sku ?? ""));
    if (!db) return live;
    const patch: Partial<ExploreProduct> = {};
    for (const f of DB_SUPPLEMENT) {
      if (live[f] == null && db[f] != null) patch[f] = db[f];
    }
    return { ...live, ...patch };
  });

  // Add db-only products
  const liveSkus = new Set(liveProducts.map(p => String(p.sku ?? "")));
  for (const db of dbProducts) {
    if (!liveSkus.has(String(db.sku ?? ""))) merged.push(db);
  }

  _localCache = merged;
  return merged;
}

// ── Local filter ──────────────────────────────────────────────────────────────

function filterLocal(
  products: ExploreProduct[],
  params: {
    country: string; region: string; subregion: string; category: string;
    wineColor: string; classification: string; grapeVariety: string;
    priceMin: string; priceMax: string;
  },
  isChampagneSubregion: boolean,
): ExploreProduct[] {
  return products.filter(p => {
    const str = (v: unknown) => String(v ?? "").toLowerCase();
    if (params.country && str(p.country) !== params.country.toLowerCase()) return false;
    if (params.region  && str(p.region)  !== params.region.toLowerCase())  return false;
    if (params.subregion && !isChampagneSubregion && str(p.subregion) !== params.subregion.toLowerCase()) return false;
    if (params.category) {
      const fn = SEGMENT_MATCH[params.category];
      if (fn && !fn(String(p.sku ?? ""))) return false;
    }
    if (params.wineColor) {
      const vals = params.wineColor.split(",").map(v => v.trim().toLowerCase());
      if (!vals.includes(str(p.wine_color))) return false;
    }
    if (params.classification) {
      const vals = params.classification.split(",").map(v => v.trim().toLowerCase());
      if (!vals.includes(str(p.classification))) return false;
    }
    if (params.grapeVariety) {
      const vals = params.grapeVariety.split(",").map(v => v.trim().toLowerCase());
      if (!vals.some(v => str(p.grape_variety).includes(v))) return false;
    }
    if (params.priceMin && Number(p.price) < Number(params.priceMin)) return false;
    if (params.priceMax && Number(p.price) > Number(params.priceMax)) return false;
    return true;
  });
}

function sortLocal(products: ExploreProduct[], sortKey: string): ExploreProduct[] {
  return [...products].sort((a, b) => {
    switch (sortKey) {
      case "popular":
        return (Number(b.popularity_score ?? 0) - Number(a.popularity_score ?? 0)) ||
               (Number(b.popularity_orders_90d ?? 0) - Number(a.popularity_orders_90d ?? 0)) ||
               (Number(b.price ?? 0) - Number(a.price ?? 0));
      case "price-asc":  return (Number(a.price ?? 0)) - (Number(b.price ?? 0));
      case "price-desc": return (Number(b.price ?? 0)) - (Number(a.price ?? 0));
      case "newest":
        return (String(b.vintage ?? "")).localeCompare(String(a.vintage ?? "")) ||
               (String(b.created_at ?? "")).localeCompare(String(a.created_at ?? ""));
      case "name": return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      default:     return 0;
    }
  });
}

// ── Supabase fetch (best-effort) ──────────────────────────────────────────────

async function fetchSupabase(qs: string): Promise<{ products: ExploreProduct[]; total: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?${qs}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      },
    });
    if (!res.ok) return null;
    const products = (await res.json()) as ExploreProduct[];
    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? products.length);
    return { products, total };
  } catch (_e) {
    return null;
  }
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const country      = sp.get("country") ?? "";
  const region       = sp.get("region") ?? "";
  const subregion    = sp.get("subregion") ?? "";
  const category     = sp.get("category") ?? "";
  const sort         = sp.get("sort") ?? "popular";
  const page         = Math.max(1, Number(sp.get("page") ?? 1));
  const limit        = Math.min(50, Math.max(1, Number(sp.get("limit") ?? 20)));
  const offset       = (page - 1) * limit;
  const wineColor    = sp.get("wine_color") ?? "";
  const classification = sp.get("classification") ?? "";
  const grapeVariety = sp.get("grape_variety") ?? "";
  const priceMin     = sp.get("price_min") ?? "";
  const priceMax     = sp.get("price_max") ?? "";

  const isChampagneSubregion =
    country === CHAMPAGNE_COUNTRY &&
    region  === CHAMPAGNE_REGION &&
    CHAMPAGNE_SUBREGION_NAMES.has(subregion);

  // Build Supabase query string
  const sbFilters: string[] = [];
  if (country)    sbFilters.push(`country=eq.${encodeURIComponent(country)}`);
  if (region)     sbFilters.push(`region=eq.${encodeURIComponent(region)}`);
  if (subregion && !isChampagneSubregion) sbFilters.push(`subregion=eq.${encodeURIComponent(subregion)}`);
  if (category && SEGMENT_FILTERS[category]) sbFilters.push(SEGMENT_FILTERS[category]);
  if (wineColor) {
    const vals = wineColor.split(",").map(v => encodeURIComponent(v.trim()));
    sbFilters.push(vals.length === 1 ? `wine_color=eq.${vals[0]}` : `wine_color=in.(${vals.join(",")})`);
  }
  if (classification) {
    const vals = classification.split(",").map(v => encodeURIComponent(v.trim()));
    sbFilters.push(vals.length === 1 ? `classification=eq.${vals[0]}` : `classification=in.(${vals.join(",")})`);
  }
  if (grapeVariety) {
    const vals = grapeVariety.split(",").map(v => encodeURIComponent(v.trim()));
    sbFilters.push(vals.length === 1 ? `grape_variety=eq.${vals[0]}` : `grape_variety=in.(${vals.join(",")})`);
  }
  if (priceMin) sbFilters.push(`price=gte.${Number(priceMin)}`);
  if (priceMax) sbFilters.push(`price=lte.${Number(priceMax)}`);

  const order = SORT_MAP[sort] ?? SORT_MAP.popular;
  const sbQs = [
    `select=${SELECT_FIELDS}`,
    ...sbFilters,
    `order=${order}`,
    `limit=${isChampagneSubregion ? 1000 : limit}`,
    `offset=${isChampagneSubregion ? 0 : offset}`,
  ].join("&");

  try {
    // Run local filter + Supabase in parallel
    const filterParams = { country, region, subregion, category, wineColor, classification, grapeVariety, priceMin, priceMax };
    const [sbResult, localFiltered] = await Promise.all([
      fetchSupabase(sbQs),
      Promise.resolve(sortLocal(filterLocal(loadLocalProducts(), filterParams, isChampagneSubregion), sort)),
    ]);

    // Champagne subregion — apply inference filter post-fetch
    if (isChampagneSubregion) {
      const source = sbResult?.products ?? localFiltered;
      const filtered = source.filter(p =>
        String(p.country ?? "") === CHAMPAGNE_COUNTRY &&
        String(p.region ?? "") === CHAMPAGNE_REGION &&
        inferChampagneSubregion(p) === subregion,
      );
      return NextResponse.json({
        products: filtered.slice(offset, offset + limit),
        total: filtered.length,
        page,
        limit,
        source: sbResult ? "supabase" : "local",
      });
    }

    // Supabase succeeded — return it directly
    if (sbResult) {
      return NextResponse.json({
        products: sbResult.products,
        total: sbResult.total,
        page,
        limit,
        source: "supabase",
      });
    }

    // Local fallback
    return NextResponse.json({
      products: localFiltered.slice(offset, offset + limit),
      total: localFiltered.length,
      page,
      limit,
      source: "local",
    });

  } catch (err) {
    return NextResponse.json({ error: "fetch_failed", detail: String(err) }, { status: 500 });
  }
}
