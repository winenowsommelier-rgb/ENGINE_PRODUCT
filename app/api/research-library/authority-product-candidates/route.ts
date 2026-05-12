import { NextResponse } from 'next/server';
import { buildAuthorityProductUpdatePreview } from '@/lib/research/authority-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await buildAuthorityProductUpdatePreview();
  return NextResponse.json({
    ...data,
    rule: 'Approved authority decisions are still read-only until reviewed and sent through the enrichment bulk-patch API.',
  });
}
