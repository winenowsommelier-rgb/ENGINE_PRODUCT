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

  const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (batch runs are longer than triage)

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));

  const code = await new Promise<number>((res) => {
    const timer = setTimeout(() => {
      child.kill();
      lines.push('[timeout] process killed after 30 minutes');
      res(1);
    }, TIMEOUT_MS);
    child.on('close', (c) => { clearTimeout(timer); res(c ?? 1); });
    child.on('error', (err) => { clearTimeout(timer); lines.push(`[spawn error] ${err.message}`); res(1); });
  });

  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
