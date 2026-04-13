import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const SEGMENT_FILTERS: Record<string, string> = {
  wine: "sku=like.W*",
  spirits: "sku=like.L*",
  beer: "sku=like.LBE*",
  sake: "sku=like.LSK*",
};

const SORT_MAP: Record<string, string> = {
  popular: "enrichment_priority.desc.nullslast,price.desc.nullslast",
  "price-asc": "price.asc.nullslast",
  "price-desc": "price.desc.nullslast",
  newest: "vintage.desc.nullslast,created_at.desc",
  name: "name.asc",
};

const SELECT_FIELDS = [
  "id",
  "sku",
  "name",
  "brand",
  "classification",
  "grape_variety",
  "wine_color",
  "vintage",
  "price",
  "currency",
  "country",
  "region",
  "subregion",
  "image_url",
].join(",");

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const country = sp.get("country") ?? "";
  const region = sp.get("region") ?? "";
  const subregion = sp.get("subregion") ?? "";
  const category = sp.get("category") ?? "";
  const sort = sp.get("sort") ?? "popular";
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit") ?? 20)));
  const offset = (page - 1) * limit;

  const filters: string[] = [];

  if (country) filters.push(`country=eq.${encodeURIComponent(country)}`);
  if (region) filters.push(`region=eq.${encodeURIComponent(region)}`);
  if (subregion) filters.push(`subregion=eq.${encodeURIComponent(subregion)}`);
  if (category && SEGMENT_FILTERS[category]) filters.push(SEGMENT_FILTERS[category]);

  // Product filters — multi-select fields use PostgREST `in.()` syntax
  const wineColor = sp.get("wine_color") ?? "";
  const classification = sp.get("classification") ?? "";
  const grapeVariety = sp.get("grape_variety") ?? "";
  const priceMin = sp.get("price_min") ?? "";
  const priceMax = sp.get("price_max") ?? "";

  if (wineColor) {
    const vals = wineColor.split(",").map((v) => encodeURIComponent(v.trim()));
    filters.push(vals.length === 1
      ? `wine_color=eq.${vals[0]}`
      : `wine_color=in.(${vals.join(",")})`);
  }
  if (classification) {
    const vals = classification.split(",").map((v) => encodeURIComponent(v.trim()));
    filters.push(vals.length === 1
      ? `classification=eq.${vals[0]}`
      : `classification=in.(${vals.join(",")})`);
  }
  if (grapeVariety) {
    const vals = grapeVariety.split(",").map((v) => encodeURIComponent(v.trim()));
    filters.push(vals.length === 1
      ? `grape_variety=eq.${vals[0]}`
      : `grape_variety=in.(${vals.join(",")})`);
  }
  if (priceMin) filters.push(`price=gte.${Number(priceMin)}`);
  if (priceMax) filters.push(`price=lte.${Number(priceMax)}`);

  const order = SORT_MAP[sort] ?? SORT_MAP.popular;

  const qs = [
    `select=${SELECT_FIELDS}`,
    ...filters,
    `order=${order}`,
    `limit=${limit}`,
    `offset=${offset}`,
  ].join("&");

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?${qs}`, {
      headers: { ...HEADERS, Prefer: "count=exact" },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: "upstream_error", detail: text }, { status: 502 });
    }

    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
    const products = await res.json();

    return NextResponse.json({ products, total, page, limit });
  } catch (err) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
