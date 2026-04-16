'use client';

import { useCallback, useEffect, useState } from 'react';
import { Package, TrendingUp, AlertTriangle, CheckCircle2, MapPin, Wine, Grape, FileText, RefreshCw, ArrowRight, Layers } from 'lucide-react';

interface Overview {
  counts: {
    total: number;
    byStatus: { validated: number; needs_review: number; needs_attention: number; other: number };
    bySegment: { wine: number; spirits: number; beer: number; accessories: number; other: number };
  };
  coverage: {
    fields: Record<string, { filled: number; total: number; pct: number }>;
  };
  pricing: { currency: string; min: number; max: number; median: number; avg: number; count: number } | null;
  topCountries: Array<{ name: string; count: number }>;
  gapsToFill: Record<string, number | string>;
}

interface ChangelogSummary {
  total: number;
  summary: {
    sourceCounts: Record<string, number>;
    pricing: { priceUpCount: number; priceDownCount: number };
  };
}

export function DashboardHomePage({ onNavigate }: { onNavigate: (section: string) => void }) {
  var [data, setData] = useState<Overview | null>(null);
  var [changelog, setChangelog] = useState<ChangelogSummary | null>(null);
  var [loading, setLoading] = useState(true);

  var fetchAll = useCallback(async function () {
    setLoading(true);
    try {
      var [ovRes, clRes] = await Promise.all([
        fetch('/api/products/overview'),
        fetch('/api/changelog?limit=1'),
      ]);
      if (ovRes.ok) setData(await ovRes.json());
      if (clRes.ok) setChangelog(await clRes.json());
    } catch (_e) { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(function () { fetchAll(); }, [fetchAll]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  var c = data.counts;
  var cov = data.coverage.fields;
  var gaps = data.gapsToFill;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">{c.total.toLocaleString()} products across wine, spirits, beer, and accessories</p>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 bg-white/5">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={<Package size={18} />} label="Total Products" value={c.total} color="violet" />
        <MetricCard icon={<CheckCircle2 size={18} />} label="Validated" value={c.byStatus.validated}
          sub={c.total > 0 ? Math.round(c.byStatus.validated / c.total * 100) + '%' : '0%'} color="emerald" />
        <MetricCard icon={<AlertTriangle size={18} />} label="Needs Review" value={c.byStatus.needs_review} color="amber" />
        <MetricCard icon={<TrendingUp size={18} />} label="Total Changes" value={changelog?.total ?? 0}
          sub={changelog?.summary?.sourceCounts ? Object.keys(changelog.summary.sourceCounts).length + ' sources' : ''} color="blue" />
      </div>

      {/* Segment breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Segments */}
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <h3 className="text-sm font-medium text-white mb-3">Product Segments</h3>
          <div className="space-y-2.5">
            <SegmentBar label="Wine" count={c.bySegment.wine} total={c.total} color="bg-red-500/60" />
            <SegmentBar label="Spirits" count={c.bySegment.spirits} total={c.total} color="bg-amber-500/60" />
            <SegmentBar label="Beer" count={c.bySegment.beer} total={c.total} color="bg-yellow-500/60" />
            <SegmentBar label="Accessories" count={c.bySegment.accessories} total={c.total} color="bg-slate-500/60" />
          </div>
        </div>

        {/* Top countries */}
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <h3 className="text-sm font-medium text-white mb-3">Top Countries</h3>
          <div className="space-y-1.5">
            {data.topCountries.slice(0, 8).map(function (tc) {
              return (
                <div key={tc.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-300 w-28 truncate">{tc.name}</span>
                  <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500/40 rounded-full"
                      style={{ width: Math.max(2, (tc.count / (data!.topCountries[0]?.count || 1)) * 100) + '%' }} />
                  </div>
                  <span className="text-xs text-slate-500 w-12 text-right">{tc.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Coverage gauges */}
      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white">Data Coverage</h3>
          <button onClick={function () { onNavigate('products'); }}
            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
            Browse products <ArrowRight size={12} />
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <CoverageGauge label="Country" field={cov.country} icon={<MapPin size={14} />} />
          <CoverageGauge label="Region" field={cov.region} icon={<MapPin size={14} />} />
          <CoverageGauge label="Grape Variety" field={cov.grape_variety} icon={<Grape size={14} />} />
          <CoverageGauge label="Vintage" field={cov.vintage} icon={<Wine size={14} />} />
          <CoverageGauge label="Brand" field={cov.brand} icon={<Package size={14} />} />
          <CoverageGauge label="Flavor Profile" field={cov.flavor_profile} icon={<Layers size={14} />} />
          <CoverageGauge label="Price" field={cov.price} icon={<TrendingUp size={14} />} />
          <CoverageGauge label="Description" field={cov.full_description} icon={<FileText size={14} />} />
        </div>
      </div>

      {/* Gaps quick actions */}
      <div className="rounded-xl border border-white/8 bg-white/3 p-4">
        <h3 className="text-sm font-medium text-white mb-3">Priority Gaps</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <GapCard label="Missing Description" count={typeof gaps.missingDescription === 'number' ? gaps.missingDescription : 0}
            onClick={function () { onNavigate('products'); }} />
          <GapCard label="Missing Flavor Profile" count={typeof gaps.missingFlavorProfile === 'number' ? gaps.missingFlavorProfile : 0}
            onClick={function () { onNavigate('products'); }} />
          <GapCard label="Missing Grape Variety" count={typeof gaps.missingGrape === 'number' ? gaps.missingGrape : 0}
            onClick={function () { onNavigate('products'); }} />
          <GapCard label="Missing Region" count={typeof gaps.missingRegion === 'number' ? gaps.missingRegion : 0}
            onClick={function () { onNavigate('products'); }} />
          <GapCard label="Missing Vintage" count={typeof gaps.missingVintage === 'number' ? gaps.missingVintage : 0}
            onClick={function () { onNavigate('products'); }} />
          <GapCard label="Missing Brand" count={typeof gaps.missingBrand === 'number' ? gaps.missingBrand : 0}
            onClick={function () { onNavigate('products'); }} />
        </div>
      </div>

      {/* Recent activity summary */}
      {changelog && changelog.summary?.sourceCounts && (
        <div className="rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white">Recent Activity</h3>
            <button onClick={function () { onNavigate('changelog'); }}
              className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
              View Change Log <ArrowRight size={12} />
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(changelog.summary.sourceCounts).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) {
              return (
                <div key={entry[0]} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                  <span className="text-xs text-slate-300">{formatSource(entry[0])}</span>
                  <span className="text-sm font-semibold text-white">{entry[1].toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* -- Sub-components -- */

function MetricCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: number; sub?: string; color: string;
}) {
  var colors: Record<string, string> = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <div className={'rounded-xl border p-4 ' + colors[color]}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  );
}

function SegmentBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  var pct = total > 0 ? Math.round(count / total * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-300 w-20">{label}</span>
      <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden">
        <div className={'h-full rounded-full transition-all ' + color} style={{ width: pct + '%' }} />
      </div>
      <span className="text-xs text-slate-400 w-20 text-right">{count.toLocaleString()} <span className="text-slate-600">({pct}%)</span></span>
    </div>
  );
}

function CoverageGauge({ label, field, icon }: {
  label: string; field: { filled: number; total: number; pct: number } | undefined; icon: React.ReactNode;
}) {
  if (!field) return null;
  var pct = field.pct;
  var cls = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : pct >= 20 ? 'text-orange-400' : 'text-rose-400';
  var bg = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : pct >= 20 ? 'bg-orange-500' : 'bg-rose-500';
  return (
    <div className="text-center">
      <div className="relative w-16 h-16 mx-auto mb-2">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" className={bg} strokeWidth="3" strokeDasharray={pct + ', 100'} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={'text-sm font-bold ' + cls}>{pct}%</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 text-slate-400">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="text-[10px] text-slate-600 mt-0.5">{field.filled.toLocaleString()}/{field.total.toLocaleString()}</p>
    </div>
  );
}

function GapCard({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button onClick={onClick}
      className="flex items-center justify-between rounded-lg border border-white/6 bg-white/3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left group">
      <div>
        <p className="text-xs text-slate-300">{label}</p>
        <p className="text-lg font-bold text-white">{count.toLocaleString()}</p>
      </div>
      <ArrowRight size={14} className="text-slate-600 group-hover:text-violet-400 transition-colors" />
    </button>
  );
}

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
