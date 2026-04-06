import { NextRequest, NextResponse } from 'next/server';
import { getEntityDetail, updateContext, getScopes, getAttributeDefs } from '@/lib/taxonomy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const detail = getEntityDetail(Number(params.id));
    if (!detail) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    const scopes = getScopes();

    // Get attribute defs for scopes that have contexts
    const scopeIds = [...new Set(detail.contexts.map(c => c.scope_id))];
    const attributeDefs = scopeIds.flatMap(sid => getAttributeDefs(sid));

    return NextResponse.json({
      entity: detail.entity,
      breadcrumb: detail.breadcrumb,
      contexts: detail.contexts,
      scopes,
      attributeDefs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { context_id, description_short, description_en, attributes, status } = body;

    if (!context_id) {
      return NextResponse.json({ error: 'context_id is required' }, { status: 400 });
    }

    updateContext(Number(context_id), {
      description_short,
      description_en,
      attributes,
      status,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
