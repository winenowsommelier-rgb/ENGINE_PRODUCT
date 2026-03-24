import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATA_DIR = path.join(process.cwd(), 'data/taxonomy');

const ENTITY_MAP: Record<string, { file: string; idField: string }> = {
  countries:       { file: 'countries.json',           idField: 'id' },
  regions:         { file: 'regions.json',             idField: 'id' },
  subregions:      { file: 'subregions.json',          idField: 'id' },
  classifications: { file: 'classification_master.json', idField: 'classification_id' },
  brands:          { file: 'brands.json',              idField: 'id' },
};

function readFile(entity: string): any[] {
  const cfg = ENTITY_MAP[entity];
  const filePath = path.join(DATA_DIR, cfg.file);
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

function writeFile(entity: string, data: any[]) {
  const cfg = ENTITY_MAP[entity];
  const filePath = path.join(DATA_DIR, cfg.file);
  fs.writeFileSync(filePath, JSON.stringify({ data }, null, 2));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { entity: string } }
) {
  const { entity } = params;
  if (!ENTITY_MAP[entity]) return NextResponse.json({ error: 'Unknown entity' }, { status: 404 });
  return NextResponse.json({ data: readFile(entity) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { entity: string } }
) {
  const { entity } = params;
  if (!ENTITY_MAP[entity]) return NextResponse.json({ error: 'Unknown entity' }, { status: 404 });
  const { idField } = ENTITY_MAP[entity];
  const body = await req.json();
  const data = readFile(entity);
  const maxId = data.reduce((m: number, r: any) => Math.max(m, Number(r[idField] ?? 0)), 0);
  const newItem = { ...body, [idField]: maxId + 1 };
  data.push(newItem);
  writeFile(entity, data);
  return NextResponse.json(newItem, { status: 201 });
}
