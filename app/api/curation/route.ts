import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const brief: string = body.brief;
    if (!brief || typeof brief !== 'string' || brief.trim().length === 0) {
      return NextResponse.json({ error: 'brief is required' }, { status: 400 });
    }
    const escaped = brief.replace(/'/g, "'\\''");
    const { stdout, stderr } = await execAsync(
      `cd "${process.cwd()}" && .venv/bin/python -c "
from lib.curation.pipeline import run_curation
import json
result = run_curation('${escaped}')
print(json.dumps(result))
"`,
      { timeout: 30000 }
    );
    if (stderr && !stderr.includes('UserWarning')) {
      console.error('Curation stderr:', stderr);
    }
    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
