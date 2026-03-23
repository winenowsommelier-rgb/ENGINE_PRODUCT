'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  AlertTriangle, ArrowDown, ArrowUp, Bot, ExternalLink, Globe,
  Loader2, MousePointerClick, RefreshCw, Search, TrendingUp, Zap,
} from 'lucide-react';

// ─── API response types ────────────────────────────────────────────────────────

type GscData = {
  totals: { clicks: number; impressions: number; avgCtr: number; avgPosition: number; keywords: number };
  history: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>;
  keywords: Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }>;
  pages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
};

type Ga4Data = {
  totals: { sessions: number; users: number; bounceRate: number; avgSessionDuration: number; pageViews: number };
  sources: Array<{ channel: string; sessions: number; share: number }>;
  topPages: Array<{ page: string; pageViews: number; sessions: number; bounceRate: number; avgDuration: number }>;
  daily: Array<{ date: string; sessions: number; users: number }>;
  conversions: Array<{ event: string; count: number; perUser: number }>;
};

type AeoData = {
  site: string;
  queriesRun: number;
  mentions: number;
  mentionRate: number;
  responses: Array<{ query: string; mentioned: boolean; mentionedBrands: string[]; snippet: string }>;
  topCompetitors: Array<{ brand: string; count: number }>;
  lastRun: string;
};

type CompetitorData = {
  competitors: Array<{
    id: string; name: string; url: string; tier: 1|2|3|4;
    focus: string; threatLevel: 'high'|'medium'|'low';
    contentGaps: string[]; opportunities: string[];
  }>;
  keyInsights: string[];
  lastUpdated: string;
};

type SiteHealthData = {
  summary: { lowCtrCount: number; quickWinCount: number; overallHealth: 'good'|'needs_attention'|'critical'; topRecommendation: string };
  lowCtrPages: Array<{ page: string; impressions: number; clicks: number; ctr: number; position: number; issue: string }>;
  quickWinKeywords: Array<{ keyword: string; position: number; impressions: number; clicks: number; opportunity: string }>;
  indexHealth: { status: string; note: string };
  coreWebVitals: { status: string; note: string };
};

const SITES = [
  { id: 'winenow', label: 'Wine-Now', gscUrl: 'https://th.wine-now.com/', ga4Id: '386954192' },
  { id: 'liq9',    label: 'LIQ9',     gscUrl: 'https://th.liq9.com/',     ga4Id: '377924618' },
] as const;

// ─── Demo data ─────────────────────────────────────────────────────────────────

const GSC_HISTORY = [
  { week: 'Jan 6',  clicks: 4210, impressions: 58400, ctr: 7.2, position: 14.1 },
  { week: 'Jan 13', clicks: 4580, impressions: 61200, ctr: 7.5, position: 13.8 },
  { week: 'Jan 20', clicks: 4320, impressions: 59800, ctr: 7.2, position: 14.0 },
  { week: 'Jan 27', clicks: 4890, impressions: 64100, ctr: 7.6, position: 13.4 },
  { week: 'Feb 3',  clicks: 5210, impressions: 67300, ctr: 7.7, position: 13.1 },
  { week: 'Feb 10', clicks: 5480, impressions: 69800, ctr: 7.9, position: 12.7 },
  { week: 'Feb 17', clicks: 5120, impressions: 66400, ctr: 7.7, position: 12.9 },
  { week: 'Feb 24', clicks: 5760, impressions: 72100, ctr: 8.0, position: 12.3 },
  { week: 'Mar 3',  clicks: 6020, impressions: 74900, ctr: 8.0, position: 12.1 },
  { week: 'Mar 10', clicks: 6380, impressions: 78200, ctr: 8.2, position: 11.8 },
  { week: 'Mar 17', clicks: 6140, impressions: 76500, ctr: 8.0, position: 12.0 },
  { week: 'Mar 23', clicks: 6710, impressions: 81300, ctr: 8.3, position: 11.5 },
];

const TOP_KEYWORDS = [
  { keyword: 'buy wine online',        clicks: 1240, impressions: 14200, ctr: 8.7, position: 3.2, change: +1.1 },
  { keyword: 'red wine delivery',      clicks:  980, impressions: 12800, ctr: 7.7, position: 4.8, change: -0.3 },
  { keyword: 'best cabernet sauvignon',clicks:  760, impressions: 18400, ctr: 4.1, position: 7.1, change: +0.8 },
  { keyword: 'wine gift sets',         clicks:  640, impressions:  9200, ctr: 7.0, position: 5.4, change: +2.3 },
  { keyword: 'italian wine shop',      clicks:  590, impressions: 11600, ctr: 5.1, position: 8.9, change: -1.2 },
  { keyword: 'champagne delivery',     clicks:  480, impressions:  8700, ctr: 5.5, position: 6.3, change: +0.5 },
  { keyword: 'wine subscription box',  clicks:  420, impressions: 15300, ctr: 2.7, position: 12.4, change: +3.1 },
  { keyword: 'natural wine online',    clicks:  380, impressions:  7400, ctr: 5.1, position: 9.7, change: -0.7 },
  { keyword: 'wine tasting kits',      clicks:  310, impressions:  6200, ctr: 5.0, position: 11.2, change: +1.8 },
  { keyword: 'prosecco case deals',    clicks:  280, impressions:  5800, ctr: 4.8, position: 13.6, change: +0.2 },
];

const TOP_PAGES = [
  { page: '/wines/red/cabernet-sauvignon', clicks: 2140, impressions: 28400, ctr: 7.5, position: 4.1 },
  { page: '/wines/red',                   clicks: 1890, impressions: 24100, ctr: 7.8, position: 3.6 },
  { page: '/gift-sets',                   clicks: 1560, impressions: 19800, ctr: 7.9, position: 4.9 },
  { page: '/champagne',                   clicks: 1240, impressions: 17200, ctr: 7.2, position: 5.3 },
  { page: '/wines/white/chardonnay',      clicks:  980, impressions: 14600, ctr: 6.7, position: 6.8 },
  { page: '/wine-subscription',           clicks:  840, impressions: 24300, ctr: 3.5, position: 14.2 },
  { page: '/blog/best-red-wines',         clicks:  760, impressions: 12100, ctr: 6.3, position: 7.4 },
  { page: '/natural-wine',               clicks:  620, impressions: 11400, ctr: 5.4, position: 9.1 },
];

const RANKING_BUCKETS = [
  { label: 'Top 3',  keywords: 48,  fill: '#10b981' },
  { label: '4–10',   keywords: 124, fill: '#6366f1' },
  { label: '11–20',  keywords: 210, fill: '#f59e0b' },
  { label: '21–50',  keywords: 387, fill: '#ef4444' },
  { label: '50+',    keywords: 892, fill: '#64748b' },
];

const TRAFFIC_SOURCES = [
  { name: 'Organic Search', value: 58, fill: '#6366f1' },
  { name: 'Direct',         value: 19, fill: '#10b981' },
  { name: 'Referral',       value: 11, fill: '#f59e0b' },
  { name: 'Social',         value:  7, fill: '#ec4899' },
  { name: 'Email',          value:  5, fill: '#06b6d4' },
];

const AI_VISIBILITY = [
  {
    llm: 'ChatGPT',      mentions: 34, impressions: 124000, sov: 12.4,
    change: +3.1, color: '#10b981', icon: '🤖',
  },
  {
    llm: 'Perplexity',   mentions: 28, impressions:  89000, sov:  9.8,
    change: +1.8, color: '#6366f1', icon: '🔍',
  },
  {
    llm: 'Claude',       mentions: 21, impressions:  67000, sov:  8.1,
    change: +5.2, color: '#f59e0b', icon: '⚡',
  },
  {
    llm: 'Gemini',       mentions: 17, impressions:  54000, sov:  6.7,
    change: -0.9, color: '#ec4899', icon: '✨',
  },
  {
    llm: 'Copilot',      mentions: 12, impressions:  38000, sov:  4.3,
    change: +0.4, color: '#06b6d4', icon: '🪟',
  },
];

const AI_SOV_HISTORY = [
  { month: 'Oct', ChatGPT: 8.1,  Perplexity: 6.4,  Claude: 2.8,  Gemini: 4.1 },
  { month: 'Nov', ChatGPT: 9.2,  Perplexity: 7.1,  Claude: 3.9,  Gemini: 4.8 },
  { month: 'Dec', ChatGPT: 10.1, Perplexity: 7.8,  Claude: 5.2,  Gemini: 5.3 },
  { month: 'Jan', ChatGPT: 10.8, Perplexity: 8.2,  Claude: 6.1,  Gemini: 5.9 },
  { month: 'Feb', ChatGPT: 11.6, Perplexity: 9.0,  Claude: 7.4,  Gemini: 6.4 },
  { month: 'Mar', ChatGPT: 12.4, Perplexity: 9.8,  Claude: 8.1,  Gemini: 6.7 },
];

// ─── Shared primitives ─────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/8 bg-slate-800/60 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function StatBadge({ value, positive }: { value: number; positive?: boolean }) {
  const up = positive ?? value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
      up ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
    }`}>
      {up ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
      {Math.abs(value)}
    </span>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, trend, trendPositive, color,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; trend?: string; trendPositive?: boolean; color: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-2.5 ${color}`}>
          <Icon size={16} className="text-white" />
        </div>
        {trend && (
          <span className={`text-xs font-medium ${trendPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trend}
          </span>
        )}
      </div>
      <p className="mt-4 text-2xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </Card>
  );
}

// ─── Custom tooltip for charts ─────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 shadow-xl">
      <p className="mb-1.5 text-xs font-medium text-slate-400">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-xs" style={{ color: p.color }}>
          {p.name}: <span className="font-semibold text-white">{p.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Panels ────────────────────────────────────────────────────────────────────

function GscPerformancePanel({ data, loading }: {
  data: typeof GSC_HISTORY; loading: boolean;
}) {
  const [metric, setMetric] = useState<'clicks' | 'impressions' | 'ctr' | 'position'>('clicks');
  const colors = { clicks: '#6366f1', impressions: '#10b981', ctr: '#f59e0b', position: '#ec4899' };
  const labels = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR (%)', position: 'Avg. Position' };

  return (
    <Card>
      <CardHeader
        title="GSC Performance"
        subtitle="Organic search metrics over time"
        action={
          <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs">
            {(['clicks', 'impressions', 'ctr', 'position'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1.5 transition-colors capitalize ${
                  metric === m
                    ? 'bg-violet-500/30 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-5 pb-5">
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="gscGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={colors[metric]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors[metric]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
              <XAxis dataKey="week" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone" dataKey={metric} name={labels[metric]}
                stroke={colors[metric]} strokeWidth={2}
                fill="url(#gscGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function TopKeywordsPanel({ data, loading }: {
  data: typeof TOP_KEYWORDS; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Top Keywords" subtitle="Google Search Console" />
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {['Keyword', 'Clicks', 'Impr.', 'CTR', 'Position', '△ Pos'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-3 font-medium text-white whitespace-nowrap">{row.keyword}</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.clicks.toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-400 tabular-nums">{row.impressions.toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.ctr}%</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.position}</td>
                  <td className="px-5 py-3">
                    {row.change !== 0 && <StatBadge value={row.change} positive={row.change < 0} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function TopPagesPanel({ data, loading }: {
  data: typeof TOP_PAGES; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Top Organic Pages" subtitle="By clicks · Google Search Console" />
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex flex-col gap-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {['Page', 'Clicks', 'Impr.', 'CTR', 'Avg. Pos'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-slate-400 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-3 font-medium text-violet-300 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {row.page}
                      <ExternalLink size={11} className="text-slate-500 shrink-0" />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.clicks.toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-400 tabular-nums">{row.impressions.toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.ctr}%</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{row.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function RankingDistributionPanel() {
  return (
    <Card>
      <CardHeader title="Ranking Distribution" subtitle="Keywords by SERP position bucket" />
      <div className="px-5 pb-5">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={RANKING_BUCKETS} barSize={36}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm font-semibold text-white">{payload[0].value} keywords</p>
                  </div>
                ) : null
              }
            />
            <Bar dataKey="keywords" radius={[6, 6, 0, 0]}>
              {RANKING_BUCKETS.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap gap-3">
          {RANKING_BUCKETS.map(b => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: b.fill }} />
              <span className="text-xs text-slate-400">{b.label}</span>
              <span className="text-xs font-semibold text-white">{b.keywords}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TrafficSourcesPanel({ data, loading }: {
  data: typeof TRAFFIC_SOURCES; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Traffic Sources" subtitle="GA4 sessions by channel" />
      <div className="px-5 pb-5">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                  dataKey="value" paddingAngle={3} stroke="none">
                  {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2.5">
              {data.map(s => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.fill }} />
                    <span className="text-xs text-slate-300">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(s.value, 100)}%`, background: s.fill }} />
                    </div>
                    <span className="text-xs font-semibold text-white w-8 text-right">{s.value}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function AiVisibilityPanel({ data, loading, error, onRun, running }: {
  data: AeoData | null; loading: boolean; error: string | null;
  onRun: () => void; running: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="AI Visibility (AEO)"
        subtitle="How often Claude recommends your brand when shoppers ask for wine/liquor in Thailand"
        action={
          <button
            onClick={onRun}
            disabled={running || loading}
            className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1.5 text-[11px] font-medium text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
            {running ? 'Running queries…' : 'Run AEO Check'}
          </button>
        }
      />

      {loading && <div className="px-5 pb-5"><Skeleton className="h-32 w-full" /></div>}

      {error && !loading && (
        <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-300">{error}</p>
        </div>
      )}

      {data && !loading && (
        <div className="px-5 pb-5 space-y-5">
          {/* Mention rate hero */}
          <div className="flex items-center gap-6 rounded-xl border border-white/8 bg-slate-900/60 p-4">
            <div className="text-center">
              <p className="text-4xl font-bold text-white">{data.mentionRate.toFixed(0)}%</p>
              <p className="text-xs text-slate-400 mt-1">mention rate</p>
            </div>
            <div className="h-12 w-px bg-white/10" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-white">
                Claude mentioned your brand in <span className="text-violet-300">{data.mentions}</span> of <span className="text-slate-300">{data.queriesRun}</span> shopper queries
              </p>
              <p className="text-xs text-slate-400">Questions asked as Thai wine/liquor shoppers across {data.queriesRun} real-world searches</p>
            </div>
          </div>

          {/* Per-query breakdown */}
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">Query breakdown</p>
            <div className="space-y-1.5">
              {data.responses.map((r, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg bg-white/3 px-3 py-2">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${r.mentioned ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-300 truncate">{r.query}</p>
                    {r.mentionedBrands.length > 0 && (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Brands: {r.mentionedBrands.join(', ')}
                      </p>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold shrink-0 ${r.mentioned ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {r.mentioned ? 'Mentioned' : 'Not mentioned'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top competitors in AI responses */}
          {data.topCompetitors.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">Competitors Claude mentioned most</p>
              <div className="flex flex-wrap gap-2">
                {data.topCompetitors.slice(0, 8).map(c => (
                  <div key={c.brand} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                    <span className="text-xs font-medium text-white capitalize">{c.brand}</span>
                    <span className="text-[10px] text-slate-400">{c.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-600">Last run: {new Date(data.lastRun).toLocaleString()}</p>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="px-5 pb-5 text-center">
          <p className="text-sm text-slate-500">Click &quot;Run AEO Check&quot; to test your brand&apos;s AI visibility</p>
          <p className="text-xs text-slate-600 mt-1">Uses Claude to simulate real shopper questions — requires ANTHROPIC_API_KEY</p>
        </div>
      )}
    </Card>
  );
}

function CompetitorsPanel({ data, loading, error }: {
  data: CompetitorData | null; loading: boolean; error: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const tier1 = data?.competitors.filter(c => c.tier === 1) ?? [];
  const tier2plus = data?.competitors.filter(c => c.tier >= 2) ?? [];

  return (
    <Card>
      <CardHeader title="Competitor Intelligence" subtitle="Thai wine & liquor market — 14 tracked competitors" />
      <div className="px-5 pb-5 space-y-4">
        {loading && <Skeleton className="h-48 w-full" />}
        {error && <p className="text-xs text-amber-400">{error}</p>}

        {data?.keyInsights && data.keyInsights.length > 0 && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4">
            <p className="text-xs font-semibold text-violet-300 mb-2">Strategic Insights</p>
            <ul className="space-y-1.5">
              {data.keyInsights.map((insight, i) => (
                <li key={i} className="text-xs text-slate-300 flex gap-2">
                  <span className="text-violet-400 shrink-0">•</span>
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tier 1 — Direct threats */}
        {tier1.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Tier 1 — Direct competitors</p>
            <div className="space-y-2">
              {tier1.map(c => (
                <div key={c.id} className="rounded-xl border border-white/8 bg-slate-900/40 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/3 transition-colors"
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-rose-400" />
                      <div>
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        <p className="text-[10px] text-slate-500">{c.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-rose-300 font-medium">High threat</span>
                      <span className="text-slate-600 text-xs">{expanded === c.id ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {expanded === c.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                      <p className="text-xs text-slate-400 pt-3">{c.focus}</p>
                      {c.contentGaps.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Content gaps to cover</p>
                          <div className="flex flex-wrap gap-1.5">
                            {c.contentGaps.map((g, i) => (
                              <span key={i} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">{g}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {c.opportunities.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Your opportunities</p>
                          <ul className="space-y-1">
                            {c.opportunities.map((o, i) => (
                              <li key={i} className="text-xs text-emerald-300 flex gap-1.5"><span>→</span>{o}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tier 2+ summary */}
        {tier2plus.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Tier 2–4 — Indirect competitors</p>
            <div className="flex flex-wrap gap-2">
              {tier2plus.map(c => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-slate-900/40 px-3 py-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${c.tier === 2 ? 'bg-amber-400' : 'bg-slate-500'}`} />
                  <span className="text-xs text-slate-300">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!data && !loading && (
          <p className="text-xs text-slate-500 text-center py-4">Competitor data will load automatically</p>
        )}
      </div>
    </Card>
  );
}

function SiteHealthPanel({ data, loading, error }: {
  data: SiteHealthData | null; loading: boolean; error: string | null;
}) {
  const healthColor = {
    good: 'text-emerald-400', needs_attention: 'text-amber-400', critical: 'text-rose-400',
  };
  const healthBg = {
    good: 'bg-emerald-500/15', needs_attention: 'bg-amber-500/15', critical: 'bg-rose-500/15',
  };

  return (
    <Card>
      <CardHeader title="Site Health" subtitle="CTR issues, quick-win keywords & indexing" />
      <div className="px-5 pb-5 space-y-5">
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <p className="text-xs text-amber-400">{error}</p>}

        {data && (
          <>
            {/* Overall health badge */}
            <div className={`flex items-center gap-3 rounded-xl p-4 ${healthBg[data.summary.overallHealth]}`}>
              <span className={`text-2xl font-bold capitalize ${healthColor[data.summary.overallHealth]}`}>
                {data.summary.overallHealth.replace('_', ' ')}
              </span>
              <div className="flex-1 text-xs text-slate-300">{data.summary.topRecommendation}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-slate-900/40 p-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{data.summary.lowCtrCount}</p>
                <p className="text-xs text-slate-400 mt-1">Low CTR pages</p>
                <p className="text-[10px] text-slate-600">Need meta improvements</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-slate-900/40 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{data.summary.quickWinCount}</p>
                <p className="text-xs text-slate-400 mt-1">Quick-win keywords</p>
                <p className="text-[10px] text-slate-600">Position 11–30, high impressions</p>
              </div>
            </div>

            {/* Quick wins */}
            {data.quickWinKeywords.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">Quick-win keywords — almost page 1</p>
                <div className="space-y-1.5">
                  {data.quickWinKeywords.slice(0, 8).map((k, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-emerald-500/8 px-3 py-2">
                      <span className="text-xs font-medium text-white flex-1 truncate">{k.keyword}</span>
                      <span className="text-xs text-emerald-300 font-semibold shrink-0">#{k.position.toFixed(0)}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{k.impressions.toLocaleString()} impr</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Low CTR pages */}
            {data.lowCtrPages.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">Pages needing meta/title work</p>
                <div className="space-y-1.5">
                  {data.lowCtrPages.slice(0, 6).map((p, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-amber-500/8 px-3 py-2">
                      <span className="text-xs text-violet-300 flex-1 truncate">{p.page}</span>
                      <span className="text-[10px] text-amber-300 shrink-0">{p.ctr}% CTR</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{p.impressions.toLocaleString()} impr</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ConversionsPanel({ data, loading }: { data: Ga4Data | null; loading: boolean }) {
  const conversions = data?.conversions ?? [];
  return (
    <Card>
      <CardHeader title="Conversion Events" subtitle="GA4 key actions & purchase funnel" />
      <div className="px-5 pb-5">
        {loading && <Skeleton className="h-32 w-full" />}
        {!loading && conversions.length === 0 && (
          <p className="text-xs text-slate-500 py-4 text-center">No conversion events found — make sure GA4 events are configured</p>
        )}
        {!loading && conversions.length > 0 && (
          <div className="space-y-2">
            {conversions.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-violet-400" />
                  <span className="text-sm font-medium text-white">{c.event}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-white">{c.count.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400">{c.perUser}/user</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/8 ${className}`} />;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function SeoCommandCenter() {
  const [dateRange, setDateRange] = useState('90d');
  const [siteId, setSiteId] = useState<'winenow' | 'liq9'>('winenow');
  const [gsc, setGsc] = useState<GscData | null>(null);
  const [ga4, setGa4] = useState<Ga4Data | null>(null);
  const [aeo, setAeo] = useState<AeoData | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorData | null>(null);
  const [siteHealth, setSiteHealth] = useState<SiteHealthData | null>(null);
  const [gscError, setGscError] = useState<string | null>(null);
  const [ga4Error, setGa4Error] = useState<string | null>(null);
  const [competitorsError, setCompetitorsError] = useState<string | null>(null);
  const [siteHealthError, setSiteHealthError] = useState<string | null>(null);
  const [aeoError, setAeoError] = useState<string | null>(null);
  const [aeoRunning, setAeoRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  const days = dateRange === '30d' ? 30 : dateRange === '6m' ? 180 : dateRange === '12m' ? 365 : 90;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setGscError(null);
    setGa4Error(null);

    const site = SITES.find(s => s.id === siteId)!;

    await Promise.all([
      fetch(`/api/gsc?days=${days}&site=${siteId}`)
        .then(r => r.json())
        .then((d: GscData & { error?: string }) => {
          if (d.error) setGscError(d.error); else setGsc(d);
        })
        .catch(e => setGscError(e.message)),

      fetch(`/api/ga4?days=${days}&site=${siteId}`)
        .then(r => r.json())
        .then((d: Ga4Data & { error?: string }) => {
          if (d.error) setGa4Error(d.error); else setGa4(d);
        })
        .catch(e => setGa4Error(e.message)),

      fetch(`/api/competitors?site=${siteId}`)
        .then(r => r.json())
        .then((d: CompetitorData & { error?: string }) => {
          if (d.error) setCompetitorsError(d.error); else setCompetitors(d);
        })
        .catch(e => setCompetitorsError(e.message)),

      fetch(`/api/site-health?site=${siteId}`)
        .then(r => r.json())
        .then((d: SiteHealthData & { error?: string }) => {
          if (d.error) setSiteHealthError(d.error); else setSiteHealth(d);
        })
        .catch(e => setSiteHealthError(e.message)),
    ]);

    setLoading(false);
    void site;
  }, [days, siteId]);

  async function runAeoCheck() {
    setAeoRunning(true);
    setAeoError(null);
    try {
      const d = await fetch(`/api/aeo?site=${siteId}`).then(r => r.json()) as AeoData & { error?: string };
      if (d.error) setAeoError(d.error); else setAeo(d);
    } catch (e) {
      setAeoError(e instanceof Error ? e.message : 'Failed');
    }
    setAeoRunning(false);
  }

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Merge real + demo data — real takes priority
  const gscHistory = gsc?.history.map(h => ({
    week: h.date.slice(5), // MM-DD
    clicks: h.clicks,
    impressions: h.impressions,
    ctr: h.ctr,
    position: h.position,
  })) ?? GSC_HISTORY;

  const topKeywords = gsc?.keywords.map(k => ({
    keyword: k.keyword,
    clicks: k.clicks,
    impressions: k.impressions,
    ctr: k.ctr,
    position: k.position,
    change: 0,
  })) ?? TOP_KEYWORDS;

  const topPages = gsc?.pages.map(p => ({
    page: p.page,
    clicks: p.clicks,
    impressions: p.impressions,
    ctr: p.ctr,
    position: p.position,
  })) ?? TOP_PAGES;

  const trafficSources = ga4?.sources.map((s, i) => ({
    name: s.channel,
    value: s.share,
    fill: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'][i] ?? '#64748b',
  })) ?? TRAFFIC_SOURCES;

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">SEO + AEO Command Center</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            All traffic data in one place — organic search, AI visibility & more
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">

          {/* Site switcher */}
          <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs">
            {SITES.map(s => (
              <button
                key={s.id}
                onClick={() => setSiteId(s.id)}
                className={`px-3 py-2 transition-colors font-medium ${
                  siteId === s.id
                    ? 'bg-emerald-500/25 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Date range selector */}
          <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs">
            {['30d', '90d', '6m', '12m'].map(r => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-2 transition-colors ${
                  dateRange === r
                    ? 'bg-violet-500/30 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            {loading
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />
            }
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── API errors ── */}
      {(gscError || ga4Error) && (
        <div className="flex flex-col gap-2">
          {gscError && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-xs font-semibold text-amber-300">GSC not connected</p>
                <p className="text-xs text-amber-400/80">{gscError} — showing demo data</p>
              </div>
            </div>
          )}
          {ga4Error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-xs font-semibold text-amber-300">GA4 not connected</p>
                <p className="text-xs text-amber-400/80">{ga4Error} — showing demo data</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Organic Clicks"
          value={loading ? '…' : (gsc?.totals.clicks ?? 6710).toLocaleString()}
          sub={`Last ${days} days`}
          icon={MousePointerClick}
          color="bg-violet-500/20"
        />
        <KpiCard
          label="Impressions"
          value={loading ? '…' : (gsc?.totals.impressions ?? 81300).toLocaleString()}
          sub={`Last ${days} days`}
          icon={Search}
          color="bg-indigo-500/20"
        />
        <KpiCard
          label="Avg. Position"
          value={loading ? '…' : String(gsc?.totals.avgPosition ?? 11.5)}
          sub="Average SERP position"
          icon={TrendingUp}
          color="bg-emerald-500/20"
        />
        <KpiCard
          label="AI Mentions"
          value="112"
          sub="Across 5 LLMs this month"
          icon={Bot}
          trend="▲ 18.4%"
          trendPositive
          color="bg-fuchsia-500/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="GA4 Sessions"
          value={loading ? '…' : (ga4?.totals.sessions ?? 0).toLocaleString()}
          sub={`Last ${days} days`}
          icon={Globe}
          color="bg-cyan-500/20"
        />
        <KpiCard
          label="Organic Keywords"
          value={loading ? '…' : (gsc?.totals.keywords ?? 1661).toLocaleString()}
          sub="Ranking keywords"
          icon={Search}
          color="bg-sky-500/20"
        />
        <KpiCard
          label="Avg. CTR"
          value={loading ? '…' : `${gsc?.totals.avgCtr ?? 8.3}%`}
          sub="GSC click-through rate"
          icon={MousePointerClick}
          color="bg-amber-500/20"
        />
        <KpiCard
          label="Bounce Rate"
          value={loading ? '…' : `${ga4?.totals.bounceRate ?? 0}%`}
          sub="GA4 bounce rate"
          icon={Zap}
          color="bg-rose-500/20"
        />
      </div>

      {/* ── GSC performance chart ── */}
      <GscPerformancePanel data={gscHistory} loading={loading} />

      {/* ── AI Visibility (AEO) — real Claude-powered ── */}
      <AiVisibilityPanel
        data={aeo} loading={false} error={aeoError}
        onRun={runAeoCheck} running={aeoRunning}
      />

      {/* ── Site health + Conversions side by side ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SiteHealthPanel data={siteHealth} loading={loading} error={siteHealthError} />
        <ConversionsPanel data={ga4} loading={loading} />
      </div>

      {/* ── Keywords + Rankings side by side ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TopKeywordsPanel data={topKeywords} loading={loading} />
        </div>
        <div className="flex flex-col gap-4">
          <RankingDistributionPanel />
          <TrafficSourcesPanel data={trafficSources} loading={loading} />
        </div>
      </div>

      {/* ── Top pages ── */}
      <TopPagesPanel data={topPages} loading={loading} />

      {/* ── Competitor intelligence ── */}
      <CompetitorsPanel data={competitors} loading={loading} error={competitorsError} />

      {/* ── Data source status ── */}
      <Card className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Data Sources</p>
        <div className="flex flex-wrap gap-3">
          {[
            { name: 'Google Search Console', status: gscError ? 'error' : gsc ? 'live' : 'pending' },
            { name: 'Google Analytics 4',    status: ga4Error ? 'error' : ga4 ? 'live' : 'pending' },
            { name: 'AEO Engine (Claude)',    status: aeoError ? 'error' : aeo ? 'live' : 'ready to run' },
            { name: 'Competitor Intelligence',status: competitorsError ? 'error' : competitors ? 'live' : 'pending' },
            { name: 'Site Health',           status: siteHealthError ? 'error' : siteHealth ? 'live' : 'pending' },
            { name: 'GA4 Conversions',       status: ga4?.conversions?.length ? 'live' : ga4 ? 'no events' : 'pending' },
            { name: 'Summary API',           status: 'ready' },
            { name: 'Google Ads',            status: 'not configured' },
          ].map(ds => (
            <div key={ds.name}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-slate-900/50 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-full ${
                ds.status === 'live' || ds.status === 'ready' ? 'bg-emerald-400' :
                ds.status === 'error' ? 'bg-rose-400' :
                ds.status === 'pending' || ds.status === 'ready to run' ? 'bg-blue-400 animate-pulse' :
                'bg-slate-500'
              }`} />
              <span className="text-xs text-slate-300">{ds.name}</span>
              <span className="text-[10px] text-slate-500">{ds.status}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
