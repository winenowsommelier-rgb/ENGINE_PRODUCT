import { NextRequest, NextResponse } from 'next/server';
import { getTaxonomyDb } from '@/lib/taxonomy-db';

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

/* ── In-memory cache for style data ────────────────────────────────────── */

interface StyleCache {
  data: StyleProduct[];
  ts: number;
}

interface StyleProduct {
  classification: string | null;
  wine_classification: string | null;
  country: string | null;
  grape_variety: string | null;
  wine_body: number | null;
  wine_acidity: number | null;
  wine_tannin: number | null;
}

let _styleCache: StyleCache | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchStyleProducts(): Promise<StyleProduct[]> {
  if (_styleCache && Date.now() - _styleCache.ts < CACHE_TTL) {
    return _styleCache.data;
  }

  const select =
    'classification,wine_classification,country,grape_variety,wine_body,wine_acidity,wine_tannin';
  const all: StyleProduct[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/products?select=${select}&is_primary_variant=eq.true&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }

  _styleCache = { data: all, ts: Date.now() };
  return all;
}

/* ── Body-based sub-style classification ───────────────────────────────── */

function bodySubStyle(
  body: number | null
): string {
  if (body == null) return 'Unspecified';
  if (body >= 4) return 'Full-bodied';
  if (body >= 2.5) return 'Medium-bodied';
  return 'Light-bodied';
}

/* ── GET handler ───────────────────────────────────────────────────────── */

export async function GET(_req: NextRequest) {
  try {
    const db = getTaxonomyDb();

    // Load classification-to-scope map for grouping
    const scopeMap = db
      .prepare('SELECT classification, scope_id FROM classification_scope_map')
      .all() as { classification: string; scope_id: string }[];

    const classToScope = new Map<string, string>();
    for (const row of scopeMap) {
      classToScope.set(row.classification, row.scope_id);
    }

    // Fetch products
    const products = await fetchStyleProducts();

    // Group by classification
    const classGroups = new Map<
      string,
      {
        products: StyleProduct[];
        scope: string;
      }
    >();

    for (const p of products) {
      const cls = p.classification || 'Unknown';
      if (!classGroups.has(cls)) {
        classGroups.set(cls, {
          products: [],
          scope: classToScope.get(cls) || 'other',
        });
      }
      classGroups.get(cls)!.products.push(p);
    }

    // Build classifications output
    const classifications: any[] = [];

    for (const [name, group] of classGroups) {
      const prods = group.products;
      const count = prods.length;

      // Character profile: average of non-null values
      let bodySum = 0,
        bodyN = 0;
      let acidSum = 0,
        acidN = 0;
      let tanninSum = 0,
        tanninN = 0;

      for (const p of prods) {
        if (p.wine_body != null) {
          bodySum += p.wine_body;
          bodyN++;
        }
        if (p.wine_acidity != null) {
          acidSum += p.wine_acidity;
          acidN++;
        }
        if (p.wine_tannin != null) {
          tanninSum += p.wine_tannin;
          tanninN++;
        }
      }

      const characterProfile: Record<string, number | null> = {
        body: bodyN > 0 ? Math.round((bodySum / bodyN) * 10) / 10 : null,
        acidity: acidN > 0 ? Math.round((acidSum / acidN) * 10) / 10 : null,
        tannin:
          tanninN > 0 ? Math.round((tanninSum / tanninN) * 10) / 10 : null,
      };

      // Sub-styles by body range
      const subStyleMap = new Map<string, { count: number; grapes: Map<string, number> }>();
      for (const p of prods) {
        const style = bodySubStyle(p.wine_body);
        if (!subStyleMap.has(style))
          subStyleMap.set(style, { count: 0, grapes: new Map() });
        const entry = subStyleMap.get(style)!;
        entry.count++;
        if (p.grape_variety) {
          // grape_variety may be comma-separated
          const grapes = p.grape_variety.split(',').map((g: string) => g.trim());
          for (const g of grapes) {
            if (g) entry.grapes.set(g, (entry.grapes.get(g) || 0) + 1);
          }
        }
      }

      const subStyles = Array.from(subStyleMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([styleName, data]) => ({
          name: styleName,
          product_count: data.count,
          typical_grapes: Array.from(data.grapes.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([g]) => g),
        }));

      // Top countries
      const countryMap = new Map<string, number>();
      for (const p of prods) {
        const c = (p.country || '').trim();
        if (c) countryMap.set(c, (countryMap.get(c) || 0) + 1);
      }
      const topCountries = Array.from(countryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([n, c]) => ({ name: n, count: c }));

      // Top grapes
      const grapeMap = new Map<string, number>();
      for (const p of prods) {
        if (p.grape_variety) {
          const grapes = p.grape_variety.split(',').map((g: string) => g.trim());
          for (const g of grapes) {
            if (g) grapeMap.set(g, (grapeMap.get(g) || 0) + 1);
          }
        }
      }
      const topGrapes = Array.from(grapeMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([n, c]) => ({ name: n, count: c }));

      classifications.push({
        name,
        scope: group.scope,
        product_count: count,
        character_profile: characterProfile,
        sub_styles: subStyles,
        top_countries: topCountries,
        top_grapes: topGrapes,
      });
    }

    // Sort by product count descending
    classifications.sort((a, b) => b.product_count - a.product_count);

    return NextResponse.json({
      classifications,
      _meta: {
        generated_at: new Date().toISOString(),
        total_products: products.length,
        total_classifications: classifications.length,
      },
    });
  } catch (err: any) {
    console.error('[style-map] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
