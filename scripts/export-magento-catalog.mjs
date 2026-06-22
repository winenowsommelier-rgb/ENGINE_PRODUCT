#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  assessProduct,
  computeReviewPriority,
  toMagentoRow,
} from './lib/magento-catalog-quality.mjs';

const root = process.cwd();
const dbPath = path.join(root, 'data', 'db', 'products.db');
const exportDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const currentDate = new Date(`${exportDate}T00:00:00Z`);
const outputDir = path.join(root, 'outputs', `magento-catalog-${exportDate}`);

const AUDIT_COLUMNS = [
  'sku',
  'name',
  'classification',
  'country',
  'region',
  'subregion',
  'short_description',
  'description',
  'updated_at',
  'magento_readiness',
  'quality_blockers',
  'quality_warnings',
  'current_validation_status',
  'enrichment_quality_grade',
  'review_priority',
  'popularity_revenue_window',
  'popularity_orders_window',
  'wn_stock',
];

const MAGENTO_COLUMNS = [
  'sku',
  'name',
  'country',
  'region',
  'subregion',
  'short_description (EN Store)',
  'description (EN Store)',
];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const escaped = text.replaceAll('"', '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function percentage(value, total) {
  return total === 0 ? 0 : Number(((value / total) * 100).toFixed(1));
}

const db = new Database(dbPath, { readonly: true });
const products = db.prepare(`
  SELECT
    sku,
    name,
    classification,
    country,
    region,
    subregion,
    desc_en_short,
    full_description,
    updated_at,
    validation_status,
    enrichment_quality_grade,
    popularity_revenue_window,
    popularity_orders_window,
    wn_stock,
    quantity_in_stock,
    has_recent_sales
  FROM products
  WHERE COALESCE(is_active, 1) = 1
  ORDER BY sku
`).all();
db.close();

const assessed = products.map((product) => {
  const row = toMagentoRow(product, currentDate);
  return {
    ...row,
    classification: product.classification || '',
    review_priority: computeReviewPriority(product),
    popularity_revenue_window: product.popularity_revenue_window || 0,
    popularity_orders_window: product.popularity_orders_window || 0,
    wn_stock: product.wn_stock ?? product.quantity_in_stock ?? 0,
  };
});

const readyRows = assessed.filter((row) => (
  row.magento_readiness === 'READY' || row.magento_readiness === 'READY_WITH_WARNING'
));
const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const reviewRows = assessed
  .filter((row) => row.magento_readiness === 'REVIEW' || row.magento_readiness === 'HOLD')
  .sort((a, b) => (
    priorityRank[a.review_priority] - priorityRank[b.review_priority]
    || b.popularity_revenue_window - a.popularity_revenue_window
    || b.wn_stock - a.wn_stock
    || a.sku.localeCompare(b.sku)
  ));

const magentoRows = readyRows.map((row) => ({
  sku: row.sku,
  name: row.name,
  country: row.country,
  region: row.region,
  subregion: row.subregion,
  'short_description (EN Store)': row.short_description,
  'description (EN Store)': row.description,
}));

const statuses = assessed.reduce((counts, row) => {
  counts[row.magento_readiness] = (counts[row.magento_readiness] || 0) + 1;
  return counts;
}, {});

const blockerCounts = {};
const warningCounts = {};
for (const product of products) {
  const assessment = assessProduct(product, currentDate);
  for (const blocker of assessment.blockers) {
    blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
  }
  for (const warning of assessment.warnings) {
    warningCounts[warning] = (warningCounts[warning] || 0) + 1;
  }
}

const focusCategories = reviewRows.reduce((counts, row) => {
  const category = row.classification || '(blank)';
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});

const summary = {
  generated_at: new Date().toISOString(),
  catalog_source: dbPath,
  export_date: exportDate,
  active_items: assessed.length,
  ready_for_magento: readyRows.length,
  needs_review_or_hold: reviewRows.length,
  ready_pct: percentage(readyRows.length, assessed.length),
  status_counts: statuses,
  field_coverage: {
    substantial_description: assessed.filter((row) => row.description.length >= 100).length,
    short_description: assessed.filter((row) => row.short_description.length >= 50).length,
    country: assessed.filter((row) => row.country).length,
    region: assessed.filter((row) => row.region).length,
    subregion: assessed.filter((row) => row.subregion).length,
  },
  blocker_counts: blockerCounts,
  warning_counts: warningCounts,
  review_priority_counts: reviewRows.reduce((counts, row) => {
    counts[row.review_priority] = (counts[row.review_priority] || 0) + 1;
    return counts;
  }, {}),
  top_review_categories: Object.entries(focusCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([classification, count]) => ({ classification, count })),
  latest_item_update: assessed.reduce(
    (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
    '',
  ),
};

const report = `# Magento Catalog Data Quality

Generated: ${summary.generated_at}

## Recommendation

Do not update all active items in one Magento import. Import the conservative ready batch first, then work through the review queue.

## Current Catalog

- Active items: ${summary.active_items}
- Ready for Magento: ${summary.ready_for_magento} (${summary.ready_pct}%)
- Review or hold: ${summary.needs_review_or_hold}
- Latest item update in source: ${summary.latest_item_update}

## Field Coverage

- Substantial description (100+ characters): ${summary.field_coverage.substantial_description} (${percentage(summary.field_coverage.substantial_description, summary.active_items)}%)
- Short description (50+ characters): ${summary.field_coverage.short_description} (${percentage(summary.field_coverage.short_description, summary.active_items)}%)
- Country: ${summary.field_coverage.country} (${percentage(summary.field_coverage.country, summary.active_items)}%)
- Region: ${summary.field_coverage.region} (${percentage(summary.field_coverage.region, summary.active_items)}%)
- Subregion: ${summary.field_coverage.subregion} (${percentage(summary.field_coverage.subregion, summary.active_items)}%)

## Main Blockers

${Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## Main Warnings

${Object.entries(warningCounts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `- ${key}: ${value}`).join('\n')}

## Cleanup Priority

- High priority (recent sales): ${summary.review_priority_counts.HIGH || 0}
- Medium priority (stock on hand): ${summary.review_priority_counts.MEDIUM || 0}
- Low priority: ${summary.review_priority_counts.LOW || 0}

Top review categories:

${summary.top_review_categories.map(({ classification, count }) => `- ${classification}: ${count}`).join('\n')}

## Export Notes

- The Magento-ready CSV only contains content and geography columns. It does not update price or stock.
- Geography is exported into independent taxonomy columns: \`country\`, \`region\`, and \`subregion\`.
- The legacy combined \`region_wine\` field is intentionally excluded.
- Missing subregion is a warning, not an automatic blocker, because many valid products only have region-level geography.
`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, `catalog_all_active_with_quality_${exportDate}.csv`),
  toCsv(assessed, AUDIT_COLUMNS),
);
fs.writeFileSync(
  path.join(outputDir, `magento_ready_content_geography_${exportDate}.csv`),
  toCsv(magentoRows, MAGENTO_COLUMNS),
);
fs.writeFileSync(
  path.join(outputDir, `catalog_review_queue_${exportDate}.csv`),
  toCsv(reviewRows, AUDIT_COLUMNS),
);
fs.writeFileSync(
  path.join(outputDir, `data_quality_summary_${exportDate}.json`),
  `${JSON.stringify(summary, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outputDir, `data_quality_report_${exportDate}.md`),
  report,
);

console.log(JSON.stringify({
  output_dir: outputDir,
  ...summary,
}, null, 2));
