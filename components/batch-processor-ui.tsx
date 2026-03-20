'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CheckCircle, ChevronLeft,
  Download, FileUp, Search, Upload, X,
} from 'lucide-react';
import { parseCsvText } from '@/lib/taxonomy-mappings';
import { processBatch, exportToMagentoCSV, exportToReviewCSV, type BatchProcessing, type NormalizedRow } from '@/lib/batch-processor';

// ── helpers ──────────────────────────────────────────────────────────────────
function pill(status: NormalizedRow['status']) {
  if (status === 'ready') return 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30';
  if (status === 'review') return 'bg-amber-500/20 text-amber-200 border border-amber-500/30';
  return 'bg-rose-500/20 text-rose-200 border border-rose-500/30';
}

function confBar(c: number) {
  const pct = Math.round(c * 100);
  const col = c >= 0.75 ? 'bg-emerald-400' : c >= 0.5 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10">
        <div className={`h-full rounded-full ${col}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function download(content: string, name: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

type LogEntry = { id: string; ts: string; file: string; rows: number; ready: number; format: string };

// ── Main Component ────────────────────────────────────────────────────────────
export function BatchProcessor({ rows: _unused }: { rows?: any[] }) {
  // ── data state
  const [stage, setStage] = useState<'load' | 'process' | 'export'>('load');
  const [batch, setBatch] = useState<BatchProcessing | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [apiTotal, setApiTotal] = useState(0);
  const [apiPage, setApiPage] = useState(0);
  const API_LIMIT = 200;

  // ── selection / filter / view state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'sku' | 'name' | 'confidence' | 'status' | 'country'>('confidence');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [detailRow, setDetailRow] = useState<NormalizedRow | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const PAGE = 50;

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load from CSV upload
  const handleFile = useCallback(async (file: File) => {
    setLoading(true); setLoadError(null);
    try {
      const text = await file.text();
      const csvRows = parseCsvText(text);
      if (csvRows.length < 2) throw new Error('File must have a header row and at least one data row.');
      const headers = csvRows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const records = csvRows.slice(1).map(cells => {
        const rec: Record<string, string> = {};
        headers.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
        return rec;
      }).filter(r => Object.values(r).some(v => v.trim()));
      if (!records.length) throw new Error('No data rows found after header.');
      const result = processBatch(records, file.name);
      setBatch(result); setSourceName(file.name);
      setSelected(new Set()); setDetailRow(null); setPage(0);
      setStage('process');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to parse file.');
    } finally { setLoading(false); }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) handleFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.csv') || f.name.endsWith('.txt'))) handleFile(f);
  }, [handleFile]);

  // ── Load from API
  async function loadFromApi(offset = 0) {
    setLoading(true); setLoadError(null);
    try {
      const res = await fetch(`/api/import-rows?limit=${API_LIMIT}&offset=${offset}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setApiTotal(data.total ?? 0);
      setApiPage(Math.floor(offset / API_LIMIT));
      const result = processBatch(data.rows ?? [], `Magento feed (rows ${offset+1}–${offset + (data.rows?.length ?? 0)})`);
      setBatch(result); setSourceName(`Magento feed`);
      setSelected(new Set()); setDetailRow(null); setPage(0);
      setStage('process');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load from API.');
    } finally { setLoading(false); }
  }

  // ── Apply field suggestion to a row
  function applySuggestion(rowId: string, field: string, value: string) {
    if (!batch) return;
    setBatch(prev => {
      if (!prev) return prev;
      const rows = prev.rows.map(r => {
        if (r.id !== rowId) return r;
        const updated = { ...r, [field]: value, appliedCorrections: { ...r.appliedCorrections, [field]: value } };
        // Recompute status
        updated.status = updated.errors.length > 0 ? 'blocked' : updated.confidence >= 0.75 ? 'ready' : 'review';
        return updated;
      });
      return { ...prev, rows, readyRows: rows.filter(r => r.status === 'ready').length, blockedRows: rows.filter(r => r.status === 'blocked').length };
    });
  }

  // ── Filters
  const categories = useMemo(() => {
    if (!batch) return [];
    return [...new Set(batch.rows.map(r => r.mainCategory).filter(Boolean))].sort();
  }, [batch]);

  const types = useMemo(() => {
    if (!batch) return [];
    const src = batch.rows.map(r => r.wine_type || r.liquor_main_type).filter(Boolean);
    return [...new Set(src)].sort();
  }, [batch]);

  const filtered = useMemo(() => {
    if (!batch) return [];
    let rows = batch.rows;
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (categoryFilter !== 'all') rows = rows.filter(r => r.mainCategory === categoryFilter);
    if (typeFilter !== 'all') rows = rows.filter(r => r.wine_type === typeFilter || r.liquor_main_type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) ||
        r.country.toLowerCase().includes(q) || r.region.toLowerCase().includes(q) ||
        r.grape_variety.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => {
      let av: any = a[sortBy]; let bv: any = b[sortBy];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });
    return rows;
  }, [batch, statusFilter, categoryFilter, typeFilter, search, sortBy, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const selRows = batch?.rows.filter(r => selected.has(r.id)) ?? [];

  // ── Export
  function doExport(format: 'magento' | 'review') {
    const rows = selRows.length > 0 ? selRows : filtered;
    const ts = new Date().toISOString().slice(0, 10);
    let content: string; let filename: string;
    if (format === 'magento') {
      content = exportToMagentoCSV(rows);
      filename = `magento-import-${ts}.csv`;
    } else {
      content = exportToReviewCSV(rows);
      filename = `review-${ts}.csv`;
    }
    download(content, filename);
    setLogs(prev => [{ id: `log-${Date.now()}`, ts: new Date().toISOString(), file: filename, rows: rows.length, ready: rows.filter(r => r.status === 'ready').length, format }, ...prev].slice(0, 20));
    setStage('export');
  }

  // ── Stage 1: Load ────────────────────────────────────────────────────────
  if (stage === 'load') return (
    <div className="mx-auto max-w-2xl py-12 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white">Data Hub</h2>
        <p className="mt-2 text-sm text-slate-400">Upload a CSV file or load directly from the Magento product feed to begin processing.</p>
      </div>

      {/* Upload zone */}
      <label
        onDrop={onDrop} onDragOver={e => e.preventDefault()}
        className="group flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-white/20 bg-white/3 p-12 text-center cursor-pointer hover:border-violet-400/50 hover:bg-violet-500/5 transition-colors"
      >
        <FileUp size={36} className="text-slate-500 group-hover:text-violet-300 transition-colors" />
        <div>
          <p className="text-base font-medium text-white">Drop CSV here or click to browse</p>
          <p className="mt-1 text-sm text-slate-400">Supports Magento-style exports and any CSV with product data</p>
        </div>
        <span className="rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white group-hover:bg-violet-400">Choose file</span>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="sr-only" onChange={onFileChange} />
      </label>

      {/* Or load from API */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-slate-500">or</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm font-semibold text-white mb-1">Load from Magento feed</p>
        <p className="text-xs text-slate-400 mb-4">Loads up to 200 rows at a time from the server-side product database.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadFromApi(0)}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
          >
            <Upload size={14} /> Load Magento rows 1–200
          </button>
          {apiTotal > API_LIMIT && (
            <span className="text-xs text-slate-400">{apiTotal.toLocaleString()} total rows available</span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-300">{loadError}</div>
      )}
      {loading && (
        <div className="text-center text-sm text-slate-400 animate-pulse">Processing…</div>
      )}
    </div>
  );

  // ── Stage 2/3: Process & Export ──────────────────────────────────────────
  if (!batch) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-slate-900/60 px-6 py-3">
        <button onClick={() => { setStage('load'); setBatch(null); }} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
          <ChevronLeft size={13} /> New batch
        </button>
        <span className="text-xs text-slate-500 truncate max-w-xs">{sourceName}</span>
        <div className="ml-auto flex items-center gap-3">
          {/* Stats */}
          <span className="text-xs font-medium text-emerald-400">{batch.readyRows} ready</span>
          <span className="text-xs font-medium text-amber-400">{batch.reviewRows} review</span>
          <span className="text-xs font-medium text-rose-400">{batch.blockedRows} blocked</span>
          <span className="h-3 w-px bg-white/10" />
          <button onClick={() => doExport('magento')} className="flex items-center gap-1.5 rounded-xl bg-violet-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-400">
            <Download size={12} /> Export Magento CSV {selRows.length > 0 ? `(${selRows.length} selected)` : '(all ready)'}
          </button>
          <button onClick={() => doExport('review')} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300 hover:text-white">
            <Download size={12} /> Review CSV
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: row list ── */}
        <div className="flex w-[380px] shrink-0 flex-col border-r border-white/10">
          {/* Filters */}
          <div className="space-y-2 border-b border-white/10 p-3">
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder="SKU, name, country, grape…"
                className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none" />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white">
                <option value="all">All status</option>
                <option value="ready">Ready</option>
                <option value="review">Review</option>
                <option value="blocked">Blocked</option>
              </select>
              <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white">
                <option value="all">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white">
                <option value="all">All types</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                className="flex-1 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white">
                <option value="confidence">Sort: Confidence</option>
                <option value="sku">Sort: SKU</option>
                <option value="name">Sort: Name</option>
                <option value="status">Sort: Status</option>
                <option value="country">Sort: Country</option>
              </select>
              <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white hover:bg-white/10">
                {sortDir === 'desc' ? '↓' : '↑'}
              </button>
              <button onClick={() => setSelected(new Set(paged.map(r => r.id)))}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white hover:bg-white/10">
                ✓ Page
              </button>
              <button onClick={() => setSelected(new Set())}
                className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white hover:bg-white/10">
                Clear
              </button>
            </div>
          </div>

          {/* Row count */}
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-1.5 text-xs text-slate-500">
            <span>{filtered.length} shown</span>
            {selected.size > 0 && <span className="text-violet-300">· {selected.size} selected</span>}
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {paged.map(row => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetailRow(detailRow?.id === row.id ? null : row)}
                className={`w-full border-b border-white/5 px-3 py-2.5 text-left transition-colors ${detailRow?.id === row.id ? 'bg-violet-500/10' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={e => {
                    e.stopPropagation();
                    const s = new Set(selected);
                    s.has(row.id) ? s.delete(row.id) : s.add(row.id);
                    setSelected(s);
                  }} onClick={e => e.stopPropagation()} className="mt-0.5 accent-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-mono text-slate-400 truncate">{row.sku}</p>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${pill(row.status)}`}>{row.status}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-white truncate">{row.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                      <span>{row.mainCategory}</span>
                      {row.country && <><span>·</span><span>{row.country}</span></>}
                      {row.grape_variety && <><span>·</span><span className="truncate">{row.grape_variety}</span></>}
                    </div>
                    <div className="mt-1.5">{confBar(row.confidence)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-xs text-slate-500">
            <span>Page {page + 1}/{pageCount}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded px-2 py-1 border border-white/10 disabled:opacity-30 hover:bg-white/5">←</button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} className="rounded px-2 py-1 border border-white/10 disabled:opacity-30 hover:bg-white/5">→</button>
            </div>
          </div>

          {/* API pagination */}
          {sourceName === 'Magento feed' && apiTotal > API_LIMIT && (
            <div className="border-t border-white/10 p-3 text-center">
              <p className="text-xs text-slate-400 mb-2">{apiTotal.toLocaleString()} total Magento rows</p>
              <div className="flex gap-2">
                {apiPage > 0 && <button onClick={() => loadFromApi((apiPage - 1) * API_LIMIT)} className="flex-1 rounded-xl border border-white/10 py-1.5 text-xs text-white hover:bg-white/5">← Prev 200</button>}
                {(apiPage + 1) * API_LIMIT < apiTotal && <button onClick={() => loadFromApi((apiPage + 1) * API_LIMIT)} className="flex-1 rounded-xl border border-white/10 py-1.5 text-xs text-white hover:bg-white/5">Next 200 →</button>}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: detail ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {!detailRow ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-slate-400">Select a row to view details, suggestions, and flavor profile.</p>
              <div className="grid grid-cols-3 gap-4 mt-4 w-full max-w-md">
                {[
                  { label: 'Total', value: batch.totalRows, color: 'text-white' },
                  { label: 'Ready', value: batch.readyRows, color: 'text-emerald-400' },
                  { label: 'Review', value: batch.reviewRows, color: 'text-amber-400' },
                  { label: 'Blocked', value: batch.blockedRows, color: 'text-rose-400' },
                  { label: 'Selected', value: selected.size, color: 'text-violet-300' },
                  { label: 'Filtered', value: filtered.length, color: 'text-cyan-300' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                    <p className="text-xs text-slate-500">{s.label}</p>
                    <p className={`mt-1 text-xl font-semibold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Export history */}
              {logs.length > 0 && (
                <div className="mt-6 w-full max-w-md space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 text-left">Export history</p>
                  {logs.map(l => (
                    <div key={l.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs">
                      <span className="text-white">{l.file}</span>
                      <span className="text-slate-400">{l.rows} rows · {l.ready} ready</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5 max-w-2xl">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-mono text-slate-400">{detailRow.sku}</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{detailRow.name}</h2>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${pill(detailRow.status)}`}>{detailRow.status}</span>
                    <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{detailRow.mainCategory}</span>
                    {detailRow.wine_type && <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{detailRow.wine_type}</span>}
                    {detailRow.liquor_main_type && <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{detailRow.liquor_main_type}</span>}
                  </div>
                </div>
                <button onClick={() => setDetailRow(null)} className="rounded-full p-1 text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              {/* Errors / Warnings */}
              {detailRow.errors.length > 0 && (
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 space-y-1">
                  <p className="text-xs font-semibold text-rose-300 uppercase">Errors</p>
                  {detailRow.errors.map((e, i) => <p key={i} className="text-xs text-rose-200">• {e}</p>)}
                </div>
              )}
              {detailRow.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 space-y-1">
                  <p className="text-xs font-semibold text-amber-300 uppercase">Warnings</p>
                  {detailRow.warnings.map((w, i) => <p key={i} className="text-xs text-amber-200">• {w}</p>)}
                </div>
              )}

              {/* Confidence */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-white">Confidence score</p>
                  <span className="text-sm font-bold text-white">{Math.round(detailRow.confidence * 100)}%</span>
                </div>
                {confBar(detailRow.confidence)}
              </div>

              {/* Product fields */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Normalized fields</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
                  {[
                    ['Brand', detailRow.brand], ['Country', detailRow.country], ['Region', detailRow.region],
                    ['Grape variety', detailRow.grape_variety], ['Grape class', detailRow.grape_class],
                    ['Vintage', detailRow.vintage], ['Bottle size', detailRow.bottle_size],
                    ['Alcohol', detailRow.alcohol], ['Price', `${detailRow.currency} ${detailRow.price}`],
                    ['Cost', `${detailRow.currency} ${detailRow.cost}`], ['In stock', detailRow.is_in_stock ? 'Yes' : 'No'],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <p className="text-slate-500">{label}</p>
                      <p className="text-white font-medium">{value || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Taxonomy suggestions */}
              {Object.entries(detailRow.fieldSuggestions).some(([, s]) => s.suggestions.length > 0) && (
                <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-violet-300 mb-3">Taxonomy suggestions</p>
                  <div className="space-y-3">
                    {Object.entries(detailRow.fieldSuggestions).map(([field, s]) => {
                      if (!s.suggestions.length) return null;
                      return (
                        <div key={field} className="rounded-lg border border-violet-400/15 bg-violet-500/5 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-violet-200 capitalize">{field}</p>
                            <span className="text-xs text-violet-400">{Math.round(s.confidence * 100)}% match</span>
                          </div>
                          <p className="text-xs text-slate-400 mb-2">Original: <span className="text-slate-200">{s.originalValue}</span></p>
                          <div className="flex flex-wrap gap-2">
                            {s.suggestions.map((sugg, i) => (
                              <button key={i} onClick={() => applySuggestion(detailRow.id, field, sugg)}
                                className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-500">
                                {sugg}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Applied corrections */}
              {Object.keys(detailRow.appliedCorrections).length > 0 && (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300 mb-3">Auto-applied corrections</p>
                  <div className="space-y-1.5">
                    {Object.entries(detailRow.appliedCorrections).map(([field, value]) => (
                      <div key={field} className="flex items-center gap-2 text-xs">
                        <CheckCircle size={11} className="text-emerald-400 shrink-0" />
                        <span className="text-slate-400 capitalize">{field}</span>
                        <span className="text-white">→ {value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Flavor profile */}
              {detailRow.flavorNotes.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Auto-assigned flavor profile</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {detailRow.flavorNotes.map(n => (
                      <span key={n} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-200">{n}</span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detailRow.flavorFamilies.map(f => (
                      <span key={f} className="rounded-full border border-violet-400/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-400">{f.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
