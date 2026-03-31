// app/api/ai-enrichment/results/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  const dir = path.join(process.cwd(), 'data', 'enrichment_results');
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ records: [] });
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const records = files.flatMap(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return [{
        ...data,
        desc_confidence: data.result?.desc_confidence ?? data.desc_confidence ?? 0,
        original_desc_source: data.original_desc_source ?? null,
      }];
    } catch (e: any) {
      console.error(`[results route] skipping corrupt file ${f}: ${e.message}`);
      return [];
    }
  });
  return NextResponse.json({ records });
}
