'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';

type WorkflowStatus = 'ready' | 'attention' | 'blocked';

type PublishReadiness = {
  generatedAt: string;
  catalog: {
    total: number;
    statusCounts: Record<string, number>;
    ready: number;
    readyPct: number;
    highConfidenceReady: number;
    reviewedButBlocked: number;
    gaps: {
      missingDescription: number;
      missingCountry: number;
      missingRegion: number;
      lowConfidence: number;
    };
  };
  program: {
    overall: {
      total_queue_rows: number;
      completed_items: number;
      overall_pct: number;
      live_ready_rows: number;
    } | null;
    progressLenses: Record<string, { done: number; total: number; pct: number }> | null;
    eta: Record<string, { remaining_rows?: number; eta: string }> | null;
    publishLogs: {
      count: number;
      latest_succeeded: number;
      latest_failed: number;
      latest_timestamp: string;
    } | null;
  };
  quality: {
    issueTotal: number;
    productMaster: Record<string, number>;
    liveUpload: Record<string, number>;
  };
  publish: {
    geographyRows: number;
    previewRows: Array<Record<string, string>>;
  };
  priorities: {
    fastLaneTotal: number;
    fastLane: PriorityRow[];
    gaTopProducts: PriorityRow[];
  };
  workflow: Array<{ id: string; label: string; status: WorkflowStatus; detail: string }>;
  nextActions: Array<{ priority: number; label: string; metric: string; owner: string }>;
};

type PriorityRow = {
  rank: number;
  sku: string;
  name: string;
  brand?: string;
  band?: string;
  priorityBand?: string;
  score?: number;
  priorityScore?: number;
  whyNow?: string;
  taskTypes?: string;
  readiness: 'ready' | 'blocked';
  blockers: string[];
};

export function PublishReadinessPage() {
  const [data, setData] = useState<PublishReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async function () {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/publish-readiness', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Readiness API failed: ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function () { fetchData(); }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const overall = data.program.overall;
  const publishLog = data.program.publishLogs;

  return (
    <div className="max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Publish Readiness</h1>
          <p className="mt-1 text-sm text-slate-400">
            Operational view for QC, fast-lane enrichment, publish batches, and next actions.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<ClipboardList size={17} />}
          label="Program Complete"
          value={overall ? `${overall.overall_pct}%` : 'n/a'}
          sub={overall ? `${overall.completed_items.toLocaleString()} of ${overall.total_queue_rows.toLocaleString()} queued rows` : 'Snapshot unavailable'}
          tone="violet"
        />
        <MetricCard
          icon={<CheckCircle2 size={17} />}
          label="Catalog Ready"
          value={`${data.catalog.readyPct}%`}
          sub={`${data.catalog.ready.toLocaleString()} ready products from ${data.catalog.total.toLocaleString()}`}
          tone="emerald"
        />
        <MetricCard
          icon={<ShieldAlert size={17} />}
          label="QC Issues"
          value={data.quality.issueTotal.toLocaleString()}
          sub="Must clear before final publish treatment"
          tone={data.quality.issueTotal > 0 ? 'amber' : 'emerald'}
        />
        <MetricCard
          icon={<UploadCloud size={17} />}
          label="Publish Batch"
          value={data.publish.geographyRows.toLocaleString()}
          sub={publishLog ? `Latest: ${publishLog.latest_succeeded} ok, ${publishLog.latest_failed} failed` : 'No publish log'}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-lg border border-white/8 bg-white/3 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Operating Workflow</h2>
            <span className="text-xs text-slate-500">Last generated {new Date(data.generatedAt).toLocaleString()}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.workflow.map(step => (
              <WorkflowCard key={step.id} step={step} />
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/8 bg-white/3 p-4">
          <h2 className="mb-4 text-sm font-medium text-white">Next Actions</h2>
          <div className="space-y-2">
            {data.nextActions.map(action => (
              <div key={action.priority} className="flex items-center gap-3 rounded-lg border border-white/6 bg-slate-950/30 px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-200">
                  {action.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{action.label}</p>
                  <p className="text-xs text-slate-500">{action.owner}</p>
                </div>
                <span className="text-xs font-medium text-slate-300">{action.metric}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-white/8 bg-white/3 p-4">
          <h2 className="mb-4 text-sm font-medium text-white">Quality Gate</h2>
          <IssueList
            rows={[
              ['Short descriptions', data.quality.productMaster.short_length ?? 0],
              ['Full description length', data.quality.productMaster.full_length ?? 0],
              ['Template language leaks', data.quality.productMaster.template_language ?? 0],
              ['Missing sources', data.quality.productMaster.missing_sources ?? 0],
              ['Verified without note', data.quality.productMaster.verified_without_note ?? 0],
              ['Weak publish rationale', data.quality.liveUpload.weak_publish_rationale ?? 0],
            ]}
          />
        </section>

        <section className="rounded-lg border border-white/8 bg-white/3 p-4">
          <h2 className="mb-4 text-sm font-medium text-white">Catalog Blockers</h2>
          <IssueList
            rows={[
              ['Missing region', data.catalog.gaps.missingRegion],
              ['Missing country', data.catalog.gaps.missingCountry],
              ['Missing description', data.catalog.gaps.missingDescription],
              ['Low confidence', data.catalog.gaps.lowConfidence],
              ['Validated but blocked', data.catalog.reviewedButBlocked],
              ['High confidence ready', data.catalog.highConfidenceReady],
            ]}
          />
        </section>

        <section className="rounded-lg border border-white/8 bg-white/3 p-4">
          <h2 className="mb-4 text-sm font-medium text-white">Program Lanes</h2>
          <div className="space-y-3">
            {Object.entries(data.program.progressLenses ?? {}).map(([key, lens]) => (
              <ProgressBar key={key} label={formatLabel(key)} done={lens.done} total={lens.total} pct={lens.pct} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PriorityTable title="Fast-Lane Queue" rows={data.priorities.fastLane} scoreLabel="Score" />
        <PriorityTable title="GA Priority Products" rows={data.priorities.gaTopProducts} scoreLabel="Demand" />
      </div>

      <section className="rounded-lg border border-white/8 bg-white/3 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">Current Geography Publish Preview</h2>
          <span className="text-xs text-slate-500">{data.publish.geographyRows.toLocaleString()} total rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Country</th>
                <th className="py-2 pr-3 font-medium">Region</th>
                <th className="py-2 pr-3 font-medium">Subregion</th>
                <th className="py-2 pr-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.publish.previewRows.map(row => (
                <tr key={`${row.sku}-${row.region}-${row.subregion}`} className="border-b border-white/5 text-slate-300">
                  <td className="py-2 pr-3 font-mono text-slate-200">{row.sku}</td>
                  <td className="py-2 pr-3">{row.country || '-'}</td>
                  <td className="py-2 pr-3">{row.region || '-'}</td>
                  <td className="py-2 pr-3">{row.subregion || '-'}</td>
                  <td className="max-w-xl py-2 pr-3 text-slate-500">{row.enrichment_note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'violet' | 'emerald' | 'amber' | 'blue';
}) {
  const tones = {
    violet: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="mb-2 flex items-center gap-2 text-xs opacity-80">{icon}<span>{label}</span></div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs opacity-70">{sub}</p>
    </div>
  );
}

function WorkflowCard({ step }: { step: { label: string; status: WorkflowStatus; detail: string } }) {
  const status = {
    ready: { icon: CheckCircle2, cls: 'text-emerald-300', label: 'Ready' },
    attention: { icon: AlertTriangle, cls: 'text-amber-300', label: 'Attention' },
    blocked: { icon: ShieldAlert, cls: 'text-rose-300', label: 'Blocked' },
  }[step.status];
  const Icon = status.icon;
  return (
    <div className="rounded-lg border border-white/6 bg-slate-950/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-200">{step.label}</p>
        <span className={`flex items-center gap-1 text-xs ${status.cls}`}>
          <Icon size={13} />
          {status.label}
        </span>
      </div>
      <p className="text-xs text-slate-500">{step.detail}</p>
    </div>
  );
}

function IssueList({ rows }: { rows: Array<[string, number]> }) {
  return (
    <div className="space-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-slate-950/30 px-3 py-2">
          <span className="text-xs text-slate-400">{label}</span>
          <span className={`text-sm font-semibold ${value > 0 ? 'text-slate-100' : 'text-slate-600'}`}>{value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ label, done, total, pct }: { label: string; done: number; total: number; pct: number }) {
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-violet-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-300">{label}</span>
        <span className="text-xs text-slate-500">{done.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/6">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

function PriorityTable({ title, rows, scoreLabel }: { title: string; rows: PriorityRow[]; scoreLabel: string }) {
  return (
    <section className="rounded-lg border border-white/8 bg-white/3 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-white">{title}</h2>
        <span className="text-xs text-slate-500">{rows.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Rank</th>
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Product</th>
              <th className="py-2 pr-3 text-right font-medium">{scoreLabel}</th>
              <th className="py-2 pr-3 font-medium">Readiness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const score = row.score ?? row.priorityScore ?? 0;
              return (
                <tr key={`${title}-${row.sku}`} className="border-b border-white/5 text-slate-300">
                  <td className="py-2 pr-3 text-slate-500">{row.rank}</td>
                  <td className="py-2 pr-3 font-mono text-slate-200">{row.sku}</td>
                  <td className="max-w-xs py-2 pr-3">
                    <p className="truncate text-slate-200">{row.name}</p>
                    <p className="truncate text-slate-500">{row.whyNow || row.brand || row.taskTypes || '-'}</p>
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-slate-200">{score.toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    {row.readiness === 'ready' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">
                        <CheckCircle2 size={11} /> Ready
                      </span>
                    ) : (
                      <span title={row.blockers.join(', ')} className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                        <ArrowRight size={11} /> {row.blockers[0] ?? 'Review'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
