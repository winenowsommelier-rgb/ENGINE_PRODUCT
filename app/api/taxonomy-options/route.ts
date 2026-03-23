import { NextResponse } from 'next/server';
import countriesJson from '@/data/taxonomy/countries.json';
import regionsJson from '@/data/taxonomy/regions.json';
import subregionsJson from '@/data/taxonomy/subregions.json';
import classificationJson from '@/data/taxonomy/classification_master.json';
import ingredientJson from '@/data/taxonomy/ingredient_master.json';
import flavorJson from '@/data/taxonomy/flavor_note_master.json';

export const runtime = 'nodejs';

export async function GET() {
  const countriesData = (countriesJson.data ?? []) as Array<{ id: number; name: string }>;
  const regionsData = (regionsJson.data ?? []) as Array<{ country_id: number; name: string }>;
  const subregionsData = (subregionsJson.data ?? []) as Array<{ name: string }>;
  const classificationData = (classificationJson.data ?? []) as Array<{ classification: string }>;
  const ingredientData = (ingredientJson.data ?? []) as Array<{ ingredient: string }>;
  const flavorData = (flavorJson.data ?? []) as Array<{ note: string }>;

  const countryById = Object.fromEntries(countriesData.map(c => [c.id, c.name]));

  return NextResponse.json({
    countries: countriesData.map(c => c.name).filter(Boolean).sort(),
    regions: regionsData.map(r => ({ name: r.name, country: countryById[r.country_id] ?? '' })),
    subregions: subregionsData.map(s => s.name).filter(Boolean).sort(),
    classifications: classificationData.map(c => c.classification).filter(Boolean).sort(),
    grapeVarieties: ingredientData.map(i => i.ingredient).filter(Boolean).sort(),
    flavorNotes: flavorData.map(f => f.note).filter(Boolean).sort(),
  });
}
