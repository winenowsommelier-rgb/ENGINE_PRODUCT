// app/api/triage/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

// GET — return the last triage summary JSON (if present)
export async function GET() {
  const summaryPath = path.join(process.cwd(), 'data', 'triage_summary.json');
  if (!fs.existsSync(summaryPath)) {
    return NextResponse.json({ ok: false, summary: null }, { status: 200 });
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    return NextResponse.json({ ok: true, summary });
  } catch {
    return NextResponse.json({ ok: false, summary: null, error: 'corrupt_summary' }, { status: 200 });
  }
}

// POST — trigger triage scan
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const args = ['tsx', 'scripts/run-triage.ts'];

  const limit = Number(body.limit);
  if (Number.isInteger(limit) && limit > 0 && limit <= 20_000) {
    args.push(`--limit=${limit}`);
  }

  const child = spawn('npx', args, { cwd: process.cwd(), env: { ...process.env } });
  const lines: string[] = [];
  child.stdout.on('data', (d: Buffer) => lines.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => lines.push(d.toString()));

  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  const code = await new Promise<number>((res) => {
    const timer = setTimeout(() => {
      child.kill();
      lines.push('[timeout] process killed after 10 minutes');
      res(1);
    }, TIMEOUT_MS);
    child.on('close', (c) => { clearTimeout(timer); res(c ?? 1); });
    child.on('error', (err) => { clearTimeout(timer); lines.push(`[spawn error] ${err.message}`); res(1); });
  });

  const ok = code === 0;
  return NextResponse.json({ ok, output: lines.join('') }, { status: ok ? 200 : 500 });
}
