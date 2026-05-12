import {
  buildGeographyEvidence,
  saveGeographyEvidence,
} from '../lib/research/geography-evidence';
import { readWineSensedResearch } from '../lib/research/winesensed';

async function main() {
  const records = await readWineSensedResearch();
  if (records.length === 0) {
    throw new Error('No WineSensed research records found. Run npm run import:winesensed first.');
  }

  const { evidence, summary } = buildGeographyEvidence(records);
  await saveGeographyEvidence(evidence, summary);

  console.log(`Built ${summary.evidence_rows.toLocaleString()} WineSensed geography evidence rows`);
  console.log(`Matched: ${summary.matched.toLocaleString()}`);
  console.log(`Ambiguous: ${summary.ambiguous.toLocaleString()}`);
  console.log(`Needs classification: ${summary.needs_classification.toLocaleString()}`);
  console.log('Saved: data/db/external-winesensed-geography-evidence.json');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
