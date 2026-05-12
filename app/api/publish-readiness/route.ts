import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { readProducts } from '@/lib/db/client';

export const runtime = 'nodejs';

type Product = {
  sku?: string;
  name?: string;
  brand?: string;
  classification?: string;
  country?: string;
  region?: string;
  subregion?: string;
  full_description?: string;
  validation_status?: string;
  overall_confidence?: number;
  taxonomy_confidence?: number;
  description_confidence?: number;
  queue_priority?: number;
  [key: string]: unknown;
};

type CsvRow = Record<string, string>;
type GapCounts = {
  missingDescription: number;
  missingCountry: number;
  missingRegion: number;
  lowConfidence: number;
};

function filePath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

async function readJson<T>(relativePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath(...relativePath.split('/')), 'utf8');
    return JSON.parse(raw) as T;
  } catch (_error) {
    return fallback;
  }
}

async function readText(relativePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath(...relativePath.split('/')), 'utf8');
  } catch (_error) {
    return '';
  }
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    if (row.some(value => value.trim() !== '')) rows.push(row);
  }

  const [headers, ...body] = rows;
  if (!headers) return [];
  return body.map(values => {
    const out: CsvRow = {};
    headers.forEach((header, idx) => {
      out[header.trim()] = (values[idx] ?? '').trim();
    });
    return out;
  });
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getBlockers(product?: Product): string[] {
  if (!product) return ['Product missing from local catalog'];

  const blockers: string[] = [];
  if (product.validation_status !== 'validated') blockers.push('Not validated');
  if (!clean(product.full_description)) blockers.push('Missing description');
  if (!clean(product.country)) blockers.push('Missing country');
  if (!clean(product.region)) blockers.push('Missing region');
  if (confidence(product.overall_confidence) < 0.8) blockers.push('Low confidence');
  return blockers;
}

function productKey(sku: string | undefined): string {
  return (sku ?? '').trim().toUpperCase();
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export async function GET() {
  const [
    products,
    processSnapshot,
    qualitySummary,
    gaPriorityRows,
    fastLaneRows,
    geographyPublishRows,
    publishSummary,
  ] = await Promise.all([
    readProducts() as Promise<Product[]>,
    readJson<Record<string, any>>('data/process_dashboard_snapshot.json', {}),
    readJson<Record<string, any>>('data/quality_control_summary.json', {}),
    readText('data/ga_priority_products.csv').then(parseCsv),
    readText('data/next_fast_lane_queue.csv').then(parseCsv),
    readText('data/product_engine_geography_publish_batch.csv').then(parseCsv),
    readJson<Record<string, any>>('data/product_engine_geography_publish_batch_summary.json', {}),
  ]);

  const productBySku = new Map(products.map(product => [productKey(product.sku), product]));
  const statusCounts = products.reduce<Record<string, number>>((acc, product) => {
    const status = clean(product.validation_status) || 'blank';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const readyProducts = products.filter(product => getBlockers(product).length === 0);
  const highConfidenceReady = readyProducts.filter(product => confidence(product.overall_confidence) >= 0.9);
  const reviewedButBlocked = products.filter(product => product.validation_status === 'validated' && getBlockers(product).length > 0);

  const gapCounts = products.reduce<GapCounts>(
    (acc, product) => {
      if (!clean(product.full_description)) acc.missingDescription += 1;
      if (!clean(product.country)) acc.missingCountry += 1;
      if (!clean(product.region)) acc.missingRegion += 1;
      if (confidence(product.overall_confidence) < 0.8) acc.lowConfidence += 1;
      return acc;
    },
    { missingDescription: 0, missingCountry: 0, missingRegion: 0, lowConfidence: 0 },
  );

  const fastLane = fastLaneRows.slice(0, 12).map(row => {
    const product = productBySku.get(productKey(row.sku));
    const blockers = getBlockers(product);
    return {
      rank: Number(row.priority_rank || 0),
      sku: row.sku,
      name: row.name || product?.name || '',
      band: row.priority_band,
      score: Number(row.score || 0),
      whyNow: row.why_now,
      taskTypes: row.task_types,
      hasLiveRecord: row.has_live_record,
      readiness: blockers.length === 0 ? 'ready' : 'blocked',
      blockers,
    };
  });

  const gaTopProducts = gaPriorityRows.slice(0, 10).map(row => {
    const product = productBySku.get(productKey(row.sku));
    const blockers = getBlockers(product);
    return {
      rank: Number(row.priority_rank || 0),
      sku: row.sku,
      name: row.product_name || product?.name || '',
      brand: row.brand || product?.brand || '',
      classification: row.classification || product?.classification || '',
      priorityBand: row.priority_band,
      priorityScore: Number(row.priority_score || 0),
      readiness: blockers.length === 0 ? 'ready' : 'blocked',
      blockers,
    };
  });

  const qcProductMaster = qualitySummary.product_master ?? {};
  const qcLiveUpload = qualitySummary.live_upload ?? {};
  const qcIssueTotal = [
    qcProductMaster.short_length,
    qcProductMaster.full_length,
    qcProductMaster.template_language,
    qcProductMaster.missing_sources,
    qcProductMaster.verified_without_note,
    qcLiveUpload.weak_publish_rationale,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0);

  const workflow = [
    {
      id: 'batch',
      label: 'Select next commercial batch',
      status: fastLaneRows.length > 0 ? 'ready' : 'blocked',
      detail: `${fastLaneRows.length.toLocaleString()} fast-lane rows available`,
    },
    {
      id: 'qc',
      label: 'Run QC and resolve high-severity issues',
      status: qcIssueTotal === 0 ? 'ready' : 'attention',
      detail: qcIssueTotal === 0 ? 'No open QC issues in summary' : `${qcIssueTotal.toLocaleString()} QC issues need review`,
    },
    {
      id: 'publish',
      label: 'Publish geography-safe rows',
      status: geographyPublishRows.length > 0 ? 'ready' : 'blocked',
      detail: `${geographyPublishRows.length.toLocaleString()} rows in current geography publish batch`,
    },
    {
      id: 'verify',
      label: 'Verify Product Engine update and log result',
      status: processSnapshot.publish_logs?.latest_failed === 0 ? 'ready' : 'attention',
      detail: processSnapshot.publish_logs?.latest_timestamp
        ? `Latest publish: ${processSnapshot.publish_logs.latest_succeeded ?? 0} succeeded, ${processSnapshot.publish_logs.latest_failed ?? 0} failed`
        : 'No publish log found in snapshot',
    },
  ];

  const nextActions = [
    {
      priority: 1,
      label: 'Clear QC blockers before the next publish wave',
      metric: `${qcIssueTotal.toLocaleString()} issues`,
      owner: 'Content + data QA',
    },
    {
      priority: 2,
      label: 'Process fast-lane SKUs with live records first',
      metric: `${fastLaneRows.filter(row => row.has_live_record === 'yes').length.toLocaleString()} live-record rows`,
      owner: 'Enrichment operator',
    },
    {
      priority: 3,
      label: 'Publish safe geography fills',
      metric: `${geographyPublishRows.length.toLocaleString()} rows`,
      owner: 'Product Engine operator',
    },
    {
      priority: 4,
      label: 'Backfill missing regions in the live catalog',
      metric: `${gapCounts.missingRegion.toLocaleString()} local catalog gaps`,
      owner: 'Taxonomy owner',
    },
  ];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    catalog: {
      total: products.length,
      statusCounts,
      ready: readyProducts.length,
      readyPct: pct(readyProducts.length, products.length),
      highConfidenceReady: highConfidenceReady.length,
      reviewedButBlocked: reviewedButBlocked.length,
      gaps: gapCounts,
    },
    program: {
      overall: processSnapshot.overall ?? null,
      progressLenses: processSnapshot.progress_lenses ?? null,
      eta: processSnapshot.eta ?? null,
      publishLogs: processSnapshot.publish_logs ?? null,
    },
    quality: {
      summary: qualitySummary,
      issueTotal: qcIssueTotal,
      productMaster: qcProductMaster,
      liveUpload: qcLiveUpload,
    },
    publish: {
      geographyRows: geographyPublishRows.length,
      geographySummary: publishSummary,
      previewRows: geographyPublishRows.slice(0, 8),
    },
    priorities: {
      fastLaneTotal: fastLaneRows.length,
      fastLane,
      gaTopProducts,
    },
    workflow,
    nextActions,
  });
}
