import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(params.id)}&select=*&limit=1`,
      { headers: HEADERS },
    );
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    if (!rows.length) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ product: rows[0], changelog: [] });
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

    const payload = { ...body.fields, updated_at: new Date().toISOString() };

    // Cast price / cost_price to integer if present
    if (payload.price != null)      payload.price      = parseInt(payload.price)      || null;
    if (payload.cost_price != null) payload.cost_price = parseInt(payload.cost_price) || null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(params.id)}`,
      { method: 'PATCH', headers: HEADERS, body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(await res.text());
    return NextResponse.json({ updated: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
