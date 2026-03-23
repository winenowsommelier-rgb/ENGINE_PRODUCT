import { NextRequest, NextResponse } from 'next/server';
import { getBrands, addBrand } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const brands = await getBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const brand = await addBrand(String(name).trim());
    return NextResponse.json({ brand });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
