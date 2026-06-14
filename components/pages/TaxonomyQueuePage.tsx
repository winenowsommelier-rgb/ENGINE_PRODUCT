'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, X, Wine, Droplets, Star, Tag, MapPin, Layers } from 'lucide-react';

type Product = Record<string, any>;
type TaxonomyProposal = {
  id: string;
  type: string;
  proposed_value: string;
  parent_path: string;
  source_sku: string | null;
  occurrences: number;
  status: string;
};
type TaxOptions = {
  countries: string[];
  regions: Array<{ name: string; country: string }>;
  subregions: string[];
  classifications: string[];
  grapeVarieties: string[];
  flavorNotes: string[];
};
type ClaudeSuggestions = {
  country?: string; region?: string; subregion?: string;
  classification?: string; grape_variety?: string;
  confidence?: number; note?: string;
};

const WINE_TYPE_OPTIONS = ['Red Wine', 'White Wine', 'Rosé', 'Sparkling', 'Dessert'];
const LIQUOR_TYPE_OPTIONS = ['Whisky', 'Rum', 'Tequila', 'Gin', 'Vodka', 'Brandy', 'Other'];
const ALL_PANEL_FIELDS = ['country', 'region', 'subregion', 'origin', 'classification', 'grape_variety', 'wine_type', 'liquor_main_type', 'flavor_profile'];
const CLAUDE_SUGGESTION_FIELDS = ['country', 'region', 'subregion', 'classification', 'grape_variety'] as const;

// Flavor category color map
const FLAVOR_COLORS: Record<string, string> = {
  fruit: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  spice: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  herbal: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  earth: 'bg-stone-500/20 text-stone-300 border-stone-500/30',
  oak: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  floral: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  mineral: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
  sweet: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};
const DEFAULT_FLAVOR_COLOR = 'bg-blue-500/20 text-blue-300 border-blue-500/30';

// Guess flavor category from name
function guessFlavorCategory(flavor: string): string {
  const f = flavor.toLowerCase();
  if (/apple|pear|cherry|plum|berry|fig|peach|citrus|lemon|lime|orange|grape|melon|tropical|mango|pineapple|passion/.test(f)) return 'fruit';
  if (/pepper|spice|clove|cinnamon|ginger|nutmeg|cardamom|vanilla/.test(f)) return 'spice';
  if (/grass|mint|herb|eucalyptus|thyme|bay|sage|green/.test(f)) return 'herbal';
  if (/earth|soil|mushroom|truffle|leather|tobacco/.test(f)) return 'earth';
  if (/oak|cedar|wood|smoke|toast/.test(f)) return 'oak';
  if (/floral|rose|violet|jasmine|blossom|flower/.test(f)) return 'floral';
  if (/mineral|chalk|flint|stone|slate/.test(f)) return 'mineral';
  if (/honey|caramel|chocolate|cream|butter|sweet/.test(f)) return 'sweet';
  return 'other';
}

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
}

function fmt(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function fmtCurrency(v: any, currency = 'THB'): string {
  if (!v && v !== 0) return '—';
  const num = parseFloat(String(v));
  if (isNaN(num)) return '—';
  const cur = (currency || 'THB').toUpperCase();
  return (num / 100).toLocaleString('th-TH', { style: 'currency', currency: cur });
}

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
  const [activeTab, setActiveTab] = useState<'info' | 'edit'>('info');
  const [pageTab, setPageTab] = useState<'queue' | 'proposals'>('queue');
  const [proposals, setProposals] = useState<TaxonomyProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalActionId, setProposalActionId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/taxonomy-options').then(r => r.json()).then(setTaxOptions);
  }, []);

  async function load(p = page, f = filter) {
    const res = await fetch(`/api/taxonomy-queue?page=${p}&validation_status=${f}`);
    setData(await res.json());
  }

  useEffect(() => { load(); }, [page, filter]);

  async function loadProposals() {
    setProposalsLoading(true);
    try {
      const res = await fetch('/api/taxonomy-proposals?status=pending');
      const json = await res.json();
      setProposals(Array.isArray(json) ? json : (json.proposals ?? []));
    } finally {
      setProposalsLoading(false);
    }
  }

  useEffect(() => { if (pageTab === 'proposals') loadProposals(); }, [pageTab]);

  async function handleProposalAction(id: string, action: 'approve' | 'reject') {
    if (proposalActionId) return;
    setProposalActionId(id);
    try {
      const res = await fetch('/api/taxonomy-proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setMessage(`Error: ${err.error ?? 'Request failed'}`);
        return;
      }
      await loadProposals();
    } catch {
      setMessage('Error: could not reach server');
    } finally {
      setProposalActionId(null);
    }
  }

  function openPanel(p: Product) {
    const fields: Record<string, string> = {};
    ALL_PANEL_FIELDS.forEach(f => { fields[f] = String(p[f] ?? ''); });
    setLocalFields(fields);
    setPanelProduct(p);
    setClaudeSuggestions(null);
    setClaudeNote('');
    setActiveTab('info');
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
          sku: panelProduct.sku, name: panelProduct.name,
          wine_type: panelProduct.wine_type, liquor_main_type: panelProduct.liquor_main_type,
          country: panelProduct.country, region: panelProduct.region,
        }),
      });
      const json = await res.json();
      if (json.error) { setClaudeNote(`Error: ${json.error}`); }
      else { setClaudeSuggestions(json.suggestions); setClaudeNote(json.suggestions?.note ?? ''); }
    } catch { setClaudeNote('Claude API unavailable. Try again.'); }
    finally { setClaudeLoading(false); }
  }

  function acceptSuggestion(field: string, value: string) {
    setLocalFields(prev => ({ ...prev, [field]: value }));
    setClaudeSuggestions(prev => prev ? { ...prev, [field]: undefined } : null);
    setActiveTab('edit');
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
    setActiveTab('edit');
  }

  const isWine = (p: Product) => String(p.wine_type ?? p.category ?? '').toLowerCase().includes('wine') || !String(p.liquor_main_type ?? '').trim();
  const filteredRegions = taxOptions?.regions.filter(r => !localFields['country'] || r.country === localFields['country']) ?? [];

  const sel = (field: string, opts: string[]) => (
    <select value={localFields[field] ?? ''} onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
      <option value="">— select —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  const txt = (field: string, placeholder?: string) => (
    <input value={localFields[field] ?? ''} onChange={e => setLocalFields(prev => ({ ...prev, [field]: e.target.value }))}
      placeholder={placeholder} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600" />
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
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">Taxonomy Queue</h1>
          <div className="flex gap-1">
            {(['queue', 'proposals'] as const).map(tab => (
              <button key={tab} onClick={() => setPageTab(tab)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors capitalize ${pageTab === tab ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {tab === 'queue' ? 'Queue' : 'Proposals'}
              </button>
            ))}
          </div>
        </div>
        {pageTab === 'queue' && (
        <div className="flex items-center gap-3">
          <select aria-label="Filter by validation status" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500/60">
            <option value="unvalidated">Unvalidated</option>
            <option value="needs_review">Needs review</option>
            <option value="needs_attention">Needs attention</option>
            <option value="validated">Validated</option>
          </select>
          <input aria-label="Batch size" type="number" min={1} max={500} value={batchN} onChange={e => setBatchN(parseInt(e.target.value) || 50)}
            className="w-20 bg-white/10 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500/60" />
          <button onClick={handleBatchValidate} disabled={working}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors">
            Batch validate top {batchN}
          </button>
        </div>
        )}
      </div>

      <div aria-live="polite" aria-atomic="true">
      {message && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex justify-between">
          <span className="text-emerald-300 text-sm">{message}</span>
          <button aria-label="Dismiss" onClick={() => setMessage(null)}><X size={14} className="text-slate-400" /></button>
        </div>
      )}
      </div>

      {pageTab === 'queue' && (
      <>
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
                <tr key={p.id} className={`border-b border-white/5 hover:bg-white/5 cursor-pointer ${isOpen ? 'bg-violet-500/5' : ''} ${p.validation_status === 'needs_attention' ? 'border-l-2 border-l-rose-500/50' : ''}`}
                  onClick={() => openPanel(p)}>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-xs truncate">{p.name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.country || <span className="text-slate-600 italic">unknown</span>}</td>
                  <td className="px-4 py-3">{confidenceBadge(conf)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.enrichment_source ?? '—'}</td>
                  <td className="px-4 py-3">
                    {isOpen
                      ? <span className="rounded-full px-2 py-0.5 text-xs bg-violet-500/20 text-violet-200">In review</span>
                      : <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.validation_status ?? 'unvalidated'] ?? 'bg-slate-500/20 text-slate-300'}`}>{p.validation_status ?? 'unvalidated'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={e => { e.stopPropagation(); openPanel(p); }} className="text-violet-400 hover:text-violet-300 text-xs">Validate →</button>
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
      </>
      )}

      {pageTab === 'proposals' && (
        <div>
          {proposalsLoading ? (
            <p className="text-slate-400 text-sm py-8 text-center">Loading proposals…</p>
          ) : proposals.length === 0 ? (
            <div className="bg-white/5 rounded-xl p-12 text-center">
              <p className="text-slate-400 text-sm">No pending proposals</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(new Set(proposals.map(pr => pr.type))).map(type => {
                const group = proposals.filter(pr => pr.type === type);
                if (!group.length) return null;
                return (
                  <div key={type} className="bg-white/5 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-white/10">
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{type.replaceAll('_', ' ')}</span>
                      <span className="ml-2 text-xs text-slate-500">{group.length} proposal{group.length !== 1 ? 's' : ''}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5">
                          {['Proposed Value', 'Type', 'Parent Path', 'Occurrences', 'Source SKU', ''].map(h => (
                            <th key={h} className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.map(pr => (
                          <tr key={pr.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-4 py-3 text-white font-medium">{pr.proposed_value ?? '—'}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{pr.type ?? '—'}</td>
                            <td className="px-4 py-3 text-slate-300">{pr.parent_path || '—'}</td>
                            <td className="px-4 py-3 text-slate-300">{pr.occurrences ?? '—'}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-400">{pr.source_sku ?? '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleProposalAction(pr.id, 'approve')}
                                  disabled={!!proposalActionId}
                                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg transition-colors">
                                  Approve
                                </button>
                                <button onClick={() => handleProposalAction(pr.id, 'reject')}
                                  disabled={!!proposalActionId}
                                  className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg transition-colors">
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Product Detail Panel */}
      {panelProduct && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-slate-950 border-l border-white/10 overflow-y-auto z-50 flex flex-col">

          {/* Panel Header */}
          <div className="px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500">{panelProduct.sku}</p>
                <h2 className="text-base font-semibold text-white mt-0.5 leading-tight">{panelProduct.name}</h2>
                {panelProduct.brand && <p className="text-xs text-slate-400 mt-0.5">{panelProduct.brand}</p>}
              </div>
              <button onClick={closePanel} className="text-slate-400 hover:text-white shrink-0 mt-0.5">
                <X size={16} />
              </button>
            </div>

            {/* Status + Confidence row */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[panelProduct.validation_status ?? 'unvalidated'] ?? 'bg-slate-500/20 text-slate-300'}`}>
                {panelProduct.validation_status ?? 'unvalidated'}
              </span>
              {(() => {
                const conf = parseFloat(String(panelProduct.overall_confidence ?? panelProduct.taxonomy_confidence ?? 0));
                return confidenceBadge(conf);
              })()}
              {panelProduct.enrichment_source && (
                <span className="text-xs text-slate-500">via {panelProduct.enrichment_source}</span>
              )}
              {panelProduct.vintage && <span className="text-xs text-slate-400 bg-white/5 rounded px-2 py-0.5">Vintage {panelProduct.vintage}</span>}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {(['info', 'edit'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors capitalize ${activeTab === tab ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  {tab === 'info' ? 'Product Info' : 'Edit & Validate'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {activeTab === 'info' && (
              <>
                {/* Quick specs */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Price', value: fmtCurrency(panelProduct.price) },
                    { label: 'Alcohol', value: panelProduct.alcohol ? `${panelProduct.alcohol}%` : '—' },
                    { label: 'Bottle', value: fmt(panelProduct.bottle_size) },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-white">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Taxonomy card */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers size={13} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Taxonomy</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                    {[
                      { label: 'Type', value: panelProduct.wine_type || panelProduct.liquor_main_type },
                      { label: 'Item Category', value: panelProduct.classification },
                      { label: 'Grape / Variety', value: panelProduct.grape_variety },
                      { label: 'Origin', value: panelProduct.origin },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="text-white mt-0.5">{fmt(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Origin / Geography card */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin size={13} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Geography</h3>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[panelProduct.country, panelProduct.region, panelProduct.subregion]
                      .filter(Boolean)
                      .map((loc, i, arr) => (
                        <span key={i} className="flex items-center gap-1.5 text-sm text-white">
                          {loc}{i < arr.length - 1 && <span className="text-slate-600">›</span>}
                        </span>
                      ))}
                    {!panelProduct.country && !panelProduct.region && (
                      <span className="text-sm text-slate-500 italic">Origin unknown</span>
                    )}
                  </div>
                  {panelProduct.enrichment_note && (
                    <p className="text-xs text-slate-500 mt-2 italic">{panelProduct.enrichment_note}</p>
                  )}
                </div>

                {/* Character traits */}
                {(() => {
                  const traits = parseTags(panelProduct.character_traits);
                  if (!traits.length) return null;
                  return (
                    <div className="bg-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Star size={13} className="text-violet-400" />
                        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Character</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {traits.map(trait => (
                          <span key={trait} className="px-3 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/25 capitalize">
                            {trait}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Flavor profile */}
                {(() => {
                  const flavors = parseTags(panelProduct.flavor_profile);
                  if (!flavors.length) return null;
                  const grouped = flavors.reduce<Record<string, string[]>>((acc, f) => {
                    const cat = guessFlavorCategory(f);
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(f);
                    return acc;
                  }, {});
                  return (
                    <div className="bg-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Droplets size={13} className="text-violet-400" />
                        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Flavour Profile</h3>
                      </div>
                      {Object.entries(grouped).map(([cat, items]) => (
                        <div key={cat} className="mb-3 last:mb-0">
                          <p className="text-xs text-slate-500 mb-1.5 capitalize">{cat}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map(f => {
                              const colorClass = FLAVOR_COLORS[cat] ?? DEFAULT_FLAVOR_COLOR;
                              return (
                                <span key={f} className={`px-2.5 py-1 rounded-full text-xs border ${colorClass}`}>{f}</span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Confidence breakdown */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag size={13} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Confidence</h3>
                  </div>
                  {[
                    { label: 'Overall', value: parseFloat(String(panelProduct.overall_confidence ?? 0)) },
                    { label: 'Taxonomy', value: parseFloat(String(panelProduct.taxonomy_confidence ?? 0)) },
                  ].map(({ label, value }) => (
                    <div key={label} className="mb-2.5 last:mb-0">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{label}</span>
                        <span className={value >= 0.75 ? 'text-emerald-400' : value >= 0.4 ? 'text-amber-400' : 'text-rose-400'}>
                          {Math.round(value * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full">
                        <div className={`h-1.5 rounded-full transition-all ${value >= 0.75 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${Math.round(value * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={() => setActiveTab('edit')}
                  className="w-full bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-sm py-2.5 rounded-xl transition-colors">
                  Edit taxonomy fields →
                </button>
              </>
            )}

            {activeTab === 'edit' && (
              <>
                {/* Ask Claude */}
                <div className="border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-slate-300">Claude AI Assist</p>
                    <button onClick={handleAskClaude} disabled={claudeLoading}
                      className="text-xs bg-violet-600/30 hover:bg-violet-600/50 disabled:opacity-50 text-violet-300 px-3 py-1 rounded-lg transition-colors">
                      {claudeLoading ? 'Asking…' : '✦ Ask Claude'}
                    </button>
                  </div>
                  {claudeNote && <p className="text-xs text-slate-500 mb-2 italic">{claudeNote}</p>}
                  {claudeSuggestions && (
                    <div className="space-y-2">
                      {CLAUDE_SUGGESTION_FIELDS.map(field => {
                        const val = claudeSuggestions[field];
                        if (!val) return null;
                        return (
                          <div key={field} className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">{field}: <span className="text-white">{val}</span></span>
                            <button onClick={() => acceptSuggestion(field, val)} className="text-emerald-400 hover:text-emerald-300 ml-2 shrink-0">Accept</button>
                          </div>
                        );
                      })}
                      <button onClick={acceptAllSuggestions}
                        className="w-full text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 py-1.5 rounded-lg transition-colors mt-1">
                        Accept all
                      </button>
                    </div>
                  )}
                </div>

                {/* Taxonomy fields */}
                <div className="space-y-3">
                  <div><label className="text-xs text-slate-400 block mb-1">Country</label>{sel('country', taxOptions?.countries ?? [])}</div>
                  <div><label className="text-xs text-slate-400 block mb-1">Region</label>{sel('region', filteredRegions.map(r => r.name))}</div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Subregion</label>
                    <input list="subregion-options" value={localFields['subregion'] ?? ''}
                      onChange={e => setLocalFields(prev => ({ ...prev, subregion: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                    <datalist id="subregion-options">{(taxOptions?.subregions ?? []).map(s => <option key={s} value={s} />)}</datalist>
                  </div>
                  <div><label className="text-xs text-slate-400 block mb-1">Origin</label>{txt('origin')}</div>
                  <div><label className="text-xs text-slate-400 block mb-1">Item Category</label>{sel('classification', taxOptions?.classifications ?? [])}</div>
                  <div><label className="text-xs text-slate-400 block mb-1">Grape / Variety</label>{sel('grape_variety', taxOptions?.grapeVarieties ?? [])}</div>
                  {isWine(panelProduct)
                    ? <div><label className="text-xs text-slate-400 block mb-1">Wine type</label>{sel('wine_type', WINE_TYPE_OPTIONS)}</div>
                    : <div><label className="text-xs text-slate-400 block mb-1">Liquor type</label>{sel('liquor_main_type', LIQUOR_TYPE_OPTIONS)}</div>}
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Flavour profile <span className="text-slate-600">(hold Ctrl/⌘ for multiple)</span></label>
                    <select multiple value={(localFields['flavor_profile'] ?? '').split(',').map(s => s.trim()).filter(Boolean)}
                      onChange={e => { const selected = Array.from(e.target.selectedOptions).map(o => o.value); setLocalFields(prev => ({ ...prev, flavor_profile: selected.join(', ') })); }}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white h-28">
                      {(taxOptions?.flavorNotes ?? []).map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sticky save button */}
          <div className="px-6 py-4 border-t border-white/10 shrink-0">
            <button onClick={handleValidateOne} disabled={saving}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors font-medium">
              <CheckCircle size={15} /> {saving ? 'Saving…' : 'Save & mark as validated'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
