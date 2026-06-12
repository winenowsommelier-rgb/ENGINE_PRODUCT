'use client';
import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, BarChart2, CheckCircle2, Download, FileWarning, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScoreBreakdown = {
  completeness: number;
  description_quality: number;
  taxonomy_accuracy: number;
  data_consistency: number;
  enrichment_depth: number;
};

type ProductQuality = {
  total: number;
  breakdown: ScoreBreakdown;
  missing: string[];
  issues: string[];
  scope: string;
};

type ScoredProduct = {
  id: string;
  sku: string;
  sku_base: string;
  name: string;
  classification: string;
  country: string;
  vintage: string | null;
  price: number | null;
  enrichment_priority: number | null;
  quality_score: ProductQuality;
};

type TopIssue = { field: string; missing_count: number; pct: number };

type ValidationData = {
  summary: { total: number; avg_score: number; passing: number; failing: number };
  distribution: Record<string, number>;
  top_issues: TopIssue[];
  products: ScoredProduct[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DIST_COLORS: Record<string, string> = {
  '90+': '#22c55e',
  '80-89': '#84cc16',
  '70-79': '#eab308',
  '60-69': '#f97316',
  '<60': '#ef4444',
};

const TIER_OPTIONS = [
  { value: '', label: 'All Tiers' },
  { value: '1', label: 'T1 (Stars)' },
  { value: '2', label: 'T2 (Core)' },
  { value: '3', label: 'T3 (Long Tail)' },
  { value: '5', label: 'T5 (No Sales)' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white/5 rounded-2xl p-5 flex flex-col gap-3 border border-white/10">
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color: color ?? '#8b5cf6' }} />
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative w-32 h-32 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{score}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">avg score</span>
      </div>
    </div>
  );
}

function FieldCompletenessTable({ issues, total }: { issues: TopIssue[]; total: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 text-xs uppercase tracking-wider border-b border-white/10">
            <th scope="col" className="pb-2 pl-3">Field</th>
            <th scope="col" className="pb-2 text-right pr-3">Filled</th>
            <th scope="col" className="pb-2 text-right pr-3">Missing</th>
            <th scope="col" className="pb-2 pr-3 w-48">Coverage</th>
            <th scope="col" className="pb-2 text-right pr-3">%</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(issue => {
            const filled = total - issue.missing_count;
            const pct = total > 0 ? (filled / total) * 100 : 0;
            const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444';
            return (
              <tr key={issue.field} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-2 pl-3 font-mono text-xs text-slate-300">{issue.field}</td>
                <td className="py-2 text-right pr-3 text-xs text-slate-400">{filled.toLocaleString()}</td>
                <td className="py-2 text-right pr-3 text-xs text-rose-400">{issue.missing_count.toLocaleString()}</td>
                <td className="py-2 pr-3">
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </td>
                <td className="py-2 text-right pr-3 text-xs text-slate-400">{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IssuesList({ products }: { products: ScoredProduct[] }) {
  // Compute issue groups
  const vintageIssues = products.filter(p =>
    p.quality_score.issues.some(i => /MAY CHANGE/i.test(i))
  );
  const placeholderIssues = products.filter(p =>
    p.quality_score.issues.some(i => /placeholder/i.test(i))
  );
  const missingItemCategory = products.filter(p =>
    p.quality_score.issues.some(i => /Missing or invalid (classification|item category)/i.test(i))
  );

  // Duplicate SKU detection
  const skuCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.sku) skuCounts[p.sku] = (skuCounts[p.sku] ?? 0) + 1;
  }
  const duplicateSkus = Object.entries(skuCounts).filter(([, c]) => c > 1);

  const issueGroups = [
    {
      label: 'Vintage "MAY CHANGE"',
      icon: AlertTriangle,
      count: vintageIssues.length,
      color: 'text-amber-400',
      items: vintageIssues.slice(0, 5),
    },
    {
      label: 'Placeholder descriptions',
      icon: FileWarning,
      count: placeholderIssues.length,
      color: 'text-rose-400',
      items: placeholderIssues.slice(0, 5),
    },
    {
      label: 'Missing item category',
      icon: XCircle,
      count: missingItemCategory.length,
      color: 'text-orange-400',
      items: missingItemCategory.slice(0, 5),
    },
    {
      label: 'Duplicate SKUs',
      icon: AlertTriangle,
      count: duplicateSkus.length,
      color: 'text-violet-400',
      items: [],
    },
  ];

  return (
    <div className="space-y-4">
      {issueGroups.map(g => (
        <div key={g.label} className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <g.icon size={14} className={g.color} />
              <span className="text-sm font-medium text-slate-200">{g.label}</span>
            </div>
            <span className={`text-sm font-mono font-bold ${g.color}`}>{g.count.toLocaleString()}</span>
          </div>
          {g.items.length > 0 && (
            <div className="space-y-1">
              {g.items.map(p => (
                <div key={p.id ?? p.sku} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono text-slate-400">{p.sku}</span>
                  <span className="truncate">{p.name}</span>
                </div>
              ))}
              {g.count > 5 && (
                <p className="text-xs text-slate-600 mt-1">... and {g.count - 5} more</p>
              )}
            </div>
          )}
          {g.label === 'Duplicate SKUs' && duplicateSkus.length > 0 && (
            <div className="space-y-1">
              {duplicateSkus.slice(0, 8).map(([sku, cnt]) => (
                <div key={sku} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono text-slate-400">{sku}</span>
                  <span className="text-rose-400">{cnt}x</span>
                </div>
              ))}
              {duplicateSkus.length > 8 && (
                <p className="text-xs text-slate-600 mt-1">... and {duplicateSkus.length - 8} more</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProductTable({ products }: { products: ScoredProduct[] }) {
  const [page, setPage] = useState(0);
  const perPage = 25;
  const totalPages = Math.ceil(products.length / perPage);
  const slice = products.slice(page * perPage, (page + 1) * perPage);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 uppercase tracking-wider border-b border-white/10">
              <th scope="col" className="pb-2 pl-3">SKU</th>
              <th scope="col" className="pb-2">Name</th>
              <th scope="col" className="pb-2">Item Category</th>
              <th scope="col" className="pb-2 text-right" title="Overall quality score">Score</th>
              <th scope="col" className="pb-2 text-right" title="Completeness">Comp</th>
              <th scope="col" className="pb-2 text-right" title="Description quality">Desc</th>
              <th scope="col" className="pb-2 text-right" title="Taxonomy accuracy">Tax</th>
              <th scope="col" className="pb-2 text-right" title="Data consistency">Cons</th>
              <th scope="col" className="pb-2 text-right pr-3" title="Enrichment depth">Enr</th>
              <th scope="col" className="pb-2 text-right pr-3">Issues</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(p => {
              const s = p.quality_score.total;
              const scoreColor = s >= 80 ? 'text-emerald-400' : s >= 60 ? 'text-amber-400' : 'text-rose-400';
              return (
                <tr key={p.id ?? p.sku} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-1.5 pl-3 font-mono text-slate-400">{p.sku}</td>
                  <td className="py-1.5 text-slate-300 max-w-[200px] truncate">{p.name}</td>
                  <td className="py-1.5 text-slate-500">{p.classification ?? '-'}</td>
                  <td className={`py-1.5 text-right font-bold ${scoreColor}`}>{s}</td>
                  <td className="py-1.5 text-right text-slate-500">{p.quality_score.breakdown.completeness}</td>
                  <td className="py-1.5 text-right text-slate-500">{p.quality_score.breakdown.description_quality}</td>
                  <td className="py-1.5 text-right text-slate-500">{p.quality_score.breakdown.taxonomy_accuracy}</td>
                  <td className="py-1.5 text-right text-slate-500">{p.quality_score.breakdown.data_consistency}</td>
                  <td className="py-1.5 text-right pr-3 text-slate-500">{p.quality_score.breakdown.enrichment_depth}</td>
                  <td className="py-1.5 text-right pr-3 text-slate-500">{p.quality_score.issues.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 pt-3 text-xs text-slate-500">
          <span>Page {page + 1} of {totalPages} ({products.length} products)</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30"
            >Prev</button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ValidationDashboardPage() {
  const [tier, setTier] = useState('1');
  const [data, setData] = useState<ValidationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = tier ? `?tier=${tier}` : '';
      const res = await fetch(`/api/validation${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tier]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = (mode: 'masterfile' | 'issues') => {
    const qs = tier ? `tier=${tier}&` : '';
    window.open(`/api/validation?${qs}export=${mode}`, '_blank');
  };

  // Distribution chart data
  const chartData = data
    ? Object.entries(data.distribution).map(([bucket, count]) => ({
        bucket,
        count,
        fill: DIST_COLORS[bucket] ?? '#6b7280',
      }))
    : [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Data Validation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quality scoring, gap analysis, and masterfile export</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by BI tier"
            value={tier}
            onChange={e => setTier(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/70"
          >
            {TIER_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
            ))}
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Running...' : 'Run Validation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-sm text-rose-300">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={24} className="animate-spin text-violet-400" />
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={BarChart2}
              label="Total Products"
              value={data.summary.total}
              sub={tier ? `Tier ${tier}` : 'All tiers'}
              color="#8b5cf6"
            />
            <div className="bg-white/5 rounded-2xl p-5 border border-white/10 flex flex-col items-center justify-center">
              <ScoreGauge score={data.summary.avg_score} />
            </div>
            <StatCard
              icon={CheckCircle2}
              label="Passing (75+)"
              value={data.summary.passing}
              sub={data.summary.total > 0
                ? `${((data.summary.passing / data.summary.total) * 100).toFixed(1)}% of total`
                : undefined}
              color="#22c55e"
            />
            <StatCard
              icon={AlertTriangle}
              label="Fields Needing Attention"
              value={data.top_issues.filter(i => i.pct > 20).length}
              sub="Fields missing in > 20% of products"
              color="#f97316"
            />
          </div>

          {/* Distribution chart + Export controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white/5 rounded-2xl p-5 border border-white/10">
              <h2 className="text-sm font-medium text-slate-300 mb-4">Quality Score Distribution</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="bucket" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                      labelStyle={{ color: '#e2e8f0' }}
                      itemStyle={{ color: '#e2e8f0' }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white/5 rounded-2xl p-5 border border-white/10 flex flex-col gap-4">
              <h2 className="text-sm font-medium text-slate-300">Export</h2>
              <button
                onClick={() => handleExport('masterfile')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm hover:bg-emerald-600/30 transition-colors"
              >
                <Download size={14} />
                Export Masterfile (CSV)
              </button>
              <p className="text-[11px] text-slate-600 -mt-2">All products with quality scores, breakdown, and issues</p>
              <button
                onClick={() => handleExport('issues')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-300 text-sm hover:bg-rose-600/30 transition-colors"
              >
                <Download size={14} />
                Export Issues Report
              </button>
              <p className="text-[11px] text-slate-600 -mt-2">Only products scoring below 75</p>

              <div className="mt-auto pt-4 border-t border-white/5">
                <h3 className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Score Legend</h3>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {Object.entries(DIST_COLORS).map(([bucket, color]) => (
                    <div key={bucket} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                      <span className="text-slate-400">{bucket}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Field completeness table */}
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
            <h2 className="text-sm font-medium text-slate-300 mb-4">Field Completeness</h2>
            {data.top_issues.length > 0
              ? <FieldCompletenessTable issues={data.top_issues} total={data.summary.total} />
              : <p className="text-sm text-slate-600">No field gaps detected.</p>
            }
          </div>

          {/* Issues list */}
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
            <h2 className="text-sm font-medium text-slate-300 mb-4">Known Issues</h2>
            <IssuesList products={data.products} />
          </div>

          {/* Product table */}
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
            <h2 className="text-sm font-medium text-slate-300 mb-4">All Products (sorted by score, worst first)</h2>
            <ProductTable products={data.products} />
          </div>
        </>
      )}
    </div>
  );
}
