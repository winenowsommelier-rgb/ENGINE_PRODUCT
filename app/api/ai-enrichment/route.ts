// app/api/ai-enrichment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

const VALID_BATCHES = new Set(['1','2','3','4','5','6','7','8','9']);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-ai-enrichment.ts'];

  // Optional: specific batch number
  if (typeof body.batch === 'string' && VALID_BATCHES.has(body.batch)) {
    args.push(`--batch=${body.batch}`);
  }

  // Optional: limit for testing
  const limit = Number(body.limit);
  if (Number.isInteger(limit) && limit > 0 && limit <= 500) {
    args.push(`--limit=${limit}`);
  }

  if (body.dry_run === true) {
    args.push('--dry-run');
  }

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));
  child.on('error', (err) => lines.push(`[spawn error] ${err.message}`));

  const code = await new Promise<number>(res => child.on('close', res));
  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
