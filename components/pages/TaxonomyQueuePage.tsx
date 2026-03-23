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
type ClaudeSuggestions = {
  country?: string;
  region?: string;
  subregion?: string;
  classification?: string;
  grape_variety?: string;
  confidence?: number;
  note?: string;
};

const WINE_TYPE_OPTIONS = ['Red Wine', 'White Wine', 'Rosé', 'Sparkling', 'Dessert'];
const LIQUOR_TYPE_OPTIONS = ['Whisky', 'Rum', 'Tequila', 'Gin', 'Vodka', 'Brandy', 'Other'];
const ALL_PANEL_FIELDS = ['country', 'region', 'subregion', 'origin', 'classification', 'grape_variety', 'wine_type', 'liquor_main_type', 'flavor_profile'];
const CLAUDE_SUGGESTION_FIELDS = ['country', 'region', 'subregion', 'classification', 'grape_variety'] as const;

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
  const [claudeSuggestions, setClaudeSuggestions] = useState<ClaudeSuggestions | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeNote, setClaudeNote] = useState<string>('');

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
    setClaudeSuggestions(null);
    setClaudeNote('');
  }

  function closePanel() {
    setPanelProduct(null);
    setLocalFields({});
    setClaudeSuggestions(null);
    setClaudeNote('');
  }

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

  async function handleAskClaude() {
    if (!panelProduct) return;
    setClaudeLoading(true);
    setClaudeSuggestions(null);
    setClaudeNote('');
    try {
      const res = await fetch('/api/enrich/claude-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: panelProduct.sku,
          name: panelProduct.name,
          wine_type: panelProduct.wine_type,
          liquor_main_type: panelProduct.liquor_main_type,
          country: panelProduct.country,
          region: panelProduct.region,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setClaudeNote(`Error: ${json.error}`);
      } else {
        setClaudeSuggestions(json.suggestions);
        setClaudeNote(json.suggestions?.note ?? '');
      }
    } catch {
      setClaudeNote('Claude API unavailable. Try again.');
    } finally {
      setClaudeLoading(false);
    }
  }

  function acceptSuggestion(field: string, value: string) {
    setLocalFields(prev => ({ ...prev, [field]: value }));
    setClaudeSuggestions(prev => prev ? { ...prev, [field]: undefined } : null);
  }

  function acceptAllSuggestions() {
    if (!claudeSuggestions) return;
    const fields: Record<string, string> = {};
    for (const f of CLAUDE_SUGGESTION_FIELDS) {
      if (claudeSuggestions[f]) fields[f] = claudeSuggestions[f] as string;
    }
    setLocalFields(prev => ({ ...prev, ...fields }));
    setClaudeSuggestions(null);
    setClaudeNote(claudeNote ? `✓ Applied — ${claudeNote}` : '✓ All suggestions applied');
  }

  const isWine = (p: Product) => String(p.wine_type ?? p.category ?? '').toLowerCase().includes('wine');
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

  const confidenceBadge = (conf: number) => {
    const pct = Math.round(conf * 100);
    const cls = conf >= 0.75 ? 'bg-emerald-500/20 text-emerald-300' : conf >= 0.4 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300';
    return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{pct}%</span>;
  };

  const statusColors: Record<string, string> = {
    needs_review: 'bg-amber-500/20 text-amber-200',
    needs_attention: 'bg-rose-500/20 text-rose-200',
    validated: 'bg-emerald-500/20 text-emerald-200',
    unvalidated: 'bg-amber-500/20 text-amber-200',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Taxonomy Queue</h1>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10">
            <option value="unvalidated">Unvalidated</option>
            <option value="needs_review">Needs review</option>
            <option value="needs_attention">Needs attention</option>
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
              {['SKU', 'Name', 'Country', 'Confidence', 'Source', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => {
              const isOpen = panelProduct?.id === p.id;
              const conf = parseFloat(String(p.overall_confidence ?? p.taxonomy_confidence ?? 0));
              return (
                <tr key={p.id}
                  className={`border-b border-white/5 hover:bg-white/5 ${isOpen ? 'bg-blue-500/5' : ''} ${p.validation_status === 'needs_attention' ? 'border-l-2 border-l-rose-500/50' : ''}`}>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.country || <span className="text-slate-600 italic">unknown</span>}</td>
                  <td className="px-4 py-3">{confidenceBadge(conf)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.enrichment_source ?? '—'}</td>
                  <td className="px-4 py-3">
                    {isOpen
                      ? <span className="rounded-full px-2 py-0.5 text-xs bg-blue-500/20 text-blue-200">In review</span>
                      : <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.validation_status ?? 'unvalidated'] ?? 'bg-slate-500/20 text-slate-300'}`}>{p.validation_status ?? 'unvalidated'}</span>
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Validate product</h2>
            <button onClick={closePanel}><X size={16} className="text-slate-400" /></button>
          </div>

          <div className="space-y-1 mb-4">
            <p className="text-xs text-slate-400">SKU</p>
            <p className="text-sm text-white font-mono">{panelProduct.sku}</p>
            <p className="text-xs text-slate-400 mt-2">Name</p>
            <p className="text-sm text-white">{panelProduct.name}</p>
            {panelProduct.enrichment_note && (
              <p className="text-xs text-slate-500 mt-1 italic">
                {panelProduct.enrichment_source === 'claude' ? '✦ ' : ''}{panelProduct.enrichment_note}
              </p>
            )}
          </div>

          {/* Ask Claude section */}
          <div className="border border-white/10 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-300">Claude AI Assist</p>
              <button
                onClick={handleAskClaude}
                disabled={claudeLoading}
                className="text-xs bg-violet-600/30 hover:bg-violet-600/50 disabled:opacity-50 text-violet-300 px-3 py-1 rounded-lg transition-colors"
              >
                {claudeLoading ? 'Asking…' : '✦ Ask Claude'}
              </button>
            </div>

            {claudeNote && (
              <p className="text-xs text-slate-500 mb-2 italic">{claudeNote}</p>
            )}

            {claudeSuggestions && (
              <div className="space-y-2">
                {CLAUDE_SUGGESTION_FIELDS.map(field => {
                  const val = claudeSuggestions[field];
                  if (!val) return null;
                  return (
                    <div key={field} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        {field}: <span className="text-white">{val}</span>
                      </span>
                      <button
                        onClick={() => acceptSuggestion(field, val)}
                        className="text-emerald-400 hover:text-emerald-300 ml-2 shrink-0"
                      >
                        Accept
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={acceptAllSuggestions}
                  className="w-full text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 py-1.5 rounded-lg transition-colors mt-1"
                >
                  Accept all
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3 mb-6">
            <div><label className="text-xs text-slate-400 block mb-1">country</label>{sel('country', taxOptions?.countries ?? [])}</div>
            <div><label className="text-xs text-slate-400 block mb-1">region</label>{sel('region', filteredRegions.map(r => r.name))}</div>
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
            <div><label className="text-xs text-slate-400 block mb-1">origin</label>{txt('origin')}</div>
            <div><label className="text-xs text-slate-400 block mb-1">classification</label>{sel('classification', taxOptions?.classifications ?? [])}</div>
            <div><label className="text-xs text-slate-400 block mb-1">grape_variety</label>{sel('grape_variety', taxOptions?.grapeVarieties ?? [])}</div>
            {isWine(panelProduct) && (
              <div><label className="text-xs text-slate-400 block mb-1">wine_type</label>{sel('wine_type', WINE_TYPE_OPTIONS)}</div>
            )}
            {!isWine(panelProduct) && (
              <div><label className="text-xs text-slate-400 block mb-1">liquor_main_type</label>{sel('liquor_main_type', LIQUOR_TYPE_OPTIONS)}</div>
            )}
            <div>
              <label className="text-xs text-slate-400 block mb-1">flavor_profile <span className="text-slate-600">(hold Ctrl/⌘ for multiple)</span></label>
              <select
                multiple
                value={(localFields['flavor_profile'] ?? '').split(',').map(s => s.trim()).filter(Boolean)}
                onChange={e => {
                  const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                  setLocalFields(prev => ({ ...prev, flavor_profile: selected.join(', ') }));
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-28"
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
