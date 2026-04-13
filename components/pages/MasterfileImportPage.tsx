'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, Check, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Package, TrendingUp } from 'lucide-react';
import * as XLSX from 'xlsx';

/* ──────────────────────────────────────────────── */

type Stage = 'idle' | 'parsing' | 'preview' | 'confirming' | 'done';

interface DiffChange {
  field: string;
  oldValue: string;
  newValue: string;
  category: string;
}

interface DiffRow {
  sku: string;
  productId: string;
  productName: string;
  changes: DiffChange[];
}

interface NewSku {
  sku: string;
  name: string;
  price: string;
  country: string;
}

interface Summary {
  totalRows: number;
  existingMatched: number;
  withChanges: number;
  newProducts: number;
  totalChanges: number;
  byCategory: Record<string, number>;
  priceUp: number;
  priceDown: number;
  costUp: number;
  costDown: number;
  stockIn: number;
  stockOut: number;
}

/* ──────────────────────────────────────────────── */

export function MasterfileImportPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [matched, setMatched] = useState<DiffRow[]>([]);
  const [newSkus, setNewSkus] = useState<NewSku[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ rowsUpdated: number; totalChanges: number } | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ─────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setError('');
    setStage('parsing');
    setFileName(file.name);

    try {
      let text: string;

      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        // Parse Excel → CSV
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        text = XLSX.utils.sheet_to_csv(ws);
      } else {
        text = await file.text();
      }

      setCsvText(text);

      // Call preview API
      const res = await fetch('/api/masterfile-import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: text }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Preview failed');
      }

      const data = await res.json();
      setMatched(data.matched);
      setNewSkus(data.newSkus);
      setSummary(data.summary);
      setStage('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setStage('idle');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Confirm import ────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (!note.trim()) { setError('Please add an import note'); return; }
    setStage('confirming');
    setError('');

    try {
      const res = await fetch('/api/masterfile-import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, note, fileName }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }

      const data = await res.json();
      setResult(data);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStage('preview');
    }
  }, [csvText, note, fileName]);

  // ── Filter matched rows ───────────────────────

  const filteredMatched = filterCategory === 'all'
    ? matched
    : matched.filter(m => m.changes.some(c => c.category === filterCategory));

  // ── Render ────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Masterfile Import</h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload a masterfile CSV or XLSX to update pricing, stock status, and product data.
          Taste-related fields are skipped.
        </p>
      </div>

      {/* Upload zone */}
      {stage === 'idle' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/15 bg-white/3 p-12 cursor-pointer hover:border-violet-500/40 hover:bg-violet-500/5 transition-all"
        >
          <Upload size={32} className="text-slate-500 mb-3" />
          <p className="text-sm text-slate-300 font-medium">Drop CSV or XLSX here, or click to browse</p>
          <p className="text-xs text-slate-500 mt-1">Accepts .csv, .xlsx, .xls</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* Parsing state */}
      {stage === 'parsing' && (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mr-3" />
          <span className="text-sm text-slate-300">Analyzing {fileName}...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
          <AlertTriangle size={16} className="text-rose-400" />
          <span className="text-sm text-rose-300">{error}</span>
        </div>
      )}

      {/* Preview */}
      {stage === 'preview' && summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard
              label="Products with Changes"
              value={summary.withChanges}
              sub={`of ${summary.existingMatched} matched`}
              icon={<FileSpreadsheet size={18} />}
              color="violet"
            />
            <SummaryCard
              label="Price Changes"
              value={summary.priceUp + summary.priceDown}
              sub={`${summary.priceUp} up, ${summary.priceDown} down`}
              icon={<TrendingUp size={18} />}
              color="amber"
            />
            <SummaryCard
              label="Stock Changes"
              value={summary.stockIn + summary.stockOut}
              sub={`${summary.stockIn} in stock, ${summary.stockOut} out`}
              icon={<Package size={18} />}
              color="emerald"
            />
            <SummaryCard
              label="New Products"
              value={summary.newProducts}
              sub="not in database yet"
              icon={<Upload size={18} />}
              color="blue"
            />
          </div>

          {/* Category breakdown */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="text-sm font-medium text-white mb-3">Changes by Category</h3>
            <div className="flex flex-wrap gap-2">
              <FilterPill
                label={`All (${summary.totalChanges})`}
                active={filterCategory === 'all'}
                onClick={() => setFilterCategory('all')}
              />
              {Object.entries(summary.byCategory).map(([cat, count]) => (
                <FilterPill
                  key={cat}
                  label={`${cat} (${count})`}
                  active={filterCategory === cat}
                  onClick={() => setFilterCategory(cat)}
                />
              ))}
            </div>
          </div>

          {/* Diff table */}
          <div className="rounded-xl border border-white/8 bg-white/3">
            <div className="border-b border-white/8 px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">
                Changed Products ({filteredMatched.length})
              </h3>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {filteredMatched.slice(0, 100).map((row) => (
                <div key={row.sku} className="border-b border-white/5">
                  <button
                    onClick={() => setExpandedSku(expandedSku === row.sku ? null : row.sku)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-white/3 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-violet-400">{row.sku}</span>
                      <span className="text-sm text-white truncate max-w-[300px]">{row.productName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{row.changes.length} changes</span>
                      {expandedSku === row.sku ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                    </div>
                  </button>
                  {expandedSku === row.sku && (
                    <div className="bg-black/20 px-4 py-2 space-y-1">
                      {row.changes.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 py-1 text-xs">
                          <span className="w-32 text-slate-500 font-mono">{c.field}</span>
                          <span className="text-rose-400/70 line-through">{c.oldValue || '(empty)'}</span>
                          <span className="text-slate-600">→</span>
                          <span className="text-emerald-400">{c.newValue}</span>
                          {c.field === 'price' && c.oldValue && (
                            <PriceArrow oldVal={c.oldValue} newVal={c.newValue} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredMatched.length > 100 && (
                <p className="px-4 py-3 text-xs text-slate-500">
                  Showing 100 of {filteredMatched.length} changed products
                </p>
              )}
            </div>
          </div>

          {/* New SKUs preview */}
          {newSkus.length > 0 && (
            <div className="rounded-xl border border-white/8 bg-white/3 p-4">
              <h3 className="text-sm font-medium text-white mb-2">
                New Products ({summary.newProducts} total, showing first {newSkus.length})
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                These SKUs are not in the database yet. They will be skipped in this import — use the regular Import page to add new products.
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {newSkus.slice(0, 20).map(s => (
                  <div key={s.sku} className="flex items-center gap-3 text-xs py-1">
                    <span className="font-mono text-blue-400 w-24">{s.sku}</span>
                    <span className="text-white truncate flex-1">{s.name}</span>
                    <span className="text-slate-500">{s.country}</span>
                    <span className="text-slate-400">฿{s.price}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm section */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Confirm Import</h3>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Import note (e.g., 'MAR31 masterfile update — pricing + stock')"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500/40"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleConfirm}
                disabled={!note.trim()}
                className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply {summary.withChanges} Updates ({summary.totalChanges} field changes)
              </button>
              <button
                onClick={() => { setStage('idle'); setMatched([]); setSummary(null); setError(''); }}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirming */}
      {stage === 'confirming' && (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mr-3" />
          <span className="text-sm text-slate-300">Applying changes...</span>
        </div>
      )}

      {/* Done */}
      {stage === 'done' && result && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
              <Check size={24} className="text-emerald-400" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-white">Import Complete</h3>
          <p className="text-sm text-slate-300">
            Updated <span className="font-semibold text-emerald-400">{result.rowsUpdated}</span> products
            with <span className="font-semibold text-emerald-400">{result.totalChanges}</span> field changes.
          </p>
          <p className="text-xs text-slate-500">All changes have been logged to the changelog.</p>
          <button
            onClick={() => { setStage('idle'); setResult(null); setMatched([]); setSummary(null); setNote(''); }}
            className="mt-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────── */

function SummaryCard({ label, value, sub, icon, color }: {
  label: string; value: number; sub: string; icon: React.ReactNode; color: string;
}) {
  const colors: Record<string, string> = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs opacity-50 mt-0.5">{sub}</p>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-white/5 text-slate-400 border border-white/8 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

function PriceArrow({ oldVal, newVal }: { oldVal: string; newVal: string }) {
  const diff = parseFloat(newVal) - parseFloat(oldVal);
  if (diff === 0 || isNaN(diff)) return null;
  const pct = ((diff / parseFloat(oldVal)) * 100).toFixed(1);
  return diff > 0 ? (
    <span className="flex items-center gap-0.5 text-emerald-400">
      <ArrowUpRight size={12} />+{pct}%
    </span>
  ) : (
    <span className="flex items-center gap-0.5 text-rose-400">
      <ArrowDownRight size={12} />{pct}%
    </span>
  );
}
