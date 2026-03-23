import { NextResponse } from 'next/server';
import { getCleanedProducts } from '@/lib/db/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const products = await getCleanedProducts({ validation_status: 'validated' });
    if (products.length === 0) return NextResponse.json({ synced: 0 });

    const client = createSupabaseBrowserClient();
    const rows = products.map(p => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      type: p.type,
      grape: p.grape,
      region: p.region,
      style: p.style,
      price: p.price,
      cost_price: p.cost ?? p.costPrice,
      currency: p.currency,
      status: p.status,
      oak: p.oak,
      country: p.country,
    }));

    const response = await fetch(`${client.url}/rest/v1/products`, {
      method: 'POST',
      headers: {
        ...client.headers,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const msg = await response.text();
      throw new Error(msg || `Supabase error ${response.status}`);
    }

    return NextResponse.json({ synced: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 500 });
  }
}
