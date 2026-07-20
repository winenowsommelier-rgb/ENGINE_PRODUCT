/**
 * gen-recs-cache.mjs — prebuild generator for precomputed "recommended together" recs.
 *
 * WHY: precomputeRecommendations() (lib/recommender.ts) does real, non-trivial
 * CPU-bound work (~10s for the full ~11,934-product catalog). The product page
 * memoizes it at module scope so it runs once PER SERVER INSTANCE — but Next's
 * static build spreads page rendering across several `jest-worker` child
 * processes, each a separate Node process with its own module cache. Every
 * worker that renders at least one product page pays the full cost
 * independently; under real build contention (several workers computing this
 * concurrently on a small core count) that cost inflates enough to blow past
 * Next's 60s-per-page static-generation timeout (observed 51-65s/worker vs.
 * ~10s solo). Precomputing ONCE here and caching to a static JSON file — same
 * pattern as gen-search-index.mjs / gen-explore-map-data.mjs — removes the
 * cross-worker duplication entirely, regardless of worker/core count.
 *
 * HOW: recommender.ts (and its category-groups/category-scorer/co-purchase
 * dependencies) stay TypeScript with `@/lib/...` path aliases — the single
 * source of truth also used by the ISR on-demand-render fallback path (see
 * app/product/[sku]/page.tsx). Rather than duplicate that scoring logic in
 * plain JS (as gen-explore-map-data.mjs does for its simpler aggregation),
 * this script bundles recommender.ts with esbuild (already a transitive
 * dependency via vite/vitest, now pinned directly in package.json) and
 * executes the bundle in-process — no new runtime dependency, single source
 * of truth for scoring stays intact.
 *
 * Wired as the npm "prebuild" lifecycle script (see package.json), so
 * `npm run build` runs it automatically first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.join(__dirname, '..'); // apps/catalog

function resolveExportPath() {
  const candidates = [
    path.join(process.cwd(), 'data', 'live_products_export.json'),
    path.join(process.cwd(), '..', '..', 'data', 'live_products_export.json'),
    path.join(catalogRoot, '..', '..', 'data', 'live_products_export.json'),
    process.env.CATALOG_DATA_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error('gen-recs-cache: live_products_export.json not found in any known location');
  }
  return found;
}

async function loadRecommender() {
  const outfile = path.join(catalogRoot, '.next', 'gen-recs-cache-bundle.mjs');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(catalogRoot, 'lib', 'recommender.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    tsconfig: path.join(catalogRoot, 'tsconfig.json'),
  });
  const mod = await import(`${fileURLToPath(new URL('file://' + outfile))}?t=${Date.now()}`);
  fs.rmSync(outfile, { force: true });
  return mod;
}

async function main() {
  const file = resolveExportPath();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw?.products ?? []);
  const all = rows.map((r) => ({
    ...r,
    is_in_stock: r.is_in_stock === '1' || r.is_in_stock === 1,
  }));

  const { precomputeRecommendations } = await loadRecommender();

  const t0 = Date.now();
  const recs = precomputeRecommendations(all);
  const elapsed = Date.now() - t0;

  // Map -> plain object for JSON.
  const out = {};
  for (const [sku, list] of recs) out[sku] = list;

  const dataDir = path.join(catalogRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, 'recs-cache.json');
  fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');

  const bytes = fs.statSync(outPath).size;
  console.log(
    `gen-recs-cache: precomputed recs for ${recs.size} products in ${elapsed}ms (${(bytes / 1024 / 1024).toFixed(2)} MB) -> ${outPath}`,
  );
}

main().catch((e) => {
  console.error('gen-recs-cache: failed:', e);
  process.exit(1);
});
