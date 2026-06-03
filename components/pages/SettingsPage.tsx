'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SupplierSettingsPage } from './SupplierSettingsPage';

type Brand = { id: string; name: string };
type SyncStatus = { last_synced_at: string | null; last_synced_count: number };

export function SettingsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newBrand, setNewBrand] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  async function loadBrands() {
    const res = await fetch('/api/settings/brands');
    const json = await res.json();
    setBrands(json.brands ?? []);
  }

  useEffect(() => {
    loadBrands();
    fetch('/api/settings/sync').then(r => r.json()).then(setSyncStatus).catch(() => {});
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

      <section className="mt-10">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Supplier Intake</h2>
        <p className="text-xs text-slate-500 mb-4">Configure supplier pricing rules and Drive folder mappings for the intake pipeline.</p>
        <SupplierSettingsPage />
      </section>
    </div>
  );
}
