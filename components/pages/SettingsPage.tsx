'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, FolderSymlink, Plus, Trash2 } from 'lucide-react';

type Brand = { id: string; name: string };
type SyncStatus = { last_synced_at: string | null; last_synced_count: number };
type SupplierProblem = {
  supplier_code: string;
  supplier_name: string;
  drive_supplier_folder_name: string;
  normalization_readiness: string;
  blocker_or_risk: string;
  recommended_solution: string;
  master_sku_count: string;
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
};

export function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newBrand, setNewBrand] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [supplierIntake, setSupplierIntake] = useState<SupplierIntakeSummary | null>(null);

  async function loadBrands() {
    const res = await fetch('/api/settings/brands');
    const json = await res.json();
    setBrands(json.brands ?? []);
  }

  useEffect(() => {
    loadBrands();
    fetch('/api/settings/sync').then(r => r.json()).then(setSyncStatus).catch(() => {});
    fetch('/api/settings/supplier-intake')
      .then(r => r.json())
      .then(json => setSupplierIntake(json.summary ?? null))
      .catch(() => {});
  }, []);

  async function addBrand() {
    if (!newBrand.trim()) return;
    await fetch('/api/settings/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBrand.trim() }),
    });
    setNewBrand('');
    loadBrands();
  }

  async function removeBrand(id: string) {
    await fetch(`/api/settings/brands/${id}`, { method: 'DELETE' });
    loadBrands();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/settings/sync', { method: 'POST' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSyncMsg(`Synced ${json.synced} validated products to Supabase.`);
      setSyncStatus({ last_synced_at: json.timestamp, last_synced_count: json.synced });
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed');
    }
    setSyncing(false);
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-semibold text-white mb-8">Settings</h1>

      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-slate-300 mb-1">Supplier intake validation</h2>
            <p className="text-xs text-slate-500">Evidence-first intake, normalized CSV readiness, product identity matching, and review blockers.</p>
          </div>
          {supplierIntake?.generated_at && (
            <span className="text-[11px] text-slate-500">
              Generated {new Date(supplierIntake.generated_at).toLocaleString()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300">
              <CheckCircle2 size={17} />
            </div>
            <p className="text-2xl font-semibold text-white">{((supplierIntake?.readiness_counts.normalizable ?? 0) + (supplierIntake?.readiness_counts.normalizable_with_rules ?? 0)).toLocaleString()}</p>
            <p className="text-xs text-slate-500">Ready or rule-ready suppliers</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
              <FileCheck2 size={17} />
            </div>
            <p className="text-2xl font-semibold text-white">{(supplierIntake?.readiness_counts.draft_extract_then_review ?? 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500">PDF draft then review</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/10 text-sky-300">
              <FolderSymlink size={17} />
            </div>
            <p className="text-2xl font-semibold text-white">{(supplierIntake?.readiness_counts.needs_profile ?? 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500">Mapped folders needing profile</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-rose-500/10 text-rose-300">
              <AlertTriangle size={17} />
            </div>
            <p className="text-2xl font-semibold text-white">{(supplierIntake?.readiness_counts.blocked ?? 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500">Supplier codes missing folder map</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Process coverage</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Supplier codes</span>
                <span className="font-medium text-white">{supplierIntake?.total_supplier_codes.toLocaleString() ?? '0'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Mapped folders</span>
                <span className="font-medium text-white">{supplierIntake?.mapped_folder_supplier_codes.toLocaleString() ?? '0'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Profiled supplier codes</span>
                <span className="font-medium text-white">{supplierIntake?.profiled_supplier_codes.toLocaleString() ?? '0'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Master SKU rows represented</span>
                <span className="font-medium text-white">{supplierIntake?.master_sku_rows_represented.toLocaleString() ?? '0'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Highest-impact blockers</h3>
            <div className="space-y-2">
              {(supplierIntake?.top_problem_suppliers ?? []).slice(0, 6).map(problem => (
                <div key={`${problem.supplier_code}-${problem.normalization_readiness}`} className="rounded-md bg-slate-950/60 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-white">{problem.supplier_code} · {problem.supplier_name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{Number(problem.master_sku_count || 0).toLocaleString()} SKUs</span>
                  </div>
                  <p className="text-xs text-slate-400">{problem.normalization_readiness.replaceAll('_', ' ')}</p>
                  <p className="mt-1 text-xs text-slate-500">{problem.recommended_solution}</p>
                </div>
              ))}
              {!supplierIntake?.top_problem_suppliers?.length && (
                <p className="text-xs text-slate-500">Supplier intake summary has not been generated yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Reputable brand list</h2>
        <p className="text-xs text-slate-500 mb-4">Products whose names contain these strings receive +20 priority points in the Taxonomy Queue.</p>

        <div className="flex gap-2 mb-3">
          <input
            value={newBrand}
            onChange={e => setNewBrand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addBrand(); }}
            placeholder="Brand name…"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <button onClick={addBrand} className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-2 rounded-lg transition-colors">
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-1">
          {brands.length === 0 && <p className="text-slate-500 text-xs">No brands added yet.</p>}
          {brands.map(b => (
            <div key={b.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
              <span className="text-sm text-white">{b.name}</span>
              <button onClick={() => removeBrand(b.id)} className="text-slate-500 hover:text-rose-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-1">Supabase sync</h2>
        <p className="text-xs text-slate-500 mb-4">Push all validated products to Supabase (one-way upsert keyed on SKU).</p>
        <button onClick={handleSync} disabled={syncing}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          {syncing ? 'Syncing…' : 'Sync validated products to Supabase'}
        </button>
        {syncMsg && <p className="mt-2 text-xs text-slate-400">{syncMsg}</p>}
        {syncStatus && (
          <p className="mt-1 text-xs text-slate-600">
            Last synced: {syncStatus.last_synced_at
              ? `${new Date(syncStatus.last_synced_at).toLocaleString()} — ${syncStatus.last_synced_count} products`
              : 'Never'}
          </p>
        )}
      </section>
    </div>
  );
}
