import { NextResponse } from 'next/server';
import { getPipelineStatus, savePipelineStatus, getProductStats } from '@/lib/db/client';

export const runtime = 'nodejs';

const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  const status = await getPipelineStatus();

  // Auto-reset stuck pipelines (running but no update for 10+ min)
  if (status.status === 'running' && status.last_run) {
    const age = Date.now() - new Date(status.last_run).getTime();
    if (age > STUCK_TIMEOUT_MS) {
      await savePipelineStatus({ status: 'error', current_step: 'Timed out — click Resume to continue' });
      return NextResponse.json({ ...status, status: 'error', current_step: 'Timed out — click Resume to continue' });
    }
  }

  // Attach live product stats to status response
  const stats = await getProductStats();
  return NextResponse.json({ ...status, stats });
}

export async function DELETE() {
  // Reset a stuck pipeline back to idle so it can be re-run
  await savePipelineStatus({ status: 'idle', current_step: null });
  return NextResponse.json({ reset: true });
}
