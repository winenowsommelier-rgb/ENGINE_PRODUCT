import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sb(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  return r.json();
}

export async function GET() {
  try {
    const [classifications, countries, statuses] = await Promise.all([
      sb('products?select=classification&classification=not.is.null&order=classification'),
      sb('products?select=country&country=not.is.null&order=country'),
      sb('products?select=validation_status&validation_status=not.is.null&order=validation_status'),
    ]);

    // Deduplicate and count
    const classMap: Record<string, number> = {};
    for (const r of classifications) if (r.classification) classMap[r.classification] = (classMap[r.classification] || 0) + 1;

    const countryMap: Record<string, number> = {};
    for (const r of countries) if (r.country) countryMap[r.country] = (countryMap[r.country] || 0) + 1;

    const statusMap: Record<string, number> = {};
    for (const r of statuses) if (r.validation_status) statusMap[r.validation_status] = (statusMap[r.validation_status] || 0) + 1;

    return NextResponse.json({
      classifications: Object.entries(classMap).sort((a,b)=>b[1]-a[1]).map(([v,c])=>({ value: v, count: c })),
      countries: Object.entries(countryMap).sort((a,b)=>b[1]-a[1]).map(([v,c])=>({ value: v, count: c })),
      statuses: Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).map(([v,c])=>({ value: v, count: c })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
