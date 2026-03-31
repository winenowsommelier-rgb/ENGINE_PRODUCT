'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Play, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Run Validation Pipeline card
// ---------------------------------------------------------------------------

type RunStatus = 'idle' | 'running' | 'done';
type FilterOption = 'all' | 'raw' | 'validated';

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'raw',       label: 'Raw only' },
  { value: 'validated', label: 'Validated only' },
];

function RunPipelineCard() {
  const [filter, setFilter]     = useState<FilterOption>('all');
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [output, setOutput]     = useState<string>('');

  async function handleRunPipeline() {
    setRunStatus('running');
    setOutput('');
    const body: Record<string, string> = {};
    if (filter === 'raw')       body.status = 'raw';
    if (filter === 'validated') body.status = 'validated';

    try {
      const res = await fetch('/api/run-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setOutput(data.output ?? '');
    } catch (err) {
      setOutput(String(err));
    } finally {
      setRunStatus('done');
    }
  }

  const statusLabel: Record<RunStatus, string> = {
    idle:    'Idle',
    running: 'Running…',
    done:    'Done',
  };
  const statusColor: Record<RunStatus, string> = {
    idle:    'text-slate-500',
    running: 'text-violet-300',
    done:    'text-emerald-300',
  };

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-4">Run Validation Pipeline</h2>

      {/* Filter radio group */}
      <div className="flex items-center gap-4 mb-4">
        {FILTER_OPTIONS.map(opt => (
          <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="pipeline-filter"
              value={opt.value}
              checked={filter === opt.value}
              onChange={() => setFilter(opt.value)}
              className="accent-violet-500"
            />
            <span className="text-xs text-slate-300">{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Run button + status indicator */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRunPipeline}
          disabled={runStatus === 'running'}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Play size={14} />
          {runStatus === 'running' ? 'Running…' : 'Run Pipeline'}
        </button>
        <span className={`text-xs font-medium ${statusColor[runStatus]}`}>
          {statusLabel[runStatus]}
        </span>
      </div>

      {/* Output log */}
      {output && (
        <textarea
          readOnly
          value={output}
          className="w-full h-48 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 resize-y"
        />
      )}
    </div>
  );
}

// Triage Scan Card
function TriageScanCard() {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [output, setOutput] = useState('');
  const [summary, setSummary] = useState<Record<string, any> | null>(null);

  const FLAGS = ['desc_missing','desc_short_only','desc_brand_voice','desc_html','desc_ok','taxonomy_incomplete'];

  async function handleRun() {
    setRunStatus('running');
    setOutput('');
    try {
      const res = await fetch('/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      setOutput(data.output ?? '');
      // Load summary
      const s = await fetch('/api/triage').then(r => r.json());
      if (s.ok) setSummary(s.summary);
    } catch (err) {
      setOutput(String(err));
    } finally {
      setRunStatus('done');
    }
  }

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-4">Stage 2 — Triage Scan</h2>
      <p className="text-xs text-slate-500 mb-4">Scans all primary variants, writes quality flags (desc_missing, brand_voice, taxonomy_incomplete, etc.). No AI credits used.</p>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={runStatus === 'running'}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <RefreshCw size={14} className={runStatus === 'running' ? 'animate-spin' : ''} />
          {runStatus === 'running' ? 'Scanning…' : 'Run Triage Scan'}
        </button>
        <span className={`text-xs font-medium ${runStatus === 'running' ? 'text-violet-300' : runStatus === 'done' ? 'text-emerald-300' : 'text-slate-500'}`}>
          {runStatus === 'idle' ? 'Idle' : runStatus === 'running' ? 'Running…' : 'Done'}
        </span>
      </div>
      {output && (
        <textarea readOnly value={output} className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 resize-y mb-4" />
      )}
      {summary && (
        <div className="overflow-x-auto">
          <table className="text-xs text-slate-300 w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-1.5 pr-4 text-slate-400 font-normal">Category</th>
                {FLAGS.map(f => <th key={f} className="text-right py-1.5 px-2 text-slate-400 font-normal whitespace-nowrap">{f}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.summary ?? {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([cls, counts]: [string, any]) => (
                <tr key={cls} className="border-b border-white/5">
                  <td className="py-1.5 pr-4 text-slate-300 whitespace-nowrap">{cls}</td>
                  {FLAGS.map(f => <td key={f} className="text-right py-1.5 px-2 text-slate-400">{counts[f] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">Last scan: {summary.generated_at ? new Date(summary.generated_at).toLocaleString() : '—'}</p>
        </div>
      )}
    </div>
  );
}

// AI Enrichment Card
function AIEnrichmentCard({ onNavigateToReview }: { onNavigateToReview: () => void }) {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [output, setOutput]   = useState('');
  const [batch, setBatch]     = useState('0');     // 0 = all batches
  const [limit, setLimit]     = useState('');

  const BATCH_OPTIONS = [
    { value: '0', label: 'All batches' },
    { value: '1', label: 'Batch 1 — Red Wine' },
    { value: '2', label: 'Batch 2 — White Wine' },
    { value: '3', label: 'Batch 3 — Rosé / Dessert Wine' },
    { value: '4', label: 'Batch 4 — Sparkling Wine' },
    { value: '5', label: 'Batch 5 — Whisky' },
    { value: '6', label: 'Batch 6 — Other Spirits' },
    { value: '7', label: 'Batch 7 — Beer' },
    { value: '8', label: 'Batch 8 — Sake' },
    { value: '9', label: 'Batch 9 — Accessories / Other' },
  ];

  async function handleRun() {
    setRunStatus('running');
    setOutput('');
    const body: Record<string, any> = {};
    if (batch !== '0') body.batch = batch;
    const l = parseInt(limit);
    if (!isNaN(l) && l > 0) body.limit = l;

    try {
      const res = await fetch('/api/ai-enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setOutput(data.output ?? '');
    } catch (err) {
      setOutput(String(err));
    } finally {
      setRunStatus('done');
    }
  }

  return (
    <div className="mb-8 bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-sm font-medium text-slate-300 mb-1">Stage 3 — AI Enrichment</h2>
      <p className="text-xs text-slate-500 mb-4">Calls Claude for each primary variant — rewrites descriptions and fills taxonomy gaps. Results saved locally for review before publishing.</p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={batch} onChange={e => setBatch(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300">
          {BATCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="number"
          placeholder="Limit (test only)"
          value={limit}
          onChange={e => setLimit(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-36"
        />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={runStatus === 'running'}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Sparkles size={14} />
          {runStatus === 'running' ? 'Running…' : 'Start AI Enrichment'}
        </button>
        {runStatus === 'done' && (
          <button onClick={onNavigateToReview}
            className="text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors">
            Review &amp; Publish →
          </button>
        )}
      </div>

      {output && (
        <textarea readOnly value={output} className="w-full h-48 bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 resize-y" />
      )}
    </div>
  );
}

type Stats = {
  total: number;
  validated: number;
  needs_review: number;
  needs_attention: number;
  blocked: number;
  avg_confidence: number;
};

type PipelineStatus = {
  status: 'idle' | 'running' | 'error';
  migration_done: boolean;
  current_step: string | null;
  progress: { done: number; total: number };
  tokens_used: number;
  last_run: string | null;
  last_summary: Record<string, any> | null;
  stats?: Stats;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  validated:       { label: 'Validated',       color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  needs_review:    { label: 'Needs review',     color: 'text-amber-300',   bg: 'bg-amber-500/10 border-amber-500/30' },
  needs_attention: { label: 'Needs attention',  color: 'text-rose-300',    bg: 'bg-rose-500/10 border-rose-500/30' },
  blocked:         { label: 'Blocked (legacy)', color: 'text-slate-400',   bg: 'bg-white/5 border-white/10' },
};

export function ProcessingReviewPage({ onNavigateToReview }: { onNavigateToReview?: () => void } = {}) {
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus(): Promise<PipelineStatus> {
    const p = await fetch('/api/enrich/status').then(r => r.json()) as PipelineStatus;
    setPipeline(p);
    return p;
  }

  async function fetchLogs() {
    const l = await fetch('/api/batch-process-db?action=logs').then(r => r.json());
    setLogs(l.logs ?? []);
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const p = await fetchStatus();
      if (p.status !== 'running') {
        stopPolling();
        setRunning(false);
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => {
    fetchStatus().then(p => {
      if (p.status === 'running') { setRunning(true); startPolling(); }
    });
    fetchLogs();
    return stopPolling;
  }, []);

  async function handleRun() {
    setRunning(true);
    await fetch('/api/enrich/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await fetchStatus();
    startPolling();
  }

  async function handleResume() {
    await fetch('/api/enrich/status', { method: 'DELETE' });
    await handleRun();
  }

  async function handleClaudeRun() {
    setRunning(true);
    await fetch('/api/enrich/claude-run', { method: 'POST' });
    await fetchStatus();
    startPolling();
  }

  async function handleRefresh() {
    await fetchStatus();
    await fetchLogs();
  }

  const stats = pipeline?.stats;
  const pct = pipeline && pipeline.progress.total > 0
    ? Math.round((pipeline.progress.done / pipeline.progress.total) * 100)
    : 0;

  const pendingCount = (stats?.needs_review ?? 0) + (stats?.needs_attention ?? 0) + (stats?.blocked ?? 0);

  return (
    <div className="p-8">
      {/* Run Validation Pipeline card */}
      <RunPipelineCard />

      {/* Triage Scan card */}
      <TriageScanCard />

      {/* AI Enrichment card */}
      <AIEnrichmentCard onNavigateToReview={onNavigateToReview ?? (() => {})} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Processing Review</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {pipeline?.migration_done ? 'Initial migration complete' : 'Initial migration pending'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} className="text-slate-400 hover:text-slate-200 p-2 rounded-lg hover:bg-white/5 transition-colors">
            <RefreshCw size={15} />
          </button>
          {pipeline?.status === 'error' ? (
            <button onClick={handleResume}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
              <RotateCcw size={14} /> Resume
            </button>
          ) : (
            <>
              {(stats?.needs_review ?? 0) > 0 && !running && (
                <button onClick={handleClaudeRun} disabled={running}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                  <Sparkles size={14} />
                  ✦ Claude {stats!.needs_review} remaining
                </button>
              )}
              <button onClick={handleRun} disabled={running}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                <Play size={14} />
                {running ? 'Running…' : pendingCount > 0 ? `Re-run rules` : 'Run Enrichment'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error / stuck state */}
      {pipeline?.status === 'error' && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 text-sm font-medium">Pipeline stopped</p>
            <p className="text-amber-400/70 text-xs mt-0.5">{pipeline.current_step}</p>
            <p className="text-slate-500 text-xs mt-1">Click Resume — it will continue from where it left off.</p>
          </div>
        </div>
      )}

      {/* Active progress bar */}
      {pipeline?.status === 'running' && (
        <div className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-xl p-5">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-violet-300 font-medium">{pipeline.current_step ?? 'Processing…'}</span>
            <span className="text-violet-300 tabular-nums">{pipeline.progress.done.toLocaleString()} / {pipeline.progress.total.toLocaleString()}</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-3">
            <div
              className="bg-violet-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{pct}% complete — saves every 200 products, safe to restart anytime</p>
        </div>
      )}

      {/* Last run summary */}
      {pipeline?.last_summary && pipeline.status !== 'running' && (
        <div className="mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-3">
            Last run — {pipeline.last_run ? new Date(pipeline.last_run).toLocaleString() : '—'}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Auto-validated', value: pipeline.last_summary.autoValidated, color: 'text-emerald-300' },
              { label: 'Sent to queue', value: pipeline.last_summary.sentToQueue, color: 'text-amber-300' },
              { label: 'Needs attention', value: pipeline.last_summary.needsAttention, color: 'text-rose-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className={`text-2xl font-semibold ${color}`}>{(value ?? 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live database status */}
      {stats && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Database status</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 col-span-2 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Total products</p>
                <p className="text-3xl font-semibold text-white mt-0.5">{stats.total.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Avg confidence</p>
                <p className="text-2xl font-semibold text-white mt-0.5">{Math.round((stats.avg_confidence ?? 0) * 100)}%</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(STATUS_META).map(([key, meta]) => {
              const count = stats[key as keyof Stats] as number ?? 0;
              return (
                <div key={key} className={`border rounded-xl p-4 ${meta.bg}`}>
                  <p className={`text-2xl font-semibold ${meta.color}`}>{count.toLocaleString()}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{meta.label}</p>
                  {stats.total > 0 && (
                    <div className="w-full bg-white/10 rounded-full h-1 mt-2">
                      <div className={`h-1 rounded-full ${meta.color.replace('text-', 'bg-').replace('-300', '-500')}`}
                        style={{ width: `${Math.round((count / stats.total) * 100)}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Batch logs */}
      <h2 className="text-sm font-medium text-slate-300 mb-3">Recent imports</h2>
      <div className="space-y-2">
        {logs.length === 0 && <p className="text-slate-500 text-sm">No batch logs yet.</p>}
        {logs.map((log: any, i: number) => (
          <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-white">{log.source_file}</p>
              <p className="text-xs text-slate-400 mt-0.5">{log.timestamp}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-300">{(log.processed_rows ?? 0).toLocaleString()} / {(log.total_rows ?? 0).toLocaleString()} rows</p>
              <p className="text-xs text-slate-500 mt-0.5">{log.status}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
