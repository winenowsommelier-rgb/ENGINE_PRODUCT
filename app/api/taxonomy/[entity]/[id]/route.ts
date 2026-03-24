import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const DATA_DIR = path.join(process.cwd(), 'data/taxonomy');

const ENTITY_MAP: Record<string, { file: string; idField: string }> = {
  countries:       { file: 'countries.json',             idField: 'id' },
  regions:         { file: 'regions.json',               idField: 'id' },
  subregions:      { file: 'subregions.json',            idField: 'id' },
  classifications: { file: 'classification_master.json', idField: 'classification_id' },
  brands:          { file: 'brands.json',                idField: 'id' },
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

export async function PUT(
  req: NextRequest,
  { params }: { params: { entity: string; id: string } }
) {
  const { entity, id } = params;
  if (!ENTITY_MAP[entity]) return NextResponse.json({ error: 'Unknown entity' }, { status: 404 });
  const { idField } = ENTITY_MAP[entity];
  const body = await req.json();
  const data = readFile(entity);
  const idx = data.findIndex((r: any) => String(r[idField]) === String(id));
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  data[idx] = { ...data[idx], ...body, [idField]: data[idx][idField] };
  writeFile(entity, data);
  return NextResponse.json(data[idx]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { entity: string; id: string } }
) {
  const { entity, id } = params;
  if (!ENTITY_MAP[entity]) return NextResponse.json({ error: 'Unknown entity' }, { status: 404 });
  const { idField } = ENTITY_MAP[entity];
  const data = readFile(entity);
  const idx = data.findIndex((r: any) => String(r[idField]) === String(id));
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  data.splice(idx, 1);
  writeFile(entity, data);
  return NextResponse.json({ ok: true });
}
