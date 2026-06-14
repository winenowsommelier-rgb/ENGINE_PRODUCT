'use client';
import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { mapMagentoCsvToImportRows } from '@/lib/taxonomy/maps';

type ImportState = 'idle' | 'parsing' | 'processing' | 'done' | 'error';

export function ImportPage() {
  const [state, setState] = useState<ImportState>('idle');
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setState('parsing');
    setError(null);
    try {
      const text = await file.text();
      const dataset = mapMagentoCsvToImportRows(text, file.name);

      if (dataset.missingRequiredFields.length > 0) {
        setError(`Missing required columns: ${dataset.missingRequiredFields.join(', ')}`);
        setState('error');
        return;
      }

      setState('processing');
      const res = await fetch('/api/batch-process-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: dataset.rows, source_file: file.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Processing failed');
      setResult(json);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-white mb-6">Import Products</h1>

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a CSV file here or click to browse"
        className="border-2 border-dashed border-white/20 rounded-xl p-12 text-center cursor-pointer hover:border-violet-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <Upload size={32} className="mx-auto mb-3 text-slate-500" />
        <p className="text-slate-400 text-sm">Drop a CSV file here or click to browse</p>
        <p className="text-slate-500 text-xs mt-1">Supports Magento-style CSV with sku, name, price columns</p>
        <input ref={inputRef} type="file" accept=".csv" className="hidden" aria-hidden="true" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      <div aria-live="polite" aria-atomic="true" className="mt-4">
        {state === 'parsing' && <p className="text-slate-400 text-sm">Parsing CSV…</p>}
        {state === 'processing' && <p className="text-slate-400 text-sm">Processing rows through batch pipeline…</p>}
      </div>

      {state === 'error' && (
        <div role="alert" className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
          <p className="text-rose-300 text-sm">{error}</p>
        </div>
      )}

      {state === 'done' && result && (
        <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 space-y-1">
          <p className="text-emerald-300 text-sm font-medium">Import complete</p>
          <p className="text-slate-400 text-sm">Total rows: {result.stats?.total ?? 0}</p>
          <p className="text-slate-400 text-sm">Saved: {result.saved ?? 0}</p>
          <p className="text-slate-400 text-sm">Blocked: {result.stats?.blocked ?? 0}</p>
        </div>
      )}
    </div>
  );
}
