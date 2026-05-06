'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight, TrendingUp, Package, DollarSign, History, Filter, RefreshCw, List, Layers, ChevronDown, ChevronRight } from 'lucide-react';

/* ──────────────────────────────────────────────── */

interface ChangelogEntry {
  id: string;
  product_id: string;
  sku: string;
  changed_at: string;
  source: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

interface Summary {
  fieldCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  pricing: {
    priceUpCount: number;
    priceDownCount: number;
    priceUpAvg: number;
    priceDownAvg: number;
    costUpCount: number;
    costDownCount: number;
  };
  stock: {
    stockInCount: number;
    stockOutCount: number;
  };
}

/* ──────────────────────────────────────────────── */

type ViewMode = 'list' | 'batches';

interface Batch {
  key: string;
  source: string;
  note: string | null;
  startedAt: string;
  endedAt: string;
  entries: ChangelogEntry[];
  uniqueSkus: number;
  fieldCounts: Record<string, number>;
}

/** Group entries into batches by (source, note, timestamp rounded to minute). */
function groupIntoBatches(entries: ChangelogEntry[]): Batch[] {
  const map = new Map<string, Batch>();
  for (const e of entries) {
    // Round timestamp down to minute for batch grouping
    const minute = e.changed_at.slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const key = `${e.source}|${e.note ?? ''}|${minute}`;
    let batch = map.get(key);
    if (!batch) {
      batch = {
        key,
        source: e.source,
        note: e.note,
        startedAt: e.changed_at,
        endedAt: e.changed_at,
        entries: [],
        uniqueSkus: 0,
        fieldCounts: {},
      };
      map.set(key, batch);
    }
    batch.entries.push(e);
    if (e.changed_at < batch.startedAt) batch.startedAt = e.changed_at;
    if (e.changed_at > batch.endedAt) batch.endedAt = e.changed_at;
    batch.fieldCounts[e.field] = (batch.fieldCounts[e.field] ?? 0) + 1;
  }
  // Compute unique SKUs per batch
  for (const b of map.values()) {
    b.uniqueSkus = new Set(b.entries.map(e => e.sku)).size;
  }
  // Sort batches by most recent first
  return Array.from(map.values()).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

export function ChangeLogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [fieldFilter, setFieldFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedBatchKeys, setExpandedBatchKeys] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fieldFilter) params.set('field', fieldFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      if (skuFilter) params.set('sku', skuFilter);
      params.set('page', String(page));
      // In batches view, pull more rows so batches include all their entries
      params.set('limit', viewMode === 'batches' ? '500' : '50');

      const res = await fetch(`/api/changelog?${params}`);
      const data = await res.json();
      setEntries(data.entries);
      setSummary(data.summary);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [fieldFilter, sourceFilter, skuFilter, page, viewMode]);

  const batches = useMemo(
    () => viewMode === 'batches' ? groupIntoBatches(entries) : [],
    [entries, viewMode]
  );

  function toggleBatch(key: string) {
    setExpandedBatchKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => { fetchData(); }, [fetchData]);

  // Top changed fields for the bar chart
  const topFields = summary
    ? Object.entries(summary.fieldCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    : [];
  const maxFieldCount = topFields.length > 0 ? topFields[0][1] : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Change Log</h1>
          <p className="text-sm text-slate-400 mt-1">
            Track all product data changes — pricing, stock status, and operational updates.
          </p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            icon={<History size={18} />}
            label="Total Changes"
            value={total}
            color="violet"
          />
          <MetricCard
            icon={<DollarSign size={18} />}
            label="Price Increases"
            value={summary.pricing.priceUpCount}
            sub={summary.pricing.priceUpAvg > 0 ? `avg +฿${summary.pricing.priceUpAvg}` : undefined}
            color="emerald"
          />
          <MetricCard
            icon={<TrendingUp size={18} />}
            label="Price Decreases"
            value={summary.pricing.priceDownCount}
            sub={summary.pricing.priceDownAvg > 0 ? `avg -฿${summary.pricing.priceDownAvg}` : undefined}
            color="rose"
          />
          <MetricCard
            icon={<Package size={18} />}
            label="Stock Status Changes"
            value={summary.stock.stockInCount + summary.stock.stockOutCount}
            sub={`${summary.stock.stockInCount} in / ${summary.stock.stockOutCount} out`}
            color="amber"
          />
        </div>
      )}

      {/* Two-column: bar chart + source breakdown */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Field change distribution */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="text-sm font-medium text-white mb-3">Changes by Field</h3>
            <div className="space-y-2">
              {topFields.map(([field, count]) => (
                <div key={field} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-slate-400 font-mono truncate">{formatField(field)}</span>
                  <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500/40 rounded-full transition-all"
                      style={{ width: `${(count / maxFieldCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 w-12 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Source breakdown */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="text-sm font-medium text-white mb-3">Changes by Source</h3>
            <div className="space-y-3">
              {summary && Object.entries(summary.sourceCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <SourceBadge source={source} />
                      <span className="text-sm text-slate-300">{formatSource(source)}</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{count.toLocaleString()}</span>
                  </div>
                ))
              }
            </div>

            {/* Pricing summary */}
            <div className="mt-6 border-t border-white/8 pt-4">
              <h4 className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Cost Movement</h4>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <ArrowUpRight size={14} className="text-emerald-400" />
                  <span className="text-sm text-slate-300">{summary.pricing.costUpCount} cost increases</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowDownRight size={14} className="text-rose-400" />
                  <span className="text-sm text-slate-300">{summary.pricing.costDownCount} cost decreases</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Filter size={14} />
          <span className="text-xs">Filters:</span>
        </div>
        <input
          type="text"
          value={skuFilter}
          onChange={(e) => { setSkuFilter(e.target.value); setPage(1); }}
          placeholder="Search SKU..."
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none w-36"
        />
        <select
          value={fieldFilter}
          onChange={(e) => { setFieldFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white outline-none"
        >
          <option value="">All fields</option>
          <option value="price">Price</option>
          <option value="cost">Cost</option>
          <option value="special_price">Special Price</option>
          <option value="is_in_stock">Stock Status</option>
          <option value="name">Name</option>
          <option value="country">Country</option>
          <option value="region">Region</option>
          <option value="classification">Item Category</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white outline-none"
        >
          <option value="">All sources</option>
          <option value="enrichment">Enrichment Agent</option>
          <option value="bi_sync">BI Sync</option>
          <option value="manual_edit">Manual Edit</option>
          <option value="override_import">Override Import</option>
          <option value="batch_process">Batch Process</option>
          <option value="taxonomy_queue">Taxonomy Queue</option>
          <option value="system">System</option>
          <option value="masterfile_import">Masterfile Import (legacy)</option>
        </select>

        {/* View mode toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${viewMode === 'list' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-white'}`}
            title="Show individual field changes"
          >
            <List size={12} /> List
          </button>
          <button
            onClick={() => setViewMode('batches')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${viewMode === 'batches' ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-white'}`}
            title="Group changes by batch (source + minute)"
          >
            <Layers size={12} /> Batches
          </button>
        </div>
      </div>

      {/* Batches view */}
      {viewMode === 'batches' && (
        <div className="space-y-2">
          {loading && <div className="p-8 text-center text-slate-500">Loading...</div>}
          {!loading && batches.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">No changes found</div>
          )}
          {batches.map((batch) => {
            const isExpanded = expandedBatchKeys.has(batch.key);
            const topFields = Object.entries(batch.fieldCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            return (
              <div key={batch.key} className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
                <button
                  onClick={() => toggleBatch(batch.key)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/3 transition-colors"
                >
                  {isExpanded ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SourceBadge source={batch.source} />
                      <span className="text-sm text-white">
                        {batch.uniqueSkus} product{batch.uniqueSkus !== 1 ? 's' : ''} &middot; {batch.entries.length} changes
                      </span>
                      {batch.note && (
                        <span className="text-xs text-slate-400 truncate max-w-md">&ldquo;{batch.note}&rdquo;</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                      <span>{new Date(batch.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="flex gap-2">
                        {topFields.map(([f, c]) => (
                          <span key={f} className="font-mono">
                            <span className="text-slate-300">{f}</span>
                            <span className="text-slate-600">:{c}</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-white/8 max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {batch.entries.map((e) => (
                          <tr key={e.id} className="border-b border-white/4 hover:bg-white/3 transition-colors">
                            <td className="px-4 py-1.5 font-mono text-xs text-violet-400 w-28">{e.sku}</td>
                            <td className="px-4 py-1.5 font-mono text-xs text-slate-300 w-32">{formatField(e.field)}</td>
                            <td className="px-4 py-1.5 text-xs text-rose-400/60 truncate max-w-xs">
                              {e.old_value || <span className="text-slate-600">—</span>}
                            </td>
                            <td className="px-4 py-1.5 text-xs text-emerald-400 truncate max-w-xs">
                              {e.new_value || <span className="text-slate-600">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List view (individual changes) */}
      {viewMode === 'list' && (
        <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left">
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Date</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">SKU</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Field</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Old Value</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">New Value</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No changes found</td></tr>
              ) : entries.map((e) => (
                <tr key={e.id} className="border-b border-white/4 hover:bg-white/3 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(e.changed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                    <span className="ml-1 text-slate-600">
                      {new Date(e.changed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-violet-400">{e.sku}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{formatField(e.field)}</td>
                  <td className="px-4 py-2.5 text-xs text-rose-400/60">
                    {e.field === 'price' || e.field === 'cost'
                      ? e.old_value ? `฿${Number(e.old_value).toLocaleString()}` : '—'
                      : e.old_value || '—'
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs text-emerald-400">
                    {e.field === 'price' || e.field === 'cost'
                      ? e.new_value ? `฿${Number(e.new_value).toLocaleString()}` : '—'
                      : e.new_value || '—'
                    }
                    {e.field === 'price' && e.old_value && e.new_value && (
                      <PriceDiff oldVal={e.old_value} newVal={e.new_value} />
                    )}
                  </td>
                  <td className="px-4 py-2.5"><SourceBadge source={e.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 50 >= total}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────── */

function MetricCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: number; sub?: string; color: string;
}) {
  const colors: Record<string, string> = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    enrichment: 'bg-violet-500/15 text-violet-300',
    bi_sync: 'bg-blue-500/15 text-blue-300',
    manual_edit: 'bg-emerald-500/15 text-emerald-400',
    override_import: 'bg-violet-500/15 text-violet-400',
    batch_process: 'bg-amber-500/15 text-amber-400',
    taxonomy_queue: 'bg-slate-500/15 text-slate-400',
    system: 'bg-slate-600/15 text-slate-400',
    masterfile_import: 'bg-blue-500/15 text-blue-400',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[source] ?? 'bg-white/10 text-slate-400'}`}>
      {formatSource(source)}
    </span>
  );
}

function formatSource(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatField(s: string): string {
  if (s === 'classification') return 'Item Category';
  if (s === 'wine_classification') return 'Classification';
  return s;
}

function PriceDiff({ oldVal, newVal }: { oldVal: string; newVal: string }) {
  const diff = parseFloat(newVal) - parseFloat(oldVal);
  if (diff === 0 || isNaN(diff)) return null;
  const pct = ((diff / parseFloat(oldVal)) * 100).toFixed(1);
  return (
    <span className={`ml-1.5 inline-flex items-center gap-0.5 ${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
      {diff > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {diff > 0 ? '+' : ''}{pct}%
    </span>
  );
}
