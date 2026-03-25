import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// ─── Auth helper ──────────────────────────────────────────────────────────────
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw === 'PASTE_YOUR_SERVICE_ACCOUNT_JSON_HERE') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured in .env.local');
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

const SITE_MAP: Record<string, string> = {
  winenow: 'https://th.wine-now.com/',
  liq9:    'https://th.liq9.com/',
};

// ─── GET /api/gsc ─────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteParam = searchParams.get('site');

  // Use site param if provided, otherwise fall back to env var
  const siteUrl = (siteParam && SITE_MAP[siteParam])
    ?? process.env.GSC_SITE_URL;

  if (!siteUrl || siteUrl === 'https://YOUR-SITE.com/') {
    return NextResponse.json(
      { error: 'GSC_SITE_URL is not configured in .env.local' },
      { status: 500 }
    );
  }

  const days = parseInt(searchParams.get('days') ?? '90', 10);
  const startDate = daysAgo(days);
  const endDate = daysAgo(0);

  try {
    const auth = getAuth();
    const sc = google.searchconsole({ version: 'v1', auth });

    // Fetch in parallel: performance history + top keywords + top pages
    const [historyRes, keywordsRes, pagesRes] = await Promise.all([
      // Weekly performance (clicks, impressions, ctr, position)
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['date'],
          rowLimit: 90,
        },
      }),
      // Top keywords
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: 25,
        },
      }),
      // Top pages
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 10,
        },
      }),
    ]);

    const history = (historyRes.data.rows ?? []).map(r => ({
      date: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: parseFloat(((r.ctr ?? 0) * 100).toFixed(1)),
      position: parseFloat((r.position ?? 0).toFixed(1)),
    }));

    const keywords = (keywordsRes.data.rows ?? []).map(r => ({
      keyword: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: parseFloat(((r.ctr ?? 0) * 100).toFixed(1)),
      position: parseFloat((r.position ?? 0).toFixed(1)),
    }));

    const pages = (pagesRes.data.rows ?? []).map(r => ({
      page: (r.keys?.[0] ?? '').replace(/^https?:\/\/[^/]+/, ''),
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: parseFloat(((r.ctr ?? 0) * 100).toFixed(1)),
      position: parseFloat((r.position ?? 0).toFixed(1)),
    }));

    // Aggregate totals from the period
    const totals = history.reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.clicks,
        impressions: acc.impressions + row.impressions,
      }),
      { clicks: 0, impressions: 0 }
    );
    const avgCtr = keywords.length
      ? parseFloat((keywords.reduce((s, k) => s + k.ctr, 0) / keywords.length).toFixed(1))
      : 0;
    const avgPosition = keywords.length
      ? parseFloat((keywords.reduce((s, k) => s + k.position, 0) / keywords.length).toFixed(1))
      : 0;

    return NextResponse.json({
      siteUrl,
      period: { startDate, endDate, days },
      totals: { ...totals, avgCtr, avgPosition, keywords: keywords.length },
      history,
      keywords,
      pages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
