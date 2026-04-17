import { NextResponse } from 'next/server';

// ─── Base URL ─────────────────────────────────────────────────────────────────
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let cache: { data: DataCenterResponse; at: number } | null = null;

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscTotals {
  clicks: number;
  impressions: number;
  avgCtr: number;
  avgPosition: number;
  keywords: number;
}

interface GscKeyword {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscHistoryPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Ga4Totals {
  sessions: number;
  users: number;
  bounceRate: number;
  avgSessionDuration: number;
  pageViews: number;
}

interface Ga4Source {
  channel: string;
  sessions: number;
  share: number;
}

interface Ga4DailyPoint {
  date: string;
  sessions: number;
  users: number;
}

interface Ga4Conversion {
  event: string;
  count: number;
}

interface SiteBundle {
  name: string;
  url: string;
  gsc: {
    totals: GscTotals;
    keywords: GscKeyword[];
    pages: GscPage[];
    history: GscHistoryPoint[];
  } | null;
  ga4: {
    totals: Ga4Totals;
    sources: Ga4Source[];
    daily: Ga4DailyPoint[];
    conversions: Ga4Conversion[];
  } | null;
  error?: string;
}

interface SheetData {
  sheetName: string;
  spreadsheetId: string;
  range: string;
  headers: string[];
  rows: Record<string, string>[];
  count: number;
  fetchedAt: string;
  error?: string;
}

interface SourceStatus {
  name: string;
  status: 'live' | 'error' | 'not_configured';
  note?: string;
}

interface DataCenterResponse {
  generatedAt: string;
  cachedUntil: string;
  period: { days: number };
  sites: {
    winenow: SiteBundle;
    liq9: SiteBundle;
  };
  sheets: SheetData[];
  comparison: {
    clicksLeader: string;
    sessionsLeader: string;
    positionLeader: string;
    insights: string[];
  };
  claudeContext: string;
  sources: SourceStatus[];
}

// ─── Auth check ───────────────────────────────────────────────────────────────
// Set DATA_CENTER_API_KEY in .env.local to require auth from external callers.
// Internal fetches (same host) always pass if key is set AND the origin matches.
// Leave DATA_CENTER_API_KEY empty to make the endpoint fully public.
function isAuthorized(request: Request): boolean {
  const key = process.env.DATA_CENTER_API_KEY;
  if (!key) return true; // no key = open access
  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${key}`;
}

// ─── Internal fetch helpers ───────────────────────────────────────────────────

async function fetchGsc(site: string, days: number) {
  const r = await fetch(`${BASE_URL}/api/gsc?days=${days}&site=${site}`);
  if (!r.ok) throw new Error(`GSC ${site} returned ${r.status}`);
  return r.json();
}

async function fetchGa4(site: string, days: number) {
  const r = await fetch(`${BASE_URL}/api/ga4?days=${days}&site=${site}`);
  if (!r.ok) throw new Error(`GA4 ${site} returned ${r.status}`);
  return r.json();
}

async function fetchSheet(id: string, range: string, name: string): Promise<SheetData> {
  try {
    const r = await fetch(
      `${BASE_URL}/api/sheets?sheet=${encodeURIComponent(id)}&range=${encodeURIComponent(range)}&name=${encodeURIComponent(name)}`
    );
    if (!r.ok) throw new Error(`Sheets API returned ${r.status}`);
    return r.json();
  } catch (err) {
    return {
      sheetName: name,
      spreadsheetId: id,
      range,
      headers: [],
      rows: [],
      count: 0,
      fetchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ─── Build site bundle ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSiteBundle(name: string, url: string, gscRaw: any, ga4Raw: any): SiteBundle {
  const gscError = gscRaw?.error as string | undefined;
  const ga4Error = ga4Raw?.error as string | undefined;

  return {
    name,
    url,
    error: [gscError, ga4Error].filter(Boolean).join('; ') || undefined,
    gsc: gscError
      ? null
      : {
          totals: gscRaw.totals ?? { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0, keywords: 0 },
          keywords: gscRaw.keywords ?? [],
          pages: gscRaw.pages ?? [],
          history: gscRaw.history ?? [],
        },
    ga4: ga4Error
      ? null
      : {
          totals: ga4Raw.totals ?? { sessions: 0, users: 0, bounceRate: 0, avgSessionDuration: 0, pageViews: 0 },
          sources: ga4Raw.sources ?? [],
          daily: ga4Raw.daily ?? [],
          conversions: ga4Raw.conversions ?? [],
        },
  };
}

// ─── Comparison ───────────────────────────────────────────────────────────────

function buildComparison(wn: SiteBundle, lq: SiteBundle) {
  const wnClicks = wn.gsc?.totals.clicks ?? 0;
  const lqClicks = lq.gsc?.totals.clicks ?? 0;
  const wnSessions = wn.ga4?.totals.sessions ?? 0;
  const lqSessions = lq.ga4?.totals.sessions ?? 0;
  const wnPos = wn.gsc?.totals.avgPosition ?? 999;
  const lqPos = lq.gsc?.totals.avgPosition ?? 999;

  const insights: string[] = [];

  if (wnClicks !== lqClicks) {
    const ratio = Math.max(wnClicks, lqClicks) / Math.max(Math.min(wnClicks, lqClicks), 1);
    const leader = wnClicks > lqClicks ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} leads organic clicks by ${ratio.toFixed(1)}x (${Math.max(wnClicks, lqClicks).toLocaleString()} vs ${Math.min(wnClicks, lqClicks).toLocaleString()}).`);
  }

  if (wnPos !== lqPos && wnPos !== 999 && lqPos !== 999) {
    const leader = wnPos < lqPos ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} holds the stronger avg SERP position (${Math.min(wnPos, lqPos)} vs ${Math.max(wnPos, lqPos)}).`);
  }

  if (wnSessions !== lqSessions) {
    const leader = wnSessions > lqSessions ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} drives more GA4 sessions (${Math.max(wnSessions, lqSessions).toLocaleString()} vs ${Math.min(wnSessions, lqSessions).toLocaleString()}).`);
  }

  const wnCtr = wn.gsc?.totals.avgCtr ?? 0;
  const lqCtr = lq.gsc?.totals.avgCtr ?? 0;
  if (wnCtr !== lqCtr) {
    const leader = wnCtr > lqCtr ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} has a higher organic CTR (${Math.max(wnCtr, lqCtr)}% vs ${Math.min(wnCtr, lqCtr)}%).`);
  }

  return {
    clicksLeader: wnClicks >= lqClicks ? 'winenow' : 'liq9',
    sessionsLeader: wnSessions >= lqSessions ? 'winenow' : 'liq9',
    positionLeader: wnPos <= lqPos ? 'winenow' : 'liq9',
    insights,
  };
}

// ─── Claude context ───────────────────────────────────────────────────────────

function buildClaudeContext(wn: SiteBundle, lq: SiteBundle, sheets: SheetData[], days: number): string {
  const wnTopKw = wn.gsc?.keywords[0]?.keyword ?? 'N/A';
  const lqTopKw = lq.gsc?.keywords[0]?.keyword ?? 'N/A';
  const wnTopCh = wn.ga4?.sources[0]?.channel ?? 'N/A';
  const lqTopCh = lq.ga4?.sources[0]?.channel ?? 'N/A';
  const wnConv = wn.ga4?.conversions.find(c => c.event === 'purchase')?.count ?? 0;
  const lqConv = lq.ga4?.conversions.find(c => c.event === 'purchase')?.count ?? 0;

  let ctx =
    `[Data Center — last ${days} days] ` +
    `Wine-Now (th.wine-now.com): ${(wn.gsc?.totals.clicks ?? 0).toLocaleString()} organic clicks, ` +
    `${(wn.gsc?.totals.impressions ?? 0).toLocaleString()} impressions, ` +
    `avg position ${wn.gsc?.totals.avgPosition ?? 'N/A'}, CTR ${wn.gsc?.totals.avgCtr ?? 0}%. ` +
    `GA4: ${(wn.ga4?.totals.sessions ?? 0).toLocaleString()} sessions, ${(wn.ga4?.totals.users ?? 0).toLocaleString()} users, ` +
    `bounce ${wn.ga4?.totals.bounceRate ?? 0}%, purchases ${wnConv}. ` +
    `Top keyword: "${wnTopKw}". Top channel: ${wnTopCh}. ` +
    `LIQ9 (th.liq9.com): ${(lq.gsc?.totals.clicks ?? 0).toLocaleString()} organic clicks, ` +
    `${(lq.gsc?.totals.impressions ?? 0).toLocaleString()} impressions, ` +
    `avg position ${lq.gsc?.totals.avgPosition ?? 'N/A'}, CTR ${lq.gsc?.totals.avgCtr ?? 0}%. ` +
    `GA4: ${(lq.ga4?.totals.sessions ?? 0).toLocaleString()} sessions, ${(lq.ga4?.totals.users ?? 0).toLocaleString()} users, ` +
    `bounce ${lq.ga4?.totals.bounceRate ?? 0}%, purchases ${lqConv}. ` +
    `Top keyword: "${lqTopKw}". Top channel: ${lqTopCh}.`;

  if (sheets.length > 0) {
    const sheetSummaries = sheets
      .filter(s => !s.error && s.count > 0)
      .map(s => `"${s.sheetName}" (${s.count} rows, columns: ${s.headers.slice(0, 6).join(', ')}${s.headers.length > 6 ? '…' : ''})`)
      .join('; ');
    if (sheetSummaries) {
      ctx += ` Additional raw data sheets: ${sheetSummaries}.`;
    }
  }

  return ctx;
}

// ─── Source status ────────────────────────────────────────────────────────────

function buildSources(wn: SiteBundle, lq: SiteBundle, sheets: SheetData[]): SourceStatus[] {
  const sources: SourceStatus[] = [
    {
      name: 'GSC — Wine-Now',
      status: wn.gsc ? 'live' : 'error',
      note: wn.error?.includes('GSC') ? wn.error : undefined,
    },
    {
      name: 'GSC — LIQ9',
      status: lq.gsc ? 'live' : 'error',
      note: lq.error?.includes('GSC') ? lq.error : undefined,
    },
    {
      name: 'GA4 — Wine-Now',
      status: wn.ga4 ? 'live' : 'error',
    },
    {
      name: 'GA4 — LIQ9',
      status: lq.ga4 ? 'live' : 'error',
    },
  ];

  const sheetsApiEnabled = !sheets.some(s => s.error?.includes('has not been used') || s.error?.includes('disabled'));
  if (sheets.length === 0) {
    sources.push({
      name: 'Google Sheets',
      status: 'not_configured',
      note: 'Sheet IDs configured. Enable Sheets API at: https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=1030487865754',
    });
  } else if (!sheetsApiEnabled) {
    sources.push({
      name: 'Google Sheets',
      status: 'error',
      note: 'Sheets API not enabled. Visit: https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=1030487865754',
    });
  } else {
    for (const s of sheets) {
      sources.push({
        name: `Sheet — ${s.sheetName}`,
        status: s.error ? 'error' : 'live',
        note: s.error,
      });
    }
  }

  return sources;
}

// ─── GET /api/data-center ─────────────────────────────────────────────────────
// Query params:
//   ?days=30              (default 30, supports 7/30/90/180/365)
//   ?refresh=true         (bypass cache)
//
// Headers (if DATA_CENTER_API_KEY is set in .env.local):
//   Authorization: Bearer <your-key>
//
// This endpoint is designed to be called by external projects, Claude sessions,
// scheduled scripts, or any tool that needs a unified view of all site data.

export async function GET(request: Request): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized. Pass Authorization: Bearer <DATA_CENTER_API_KEY> header.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get('days') ?? '30', 10)));
  const refresh = searchParams.get('refresh') === 'true';

  // ── Cache hit ─────────────────────────────────────────────────────────────
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  // ── Fetch all data in parallel ────────────────────────────────────────────
  // GSC + GA4 for both sites + key tabs from the three Google Sheets.
  //
  // WN GA sheet tabs:  Monthly Summary | Daily Metrics | Daily by Source |
  //                    Ecommerce Daily | Product Performance | Landing Pages |
  //                    Traffic Overview | Top Pages | Traffic Sources | ...
  // LIQ9 GA sheet tabs: same structure as WN GA
  // GSC sheet tabs:    WN GSC 90D | LIQ9 GSC 90D | WN GSC FEED | LIQ9 GSC FEED | GSC Status
  const sheetConfigs = [
    // GA4 — Monthly rollup (best overview for claudeContext / AI consumption)
    { id: process.env.SHEETS_WN_GA_ID ?? '',   range: 'Monthly Summary!A:J', name: 'WN Monthly' },
    { id: process.env.SHEETS_WN_GA_ID ?? '',   range: 'Ecommerce Daily!A:H', name: 'WN Ecommerce' },
    { id: process.env.SHEETS_LIQ9_GA_ID ?? '',  range: 'Monthly Summary!A:J', name: 'LIQ9 Monthly' },
    // GSC — page×query data for both sites (90-day rolling, updated by Apps Script)
    { id: process.env.SHEETS_GSC_ID ?? '',       range: 'WN GSC 90D!A:H',    name: 'WN GSC 90D' },
    { id: process.env.SHEETS_GSC_ID ?? '',       range: 'LIQ9 GSC 90D!A:H',  name: 'LIQ9 GSC 90D' },
  ].filter(s => s.id.length > 0);

  const [gscWn, gscLq, ga4Wn, ga4Lq, ...sheetResults] = await Promise.all([
    fetchGsc('winenow', days).catch(e => ({ error: String(e) })),
    fetchGsc('liq9', days).catch(e => ({ error: String(e) })),
    fetchGa4('winenow', days).catch(e => ({ error: String(e) })),
    fetchGa4('liq9', days).catch(e => ({ error: String(e) })),
    ...sheetConfigs.map(s => fetchSheet(s.id, s.range, s.name)),
  ]);

  const winenow = buildSiteBundle('Wine-Now', 'https://th.wine-now.com', gscWn, ga4Wn);
  const liq9 = buildSiteBundle('LIQ9', 'https://th.liq9.com', gscLq, ga4Lq);
  const sheets = sheetResults as SheetData[];

  const now = new Date();
  const cachedUntil = new Date(now.getTime() + CACHE_TTL);

  const response: DataCenterResponse = {
    generatedAt: now.toISOString(),
    cachedUntil: cachedUntil.toISOString(),
    period: { days },
    sites: { winenow, liq9 },
    sheets,
    comparison: buildComparison(winenow, liq9),
    claudeContext: buildClaudeContext(winenow, liq9, sheets, days),
    sources: buildSources(winenow, liq9, sheets),
  };

  cache = { data: response, at: Date.now() };
  return NextResponse.json(response);
}
