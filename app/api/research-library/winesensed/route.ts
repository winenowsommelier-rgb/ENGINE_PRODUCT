import { NextRequest, NextResponse } from 'next/server';
import {
  listWineSensedResearch,
  readWineSensedResearch,
  readWineSensedSummary,
} from '@/lib/research/winesensed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const records = await readWineSensedResearch();
  const summary = await readWineSensedSummary();

  const result = listWineSensedResearch(records, {
    q: sp.get('q') ?? undefined,
    country: sp.get('country') ?? undefined,
    region: sp.get('region') ?? undefined,
    grape: sp.get('grape') ?? undefined,
    hasReview: sp.get('has_review') === 'true',
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    offset: sp.get('offset') ? Number(sp.get('offset')) : undefined,
  });

  return NextResponse.json({
    summary,
    ...result,
    license_warning: 'WineSensed dataset is CC BY-NC-ND 4.0. Use as research-only reference, not production product copy.',
  });
}
