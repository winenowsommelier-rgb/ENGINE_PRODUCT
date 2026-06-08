import { NextRequest, NextResponse } from 'next/server';
import { readCurationRuns, saveCurationRun } from '@/lib/curation/storage';

export const runtime = 'nodejs';

export async function GET() {
  const runs = await readCurationRuns();
  return NextResponse.json({ runs: runs.slice(0, 30) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.brief || !Array.isArray(body.products)) {
      return NextResponse.json({ error: 'brief and products are required' }, { status: 400 });
    }
    const run = await saveCurationRun({
      id: body.id,
      brief: String(body.brief),
      resolved_query: body.resolved_query ?? {},
      candidate_count: Number(body.candidate_count ?? body.products.length ?? 0),
      products: body.products,
      run_time_s: Number.isFinite(Number(body.run_time_s)) ? Number(body.run_time_s) : undefined,
      llm_cost_usd: Number.isFinite(Number(body.llm_cost_usd)) ? Number(body.llm_cost_usd) : undefined,
      approved_skus: Array.isArray(body.approved_skus) ? body.approved_skus : [],
      skipped_skus: Array.isArray(body.skipped_skus) ? body.skipped_skus : [],
      operator_note: body.operator_note ? String(body.operator_note) : undefined,
    });
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save curation run' },
      { status: 500 },
    );
  }
}
