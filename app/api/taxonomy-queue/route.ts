import { NextRequest, NextResponse } from 'next/server';
import { getQueueProducts } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await getQueueProducts({
      validation_status: searchParams.get('validation_status') ?? undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
