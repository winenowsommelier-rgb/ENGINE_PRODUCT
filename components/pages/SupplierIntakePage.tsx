'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSearch,
  FolderSymlink,
  GitBranch,
  Loader2,
  PackagePlus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  TableProperties,
} from 'lucide-react';

type SupplierProblem = {
  supplier_code: string;
  supplier_name: string;
  drive_supplier_folder_name: string;
  normalization_readiness: string;
  blocker_or_risk: string;
  recommended_solution: string;
  master_sku_count: string;
};

type SupplierProcessStep = {
  step: string;
  status: string;
  artifact: string;
};

type SupplierIntakeSummary = {
  generated_at: string;
  total_supplier_codes: number;
  problem_supplier_codes: number;
  readiness_counts: Record<string, number>;
  profiled_supplier_codes: number;
  mapped_folder_supplier_codes: number;
  master_sku_rows_represented: number;
  top_problem_suppliers: SupplierProblem[];
  ready_supplier_codes: SupplierProblem[];
  process_steps: SupplierProcessStep[];
};

type SupplierIntakeRow = {
  supplier_code: string;
  supplier_name: string;
  supplier_detail: string;
  pricing_structure: string;
  drive_bucket_name: string;
  drive_supplier_folder_name: string;
  drive_supplier_folder_url: string;
  profile_status: string;
  input_file_type: string;
  latest_sample_file: string;
  automation_confidence: string;
  normalization_readiness: string;
  blocker_or_risk: string;
  recommended_solution: string;
  master_sku_metric_code: string;
  master_sku_count: string;
  master_top_brands: string;
  sample_skus: string;
  match_coverage_status: string;
  match_coverage_pct: string;
  match_coverage_note: string;
};

type SupplierIntakeResponse = {
  summary: SupplierIntakeSummary;
  suppliers: SupplierIntakeRow[];
};

type IntakeView = 'control' | 'suppliers' | 'review' | 'pim' | 'run';

const VIEW_LABELS: Record<IntakeView, string> = {
  control: 'Control room',
  suppliers: 'Supplier folders',
  review: 'Review queue',
  pim: 'PIM apply',
  run: 'Run intake',
};

const STEP_ICONS = [FolderSymlink, TableProperties, GitBranch, FileSearch, ClipboardCheck, PackagePlus];

function formatLabel(value: string) {
  return (value || 'not set')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function numberValue(value: string | number | undefined) {
  return Number(value || 0);
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
};

type SupplierDef = {
  id: string;
  name: string;
  supplier_code: string;
  drive_folder_id?: string;
  pricing_structure: string;
};

type WorkflowRun = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  source_filename: string;
  source_format: string;
  status: string;
  total_rows: number;
  approved_rows: number;
  blocked_rows: number;
};

type WorkflowRow = {
  id: string;
  run_id: string;
  row_number: number;
  raw_payload: Record<string, unknown>;
  normalized_payload: {
    supplier_item_code?: string;
    name: string;
    cost: number;
    rsp?: number;
    currency: string;
  };
  status: string;
  issues: string[];
  match?: {
    selected_sku?: string;
    confidence: number;
    status: string;
  };
  price?: {
    calculated_price: number;
    final_selling_price: number;
    margin_pct: number;
    status: string;
  };
};

type WorkflowPhase = 'setup' | 'processing' | 'review' | 'committed';

interface IntakeRunWorkflowProps {
  onNavigateToSettings: () => void;
}

const CHAIN_STEPS = [
  { key: 'normalize', label: 'Normalize' },
  { key: 'match', label: 'Match' },
  { key: 'price', label: 'Price' },
] as const;

function IntakeRunWorkflow({ onNavigateToSettings }: IntakeRunWorkflowProps) {
  const [phase, setPhase] = useState<WorkflowPhase>('setup');
  const [suppliers, setSuppliers] = useState<SupplierDef[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  useEffect(() => {
    fetch('/api/settings/suppliers')
      .then(r => r.json())
      .then(d => setSuppliers(d.suppliers ?? []))
      .catch(() => {})
      .finally(() => setLoadingSuppliers(false));
  }, []);

  useEffect(() => {
    if (!selectedSupplierId) { setDriveFiles([]); return; }
    const sup = suppliers.find(s => s.id === selectedSupplierId);
    if (!sup?.drive_folder_id) return;
    fetch(`/api/supplier-intake/drive-files?folder_id=${encodeURIComponent(sup.drive_folder_id)}`)
      .then(r => r.json())
      .then(d => setDriveFiles(d.files ?? []))
      .catch(() => setDriveFiles([]));
  }, [selectedSupplierId, suppliers]);

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId) ?? null;
  const flaggedCount = rows.filter(r => r.status === 'blocked').length;
  const reviewCount = rows.filter(r => r.status === 'needs_review' || r.price?.status === 'needs_review').length;
  const checkedCount = checkedIds.size;

  function handleStartRun() {
    if (!selectedSupplierId || !selectedFileId) return;
    setProcessing(true);
    setError(null);
    setPhase('processing');
    setProcessingStep('normalize');

    const sup = suppliers.find(s => s.id === selectedSupplierId)!;
    const file = driveFiles.find(f => f.id === selectedFileId)!;

    fetch('/api/supplier-intake/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplier_id: selectedSupplierId,
        source_drive_file_id: selectedFileId,
        source_filename: file.name,
        source_format: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx',
      }),
    })
      .then(r => r.json())
      .then(data => {
        const createdRun = data.run as WorkflowRun;
        setRun(createdRun);
        return chainSteps(createdRun.id, 0);
      })
      .catch(err => { setError(String(err?.message ?? err)); setProcessing(false); setProcessingStep(null); });
  }

  function chainSteps(runId: string, stepIndex: number): Promise<void> {
    if (stepIndex >= CHAIN_STEPS.length) {
      // All done — fetch rows
      setProcessingStep(null);
      return fetch(`/api/supplier-intake/runs/${runId}`)
        .then(r => r.json())
        .then(data => {
          const fetched = data.rows ?? [];
          setRows(fetched);
          setCheckedIds(new Set(
            fetched
              .filter((r: WorkflowRow) => r.status !== 'blocked' && r.status !== 'new_code_required' && r.price?.status !== 'needs_review')
              .map((r: WorkflowRow) => r.id)
          ));
          setPhase('review');
          setProcessing(false);
        });
    }

    const step = CHAIN_STEPS[stepIndex];
    setProcessingStep(step.key);
    const url = `/api/supplier-intake/runs/${runId}/${step.key}`;
    const opts: RequestInit = step.key === 'normalize'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      : { method: 'POST' };

    return fetch(url, opts)
      .then(r => {
        if (!r.ok) return r.json().then((d: { error?: string }) => Promise.reject(new Error(d.error ?? `${step.label} failed`)));
        return r.json();
      })
      .then(() => chainSteps(runId, stepIndex + 1))
      .catch(err => { setError(`${step.label}: ${String(err?.message ?? err)}`); setProcessing(false); setProcessingStep(null); });
  }

  function handleRetryFromStep() {
    if (!run) return;
    setProcessing(true);
    setError(null);
    const stepIndex = CHAIN_STEPS.findIndex(s => s.key === processingStep);
    setProcessingStep(processingStep);
    chainSteps(run.id, Math.max(0, stepIndex)).catch(() => {});
  }

  function handleApproveSelected() {
    if (!run || checkedIds.size === 0) return;
    setProcessing(true);
    fetch(`/api/supplier-intake/runs/${run.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_ids: Array.from(checkedIds) }),
    })
      .then(r => r.json())
      .then(data => {
        setRows(data.rows ?? []);
        setPhase('review');
      })
      .catch(err => setError(String(err?.message ?? err)))
      .finally(() => setProcessing(false));
  }

  function handleCommit() {
    if (!run) return;
    setProcessing(true);
    fetch(`/api/supplier-intake/runs/${run.id}/commit`, { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        setPhase('committed');
        setProcessing(false);
      })
      .catch(err => { setError(String(err?.message ?? err)); setProcessing(false); });
  }

  function handleReset() {
    setPhase('setup');
    setRun(null);
    setRows([]);
    setCheckedIds(new Set());
    setError(null);
    setProcessing(false);
    setProcessingStep(null);
  }

  function handleExportCsv() {
    if (!run) return;
    window.open(`/api/supplier-intake/runs/${run.id}/export-csv`, '_blank');
  }

  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // SETUP phase
  if (phase === 'setup') {
    return (
      <div className="space-y-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Supplier</label>
          {loadingSuppliers ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" />Loading suppliers…</div>
          ) : (
            <select
              value={selectedSupplierId ?? ''}
              onChange={e => { setSelectedSupplierId(e.target.value); setSelectedFileId(null); setSelectedFileName(null); }}
              className="w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Select a supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_code} · {s.name}</option>)}
            </select>
          )}
        </div>

        {selectedSupplier && !selectedSupplier.drive_folder_id && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={15} />
            This supplier has no Drive folder configured — go to Settings to add one.
          </div>
        )}

        {selectedSupplier?.drive_folder_id && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Drive files</label>
            {driveFiles.length === 0 ? (
              <p className="text-sm text-slate-500">No files found in this supplier's Drive folder.</p>
            ) : (
              <div className="space-y-1">
                {driveFiles.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setSelectedFileId(f.id); setSelectedFileName(f.name); }}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedFileId === f.id
                        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-slate-950/50 text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="font-medium">{f.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{new Date(f.modifiedTime).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        <button
          onClick={handleStartRun}
          disabled={!selectedSupplierId || !selectedFileId || !!(selectedSupplier && !selectedSupplier.drive_folder_id)}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start Run
        </button>
      </div>
    );
  }

  // PROCESSING phase
  if (phase === 'processing') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          {CHAIN_STEPS.map(step => {
            const isActive = processingStep === step.key;
            const isDone = processingStep !== null && CHAIN_STEPS.indexOf(step) < CHAIN_STEPS.findIndex(s => s.key === processingStep);
            return (
              <div key={step.key} className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-cyan-500 text-white' : 'bg-slate-800 text-slate-500'
                }`}>
                  {isDone ? <CheckCircle2 size={16} /> : isActive ? <Loader2 size={16} className="animate-spin" /> : CHAIN_STEPS.indexOf(step) + 1}
                </div>
                <span className={`text-sm ${isDone ? 'text-emerald-300' : isActive ? 'text-cyan-200' : 'text-slate-500'}`}>{step.label}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm font-medium text-slate-500">4</div>
            <span className="text-sm text-slate-500">Review</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm font-medium text-slate-500">5</div>
            <span className="text-sm text-slate-500">Commit</span>
          </div>
        </div>

        {error && (
          <div className="space-y-3">
            <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
            <button onClick={handleRetryFromStep} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.08]">
              <RotateCcw size={14} /> Retry from this step
            </button>
          </div>
        )}
      </div>
    );
  }

  // COMMITTED phase
  if (phase === 'committed') {
    const committedCount = rows.filter(r => r.status === 'committed' || r.status === 'approved').length;
    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-6 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-300" />
          <h3 className="text-lg font-semibold text-white">{committedCount} rows committed to PIM</h3>
          <p className="mt-1 text-sm text-slate-400">
            {flaggedCount} flagged rows excluded · review in next run
          </p>
        </div>
        <button onClick={handleReset} className="flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400">
          <RotateCcw size={15} /> Start another run
        </button>
      </div>
    );
  }

  // REVIEW phase
  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>{rows.length} rows</span>
          <span>·</span>
          <span>{flaggedCount} flagged</span>
          <span>·</span>
          <span>{reviewCount} needs review</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.08]">
            <Download size={14} /> Export CSV
          </button>
          <button onClick={onNavigateToSettings} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.08]">
            <Settings2 size={14} /> Adjust Settings
          </button>
          {checkedCount > 0 && (
            <button
              onClick={handleApproveSelected}
              disabled={processing}
              className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
            >
              Approve Selected ({checkedCount})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {/* Review table */}
      <div className="overflow-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-950 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-10 px-3 py-3 font-medium">☐</th>
              <th className="w-12 px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Matched SKU</th>
              <th className="w-20 px-3 py-3 text-right font-medium">Conf.</th>
              <th className="w-24 px-3 py-3 text-right font-medium">Cost</th>
              <th className="w-24 px-3 py-3 text-right font-medium">Supp RSP</th>
              <th className="w-24 px-3 py-3 text-right font-medium">Calc Price</th>
              <th className="w-20 px-3 py-3 text-right font-medium">Margin%</th>
              <th className="w-28 px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(row => {
              const isBlocked = row.status === 'blocked';
              const isNeedsReview = row.status === 'needs_review' || row.price?.status === 'needs_review';
              const isChecked = checkedIds.has(row.id);
              const p = row.normalized_payload;
              const m = row.match;
              const pr = row.price;

              const rowBg = isBlocked ? 'bg-slate-900/80' : isNeedsReview ? 'bg-amber-500/[0.06]' : '';
              const marginColor = pr && pr.margin_pct != null
                ? pr.margin_pct >= 30 ? 'text-emerald-300' : pr.margin_pct >= 15 ? 'text-amber-300' : 'text-rose-300'
                : 'text-slate-500';
              const confColor = m && m.confidence != null
                ? m.confidence >= 100 ? 'text-emerald-300' : m.confidence >= 55 ? 'text-amber-300' : 'text-rose-300'
                : 'text-slate-500';

              return (
                <tr key={row.id} className={`transition-colors hover:bg-white/[0.04] ${rowBg}`}>
                  <td className="px-3 py-2">
                    {!isBlocked && row.status !== 'new_code_required' && (
                      <input type="checkbox" checked={isChecked} onChange={() => toggleCheck(row.id)} className="h-4 w-4 accent-cyan-500" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{row.row_number}</td>
                  <td className={`px-3 py-2 ${isBlocked ? 'text-slate-500 line-through' : 'text-white font-medium'}`}>{p.name}</td>
                  <td className="px-3 py-2 text-slate-400">{m?.selected_sku ?? <span className="text-slate-600">—</span>}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${confColor}`}>{m?.confidence != null ? `${m.confidence}%` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{p.currency} {p.cost?.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{p.rsp != null ? `${p.currency} ${p.rsp.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{pr?.calculated_price != null ? pr.calculated_price.toFixed(2) : '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${marginColor}`}>{pr?.margin_pct != null ? `${pr.margin_pct.toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-2">
                    {isBlocked ? (
                      <span className="rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[11px] text-rose-200">flagged ✗</span>
                    ) : isNeedsReview ? (
                      <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-200">review ⚑</span>
                    ) : (
                      <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[11px] text-emerald-200">auto ✓</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 group relative">
                    <span className="line-clamp-1">{row.issues.join(', ')}</span>
                    {row.issues.length > 0 && (
                      <span className="absolute left-0 top-full z-10 hidden max-w-xs rounded bg-slate-800 p-2 text-xs text-slate-300 shadow-lg group-hover:block">
                        {row.issues.join(' · ')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Commit button */}
      {checkedCount > 0 && (
        <button
          onClick={handleCommit}
          disabled={processing}
          className="w-full rounded-md bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
        >
          Commit {checkedCount} approved rows to PIM →
        </button>
      )}
    </div>
  );
}

function statusClass(status: string) {
  if (status === 'normalizable' || status === 'built') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (status === 'normalizable_with_rules' || status === 'partially_built') return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200';
  if (status === 'normalizable_with_review' || status === 'designed') return 'border-sky-400/25 bg-sky-400/10 text-sky-200';
  if (status === 'draft_extract_then_review' || status === 'needs_profile') return 'border-amber-400/25 bg-amber-400/10 text-amber-200';
  if (status === 'blocked' || status === 'not_built') return 'border-rose-400/25 bg-rose-400/10 text-rose-200';
  return 'border-slate-500/25 bg-slate-500/10 text-slate-300';
}

function readinessRank(row: SupplierIntakeRow) {
  const score: Record<string, number> = {
    blocked: 0,
    needs_profile: 1,
    draft_extract_then_review: 2,
    normalizable_with_review: 3,
    normalizable_with_rules: 4,
    normalizable: 5,
  };
  return score[row.normalization_readiness] ?? 0;
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof CheckCircle2; tone: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-md ${tone}`}>
        <Icon size={17} />
      </div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

export function SupplierIntakePage() {
  const [data, setData] = useState<SupplierIntakeResponse | null>(null);
  const [view, setView] = useState<IntakeView>('control');
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/supplier-intake')
      .then(response => response.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const summary = data?.summary;
  const suppliers = data?.suppliers ?? [];
  const selectedSupplier = suppliers.find(row => row.supplier_code === selectedCode) ?? suppliers[0];

  const filteredSuppliers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suppliers
      .filter(row => {
        if (!needle) return true;
        return [
          row.supplier_code,
          row.supplier_name,
          row.drive_supplier_folder_name,
          row.normalization_readiness,
          row.master_top_brands,
        ].some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const rankDelta = readinessRank(a) - readinessRank(b);
        if (rankDelta !== 0) return rankDelta;
        return numberValue(b.master_sku_count) - numberValue(a.master_sku_count);
      });
  }, [query, suppliers]);

  const readyCount = (summary?.readiness_counts.normalizable ?? 0) + (summary?.readiness_counts.normalizable_with_rules ?? 0);
  const reviewCount = (summary?.readiness_counts.draft_extract_then_review ?? 0) + (summary?.readiness_counts.normalizable_with_review ?? 0);

  return (
    <div className="min-h-full bg-slate-950 text-white">
      <div className="border-b border-white/10 bg-slate-950/90 px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Supplier Intake</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Controlled process for supplier files, normalized CSV, SKU matching, name research, product_admin approval, and final PIM insertion.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Last generated</p>
            <p className="text-sm text-slate-300">
              {summary?.generated_at ? new Date(summary.generated_at).toLocaleString() : 'Waiting for audit'}
            </p>
          </div>
        </div>

        <div role="tablist" aria-label="Supplier intake sections" className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABELS) as IntakeView[]).map(item => (
            <button
              key={item}
              role="tab"
              type="button"
              aria-selected={view === item}
              aria-current={view === item ? 'page' : undefined}
              onClick={() => setView(item)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                view === item
                  ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
            >
              {VIEW_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8">
        {view === 'control' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard label="Supplier codes" value={(summary?.total_supplier_codes ?? 0).toLocaleString()} icon={FolderSymlink} tone="bg-sky-500/10 text-sky-300" />
              <MetricCard label="Ready or rule-ready" value={readyCount.toLocaleString()} icon={CheckCircle2} tone="bg-emerald-500/10 text-emerald-300" />
              <MetricCard label="Need review extraction" value={reviewCount.toLocaleString()} icon={ClipboardCheck} tone="bg-amber-500/10 text-amber-300" />
              <MetricCard label="Need folder profile" value={(summary?.readiness_counts.needs_profile ?? 0).toLocaleString()} icon={FileSearch} tone="bg-cyan-500/10 text-cyan-300" />
              <MetricCard label="Blocked folder map" value={(summary?.readiness_counts.blocked ?? 0).toLocaleString()} icon={AlertTriangle} tone="bg-rose-500/10 text-rose-300" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
              <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Process pipeline</h2>
                <div className="space-y-3">
                  {(summary?.process_steps ?? []).map((step, index) => {
                    const Icon = STEP_ICONS[index] ?? ShieldCheck;
                    return (
                      <div key={step.step} className="flex gap-3 rounded-md bg-slate-950/60 p-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-slate-300">
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{formatLabel(step.step)}</p>
                            <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${statusClass(step.status)}`}>
                              {formatLabel(step.status)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">{step.artifact}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Highest-impact worklist</h2>
                <div className="space-y-2">
                  {(summary?.top_problem_suppliers ?? []).slice(0, 8).map(problem => (
                    <button
                      key={`${problem.supplier_code}-${problem.normalization_readiness}`}
                      type="button"
                      onClick={() => {
                        setSelectedCode(problem.supplier_code);
                        setView('suppliers');
                      }}
                      className="w-full rounded-md bg-slate-950/60 px-3 py-2 text-left transition-colors hover:bg-slate-900"
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">{problem.supplier_code} · {problem.supplier_name}</span>
                        <span className="shrink-0 text-xs text-slate-500">{numberValue(problem.master_sku_count).toLocaleString()} SKUs</span>
                      </div>
                      <p className="text-xs text-slate-400">{formatLabel(problem.normalization_readiness)}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{problem.recommended_solution}</p>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {view === 'suppliers' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
            <section className="rounded-lg border border-white/10 bg-white/[0.03]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
                <div>
                  <h2 className="text-sm font-medium text-slate-200">Supplier folder readiness</h2>
                  <p className="text-xs text-slate-500">Click a supplier to inspect blocker, sample SKUs, parser status, and next action.</p>
                </div>
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-600" size={15} />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search supplier, folder, brand, status"
                    className="w-full rounded-md border border-white/10 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-950 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">Supplier</th>
                      <th className="px-4 py-3 font-medium">Folder</th>
                      <th className="px-4 py-3 font-medium">Readiness</th>
                      <th className="px-4 py-3 text-right font-medium">SKUs</th>
                      <th className="px-4 py-3 font-medium">Next action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredSuppliers.map(row => (
                      <tr
                        key={row.supplier_code}
                        onClick={() => setSelectedCode(row.supplier_code)}
                        className={`cursor-pointer transition-colors hover:bg-white/[0.04] ${
                          selectedSupplier?.supplier_code === row.supplier_code ? 'bg-cyan-400/[0.06]' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">{row.supplier_code}</p>
                          <p className="text-xs text-slate-500">{row.supplier_name}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-400">{row.drive_supplier_folder_name || 'Not mapped'}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded border px-2 py-1 text-xs ${statusClass(row.normalization_readiness)}`}>
                            {formatLabel(row.normalization_readiness)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">{numberValue(row.master_sku_count).toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{row.recommended_solution}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              {selectedSupplier ? (
                <div>
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-white">{selectedSupplier.supplier_code}</h2>
                      <p className="text-sm text-slate-400">{selectedSupplier.supplier_name}</p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-xs ${statusClass(selectedSupplier.normalization_readiness)}`}>
                      {formatLabel(selectedSupplier.normalization_readiness)}
                    </span>
                  </div>

                  <div className="space-y-4 text-sm">
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Drive folder</p>
                      <p className="text-slate-300">{selectedSupplier.drive_supplier_folder_name || 'Not mapped'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Latest sample</p>
                      <p className="text-slate-300">{selectedSupplier.latest_sample_file || 'Not profiled yet'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Blocker or risk</p>
                      <p className="text-slate-400">{selectedSupplier.blocker_or_risk || 'No blocker recorded.'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Recommended solution</p>
                      <p className="text-slate-300">{selectedSupplier.recommended_solution || 'Ready for normalizer run.'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Masterfile coverage baseline</p>
                      <p className="text-slate-300">{numberValue(selectedSupplier.master_sku_count).toLocaleString()} SKU rows</p>
                      <p className="mt-1 text-xs text-slate-500">{selectedSupplier.master_top_brands}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-600">Sample SKUs</p>
                      <p className="break-words font-mono text-xs text-slate-400">{selectedSupplier.sample_skus}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No supplier rows loaded yet.</p>
              )}
            </aside>
          </div>
        )}

        {view === 'review' && (
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              ['Normalize CSV', 'Parser converts supplier file into the canonical schema with evidence columns, prices, item identity, and parse confidence.'],
              ['Identity match', 'System compares supplier item code, barcode, name, vintage, size, country, and prior mappings to existing masterfile rows.'],
              ['Name research', 'Uncertain new products or supplier changes are split into an online evidence queue before approval.'],
              ['Product admin review', 'product_admin approves existing update, supplier change, new SKU, or blocks/holds the row.'],
              ['Pricing proposal', 'Supplier RSP or trade-term formula calculates final website selling price after cost is accepted.'],
              ['Audit package', 'Every approved row keeps source file, normalized row, decision reason, approver, and timestamp.'],
            ].map(([title, body], index) => (
              <section key={title} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md bg-cyan-400/10 text-cyan-200">
                  {index + 1}
                </div>
                <h2 className="text-sm font-medium text-white">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
              </section>
            ))}
          </div>
        )}

        {view === 'pim' && (
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <div>
                <h2 className="text-sm font-medium text-white">Gate before real product creation</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Approved intake rows should become PIM writes only after supplier evidence, normalized CSV, identity match, pricing formula, and product_admin decision are all stored together.
                </p>
                <div className="mt-5 space-y-3">
                  {['Exact match cost/RSP update', 'Supplier change creates new suffix SKU and inactivates old SKU', 'New product creates category running number SKU', 'Rejected and held rows never write to PIM'].map(item => (
                    <div key={item} className="flex items-center gap-3 text-sm text-slate-300">
                      <CheckCircle2 size={16} className="text-emerald-300" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md bg-slate-950/70 p-4">
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned apply sequence</h3>
                {['Load approved review rows', 'Validate no stale source or duplicate approval', 'Calculate final cost and website price', 'Write PIM product/SKU changes', 'Write audit log and monthly validation marker'].map((item, index) => (
                  <div key={item} className="flex items-center gap-3 border-b border-white/5 py-3 last:border-0">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-white/[0.04] text-xs text-slate-400">{index + 1}</span>
                    <span className="text-sm text-slate-300">{item}</span>
                    {index < 4 && <ArrowRight size={14} className="ml-auto text-slate-600" />}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {view === 'run' && (
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <IntakeRunWorkflow onNavigateToSettings={() => setView('pim')} />
          </section>
        )}
      </div>
    </div>
  );
}
