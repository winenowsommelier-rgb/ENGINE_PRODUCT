'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, X } from 'lucide-react';

type Product = Record<string, any>;
type TaxOptions = {
  countries: string[];
  regions: Array<{ name: string; country: string }>;
  subregions: string[];
  classifications: string[];
  grapeVarieties: string[];
  flavorNotes: string[];
};

const WINE_TYPE_OPTIONS = ['Red Wine', 'White Wine', 'Rosé', 'Sparkling', 'Dessert'];
const LIQUOR_TYPE_OPTIONS = ['Whisky', 'Rum', 'Tequila', 'Gin', 'Vodka', 'Brandy', 'Other'];
const ALL_PANEL_FIELDS = ['country', 'region', 'subregion', 'origin', 'classification', 'grape_variety', 'wine_type', 'liquor_main_type', 'flavor_profile'];

export function TaxonomyQueuePage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [taxOptions, setTaxOptions] = useState<TaxOptions | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('unvalidated');
  const [panelProduct, setPanelProduct] = useState<Product | null>(null);
  const [localFields, setLocalFields] = useState<Record<string, string>>({});
  const [batchN, setBatchN] = useState(50);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/taxonomy-options').then(r => r.json()).then(setTaxOptions);
  }, []);

  async function load(p = page, f = filter) {
    const res = await fetch(`/api/taxonomy-queue?page=${p}&validation_status=${f}`);
    setData(await res.json());
  }

  useEffect(() => { load(); }, [page, filter]);

  function openPanel(p: Product) {
    const fields: Record<string, string> = {};
    ALL_PANEL_FIELDS.forEach(f => { fields[f] = String(p[f] ?? ''); });
    setLocalFields(fields);
    setPanelProduct(p);
  }

  function closePanel() { setPanelProduct(null); setLocalFields({}); }

  async function handleBatchValidate() {
    setWorking(true);
    const res = await fetch('/api/taxonomy-queue/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchMode: true, n: batchN }),
    });
    const json = await res.json();
    setMessage(`Validated ${json.updated} products`);
    setWorking(false);
    load();
  }

  async function handleValidateOne() {
    if (!panelProduct) return;
    setSaving(true);

    const changedFields: Record<string, string> = {};
    Object.entries(localFields).forEach(([k, v]) => {
      if (v !== String(panelProduct[k] ?? '')) changedFields[k] = v;
    });

    if (Object.keys(changedFields).length > 0) {
      await fetch(`/api/products/${panelProduct.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: changedFields }),
      });
    }

    await fetch('/api/taxonomy-queue/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [panelProduct.id] }),
    });

    setSaving(false);
    closePanel();
    load();
  }

  const isWine = (p: Product) => String(p.category ?? '').toLowerCase().includes('wine');

  const filteredRegions = taxOptions?.regions.filter(r => !localFields['country'] || r.country === localFields['country']) ?? [];

  const sel = (field: string, opts: string[]) => (
    <select
      value={localFields[field] ?? ''}
      onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
    >
      <option value="">— select —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const txt = (field: string, placeholder?: string) => (
    <input
      value={localFields[field] ?? ''}
      onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      placeholder={placeholder}
      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
    />
  );

  const statusColors: Record<string, string> = {
    unvalidated: 'bg-amber-500/20 text-amber-200',
    validated: 'bg-emerald-500/20 text-emerald-200',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Taxonomy Queue</h1>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10">
            <option value="unvalidated">Unvalidated</option>
            <option value="validated">Validated</option>
          </select>
          <input type="number" min={1} max={500} value={batchN}
            onChange={e => setBatchN(parseInt(e.target.value) || 50)}
            className="w-20 bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10" />
          <button onClick={handleBatchValidate} disabled={working}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors">
            Batch validate top {batchN}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex justify-between">
          <span className="text-emerald-300 text-sm">{message}</span>
          <button onClick={() => setMessage(null)}><X size={14} className="text-slate-400" /></button>
        </div>
      )}

      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU', 'Name', 'Country', 'Region', 'Confidence', 'Priority', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => {
              const isOpen = panelProduct?.id === p.id;
              return (
                <tr key={p.id} className={`border-b border-white/5 hover:bg-white/5 ${isOpen ? 'bg-blue-500/5' : ''}`}>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.country}</td>
                  <td className="px-4 py-3 text-slate-300">{p.region}</td>
                  <td className="px-4 py-3 text-slate-300">{(p.overall_confidence ?? p.taxonomy_confidence ?? 0).toFixed(1)}</td>
                  <td className="px-4 py-3 text-slate-300">{p.queue_priority ?? 0}</td>
                  <td className="px-4 py-3">
                    {isOpen
                      ? <span className="rounded-full px-2 py-0.5 text-xs bg-blue-500/20 text-blue-200">In review</span>
                      : <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.validation_status ?? 'unvalidated'] ?? ''}`}>{p.validation_status ?? 'unvalidated'}</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openPanel(p)} className="text-violet-400 hover:text-violet-300 text-xs">Validate</button>
                  </td>
                </tr>
              );
            })}
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

      {panelProduct && (
        <div className="fixed inset-y-0 right-0 w-96 bg-slate-900 border-l border-white/10 p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-white">Validate product</h2>
            <button onClick={closePanel}><X size={16} className="text-slate-400" /></button>
          </div>
          <div className="space-y-1 mb-4">
            <p className="text-xs text-slate-400">SKU</p>
            <p className="text-sm text-white font-mono">{panelProduct.sku}</p>
            <p className="text-xs text-slate-400 mt-2">Name</p>
            <p className="text-sm text-white">{panelProduct.name}</p>
          </div>

          <div className="space-y-3 mb-6">
            <div>
              <label className="text-xs text-slate-400 block mb-1">country</label>
              {sel('country', taxOptions?.countries ?? [])}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">region</label>
              {sel('region', filteredRegions.map(r => r.name))}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">subregion</label>
              <input
                list="subregion-options"
                value={localFields['subregion'] ?? ''}
                onChange={e => setLocalFields(prev => ({ ...prev, subregion: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
              <datalist id="subregion-options">
                {(taxOptions?.subregions ?? []).map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">origin</label>
              {txt('origin')}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">classification</label>
              {sel('classification', taxOptions?.classifications ?? [])}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">grape_variety</label>
              {sel('grape_variety', taxOptions?.grapeVarieties ?? [])}
            </div>
            {isWine(panelProduct) && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">wine_type</label>
                {sel('wine_type', WINE_TYPE_OPTIONS)}
              </div>
            )}
            {!isWine(panelProduct) && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">liquor_main_type</label>
                {sel('liquor_main_type', LIQUOR_TYPE_OPTIONS)}
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 block mb-1">flavor_profile <span className="text-slate-600">(hold Ctrl/⌘ to select multiple)</span></label>
              <select
                multiple
                value={(localFields['flavor_profile'] ?? '').split(',').map(s => s.trim()).filter(Boolean)}
                onChange={e => {
                  const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                  setLocalFields(prev => ({ ...prev, flavor_profile: selected.join(', ') }));
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-32"
              >
                {(taxOptions?.flavorNotes ?? []).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <button onClick={handleValidateOne} disabled={saving}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2 rounded-lg flex items-center justify-center gap-2 transition-colors">
            <CheckCircle size={15} /> {saving ? 'Saving…' : 'Save & mark as validated'}
          </button>
        </div>
      )}
    </div>
  );
}
