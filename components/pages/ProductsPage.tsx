'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Edit2, X } from 'lucide-react';

type Product = Record<string, any>;
type ChangelogEntry = Record<string, any>;
type DetailView = 'edit' | 'changelog';

export function ProductsPage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [view, setView] = useState<DetailView>('edit');
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function load(p = page, q = search) {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('search', q);
    const res = await fetch(`/api/products?${params}`);
    const json = await res.json();
    setData(json);
  }

  useEffect(() => { load(); }, [page, search]);

  async function openProduct(product: Product) {
    setSelected(product);
    setView('edit');
    setEditFields(Object.fromEntries(
      Object.entries(product).map(([k, v]) => [k, v != null ? String(v) : ''])
    ));
    setNote('');
    setSaveMsg(null);
    const res = await fetch(`/api/products/${product.id}`);
    const json = await res.json();
    if (json.changelog) setChangelog(json.changelog);
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/products/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: editFields, note: note || undefined }),
    });
    const json = await res.json();
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved');
      load();
      const r2 = await fetch(`/api/products/${selected.id}`);
      const j2 = await r2.json();
      if (j2.changelog) setChangelog(j2.changelog);
    } else {
      setSaveMsg(json.error ?? 'Save failed');
    }
  }

  const EDITABLE_FIELDS = ['name', 'sku', 'country', 'region', 'subregion', 'classification',
    'grape_variety', 'price', 'cost', 'currency', 'validation_status'];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Products</h1>
        <input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 w-64"
        />
      </div>

      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU', 'Name', 'Country', 'Region', 'Price', 'Confidence', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => (
              <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => openProduct(p)}>
                <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                <td className="px-4 py-3 text-slate-300">{p.country}</td>
                <td className="px-4 py-3 text-slate-300">{p.region}</td>
                <td className="px-4 py-3 text-slate-300">{p.price}</td>
                <td className="px-4 py-3 text-slate-300">{(p.overall_confidence ?? 0).toFixed(1)}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${p.validation_status === 'validated' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'}`}>
                    {p.validation_status ?? 'unvalidated'}
                  </span>
                </td>
                <td className="px-4 py-3"><Edit2 size={13} className="text-slate-500" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-400">{data.total} products</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-slate-400 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-300">Page {data.page} / {data.totalPages}</span>
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="text-slate-400 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-slate-900 border-l border-white/10 flex flex-col z-50">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex gap-3">
              <button onClick={() => setView('edit')} className={`text-xs px-3 py-1.5 rounded-lg ${view === 'edit' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-white'}`}>
                <Edit2 size={12} className="inline mr-1" />Edit
              </button>
              <button onClick={() => setView('changelog')} className={`text-xs px-3 py-1.5 rounded-lg ${view === 'changelog' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-white'}`}>
                <Clock size={12} className="inline mr-1" />Changelog
              </button>
            </div>
            <button onClick={() => setSelected(null)}><X size={16} className="text-slate-400" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {view === 'edit' && (
              <div className="space-y-3">
                {EDITABLE_FIELDS.map(field => (
                  <div key={field}>
                    <label className="text-xs text-slate-400 block mb-1">{field}</label>
                    <input
                      value={editFields[field] ?? ''}
                      onChange={e => setEditFields(f => ({ ...f, [field]: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Note (optional)</label>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for this change…"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600" />
                </div>
              </div>
            )}

            {view === 'changelog' && (
              <div className="space-y-2">
                {changelog.length === 0 && <p className="text-slate-500 text-sm">No changes recorded yet.</p>}
                {changelog.map((entry: ChangelogEntry, i: number) => (
                  <div key={i} className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-violet-300">{entry.source}</span>
                      <span className="text-xs text-slate-500">{new Date(entry.changed_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-300"><span className="text-slate-400">{entry.field}:</span> {entry.old_value ?? '∅'} → {entry.new_value ?? '∅'}</p>
                    {entry.note && <p className="text-xs text-slate-500 mt-1 italic">{entry.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {view === 'edit' && (
            <div className="p-4 border-t border-white/10">
              {saveMsg && <p className="text-xs text-slate-400 mb-2">{saveMsg}</p>}
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
