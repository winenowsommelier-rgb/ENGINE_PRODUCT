import { NextResponse } from 'next/server';
import { readProducts } from '@/lib/db/client';
import { readGeographyEvidenceWithCuration } from '@/lib/research/geography-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Product = {
  id?: string;
  sku?: string;
  name?: string;
  country?: string;
  region?: string;
  subregion?: string;
  appellation?: string;
  validation_status?: string;
  overall_confidence?: number;
};

function normalize(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function fieldForStatus(status: string, fallbackType?: string | null): 'region' | 'subregion' | 'appellation' | null {
  if (status === 'promoted' && (fallbackType === 'region' || fallbackType === 'subregion' || fallbackType === 'appellation')) return fallbackType;
  if (status === 'confirmed_region') return 'region';
  if (status === 'confirmed_subregion') return 'subregion';
  if (status === 'confirmed_appellation') return 'appellation';
  if (fallbackType === 'region' || fallbackType === 'subregion' || fallbackType === 'appellation') return fallbackType;
  return null;
}

export async function GET() {
  const [{ evidence }, products] = await Promise.all([
    readGeographyEvidenceWithCuration(),
    readProducts() as Promise<Product[]>,
  ]);

  const candidates: Array<Record<string, unknown>> = [];
  const confirmedRows = evidence.filter(row =>
    row.curation &&
    ['confirmed_region', 'confirmed_subregion', 'confirmed_appellation', 'promoted'].includes(row.curation.status) &&
    row.curation.status !== 'rejected_generic',
  );

  for (const row of confirmedRows) {
    const status = row.curation!.status;
    const field = fieldForStatus(status, row.matched_entity_type ?? row.suggested_target_type);
    if (!field) continue;

    const newValue = row.curation!.confirmed_name || row.matched_entity_name || row.observed_name;
    const observed = normalize(row.observed_name);
    const canonical = normalize(newValue);
    const country = normalize(row.observed_country);

    for (const product of products) {
      if (country && normalize(product.country) !== country) continue;
      const currentValue = String(product[field] ?? '').trim();
      const current = normalize(currentValue);

      if (!currentValue) continue;
      if (current !== observed && current !== canonical) continue;
      if (currentValue === newValue) continue;

      candidates.push({
        sku: product.sku,
        id: product.id,
        name: product.name,
        field_name: field,
        old_value: currentValue,
        new_value: newValue,
        evidence_id: row.id,
        curation_status: status,
        canonical_entity_id: row.curation!.promoted_entity_id ?? row.matched_entity_id ?? null,
        confidence: 'high',
        match_reason: `Product already uses observed geography "${row.observed_name}"; safe canonicalization to "${newValue}".`,
        publish_status: 'candidate_only',
      });
    }
  }

  const byField = candidates.reduce<Record<string, number>>((acc, row) => {
    const field = String(row.field_name);
    acc[field] = (acc[field] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    summary: {
      confirmed_evidence_rows: confirmedRows.length,
      candidate_rows: candidates.length,
      by_field: byField,
      write_policy: 'read_only_preview',
      next_step: 'Review candidates, export approved rows, then send through /api/products/bulk-patch with X-Source: enrichment.',
    },
    candidates,
  });
}
