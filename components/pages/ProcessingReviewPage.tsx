'use client';
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

type Stats = { total: number; validated: number; needs_review: number; needs_attention: number; blocked: number };
type PipelineStatus = {
  status: 'idle' | 'running' | 'error';
  current_step: string | null;
  progress: { done: number; total: number };
  tokens_used: number;
  last_run: string | null;
  last_summary: Record<string, any> | null;
};

export function ProcessingReviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadAll() {
    const [s, l, p] = await Promise.all([
      fetch('/api/batch-process-db?action=stats').then(r => r.json()),
      fetch('/api/batch-process-db?action=logs').then(r => r.json()),
      fetch('/api/enrich/status').then(r => r.json()),
    ]);
    setStats(s);
    setLogs(l.logs ?? []);
    setPipeline(p);
    return p as PipelineStatus;
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const p = await fetch('/api/enrich/status').then(r => r.json()) as PipelineStatus;
      setPipeline(p);
      if (p.status !== 'running') {
        stopPolling();
        setRunning(false);
        const s = await fetch('/api/batch-process-db?action=stats').then(r => r.json());
        setStats(s);
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => {
    loadAll().then(p => { if (p.status === 'running') { setRunning(true); startPolling(); } });
    return stopPolling;
  }, []);

  async function handleRunPipeline() {
    setRunning(true);
    await fetch('/api/enrich/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    startPolling();
  }

  const pct = pipeline && pipeline.progress.total > 0
    ? Math.round((pipeline.progress.done / pipeline.progress.total) * 100)
    : 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Processing Review</h1>
        <button
          onClick={handleRunPipeline}
          disabled={running}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Play size={14} />
          {running ? 'Running…' : 'Run Enrichment'}
        </button>
      </div>

      {pipeline?.status === 'running' && (
        <div className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-xl p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-violet-300">{pipeline.current_step?.replace(/_/g, ' ') ?? 'Processing…'}</span>
            <span className="text-violet-300">{pipeline.progress.done} / {pipeline.progress.total}</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div className="bg-violet-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          {pipeline.tokens_used > 0 && (
            <p className="text-xs text-slate-500 mt-2">Tokens used: {pipeline.tokens_used.toLocaleString()}</p>
          )}
        </div>
      )}

      {pipeline?.last_summary && pipeline.status !== 'running' && (
        <div className="mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-2">
            Last enrichment — {pipeline.last_run ? new Date(pipeline.last_run).toLocaleString() : '—'}
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Auto-validated', value: pipeline.last_summary.autoValidated },
              { label: 'In queue', value: pipeline.last_summary.sentToQueue },
              { label: 'Needs attention', value: pipeline.last_summary.needsAttention },
              { label: 'Tokens used', value: (pipeline.last_summary.tokensUsed ?? 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Total', value: stats.total },
            { label: 'Validated', value: stats.validated },
            { label: 'Needs review', value: stats.needs_review },
            { label: 'Needs attention', value: stats.needs_attention },
            { label: 'Blocked (legacy)', value: stats.blocked },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-2xl font-semibold text-white mt-1">{value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-medium text-slate-300 mb-3">Recent batch logs</h2>
      <div className="space-y-2">
        {logs.length === 0 && <p className="text-slate-500 text-sm">No batch logs yet.</p>}
        {logs.map((log: any, i: number) => (
          <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-white">{log.source_file}</p>
              <p className="text-xs text-slate-400 mt-0.5">{log.timestamp}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-300">{log.processed_rows} / {log.total_rows} rows</p>
              <p className="text-xs text-slate-500 mt-0.5">{log.status}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
