import { NextRequest, NextResponse } from 'next/server';
import { buildValidationReport, buildCsv } from '@/lib/data-quality';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * Fetch all products for a given enrichment_priority tier (or all).
 * Supabase REST API caps at 1000 rows per request, so we paginate.
 */
async function fetchProducts(tier?: string): Promise<any[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: any[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filters: string[] = [];
    if (tier) filters.push(`enrichment_priority=eq.${tier}`);
    filters.push(`order=sku.asc`);
    filters.push(`offset=${offset}`);
    filters.push(`limit=${PAGE}`);

    const qs = filters.join('&');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*&${qs}`, {
      headers: { ...HEADERS, Prefer: 'count=exact' },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase fetch failed: ${err}`);
    }

    const batch = await res.json();
    all.push(...batch);

    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  return all;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tier = searchParams.get('tier') ?? undefined;
    const exportMode = searchParams.get('export') ?? '';

    const products = await fetchProducts(tier);

    if (products.length === 0) {
      return NextResponse.json({
        summary: { total: 0, avg_score: 0, passing: 0, failing: 0 },
        distribution: { '90+': 0, '80-89': 0, '70-79': 0, '60-69': 0, '<60': 0 },
        top_issues: [],
        products: [],
      });
    }

    const report = buildValidationReport(products);

    // CSV masterfile export
    if (exportMode === 'masterfile') {
      const csv = buildCsv(report.products);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="masterfile_tier${tier ?? 'all'}_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // Issues report export (products below threshold)
    if (exportMode === 'issues') {
      const belowThreshold = report.products.filter((p: any) => p.quality_score.total < 75);
      const csv = buildCsv(belowThreshold);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="issues_report_tier${tier ?? 'all'}_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // Return JSON — limit product details to keep payload manageable
    const productSummaries = report.products.map((p: any) => ({
      id: p.id,
      sku: p.sku,
      sku_base: p.sku_base,
      name: p.name,
      classification: p.classification,
      country: p.country,
      vintage: p.vintage,
      price: p.price,
      enrichment_priority: p.enrichment_priority,
      quality_score: p.quality_score,
    }));

    return NextResponse.json({
      summary: report.summary,
      distribution: report.distribution,
      top_issues: report.top_issues,
      products: productSummaries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Validation failed' },
      { status: 500 },
    );
  }
}
