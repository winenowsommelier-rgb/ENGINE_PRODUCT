import { NextResponse } from 'next/server';

// ─── Base URL for internal fetches ────────────────────────────────────────────
// Set NEXT_PUBLIC_BASE_URL in .env.local for production, e.g.:
//   NEXT_PUBLIC_BASE_URL=https://your-domain.com
// Falls back to http://localhost:3000 in development.
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// ─── Types for upstream API responses ─────────────────────────────────────────

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

interface GscResponse {
  error?: string;
  totals?: {
    clicks: number;
    impressions: number;
    avgCtr: number;
    avgPosition: number;
    keywords: number;
  };
  keywords?: GscKeyword[];
  pages?: GscPage[];
}

interface Ga4Source {
  channel: string;
  sessions: number;
  share: number;
}

interface Ga4Response {
  error?: string;
  totals?: {
    sessions: number;
    users: number;
    bounceRate: number;
    avgSessionDuration: number;
    pageViews: number;
  };
  sources?: Ga4Source[];
}

// ─── Types for the summary response ──────────────────────────────────────────

type SiteKey = 'winenow' | 'liq9';
type Winner = SiteKey | 'tie';
type HealthStatus = 'healthy' | 'warning' | 'critical';

interface SiteGsc {
  clicks: number;
  impressions: number;
  avgCtr: number;
  avgPosition: number;
  topKeywords: Array<{ keyword: string; clicks: number; position: number }>;
  topPages: Array<{ page: string; clicks: number }>;
}

interface SiteGa4 {
  sessions: number;
  users: number;
  bounceRate: number;
  avgSessionDuration: number;
  topChannels: Array<{ channel: string; sessions: number; share: number }>;
}

interface SiteHealth {
  status: HealthStatus;
  notes: string[];
}

interface SiteData {
  name: string;
  url: string;
  gsc: SiteGsc;
  ga4: SiteGa4;
  health: SiteHealth;
  error?: string;
}

interface SummaryResponse {
  generatedAt: string;
  period: { days: number; startDate: string; endDate: string };
  sites: {
    winenow: SiteData;
    liq9: SiteData;
  };
  comparison: {
    winner: {
      clicks: Winner;
      sessions: Winner;
      avgPosition: Winner;
    };
    insights: string[];
  };
  claudeContext: string;
}

// ─── Date helper ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── Health logic ─────────────────────────────────────────────────────────────

function computeHealth(gsc: SiteGsc, ga4: SiteGa4): SiteHealth {
  const notes: string[] = [];
  let status: HealthStatus = 'healthy';

  if (gsc.avgPosition > 50 || gsc.clicks < 100) {
    status = 'critical';
    if (gsc.avgPosition > 50) notes.push(`Average position ${gsc.avgPosition} is critically low (>50).`);
    if (gsc.clicks < 100) notes.push(`Only ${gsc.clicks} organic clicks — critically low traffic.`);
  } else if (gsc.avgPosition > 20 || ga4.bounceRate > 70) {
    status = 'warning';
    if (gsc.avgPosition > 20) notes.push(`Average position ${gsc.avgPosition} is above 20 — needs improvement.`);
    if (ga4.bounceRate > 70) notes.push(`Bounce rate ${ga4.bounceRate}% is high (>70%).`);
  } else {
    notes.push('All key metrics within healthy ranges.');
  }

  return { status, notes };
}

// ─── Winner helper ────────────────────────────────────────────────────────────

function pickWinner(a: number, b: number, lowerIsBetter = false): Winner {
  if (a === b) return 'tie';
  if (lowerIsBetter) {
    return a < b ? 'winenow' : 'liq9';
  }
  return a > b ? 'winenow' : 'liq9';
}

// ─── Insight generator ────────────────────────────────────────────────────────

function buildInsights(wn: SiteData, lq: SiteData): string[] {
  const insights: string[] = [];

  // Clicks comparison
  if (wn.gsc.clicks !== lq.gsc.clicks) {
    const leader = wn.gsc.clicks > lq.gsc.clicks ? 'Wine-Now' : 'LIQ9';
    const ratio = wn.gsc.clicks > lq.gsc.clicks
      ? (wn.gsc.clicks / Math.max(lq.gsc.clicks, 1)).toFixed(1)
      : (lq.gsc.clicks / Math.max(wn.gsc.clicks, 1)).toFixed(1);
    insights.push(`${leader} leads in organic clicks by a ${ratio}x margin.`);
  } else {
    insights.push('Both sites have equal organic click volume.');
  }

  // Position comparison
  if (wn.gsc.avgPosition !== lq.gsc.avgPosition) {
    const leader = wn.gsc.avgPosition < lq.gsc.avgPosition ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} holds a stronger average SERP position (${Math.min(wn.gsc.avgPosition, lq.gsc.avgPosition)} vs ${Math.max(wn.gsc.avgPosition, lq.gsc.avgPosition)}).`);
  }

  // Sessions comparison
  if (wn.ga4.sessions !== lq.ga4.sessions) {
    const leader = wn.ga4.sessions > lq.ga4.sessions ? 'Wine-Now' : 'LIQ9';
    insights.push(`${leader} drives more GA4 sessions (${Math.max(wn.ga4.sessions, lq.ga4.sessions).toLocaleString()} vs ${Math.min(wn.ga4.sessions, lq.ga4.sessions).toLocaleString()}).`);
  }

  // Bounce rate comparison
  if (wn.ga4.bounceRate !== lq.ga4.bounceRate) {
    const better = wn.ga4.bounceRate < lq.ga4.bounceRate ? 'Wine-Now' : 'LIQ9';
    insights.push(`${better} has a lower bounce rate (${Math.min(wn.ga4.bounceRate, lq.ga4.bounceRate)}% vs ${Math.max(wn.ga4.bounceRate, lq.ga4.bounceRate)}%), indicating better content engagement.`);
  }

  // Health status
  if (wn.health.status !== lq.health.status) {
    const healthOrder: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 };
    const wnScore = healthOrder[wn.health.status];
    const lqScore = healthOrder[lq.health.status];
    if (wnScore < lqScore) {
      insights.push(`Wine-Now is in a healthier overall state (${wn.health.status}) compared to LIQ9 (${lq.health.status}).`);
    } else {
      insights.push(`LIQ9 is in a healthier overall state (${lq.health.status}) compared to Wine-Now (${wn.health.status}).`);
    }
  } else {
    insights.push(`Both sites share a ${wn.health.status} health status.`);
  }

  return insights.slice(0, 5);
}

// ─── Claude context paragraph ─────────────────────────────────────────────────

function buildClaudeContext(wn: SiteData, lq: SiteData, days: number): string {
  const wnTopKw = wn.gsc.topKeywords[0]?.keyword ?? 'N/A';
  const lqTopKw = lq.gsc.topKeywords[0]?.keyword ?? 'N/A';
  const wnTopCh = wn.ga4.topChannels[0]?.channel ?? 'N/A';
  const lqTopCh = lq.ga4.topChannels[0]?.channel ?? 'N/A';

  return (
    `In the last ${days} days, Wine-Now (th.wine-now.com) recorded ${wn.gsc.clicks.toLocaleString()} organic clicks ` +
    `and ${wn.gsc.impressions.toLocaleString()} impressions with an average SERP position of ${wn.gsc.avgPosition} ` +
    `and CTR of ${wn.gsc.avgCtr}%. GA4 shows ${wn.ga4.sessions.toLocaleString()} sessions, ` +
    `${wn.ga4.users.toLocaleString()} users, and a bounce rate of ${wn.ga4.bounceRate}%. ` +
    `Top keyword: "${wnTopKw}". Top traffic channel: ${wnTopCh}. ` +
    `Overall health: ${wn.health.status}. ` +
    `LIQ9 (th.liq9.com) recorded ${lq.gsc.clicks.toLocaleString()} organic clicks ` +
    `and ${lq.gsc.impressions.toLocaleString()} impressions with avg position ${lq.gsc.avgPosition} ` +
    `and CTR ${lq.gsc.avgCtr}%. GA4: ${lq.ga4.sessions.toLocaleString()} sessions, ` +
    `${lq.ga4.users.toLocaleString()} users, bounce rate ${lq.ga4.bounceRate}%. ` +
    `Top keyword: "${lqTopKw}". Top channel: ${lqTopCh}. Health: ${lq.health.status}. ` +
    `${wn.gsc.clicks > lq.gsc.clicks ? 'Wine-Now outperforms LIQ9 on organic traffic' : 'LIQ9 outperforms Wine-Now on organic traffic'}, ` +
    `while ${wn.gsc.avgPosition < lq.gsc.avgPosition ? 'Wine-Now holds stronger search rankings' : 'LIQ9 holds stronger search rankings'}.`
  );
}

// ─── Default (empty) site data for error fallback ────────────────────────────

function emptySiteData(name: string, url: string, errorMsg: string): SiteData {
  return {
    name,
    url,
    gsc: { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0, topKeywords: [], topPages: [] },
    ga4: { sessions: 0, users: 0, bounceRate: 0, avgSessionDuration: 0, topChannels: [] },
    health: { status: 'critical', notes: [`Data unavailable: ${errorMsg}`] },
    error: errorMsg,
  };
}

// ─── GET /api/summary ─────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const startDate = daysAgo(days);
  const endDate = new Date().toISOString().split('T')[0];

  // Fetch all four upstream endpoints in parallel
  const [gscWn, gscLq, ga4Wn, ga4Lq] = await Promise.all([
    fetch(`${BASE_URL}/api/gsc?days=${days}&site=winenow`).then(r => r.json() as Promise<GscResponse>).catch((e: unknown) => ({ error: String(e) } as GscResponse)),
    fetch(`${BASE_URL}/api/gsc?days=${days}&site=liq9`).then(r => r.json() as Promise<GscResponse>).catch((e: unknown) => ({ error: String(e) } as GscResponse)),
    fetch(`${BASE_URL}/api/ga4?days=${days}&site=winenow`).then(r => r.json() as Promise<Ga4Response>).catch((e: unknown) => ({ error: String(e) } as Ga4Response)),
    fetch(`${BASE_URL}/api/ga4?days=${days}&site=liq9`).then(r => r.json() as Promise<Ga4Response>).catch((e: unknown) => ({ error: String(e) } as Ga4Response)),
  ]);

  // ── Build winenow site data ────────────────────────────────────────────────
  let winenow: SiteData;
  if (gscWn.error || ga4Wn.error) {
    const msg = [gscWn.error, ga4Wn.error].filter(Boolean).join('; ');
    winenow = emptySiteData('Wine-Now', 'https://th.wine-now.com', msg);
  } else {
    const wnGsc: SiteGsc = {
      clicks: gscWn.totals?.clicks ?? 0,
      impressions: gscWn.totals?.impressions ?? 0,
      avgCtr: gscWn.totals?.avgCtr ?? 0,
      avgPosition: gscWn.totals?.avgPosition ?? 0,
      topKeywords: (gscWn.keywords ?? []).slice(0, 10).map(k => ({
        keyword: k.keyword,
        clicks: k.clicks,
        position: k.position,
      })),
      topPages: (gscWn.pages ?? []).slice(0, 5).map(p => ({
        page: p.page,
        clicks: p.clicks,
      })),
    };
    const wnGa4: SiteGa4 = {
      sessions: ga4Wn.totals?.sessions ?? 0,
      users: ga4Wn.totals?.users ?? 0,
      bounceRate: ga4Wn.totals?.bounceRate ?? 0,
      avgSessionDuration: ga4Wn.totals?.avgSessionDuration ?? 0,
      topChannels: (ga4Wn.sources ?? []).slice(0, 5).map(s => ({
        channel: s.channel,
        sessions: s.sessions,
        share: s.share,
      })),
    };
    winenow = {
      name: 'Wine-Now',
      url: 'https://th.wine-now.com',
      gsc: wnGsc,
      ga4: wnGa4,
      health: computeHealth(wnGsc, wnGa4),
    };
  }

  // ── Build liq9 site data ───────────────────────────────────────────────────
  let liq9: SiteData;
  if (gscLq.error || ga4Lq.error) {
    const msg = [gscLq.error, ga4Lq.error].filter(Boolean).join('; ');
    liq9 = emptySiteData('LIQ9', 'https://th.liq9.com', msg);
  } else {
    const lqGsc: SiteGsc = {
      clicks: gscLq.totals?.clicks ?? 0,
      impressions: gscLq.totals?.impressions ?? 0,
      avgCtr: gscLq.totals?.avgCtr ?? 0,
      avgPosition: gscLq.totals?.avgPosition ?? 0,
      topKeywords: (gscLq.keywords ?? []).slice(0, 10).map(k => ({
        keyword: k.keyword,
        clicks: k.clicks,
        position: k.position,
      })),
      topPages: (gscLq.pages ?? []).slice(0, 5).map(p => ({
        page: p.page,
        clicks: p.clicks,
      })),
    };
    const lqGa4: SiteGa4 = {
      sessions: ga4Lq.totals?.sessions ?? 0,
      users: ga4Lq.totals?.users ?? 0,
      bounceRate: ga4Lq.totals?.bounceRate ?? 0,
      avgSessionDuration: ga4Lq.totals?.avgSessionDuration ?? 0,
      topChannels: (ga4Lq.sources ?? []).slice(0, 5).map(s => ({
        channel: s.channel,
        sessions: s.sessions,
        share: s.share,
      })),
    };
    liq9 = {
      name: 'LIQ9',
      url: 'https://th.liq9.com',
      gsc: lqGsc,
      ga4: lqGa4,
      health: computeHealth(lqGsc, lqGa4),
    };
  }

  // ── Comparison ────────────────────────────────────────────────────────────
  const comparison = {
    winner: {
      clicks: pickWinner(winenow.gsc.clicks, liq9.gsc.clicks),
      sessions: pickWinner(winenow.ga4.sessions, liq9.ga4.sessions),
      avgPosition: pickWinner(winenow.gsc.avgPosition, liq9.gsc.avgPosition, true),
    },
    insights: buildInsights(winenow, liq9),
  };

  // ── Claude context ────────────────────────────────────────────────────────
  const claudeContext = buildClaudeContext(winenow, liq9, days);

  const response: SummaryResponse = {
    generatedAt: new Date().toISOString(),
    period: { days, startDate, endDate },
    sites: { winenow, liq9 },
    comparison,
    claudeContext,
  };

  return NextResponse.json(response);
}
