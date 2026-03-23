import { NextResponse } from 'next/server';
import { getPipelineStatus } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET() {
  const status = await getPipelineStatus();
  return NextResponse.json(status);
}
