import { NextRequest, NextResponse } from 'next/server';
import {
  readCurationFeedback,
  saveCurationFeedback,
  type CurationFeedbackAction,
} from '@/lib/curation/storage';

export const runtime = 'nodejs';

const ACTIONS = new Set<CurationFeedbackAction>(['approve', 'skip', 'replace']);

export async function GET(req: NextRequest) {
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 100)));
  const feedback = await readCurationFeedback();
  return NextResponse.json({ feedback: feedback.slice(0, limit) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!ACTIONS.has(body.action) || !body.reason_code || !body.source_sku) {
      return NextResponse.json(
        { error: 'action, reason_code, and source_sku are required' },
        { status: 400 },
      );
    }
    if (body.action === 'replace' && !body.target_sku) {
      return NextResponse.json({ error: 'target_sku is required for replacement feedback' }, { status: 400 });
    }

    const feedback = await saveCurationFeedback({
      action: body.action,
      reason_code: String(body.reason_code),
      reason_label: String(body.reason_label || body.reason_code),
      note: body.note ? String(body.note) : undefined,
      run_id: body.run_id ? String(body.run_id) : undefined,
      brief: body.brief ? String(body.brief) : undefined,
      source_sku: String(body.source_sku),
      source_name: body.source_name ? String(body.source_name) : undefined,
      target_sku: body.target_sku ? String(body.target_sku) : undefined,
      target_name: body.target_name ? String(body.target_name) : undefined,
      relationship_type: body.relationship_type ? String(body.relationship_type) : undefined,
      recommendation_score: Number.isFinite(Number(body.recommendation_score))
        ? Number(body.recommendation_score)
        : undefined,
      recommendation_matrix: body.recommendation_matrix && typeof body.recommendation_matrix === 'object'
        ? body.recommendation_matrix
        : undefined,
      recommendation_risks: Array.isArray(body.recommendation_risks)
        ? body.recommendation_risks.map(String)
        : undefined,
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save feedback' },
      { status: 500 },
    );
  }
}
