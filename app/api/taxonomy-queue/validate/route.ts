import { NextRequest, NextResponse } from 'next/server';
import { validateProducts, batchValidateTopN } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.batchMode === true) {
      const n = typeof body.n === 'number' ? body.n : 50;
      const result = await batchValidateTopN(n);
      return NextResponse.json(result);
    }

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
    }

    const result = await validateProducts(body.ids, body.note);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
