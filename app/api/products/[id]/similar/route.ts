import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

type SimilarRow = {
  similar_id: string;
  score: number;
  matching_notes: unknown;
  products?: {
    id: string;
    sku: string;
    name: string | null;
    classification: string | null;
    price: number | null;
    image_url: string | null;
  };
};

/**
 * GET /api/products/[id]/similar?limit=10
 *
 * Returns the top-N products with the highest pre-computed similarity score
 * to the given product. The similarity table is populated by the pg_cron
 * job that runs the `recompute_similarity_for_product` plpgsql function.
 *
 * The PostgREST embed (`products:similar_id(...)`) joins each row with the
 * referenced product's display fields so the client gets everything in one
 * request.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));

  const select = 'similar_id,score,matching_notes,products:similar_id(id,sku,name,classification,price,image_url)';
  const qs = new URLSearchParams({
    select,
    product_id: `eq.${params.id}`,
    order: 'score.desc',
    limit: String(limit),
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/product_similar?${qs}`, {
    headers: HEADERS,
    // Cache: similar lists are pre-computed nightly + on the dirty queue —
    // tolerate a few seconds of staleness for performance.
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `product_similar fetch failed: ${res.status} ${text.slice(0, 200)}` },
      { status: 500 }
    );
  }

  const rows = (await res.json()) as SimilarRow[];
  return NextResponse.json({ similar: rows });
}
