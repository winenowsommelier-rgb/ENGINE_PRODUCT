import { NextRequest, NextResponse } from 'next/server';
import {
  buildAuthorityCandidates,
  updateAuthorityDecision,
} from '@/lib/research/authority-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const data = await buildAuthorityCandidates({
    status: sp.get('status') ?? undefined,
    q: sp.get('q') ?? undefined,
    country: sp.get('country') ?? undefined,
    missing_field: sp.get('missing_field') ?? undefined,
    sku_tier: sp.get('sku_tier') ?? undefined,
    sales_tier: sp.get('sales_tier') ?? undefined,
    price_tier: sp.get('price_tier') ?? undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    offset: sp.get('offset') ? Number(sp.get('offset')) : undefined,
  });
  return NextResponse.json({
    ...data,
    rule: 'Authority validation is required before taxonomy promotion or product updates.',
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.candidate_id) {
      return NextResponse.json({ error: 'candidate_id is required' }, { status: 400 });
    }

    const decision = await updateAuthorityDecision(String(body.candidate_id), {
      status: body.status,
      authority_urls: Array.isArray(body.authority_urls) ? body.authority_urls : undefined,
      authority_notes: body.authority_notes,
      reviewer: body.reviewer,
      validated_value: body.validated_value,
      validated_field: body.validated_field,
      confidence: body.confidence,
    });

    return NextResponse.json({ decision });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update authority decision' },
      { status: 500 },
    );
  }
}
