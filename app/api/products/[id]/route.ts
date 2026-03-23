import { NextRequest, NextResponse } from 'next/server';
import { getProductWithChangelog, updateProductFields } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await getProductWithChangelog(params.id);
    if (!result) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: 'fields object required' }, { status: 400 });
    }
    const result = await updateProductFields(params.id, body.fields, body.note);
    if (!result.updated) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
