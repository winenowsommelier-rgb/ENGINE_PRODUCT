import { NextResponse } from 'next/server';
import { getSupplierIntakeRows, getSupplierIntakeRuns } from '@/lib/db/client';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const runs = await getSupplierIntakeRuns();
  const run = runs.find(r => r.id === params.id);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  return NextResponse.json({ run, rows: await getSupplierIntakeRows(params.id) });
}
