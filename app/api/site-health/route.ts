import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LowCtrPage {
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  issue: string;
}

interface QuickWinKeyword {
  keyword: string;
  position: number;
  impressions: number;
  clicks: number;
  opportunity: string;
}

interface SiteHealthResponse {
  site: string;
  siteUrl: string;
  checkedAt: string;

  indexHealth: {
    status: 'good' | 'warning' | 'unknown';
    note: string;
  };

  coreWebVitals: {
    status: 'not_configured';
    note: string;
    lcp: null;
    fid: null;
    cls: null;
  };

  lowCtrPages: LowCtrPage[];

  quickWinKeywords: QuickWinKeyword[];

  summary: {
    lowCtrCount: number;
    quickWinCount: number;
    overallHealth: 'good' | 'needs_attention' | 'critical';
    topRecommendation: string;
  };
}

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

// ─── Site map ─────────────────────────────────────────────────────────────────

const SITE_MAP: Record<string, string> = {
  winenow: 'https://th.wine-now.com/',
  liq9: 'https://th.liq9.com/',
};

// ─── GET /api/site-health?site=winenow ────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteParam = searchParams.get('site') ?? '';

  const siteUrl = SITE_MAP[siteParam] ?? process.env.GSC_SITE_URL;

  if (!siteUrl || siteUrl === 'https://YOUR-SITE.com/') {
    return NextResponse.json(
      {
        error:
          'Unknown site. Pass ?site=winenow or ?site=liq9, or configure GSC_SITE_URL in .env.local',
      },
      { status: 400 }
    );
  }

  // Resolve a display name for the site
  const site =
    Object.entries(SITE_MAP).find(([, v]) => v === siteUrl)?.[0] ?? siteParam ?? 'unknown';

  const startDate = daysAgo(30);
  const endDate = daysAgo(0);

  try {
    const auth = getAuth();
    const sc = google.searchconsole({ version: 'v1', auth });

    // ── Fetch GSC data in parallel ────────────────────────────────────────────
    const [pagesRes, queriesRes] = await Promise.all([
      // Pages — we'll filter for low CTR
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 50,
        },
      }),
      // Queries — 200 rows so position 11-30 quick wins are captured
      // even for high-ranking sites where the top 50 are all page 1
      sc.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: 200,
        },
      }),
    ]);

    // ── Low CTR pages ─────────────────────────────────────────────────────────
    // GSC returns ctr as 0-1 decimal; multiply by 100 for percentage.
    // Filter: impressions >= 100 AND ctr (as %) < 2.0
    const lowCtrPages: LowCtrPage[] = (pagesRes.data.rows ?? [])
      .map((r) => ({
        page: (r.keys?.[0] ?? '').replace(/^https?:\/\/[^/]+/, '') || '/',
        impressions: r.impressions ?? 0,
        clicks: r.clicks ?? 0,
        ctr: parseFloat(((r.ctr ?? 0) * 100).toFixed(2)),
        position: parseFloat((r.position ?? 0).toFixed(1)),
      }))
      .filter((row) => row.impressions >= 100 && row.ctr < 2.0)
      .map((row) => ({
        ...row,
        issue:
          row.ctr < 0.5
            ? 'Very low CTR — title or meta description may be missing or very weak'
            : 'High impressions but low CTR — check title/meta description relevance',
      }));

    // ── Quick-win keywords ────────────────────────────────────────────────────
    // Filter: position between 11 and 30 AND impressions >= 50
    const quickWinKeywords: QuickWinKeyword[] = (queriesRes.data.rows ?? [])
      .map((r) => ({
        keyword: r.keys?.[0] ?? '',
        position: parseFloat((r.position ?? 0).toFixed(1)),
        impressions: r.impressions ?? 0,
        clicks: r.clicks ?? 0,
      }))
      .filter((row) => row.position >= 11 && row.position <= 30 && row.impressions >= 50)
      .map((row) => {
        let opportunity: string;
        if (row.position <= 15) {
          opportunity = `Position ${row.position} — a small boost could reach the top 10`;
        } else if (row.position <= 20) {
          opportunity = `Position ${row.position} — moderate effort could reach page 1`;
        } else {
          opportunity = `Position ${row.position} — small improvement could reach page 1`;
        }
        return { ...row, opportunity };
      });

    // ── Index health heuristic ────────────────────────────────────────────────
    // We derive a rough index health signal from whether GSC returned any data.
    const totalPageRows = pagesRes.data.rows?.length ?? 0;
    let indexHealth: SiteHealthResponse['indexHealth'];

    if (totalPageRows === 0) {
      indexHealth = {
        status: 'warning',
        note:
          'No page data returned from GSC in the last 30 days — site may have indexing or crawl issues.',
      };
    } else if (lowCtrPages.length > totalPageRows * 0.5) {
      indexHealth = {
        status: 'warning',
        note: `${totalPageRows} pages found in GSC, but ${lowCtrPages.length} have poor CTR — pages may be indexed but metadata needs work.`,
      };
    } else {
      indexHealth = {
        status: 'good',
        note: `${totalPageRows} pages found in GSC with active impressions over the last 30 days.`,
      };
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const lowCtrCount = lowCtrPages.length;
    const quickWinCount = quickWinKeywords.length;

    let overallHealth: SiteHealthResponse['summary']['overallHealth'];
    if (lowCtrCount > 20) {
      overallHealth = 'critical';
    } else if (lowCtrCount > 5) {
      overallHealth = 'needs_attention';
    } else {
      overallHealth = 'good';
    }

    let topRecommendation: string;
    if (lowCtrCount > 0 && quickWinCount > 0) {
      const topPage = lowCtrPages[0];
      const topKw = quickWinKeywords[0];
      topRecommendation = `Fix meta title/description on "${topPage.page}" (${topPage.impressions} impressions, ${topPage.ctr}% CTR), and push "${topKw.keyword}" from position ${topKw.position} to page 1.`;
    } else if (lowCtrCount > 0) {
      const topPage = lowCtrPages[0];
      topRecommendation = `Improve meta title/description on "${topPage.page}" — it has ${topPage.impressions} impressions but only ${topPage.ctr}% CTR.`;
    } else if (quickWinCount > 0) {
      const topKw = quickWinKeywords[0];
      topRecommendation = `"${topKw.keyword}" is at position ${topKw.position} with ${topKw.impressions} impressions — a targeted content update could push it to page 1.`;
    } else {
      topRecommendation = 'No critical issues found. Continue monitoring and expanding content coverage.';
    }

    const response: SiteHealthResponse = {
      site,
      siteUrl,
      checkedAt: new Date().toISOString(),

      indexHealth,

      coreWebVitals: {
        status: 'not_configured',
        note: 'Add PAGESPEED_API_KEY to .env.local to enable Core Web Vitals via PageSpeed Insights API',
        lcp: null,
        fid: null,
        cls: null,
      },

      lowCtrPages,
      quickWinKeywords,

      summary: {
        lowCtrCount,
        quickWinCount,
        overallHealth,
        topRecommendation,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
