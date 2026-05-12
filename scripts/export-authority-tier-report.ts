import fs from 'fs';
import path from 'path';
import { buildAuthorityCandidates } from '@/lib/research/authority-validation';

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const field = process.argv.find(arg => arg.startsWith('--field='))?.split('=')[1] ?? 'region';
  const status = process.argv.find(arg => arg.startsWith('--status='))?.split('=')[1] ?? 'new';
  const tierKind = process.argv.find(arg => arg.startsWith('--tier='))?.split('=')[1] ?? 'sales';
  const outDir = path.join(process.cwd(), 'data', 'reports');
  fs.mkdirSync(outDir, { recursive: true });

  const data = await buildAuthorityCandidates({
    missing_field: field,
    status,
    limit: 200,
  });

  const tiers = new Map<string, typeof data.candidates>();
  for (const row of data.candidates) {
    const tier = tierKind === 'sku' ? row.sku_tier ?? 'unknown' : row.sales_tier;
    tiers.set(tier, [...(tiers.get(tier) ?? []), row]);
  }

  const tierSummary = [...tiers.entries()]
    .map(([tier, rows]) => ({
      tier,
      candidate_count: rows.length,
      countries: [...new Set(rows.map(row => row.country).filter(Boolean))].sort(),
      sample_skus: rows.slice(0, 10).map(row => row.sku),
    }))
    .sort((a, b) => a.tier.localeCompare(b.tier));

  const jsonPath = path.join(outDir, `authority-${field}-${status}-by-${tierKind}-tier.json`);
  const csvPath = path.join(outDir, `authority-${field}-${status}-by-${tierKind}-tier.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    filters: { field, status, tier: tierKind },
    summary: data.summary,
    tier_summary: tierSummary,
    candidates: data.candidates,
  }, null, 2));

  const csvRows = [
    [`${tierKind}_tier`, 'candidate_count', 'countries', 'sample_skus'].map(csvCell).join(','),
    ...tierSummary.map(row => [
      row.tier,
      row.candidate_count,
      row.countries.join('; '),
      row.sample_skus.join('; '),
    ].map(csvCell).join(',')),
  ];
  fs.writeFileSync(csvPath, `${csvRows.join('\n')}\n`);

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);
  console.log(`Total ${field} ${status} candidates: ${data.total}`);
  console.log(`${tierKind.toUpperCase()} tiers:`, tierSummary);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
