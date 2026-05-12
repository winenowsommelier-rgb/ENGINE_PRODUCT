import fs from 'fs/promises';
import path from 'path';
import {
  buildWineSensedSummary,
  parseWineSensedJsonl,
  saveWineSensedResearch,
} from '../lib/research/winesensed';

const DEFAULT_SOURCE = path.join(process.cwd(), 'data', 'research', 'winesensed_wt_session.jsonl');

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

async function main() {
  const source = path.resolve(argValue('source') ?? DEFAULT_SOURCE);
  const limitRaw = argValue('limit');
  const limit = limitRaw ? Number(limitRaw) : 5000;

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }

  const text = await fs.readFile(source, 'utf8');
  const records = parseWineSensedJsonl(text, path.relative(process.cwd(), source), limit);
  const summary = buildWineSensedSummary(records, path.relative(process.cwd(), source));
  await saveWineSensedResearch(records, summary);

  console.log(`Imported ${summary.imported_rows.toLocaleString()} WineSensed research rows`);
  console.log(`Reviews: ${summary.rows_with_review.toLocaleString()}`);
  console.log(`Countries: ${summary.rows_with_country.toLocaleString()}`);
  console.log(`Regions: ${summary.rows_with_region.toLocaleString()}`);
  console.log(`Grapes: ${summary.rows_with_grape.toLocaleString()}`);
  console.log('Saved: data/db/external-winesensed-records.json');
  console.log('Saved: data/db/external-winesensed-summary.json');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
