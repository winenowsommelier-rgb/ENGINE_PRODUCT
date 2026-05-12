import { NextRequest, NextResponse } from 'next/server';
import { getTaxonomyDb } from '@/lib/taxonomy-db';
import {
  readGeographyEvidenceWithCuration,
  updateGeographyCuration,
  type GeographyCurationStatus,
} from '@/lib/research/geography-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TargetType = 'region' | 'subregion' | 'appellation';

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return normalizeName(value).replace(/\s+/g, '-');
}

function expectedType(status: GeographyCurationStatus): TargetType | null {
  if (status === 'confirmed_region') return 'region';
  if (status === 'confirmed_subregion') return 'subregion';
  if (status === 'confirmed_appellation') return 'appellation';
  return null;
}

function getCountryId(name: string | null) {
  if (!name) return null;
  const row = getTaxonomyDb().prepare(`
    SELECT id FROM taxonomy_entities
    WHERE entity_type = 'country' AND lower(name) = lower(?)
    LIMIT 1
  `).get(name) as { id: number } | undefined;
  return row?.id ?? null;
}

function findEntity(entityType: TargetType, name: string, parentId?: number | null) {
  const db = getTaxonomyDb();
  if (parentId) {
    return db.prepare(`
      SELECT * FROM taxonomy_entities
      WHERE entity_type = ? AND lower(name) = lower(?) AND parent_id = ?
      LIMIT 1
    `).get(entityType, name, parentId) as any;
  }
  return db.prepare(`
    SELECT * FROM taxonomy_entities
    WHERE entity_type = ? AND lower(name) = lower(?)
    LIMIT 1
  `).get(entityType, name) as any;
}

function findParents(parentName: string | null, parentTypes: string[]) {
  if (!parentName) return [];
  const placeholders = parentTypes.map(() => '?').join(',');
  return getTaxonomyDb().prepare(`
    SELECT * FROM taxonomy_entities
    WHERE entity_type IN (${placeholders}) AND lower(name) = lower(?)
    ORDER BY CASE entity_type WHEN 'region' THEN 1 WHEN 'subregion' THEN 2 ELSE 3 END
  `).all(...parentTypes, parentName) as any[];
}

function insertEntity(entityType: TargetType, name: string, parentId: number | null) {
  const db = getTaxonomyDb();
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;
  while (db.prepare('SELECT id FROM taxonomy_entities WHERE entity_type = ? AND slug = ?').get(entityType, slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const info = db.prepare(`
    INSERT INTO taxonomy_entities (entity_type, name, slug, parent_id, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(entityType, name, slug, parentId);

  const entityId = Number(info.lastInsertRowid);
  db.prepare(`
    INSERT OR IGNORE INTO taxonomy_contexts (entity_id, scope_id, description_short, description_en, attributes, status)
    VALUES (?, 'wine', ?, ?, '{}', 'validated')
  `).run(
    entityId,
    `Research-confirmed ${entityType} from curated geography evidence.`,
    `Created from reviewed WineSensed geography evidence. Use as a canonical taxonomy entry only after source validation.`,
  );

  return db.prepare('SELECT * FROM taxonomy_entities WHERE id = ?').get(entityId) as any;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const evidenceId = String(body.evidence_id ?? '');
    const apply = body.apply === true;

    const { evidence } = await readGeographyEvidenceWithCuration();
    const row = evidence.find(item => item.id === evidenceId);
    if (!row) return NextResponse.json({ error: 'Evidence row not found' }, { status: 404 });

    const curation = row.curation;
    if (!curation) {
      return NextResponse.json({ error: 'Curation state is required before promotion' }, { status: 400 });
    }
    if (curation.status === 'rejected_generic') {
      return NextResponse.json({ error: 'Rejected generic rows cannot be promoted' }, { status: 400 });
    }

    const targetType = expectedType(curation.status as GeographyCurationStatus);
    if (!targetType) {
      return NextResponse.json({
        error: 'Promotion requires confirmed_region, confirmed_subregion, or confirmed_appellation status',
        current_status: curation.status,
      }, { status: 400 });
    }

    const confirmedName = curation.confirmed_name?.trim() || row.observed_name;
    let parentId: number | null = null;
    const blockers: string[] = [];

    if (targetType === 'region') {
      parentId = getCountryId(row.observed_country);
      if (!parentId) blockers.push(`Country not found in taxonomy: ${row.observed_country ?? 'unknown'}`);
    }

    if (targetType === 'subregion') {
      const parents = findParents(curation.confirmed_parent_name, ['region']);
      if (parents.length === 0) blockers.push('Subregion promotion requires confirmed_parent_name matching an existing region');
      if (parents.length > 1) blockers.push(`Parent region is ambiguous: ${curation.confirmed_parent_name}`);
      parentId = parents[0]?.id ?? null;
    }

    if (targetType === 'appellation' && curation.confirmed_parent_name) {
      const parents = findParents(curation.confirmed_parent_name, ['subregion', 'region']);
      if (parents.length === 0) blockers.push('Confirmed parent name does not match an existing subregion or region');
      if (parents.length > 1) blockers.push(`Parent geography is ambiguous: ${curation.confirmed_parent_name}`);
      parentId = parents[0]?.id ?? null;
    }

    const existing = blockers.length === 0 ? findEntity(targetType, confirmedName, parentId) : null;
    const preview = {
      evidence_id: evidenceId,
      apply,
      target_type: targetType,
      confirmed_name: confirmedName,
      parent_id: parentId,
      observed_country: row.observed_country,
      existing_entity_id: existing?.id ?? null,
      action: existing ? 'link_existing' : 'create_entity',
      blockers,
    };

    if (!apply || blockers.length > 0) {
      return NextResponse.json({ preview, promoted: false });
    }

    const entity = existing ?? insertEntity(targetType, confirmedName, parentId);
    const nextCuration = await updateGeographyCuration(evidenceId, {
      ...curation,
      status: 'promoted',
      promoted_entity_id: entity.id,
    });

    return NextResponse.json({
      preview,
      promoted: true,
      entity,
      curation: nextCuration,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Promotion failed' },
      { status: 500 },
    );
  }
}
