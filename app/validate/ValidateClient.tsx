'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileCheck2, Download, Loader2, AlertTriangle, CheckCircle2, FlaskConical } from 'lucide-react';

type Row = Record<string, string>;
type Proposal = {
  type: string;
  proposed_value: string;
  parent_path: string;
  status: string;
  canonical?: string;
  recommend_add?: boolean | null;
  confidence?: number;
  evidence?: string;
  occurrences: number;
};
type ApiResult = {
  detectedColumns: Record<string, string>;
  summary: Record<string, number>;
  total: number;
  results: Row[];
  csv: string;
  proposals: Proposal[];
  error?: string;
};

const STATUS_STYLE: Record<string, string> = {
  matched: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  validated: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  corrected: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pending_new_taxonomy: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  needs_review: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};

const TABLE_COLS = [
  'item', 'input_name', 'canonical_name', 'name_status',
  'country', 'region', 'subregion', 'brand',
  'country_status', 'region_status', 'subregion_status', 'brand_status',
  'overall_status', 'notes',
];

export default function ValidateClient() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [research, setResearch] = useState(true);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState<ApiResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (csv: string, name: string) => {
    setLoading(true);
    setError('');
    setData(null);
    setFileName(name);
    try {
      const res = await fetch('/api/validate-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, research }),
      });
      const json = (await res.json()) as ApiResult;
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  }, [research]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => run(String(reader.result ?? ''), file.name);
    reader.readAsText(file);
  }, [run]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const downloadCsv = useCallback(() => {
    if (!data?.csv) return;
    const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `validated_${fileName.replace(/\.[^.]+$/, '') || 'items'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, fileName]);

  const pendingProposals = data?.proposals?.filter((p) => p.status !== 'approved' && p.status !== 'rejected') ?? [];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Validate Supplier List</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/60">
          Drop a supplier CSV. We normalize each item against our product database, validate
          country → region → sub-region and brand against the master taxonomy, and route anything
          unknown to the review queue. Download the validated CSV to process further.
        </p>
      </header>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`panel flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-12 text-center transition
          ${dragging ? 'border-fuchsia-400/60 bg-fuchsia-500/5' : 'hover:border-white/25'}`}
      >
        <UploadCloud className="h-10 w-10 text-white/50" />
        <div className="text-base font-medium text-white">
          {fileName ? fileName : 'Drop a CSV here, or click to choose a file'}
        </div>
        <div className="text-xs text-white/40">
          Supplier column names are auto-detected (name, brand, country, region, sub-region…)
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm text-white/60">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
          <FlaskConical className="h-4 w-4" />
          Research unknown taxonomy online before proposing
        </label>
      </div>

      {loading && (
        <div className="panel mt-6 flex items-center gap-3 px-6 py-5 text-white/70">
          <Loader2 className="h-5 w-5 animate-spin" /> Validating…
        </div>
      )}

      {error && (
        <div className="panel mt-6 flex items-center gap-3 border-red-500/30 bg-red-500/10 px-6 py-5 text-red-200">
          <AlertTriangle className="h-5 w-5" /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary */}
          <section className="mt-6 flex flex-wrap items-center gap-3">
            {Object.entries(data.summary).map(([k, v]) => (
              <span key={k} className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLE[k] ?? 'border-white/15 text-white/70'}`}>
                {k.replace(/_/g, ' ')}: {v}
              </span>
            ))}
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">total: {data.total}</span>
            <button
              onClick={downloadCsv}
              className="ml-auto flex items-center gap-2 rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              <Download className="h-4 w-4" /> Download validated CSV
            </button>
          </section>

          <div className="mt-2 text-xs text-white/40">
            Detected columns: {Object.entries(data.detectedColumns).map(([k, v]) => `${k}→${v}`).join('  ·  ') || 'none'}
          </div>

          {/* Proposals (human-approved queue) */}
          {pendingProposals.length > 0 && (
            <section className="panel mt-6 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fuchsia-200">
                <FileCheck2 className="h-4 w-4" /> {pendingProposals.length} new taxonomy proposal(s) awaiting review
              </h2>
              <p className="mt-1 text-xs text-white/50">
                Unknown values are never auto-added. These were filed to <code>data/db/taxonomy-proposals.json</code> for approval.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-white/40">
                    <tr>
                      <th className="px-2 py-1">type</th><th className="px-2 py-1">value</th>
                      <th className="px-2 py-1">parent</th><th className="px-2 py-1">canonical</th>
                      <th className="px-2 py-1">add?</th><th className="px-2 py-1">conf</th>
                      <th className="px-2 py-1">status</th><th className="px-2 py-1">evidence</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/75">
                    {pendingProposals.map((p, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-2 py-1">{p.type}</td>
                        <td className="px-2 py-1 font-medium">{p.proposed_value}</td>
                        <td className="px-2 py-1 text-white/50">{p.parent_path || '—'}</td>
                        <td className="px-2 py-1">{p.canonical || '—'}</td>
                        <td className="px-2 py-1">{p.recommend_add == null ? '?' : p.recommend_add ? '✓' : '✕'}</td>
                        <td className="px-2 py-1">{p.confidence ? p.confidence.toFixed(2) : '—'}</td>
                        <td className="px-2 py-1">{p.status}</td>
                        <td className="px-2 py-1 text-white/50">{p.evidence || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Results table */}
          <section className="panel mt-6 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-black/30 text-white/40">
                <tr>{TABLE_COLS.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2">{c.replace(/_/g, ' ')}</th>)}</tr>
              </thead>
              <tbody className="text-white/80">
                {data.results.map((r, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                    {TABLE_COLS.map((c) => (
                      <td key={c} className="whitespace-nowrap px-3 py-1.5">
                        {c === 'overall_status' ? (
                          <span className={`rounded border px-2 py-0.5 ${STATUS_STYLE[r[c]] ?? 'border-white/15'}`}>{r[c]}</span>
                        ) : (
                          r[c] || <span className="text-white/20">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Canonical name / country / region / sub-region / brand columns hold the corrected values — feed these downstream.
          </div>
        </>
      )}
    </main>
  );
}
