import { NextRequest, NextResponse } from 'next/server';
import { validateRows, resultsToCsv, parseCsv } from '@/lib/validation/upload-pipeline';
import { fileProposals } from '@/lib/validation/taxonomy-research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/validate-upload
 *
 * Body (JSON):
 *   { csv: string }                      — raw CSV text, OR
 *   { rows: object[], headers: string[] } — already-parsed rows
 *   download?: boolean                   — return text/csv attachment instead of JSON
 *
 * Problem values (unknown taxonomy) are cross-checked against our own product
 * database + canonical lists (no external API) and filed to the review queue.
 * Nothing is added to the canonical taxonomy automatically.
 *
 * Returns JSON: { detectedColumns, summary, results, proposals }
 * or a CSV file when download=true.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    let rows: Array<Record<string, any>> = [];
    let headers: string[] = [];

    if (typeof body.csv === 'string' && body.csv.trim()) {
      const parsed = parseCsv(body.csv);
      rows = parsed.rows;
      headers = parsed.headers;
    } else if (Array.isArray(body.rows)) {
      rows = body.rows;
      headers = Array.isArray(body.headers) && body.headers.length
        ? body.headers
        : Object.keys(rows[0] ?? {});
    } else {
      return NextResponse.json({ error: 'Provide { csv } text or { rows, headers }.' }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in the input.' }, { status: 400 });
    }

    const { results, proposals, detectedColumns, summary } = validateRows(rows, headers);

    if (Object.keys(detectedColumns).length === 0) {
      return NextResponse.json(
        { error: `Could not detect country/region/subregion/name columns. Headers: ${headers.join(', ')}` },
        { status: 422 },
      );
    }

    // Cross-check problem values against our database and file them for review.
    // Nothing is added to the canonical taxonomy automatically.
    let storedProposals: ReturnType<typeof fileProposals> = [];
    if (proposals.length) {
      storedProposals = fileProposals(proposals);
    }

    if (body.download) {
      const csv = resultsToCsv(results);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="validated_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json({
      detectedColumns,
      summary,
      total: results.length,
      results,
      csv: resultsToCsv(results),
      proposals: storedProposals,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Validation failed' },
      { status: 500 },
    );
  }
}
