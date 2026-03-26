// app/api/run-pipeline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as path from 'path';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-validation.ts'];
  if (body.status) args.push(`--status=${body.status}`);
  if (body.limit)  args.push(`--limit=${body.limit}`);

  const cwd = path.resolve(process.cwd());
  const child = spawn('npx', args, { cwd, env: { ...process.env } });

  // Accumulate output and return after completion (MVP: no streaming).
  // The UI button stays disabled while waiting; output appears all at once when done.
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));

  const code = await new Promise<number>(res => child.on('close', res));
  return NextResponse.json({ ok: code === 0, output: lines.join('') });
}
