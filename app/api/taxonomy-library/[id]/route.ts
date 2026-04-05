import { NextRequest, NextResponse } from 'next/server';
import { supabaseProject } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const headers = {
  apikey: supabaseProject.publishableKey,
  Authorization: `Bearer ${supabaseProject.publishableKey}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${supabaseProject.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    // Fetch entity
    const entities = await sbFetch(`taxonomy_entities?id=eq.${id}&select=id,entity_type,name,slug,parent_id`);
    if (!entities?.length) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }
    const entity = entities[0];

    // Build breadcrumb by walking up parent chain
    const breadcrumb: Array<{ id: string; name: string; entity_type: string }> = [];
    let currentId = entity.parent_id;
    while (currentId) {
      const parents = await sbFetch(`taxonomy_entities?id=eq.${currentId}&select=id,entity_type,name,parent_id`);
      if (!parents?.length) break;
      breadcrumb.unshift({ id: parents[0].id, name: parents[0].name, entity_type: parents[0].entity_type });
      currentId = parents[0].parent_id;
    }

    // Fetch all contexts for this entity
    const contexts = await sbFetch(
      `taxonomy_contexts?entity_id=eq.${id}&select=id,entity_id,scope_id,description_short,description_en,attributes,status`
    );

    // Fetch scopes
    const scopes = await sbFetch('scopes?select=id,label,description,icon&order=label.asc');

    // Fetch scope_attribute_defs for each scope that has a context
    const scopeIds = [...new Set((contexts ?? []).map((c: any) => c.scope_id))];
    let attributeDefs: any[] = [];
    if (scopeIds.length > 0) {
      attributeDefs = await sbFetch(
        `scope_attribute_defs?scope_id=in.(${scopeIds.join(',')})&select=id,scope_id,attribute_key,label,data_type&order=label.asc`
      );
    }

    return NextResponse.json({
      entity,
      breadcrumb,
      contexts: contexts ?? [],
      scopes: scopes ?? [],
      attributeDefs: attributeDefs ?? [],
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

    const updatePayload: Record<string, any> = {};
    if (description_short !== undefined) updatePayload.description_short = description_short;
    if (description_en !== undefined) updatePayload.description_en = description_en;
    if (attributes !== undefined) updatePayload.attributes = attributes;
    if (status !== undefined) updatePayload.status = status;

    const result = await sbFetch(
      `taxonomy_contexts?id=eq.${context_id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(updatePayload),
      }
    );

    return NextResponse.json({ ok: true, context: result?.[0] ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
