import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const revalidate = 300;

type Row = Record<string, unknown>;

function loadLocal(): Row[] {
  const livePath = path.join(process.cwd(), 'data', 'live_products_export.json');
  try {
    const r = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    return Array.isArray(r) ? r : (r.products ?? []);
  } catch (_) { return []; }
}

function hasValue(v: unknown): boolean {
  if (v == null || v === '' || v === 'null') return false;
  if (Array.isArray(v)) return v.length > 0;
  try { const p = JSON.parse(String(v)); return Array.isArray(p) ? p.length > 0 : !!p; } catch (_) {}
  return true;
}

export async function GET() {
  const products = loadLocal();
  const total = products.length;
  if (total === 0) return NextResponse.json({ total: 0, fields: [] });

  const FIELDS = [
    { key: 'desc_en_short',     label: 'Short Description' },
    { key: 'full_description',  label: 'Full Description' },
    { key: 'wine_body',         label: 'Wine Body' },
    { key: 'wine_acidity',      label: 'Acidity' },
    { key: 'wine_tannin',       label: 'Tannin' },
    { key: 'flavor_tags',       label: 'Flavor Tags' },
    { key: 'food_matching',     label: 'Food Matching' },
    { key: 'image_url',         label: 'Image URL' },
    { key: 'region',            label: 'Region' },
    { key: 'appellation',       label: 'Appellation' },
    { key: 'grape_variety',     label: 'Grape Variety' },
    { key: 'enrichment_confidence', label: 'Confidence Score' },
    { key: 'validation_status', label: 'Validation Status' },
    { key: 'country',           label: 'Country' },
    { key: 'vintage',           label: 'Vintage' },
    { key: 'price',             label: 'Price' },
  ];

  const fields = FIELDS.map(({ key, label }) => {
    const filled = products.filter(p => hasValue(p[key])).length;
    return { key, label, filled, missing: total - filled, pct: Math.round((filled / total) * 100) };
  });

  // Breakdown by classification
  const byCategory: Record<string, { total: number; withDesc: number; withImage: number; withTaste: number }> = {};
  for (const p of products) {
    const cat = String(p.classification ?? 'Unknown').split('|')[0].trim() || 'Unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, withDesc: 0, withImage: 0, withTaste: 0 };
    byCategory[cat].total++;
    if (hasValue(p.desc_en_short)) byCategory[cat].withDesc++;
    if (hasValue(p.image_url)) byCategory[cat].withImage++;
    if (hasValue(p.wine_body) || hasValue(p.flavor_tags)) byCategory[cat].withTaste++;
  }

  const categories = Object.entries(byCategory)
    .map(([name, v]) => ({ name, ...v, descPct: Math.round(v.withDesc/v.total*100), imagePct: Math.round(v.withImage/v.total*100), tastePct: Math.round(v.withTaste/v.total*100) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return NextResponse.json({ total, fields, categories });
}
