import { NextRequest, NextResponse } from 'next/server';
import { listEntities, getScopes, getTaxonomyStats } from '@/lib/taxonomy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  try {
    const entities = listEntities({
      entityType: sp.get('entity_type') || undefined,
      scopeId: sp.get('scope_id') || undefined,
      status: sp.get('status') || undefined,
      search: sp.get('search') || undefined,
      parentId: sp.get('parent_id') ? Number(sp.get('parent_id')) : undefined,
      limit: sp.get('limit') ? Number(sp.get('limit')) : 200,
    });

    const scopes = getScopes();
    const stats = getTaxonomyStats();

    return NextResponse.json({ entities, scopes, stats });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
