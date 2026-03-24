import { NextResponse } from 'next/server';
import { getCleanedProducts, batchUpdateEnrichment, getSyncStatus, saveSyncStatus } from '@/lib/db/client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export const runtime = 'nodejs';

export async function GET() {
  const s = await getSyncStatus();
  return NextResponse.json(s);
}

export async function POST() {
  try {
    const products = await getCleanedProducts({ validation_status: 'validated' });
    if (products.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No validated products to sync' });
    }

    const client = createSupabaseBrowserClient();
    const CHUNK = 500;
    const rows = products.map(p => ({
      id: String(p.id),
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      vintage: p.vintage,
      alcohol: p.alcohol,
      bottle_size: p.bottle_size,
      country: p.country,
      region: p.region,
      subregion: p.subregion,
      classification: p.classification,
      grape_variety: p.grape_variety,
      wine_type: p.wine_type,
      liquor_main_type: p.liquor_main_type,
      price: p.price,
      cost_price: p.cost,
      currency: p.currency,
      overall_confidence: p.overall_confidence,
      taxonomy_confidence: p.taxonomy_confidence,
      validation_status: p.validation_status,
      enrichment_source: p.enrichment_source,
      enrichment_note: p.enrichment_note,
      flavor_profile: p.flavor_profile,
      character_traits: p.character_traits,
      image_url: p.image_url,
      image_alt_text: p.image_alt_text,
      source_file: p.source_file,
    }));

    // Push in chunks of 500 to stay within Supabase row limits
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const response = await fetch(`${client.url}/rest/v1/products`, {
        method: 'POST',
        headers: {
          ...client.headers,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg || `Supabase error ${response.status}`);
      }
    }

    // Mark synced_at on all synced products
    const now = new Date().toISOString();
    await batchUpdateEnrichment(products.map(p => ({ id: String(p.id), synced_at: now })));
    await saveSyncStatus({ last_synced_at: now, last_synced_count: rows.length });

    return NextResponse.json({ synced: rows.length, timestamp: now });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
