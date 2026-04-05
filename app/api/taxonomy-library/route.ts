import { NextRequest, NextResponse } from 'next/server';
import { supabaseProject } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const headers = {
  apikey: supabaseProject.publishableKey,
  Authorization: `Bearer ${supabaseProject.publishableKey}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path: string) {
  const res = await fetch(`${supabaseProject.url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const entityType = sp.get('entity_type');
  const scopeId = sp.get('scope_id');
  const status = sp.get('status');
  const search = sp.get('search');
  const parentId = sp.get('parent_id');

  try {
    // Build entity query
    const entityParts: string[] = [];
    entityParts.push('select=id,entity_type,name,slug,parent_id');
    if (entityType) entityParts.push(`entity_type=eq.${entityType}`);
    if (parentId) entityParts.push(`parent_id=eq.${parentId}`);
    if (search) entityParts.push(`name=ilike.*${encodeURIComponent(search)}*`);
    entityParts.push('order=name.asc');
    entityParts.push('limit=200');

    const entities = await sbFetch(`taxonomy_entities?${entityParts.join('&')}`);

    if (entities.length === 0) {
      return NextResponse.json({ entities: [], scopes: [] });
    }

    // Fetch contexts for these entities
    const entityIds = entities.map((e: any) => e.id);
    const ctxParts: string[] = [];
    ctxParts.push('select=id,entity_id,scope_id,description_short,description_en,attributes,status');
    ctxParts.push(`entity_id=in.(${entityIds.join(',')})`);
    if (scopeId) ctxParts.push(`scope_id=eq.${scopeId}`);
    if (status) ctxParts.push(`status=eq.${status}`);

    const contexts = await sbFetch(`taxonomy_contexts?${ctxParts.join('&')}`);

    // If scope/status filter is active, only return entities that have matching contexts
    let filteredEntities = entities;
    if (scopeId || status) {
      const matchedEntityIds = new Set(contexts.map((c: any) => c.entity_id));
      filteredEntities = entities.filter((e: any) => matchedEntityIds.has(e.id));
    }

    // Attach contexts to entities
    const result = filteredEntities.map((e: any) => ({
      ...e,
      contexts: contexts.filter((c: any) => c.entity_id === e.id),
    }));

    // Fetch scopes for reference
    const scopes = await sbFetch('scopes?select=id,label,description,icon&order=label.asc');

    return NextResponse.json({ entities: result, scopes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
