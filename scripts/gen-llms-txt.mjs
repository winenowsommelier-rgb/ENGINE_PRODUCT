// scripts/gen-llms-txt.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function findExport() {
  const candidates = [
    path.join(ROOT, 'apps', 'catalog', 'data', 'live_products_export.json'),
    path.join(ROOT, 'data', 'live_products_export.json'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

const exportFile = findExport();
if (!exportFile) {
  console.warn('gen-llms-txt: live_products_export.json not found, skipping');
  process.exit(0);
}

const products = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
const total = products.length;

// Count by country for summary
const countryCounts = {};
for (const p of products) {
  if (p.country) countryCounts[p.country] = (countryCounts[p.country] ?? 0) + 1;
}
const topCountries = Object.entries(countryCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6)
  .map(([c]) => c)
  .join(', ');

// Top 6 regions by product count
const regionCounts = {};
for (const p of products) {
  if (p.region) regionCounts[p.region] = (regionCounts[p.region] ?? 0) + 1;
}
const topRegions = Object.entries(regionCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6);

// Contact env
const line = process.env.LINE_OFFICIAL_URL ?? '';
const wa = process.env.WHATSAPP_NUMBER ?? '';
const fb = process.env.FB_MESSENGER_PAGE ?? '';

const BASE = 'https://wnlq9-catalog.vercel.app';

const contactLines = [
  line ? `- LINE: ${line}` : '',
  wa ? `- WhatsApp: ${wa}` : '',
  fb ? `- Facebook Messenger: ${BASE}/contact` : '',
].filter(Boolean).join('\n');

const regionLines = topRegions.map(([region, count]) => {
  const slug = region.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `- ${region} (${count} bottles): ${BASE}/explore-map/${slug}`;
}).join('\n');

const llmsTxt = `# WNLQ9

> WNLQ9 is a curated wine, whisky and spirits retailer based in Bangkok, Thailand.

WNLQ9 stocks ${total.toLocaleString()} bottles from wine and spirits regions across 40+ countries, with a focus on ${topCountries}. The selection includes wine (red, white, rosé, sparkling, Champagne), whisky (single malt, blended, Japanese), spirits (gin, vodka, rum, tequila, cognac), sake, liqueurs, beer, and accessories.

## How to order

WNLQ9 does not process online payments. To order, contact the team directly:
${contactLines || '- Contact page: ' + BASE + '/contact'}

Contact page: ${BASE}/contact

## Catalog

Full catalog: ${BASE}/shop
Browse by region: ${BASE}/explore-map
Sitemap: ${BASE}/sitemap.xml

## Key collections

${regionLines}`.trim();

const outPath = path.join(ROOT, 'apps', 'catalog', 'public', 'llms.txt');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, llmsTxt, 'utf8');
console.log(`gen-llms-txt: wrote ${outPath} (${total} products, ${topRegions.length} regions)`);
