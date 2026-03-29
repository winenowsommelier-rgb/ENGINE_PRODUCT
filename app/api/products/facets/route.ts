import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  // Bypass Supabase's 1000-row default to get accurate counts
  Range: '0-99999',
  'Range-Unit': 'items',
};

async function sb(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!r.ok) return [];
  return r.json();
}

function countBy<T>(rows: T[], key: keyof T): { value: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const v = row[key];
    if (v != null && v !== '') map[String(v)] = (map[String(v)] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

export async function GET() {
  try {
    const [categories, countries, statuses, regions, appellations, wineClasses] = await Promise.all([
      sb('products?select=classification&classification=not.is.null'),
      sb('products?select=country&country=not.is.null'),
      sb('products?select=validation_status&validation_status=not.is.null'),
      sb('products?select=region&region=not.is.null'),
      sb('products?select=appellation&appellation=not.is.null'),
      sb('products?select=wine_classification&wine_classification=not.is.null'),
    ]);

    return NextResponse.json({
      categories:       countBy(categories,  'classification'),
      countries:        countBy(countries,   'country'),
      statuses:         countBy(statuses,    'validation_status'),
      regions:          countBy(regions,     'region'),
      appellations:     countBy(appellations,'appellation'),
      wineClasses:      countBy(wineClasses, 'wine_classification'),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
