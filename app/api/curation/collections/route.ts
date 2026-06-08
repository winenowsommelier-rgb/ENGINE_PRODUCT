import { NextRequest, NextResponse } from 'next/server';
import { readCurationCollections, saveCurationCollection } from '@/lib/curation/storage';

export const runtime = 'nodejs';

export async function GET() {
  const collections = await readCurationCollections();
  return NextResponse.json({ collections: collections.slice(0, 50) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !Array.isArray(body.approved_items)) {
      return NextResponse.json({ error: 'name and approved_items are required' }, { status: 400 });
    }

    const collection = await saveCurationCollection({
      id: body.id,
      name: String(body.name),
      purpose: body.purpose ? String(body.purpose) : 'internal_curation',
      source_run_id: body.source_run_id ? String(body.source_run_id) : undefined,
      approved_items: body.approved_items,
      status: body.status === 'approved' || body.status === 'published' ? body.status : 'draft',
    });

    return NextResponse.json({ collection });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save curation collection' },
      { status: 500 },
    );
  }
}

