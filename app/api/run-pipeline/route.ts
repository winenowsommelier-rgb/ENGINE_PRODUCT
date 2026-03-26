// app/api/run-pipeline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

const ALLOWED_STATUSES = new Set(['raw', 'needs_review', 'needs_attention', 'validated']);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-validation.ts'];

  if (typeof body.status === 'string' && ALLOWED_STATUSES.has(body.status)) {
    args.push(`--status=${body.status}`);
  }
  const limit = Number(body.limit);
  if (Number.isInteger(limit) && limit > 0 && limit <= 10_000) {
    args.push(`--limit=${limit}`);
  }

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });

  // Accumulate output and return after completion (MVP: no streaming).
  // The UI button stays disabled while waiting; output appears all at once when done.
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));
  child.on('error', (err) => lines.push(`[spawn error] ${err.message}`));

  const code = await new Promise<number>(res => child.on('close', res));
  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
