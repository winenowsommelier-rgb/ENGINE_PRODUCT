import { NextRequest, NextResponse } from 'next/server';
import {
  filterGeographyEvidence,
  readGeographyEvidenceWithCuration,
  updateGeographyCuration,
} from '@/lib/research/geography-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { summary, evidence } = await readGeographyEvidenceWithCuration();
  const result = filterGeographyEvidence(evidence, {
    q: sp.get('q') ?? undefined,
    status: sp.get('status') ?? undefined,
    targetType: sp.get('target_type') ?? undefined,
    entityType: sp.get('entity_type') ?? undefined,
    curationStatus: sp.get('curation_status') ?? undefined,
    name: sp.get('name') ?? undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    offset: sp.get('offset') ? Number(sp.get('offset')) : undefined,
  });

  return NextResponse.json({
    summary,
    ...result,
    license_warning: 'WineSensed geography evidence is research-only. Review before changing canonical region, subregion, or appellation taxonomy.',
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.evidence_id) {
      return NextResponse.json({ error: 'evidence_id is required' }, { status: 400 });
    }

    const curation = await updateGeographyCuration(body.evidence_id, {
      status: body.status,
      reviewer: body.reviewer,
      notes: body.notes,
      source_urls: Array.isArray(body.source_urls) ? body.source_urls : undefined,
      confirmed_name: body.confirmed_name,
      confirmed_parent_name: body.confirmed_parent_name,
      promoted_entity_id: body.promoted_entity_id,
    });

    return NextResponse.json({ curation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update curation' },
      { status: 500 },
    );
  }
}
