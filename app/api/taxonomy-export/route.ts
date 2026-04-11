import { NextRequest, NextResponse } from 'next/server';
import { getTaxonomyDb, getScopes, getCharacterDimensions } from '@/lib/taxonomy-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ── GET handler ───────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') || 'json';

  try {
    if (format === 'csv') {
      return handleCsv();
    }
    return handleJson();
  } catch (err: any) {
    console.error('[taxonomy-export] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* ── JSON export ───────────────────────────────────────────────────────── */

function handleJson() {
  const db = getTaxonomyDb();

  // All scopes
  const scopes = getScopes();

  // All entities
  const entities = db
    .prepare(
      `SELECT id, entity_type, name, slug, parent_id, latitude, longitude, iso_code, image_url, sort_order, created_at, updated_at
       FROM taxonomy_entities ORDER BY entity_type, sort_order, name`
    )
    .all() as any[];

  // All contexts with parsed attributes
  const contexts = db
    .prepare(
      `SELECT id, entity_id, scope_id, description_short, description_en, attributes, status, validated_by, validated_at, created_at, updated_at
       FROM taxonomy_contexts ORDER BY entity_id, scope_id`
    )
    .all() as any[];

  const parsedContexts = contexts.map((c: any) => ({
    ...c,
    attributes: c.attributes ? safeParseJson(c.attributes) : {},
  }));

  // All character dimensions
  const dimensions = db
    .prepare('SELECT * FROM character_dimensions ORDER BY scope_id, sort_order')
    .all();

  // All benchmarks
  const benchmarks = db
    .prepare(
      `SELECT tb.id, tb.context_id, tb.dimension_id, tb.typical_value, tb.range_low, tb.range_high
       FROM taxonomy_benchmarks tb ORDER BY tb.context_id`
    )
    .all();

  // All relationships
  const relationships = db
    .prepare(
      `SELECT id, from_entity_id, to_entity_id, relationship, scope_id, metadata
       FROM taxonomy_relationships ORDER BY from_entity_id`
    )
    .all() as any[];

  const parsedRelationships = relationships.map((r: any) => ({
    ...r,
    metadata: r.metadata ? safeParseJson(r.metadata) : {},
  }));

  // Scope attribute definitions
  const attributeDefs = db
    .prepare('SELECT * FROM scope_attribute_defs ORDER BY scope_id, sort_order')
    .all() as any[];

  const parsedAttrDefs = attributeDefs.map((a: any) => ({
    ...a,
    options: a.options ? safeParseJson(a.options) : null,
  }));

  // Classification scope map
  const classificationMap = db
    .prepare('SELECT * FROM classification_scope_map ORDER BY sort_order')
    .all();

  const payload = {
    _export: {
      version: '1.0',
      generated_at: new Date().toISOString(),
      format: 'taxonomy-library-full',
    },
    scopes,
    classification_scope_map: classificationMap,
    character_dimensions: dimensions,
    scope_attribute_defs: parsedAttrDefs,
    entities,
    contexts: parsedContexts,
    benchmarks,
    relationships: parsedRelationships,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="taxonomy-export.json"',
      'Cache-Control': 'no-store',
    },
  });
}

/* ── CSV export ────────────────────────────────────────────────────────── */

function handleCsv() {
  const db = getTaxonomyDb();

  // Join entities with their primary context (first scope alphabetically)
  const rows = db
    .prepare(
      `SELECT
         e.id,
         e.entity_type,
         e.name,
         e.slug,
         e.parent_id,
         e.latitude,
         e.longitude,
         e.iso_code,
         e.sort_order,
         tc.scope_id,
         tc.description_short,
         tc.description_en,
         tc.status AS context_status
       FROM taxonomy_entities e
       LEFT JOIN taxonomy_contexts tc ON tc.id = (
         SELECT id FROM taxonomy_contexts
         WHERE entity_id = e.id
         ORDER BY scope_id ASC
         LIMIT 1
       )
       ORDER BY e.entity_type, e.sort_order, e.name`
    )
    .all() as any[];

  // Also include parent name for readability
  const entityNames = new Map<number, string>();
  for (const r of rows) entityNames.set(r.id, r.name);

  const csvHeaders = [
    'id',
    'entity_type',
    'name',
    'slug',
    'parent_id',
    'parent_name',
    'latitude',
    'longitude',
    'iso_code',
    'sort_order',
    'scope_id',
    'description_short',
    'description_en',
    'context_status',
  ];

  const csvLines = [csvHeaders.join(',')];

  for (const r of rows) {
    const values = [
      r.id,
      escapeCsv(r.entity_type),
      escapeCsv(r.name),
      escapeCsv(r.slug),
      r.parent_id ?? '',
      escapeCsv(entityNames.get(r.parent_id) || ''),
      r.latitude ?? '',
      r.longitude ?? '',
      escapeCsv(r.iso_code || ''),
      r.sort_order,
      escapeCsv(r.scope_id || ''),
      escapeCsv(r.description_short || ''),
      escapeCsv(r.description_en || ''),
      escapeCsv(r.context_status || ''),
    ];
    csvLines.push(values.join(','));
  }

  const csv = csvLines.join('\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="taxonomy-export.csv"',
      'Cache-Control': 'no-store',
    },
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function escapeCsv(val: string): string {
  if (!val) return '';
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function safeParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
