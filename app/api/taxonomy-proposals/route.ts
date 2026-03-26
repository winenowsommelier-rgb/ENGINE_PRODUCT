import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204 || res.status === 201) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// GET /api/taxonomy-proposals?status=pending
export async function GET(req: NextRequest) {
  try {
    const status = new URL(req.url).searchParams.get('status') ?? 'pending';
    const rows = await sbFetch(
      `taxonomy_proposals?status=eq.${status}&order=occurrences.desc,created_at.asc&limit=200`
    );
    return NextResponse.json({ proposals: rows ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

// PATCH /api/taxonomy-proposals  body: { id: string, action: 'approve' | 'reject' }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action } = body as { id: string; action: 'approve' | 'reject' };
    if (!id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
    }

    // Update proposal status
    await sbFetch(`taxonomy_proposals?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() }),
    });

    // On approve: reset affected products to raw so next pipeline run re-processes them
    if (action === 'approve') {
      const proposals = await sbFetch(`taxonomy_proposals?id=eq.${id}&select=proposed_value`);
      const val = proposals?.[0]?.proposed_value;
      if (val) {
        await sbFetch(`products?enrichment_note=like.*${val}*&validation_status=neq.validated`, {
          method: 'PATCH',
          body: JSON.stringify({ validation_status: 'raw', enrichment_note: null }),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
