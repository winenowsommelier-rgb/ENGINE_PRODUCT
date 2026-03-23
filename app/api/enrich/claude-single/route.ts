import { NextRequest, NextResponse } from 'next/server';
import { enrichSingleWithClaude } from '@/lib/enrichment/claude';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.sku || !body.name) {
      return NextResponse.json({ error: 'sku and name are required' }, { status: 400 });
    }
    const result = await enrichSingleWithClaude(body);
    if ('error' in result) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json({ suggestions: result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Claude API error' }, { status: 500 });
  }
}
