'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FolderSymlink,
  GitBranch,
  PackagePlus,
  Search,
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

type IntakeView = 'control' | 'suppliers' | 'review' | 'pim';

const VIEW_LABELS: Record<IntakeView, string> = {
  control: 'Control room',
  suppliers: 'Supplier folders',
  review: 'Review queue',
  pim: 'PIM apply',
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

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABELS) as IntakeView[]).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={`rounded-md border px-3 py-2 text-sm transition-colors ${
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
      </div>
    </div>
  );
}
