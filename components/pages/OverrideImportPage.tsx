'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

type DiffRow = { sku: string; productId: string; changes: Array<{ field: string; oldValue: string; newValue: string }> };
type PreviewResult = { matched: DiffRow[]; unmatched: string[]; ignoredColumns: string[] };
type Stage = 'idle' | 'loading' | 'preview' | 'confirming' | 'done' | 'error';

export function OverrideImportPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStage('loading');
    setError(null);
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    const res = await fetch('/api/override-import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: text }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setStage('error'); return; }
    setPreview(json);
    setStage('preview');
  }

  async function handleConfirm() {
    if (!note.trim()) return;
    setStage('confirming');
    const res = await fetch('/api/override-import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText, note, batchId: fileName }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setStage('error'); return; }
    setResult(json);
    setStage('done');
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-white mb-2">Override Import</h1>
      <p className="text-slate-400 text-sm mb-6">Upload a CSV to hard-code overrides to existing products. SKU is used as the match key.</p>

      {stage === 'idle' || stage === 'error' ? (
        <>
          <div
            className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-violet-400 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <Upload size={32} className="mx-auto mb-3 text-slate-500" />
            <p className="text-slate-400 text-sm">Drop a CSV here or click to browse</p>
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
          {stage === 'error' && <p className="mt-4 text-rose-300 text-sm">{error}</p>}
        </>
      ) : stage === 'loading' ? (
        <p className="text-slate-400 text-sm">Parsing and comparing against database…</p>
      ) : stage === 'preview' && preview ? (
        <div>
          <div className="flex gap-4 mb-4">
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-white">{preview.matched.length}</p>
              <p className="text-xs text-slate-400">rows with changes</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-amber-300">{preview.unmatched.length}</p>
              <p className="text-xs text-slate-400">unmatched SKUs</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3 flex-1 text-center">
              <p className="text-2xl font-semibold text-slate-400">{preview.ignoredColumns.length}</p>
              <p className="text-xs text-slate-400">ignored columns</p>
            </div>
          </div>

          {preview.ignoredColumns.length > 0 && (
            <p className="text-xs text-slate-500 mb-4">Ignored columns: {preview.ignoredColumns.join(', ')}</p>
          )}

          <div className="bg-white/5 rounded-xl overflow-hidden mb-4 max-h-80 overflow-y-auto">
            {preview.matched.slice(0, 50).map((row, i) => (
              <div key={i} className="border-b border-white/5 px-4 py-3">
                <p className="text-xs text-white font-mono mb-1">{row.sku}</p>
                {row.changes.map((c, j) => (
                  <p key={j} className="text-xs text-slate-400">
                    <span className="text-slate-300">{c.field}:</span> {c.oldValue || '∅'} → <span className="text-violet-300">{c.newValue}</span>
                  </p>
                ))}
              </div>
            ))}
            {preview.matched.length > 50 && <p className="px-4 py-3 text-xs text-slate-500">…and {preview.matched.length - 50} more rows</p>}
          </div>

          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-1">Batch note (required)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Manual price corrections from supplier sheet 2026-03"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
            />
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStage('idle'); setPreview(null); setNote(''); }}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={!note.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white transition-colors">
              Confirm override ({preview.matched.length} rows)
            </button>
          </div>
        </div>
      ) : stage === 'confirming' ? (
        <p className="text-slate-400 text-sm">Applying overrides…</p>
      ) : stage === 'done' && result ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <p className="text-emerald-300 text-sm font-medium mb-2">Override complete</p>
          <p className="text-slate-400 text-sm">Rows updated: {result.rowsUpdated}</p>
          <p className="text-slate-400 text-sm">Rows skipped (SKU not found): {result.rowsSkipped}</p>
          <button onClick={() => { setStage('idle'); setResult(null); setNote(''); }}
            className="mt-3 text-xs text-violet-400 hover:text-violet-300">
            Import another file
          </button>
        </div>
      ) : null}
    </div>
  );
}
