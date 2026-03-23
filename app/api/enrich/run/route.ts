import { NextRequest, NextResponse } from 'next/server';
import { getPipelineStatus } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const status = await getPipelineStatus();
    if (status.status === 'running') {
      return NextResponse.json({ error: 'Pipeline already running' }, { status: 409 });
    }
    const body = await req.json().catch(() => ({}));
    // Fire-and-forget — don't await
    import('@/lib/enrichment/pipeline').then(({ runEnrichmentPipeline }) => {
      runEnrichmentPipeline({ productIds: body.productIds, forceReEnrich: body.forceReEnrich })
        .catch(console.error);
    });
    return NextResponse.json({ started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
