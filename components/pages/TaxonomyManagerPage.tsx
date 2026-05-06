'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';

// --- Types ---

type Entity = 'countries' | 'regions' | 'subregions' | 'classifications' | 'brands';

type Country = { id: number; name: string; iso: string };
type Region = { id: number; country_id: number; name: string };
type Subregion = { id: number; region_id: number; name: string; subregion_type: string };
type Classification = {
  classification_id: number; classification: string; classification_slug: string;
  classification_group: string; category_scope: string; priority: number;
  description: string; is_active: number | boolean;
};
type Brand = { id: number; name: string; country: string; region: string; notes: string };

type DescEntry = {
  name: string; parentCountry: string; parentRegion: string;
  productCount: number; segments: string; status: string;
  shortDesc: string; fullDesc: string; notes: string;
};

// Map entity tab to description type
const DESC_TYPE_MAP: Record<Entity, string> = {
  countries: 'country',
  regions: 'region',
  subregions: 'subregion',
  classifications: 'classification',
  brands: 'brand',
};

const TABS: Array<{ id: Entity; label: string }> = [
  { id: 'countries', label: 'Countries' },
  { id: 'regions', label: 'Regions' },
  { id: 'subregions', label: 'Sub-regions' },
  { id: 'classifications', label: 'Item Categories' },
  { id: 'brands', label: 'Brands' },
];

// --- Helpers ---

function idOf(entity: Entity, item: any): number {
  return entity === 'classifications' ? item.classification_id : item.id;
}

function nameOf(entity: Entity, item: any): string {
  return entity === 'classifications' ? item.classification : item.name;
}

function Input({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <input value={value} onChange={function (e) { onChange(e.target.value); }} placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50" />
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, rows }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <textarea value={value} onChange={function (e) { onChange(e.target.value); }} placeholder={placeholder}
        rows={rows || 3}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 resize-y" />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <div className="relative">
        <select value={value} onChange={function (e) { onChange(e.target.value); }}
          className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50 pr-8">
          <option value="">-- select --</option>
          {options.map(function (o) { return <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>; })}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// --- Description badge ---

function DescBadge({ status }: { status: string }) {
  if (!status) return null;
  var cls = 'bg-slate-500/15 text-slate-400';
  if (status === 'draft_ready') cls = 'bg-emerald-500/15 text-emerald-400';
  if (status === 'draft_catalog_based') cls = 'bg-amber-500/15 text-amber-400';
  if (status === 'needs_review') cls = 'bg-rose-500/15 text-rose-400';
  return <span className={'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ' + cls}>{status.replace(/_/g, ' ')}</span>;
}

// --- Scope badge ---

function ScopeBadge({ scope }: { scope: string }) {
  var cls = 'bg-white/10 text-slate-300';
  if (scope === 'wine') cls = 'bg-violet-500/20 text-violet-300';
  if (scope === 'spirits') cls = 'bg-amber-500/20 text-amber-300';
  if (scope === 'beer') cls = 'bg-yellow-500/20 text-yellow-300';
  return <span className={'text-xs px-2 py-0.5 rounded-full ' + cls}>{scope}</span>;
}

// --- Main Page ---

export function TaxonomyManagerPage() {
  var [tab, setTab] = useState<Entity>('countries');
  var [data, setData] = useState<Record<Entity, any[]>>({
    countries: [], regions: [], subregions: [], classifications: [], brands: [],
  });
  var [descriptions, setDescriptions] = useState<Record<string, DescEntry>>({});
  var [search, setSearch] = useState('');
  var [editingId, setEditingId] = useState<number | null>(null);
  var [adding, setAdding] = useState(false);
  var [loading, setLoading] = useState(false);
  var [expandedId, setExpandedId] = useState<number | null>(null);
  var [showDescs, setShowDescs] = useState(true);

  // Load taxonomy data
  var load = useCallback(async function (entity: Entity) {
    setLoading(true);
    try {
      var res = await fetch('/api/taxonomy/' + entity);
      var json = await res.json();
      setData(function (d) { return { ...d, [entity]: json.data || [] }; });
    } catch (_e) { /* ignore */ }
    setLoading(false);
  }, []);

  // Load descriptions for current tab
  var loadDescs = useCallback(async function (entity: Entity) {
    var descType = DESC_TYPE_MAP[entity];
    try {
      var res = await fetch('/api/taxonomy-descriptions?type=' + descType);
      var json = await res.json();
      var map: Record<string, DescEntry> = {};
      (json.entries || []).forEach(function (e: DescEntry) {
        map[e.name.toLowerCase()] = e;
      });
      setDescriptions(map);
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(function () { load(tab); loadDescs(tab); }, [tab, load, loadDescs]);

  var items = data[tab] || [];
  var countries = data.countries || [];
  var regions = data.regions || [];

  var filtered = items.filter(function (item: any) {
    if (!search) return true;
    var q = search.toLowerCase();
    return Object.values(item).some(function (v) { return String(v || '').toLowerCase().includes(q); });
  });

  var countryName = function (id: number) { return countries.find(function (c: Country) { return c.id === id; })?.name || '--'; };
  var regionName = function (id: number) { return regions.find(function (r: Region) { return r.id === id; })?.name || '--'; };

  function getDesc(item: any): DescEntry | undefined {
    var name = nameOf(tab, item).toLowerCase();
    return descriptions[name];
  }

  async function handleSave(updated: any) {
    var itemId = editingId || idOf(tab, updated);
    await fetch('/api/taxonomy/' + tab + '/' + itemId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated),
    });
    setEditingId(null);
    load(tab);
  }

  async function handleCreate(newItem: any) {
    await fetch('/api/taxonomy/' + tab, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newItem),
    });
    setAdding(false);
    load(tab);
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry?')) return;
    await fetch('/api/taxonomy/' + tab + '/' + id, { method: 'DELETE' });
    load(tab);
  }

  function toggleExpand(id: number) {
    setExpandedId(function (prev) { return prev === id ? null : id; });
  }

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-white">Taxonomy Manager</h1>
          <p className="text-xs text-slate-500 mt-0.5">Browse, search, and manage reference data with descriptions</p>
        </div>
        <button onClick={function () { setShowDescs(!showDescs); }}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 bg-white/5">
          {showDescs ? <EyeOff size={12} /> : <Eye size={12} />}
          {showDescs ? 'Hide descriptions' : 'Show descriptions'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 mb-5">
        {TABS.map(function (t) {
          return (
            <button key={t.id}
              onClick={function () { setTab(t.id); setSearch(''); setAdding(false); setEditingId(null); setExpandedId(null); }}
              className={'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ' +
                (tab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200')}>
              {t.label}
              <span className="ml-1.5 text-xs text-slate-500">{(data[t.id] || []).length}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={function (e) { setSearch(e.target.value); }}
            placeholder={'Search ' + tab + '...'}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50" />
        </div>
        <button onClick={function () { setAdding(true); setEditingId(null); }} disabled={adding}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Content */}
      <div className="space-y-1">
        {loading && items.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
        )}

        {/* Add form */}
        {adding && (
          <InlineEditForm entity={tab} item={getBlankItem(tab)} countries={countries} regions={regions}
            onSave={handleCreate} onCancel={function () { setAdding(false); }} />
        )}

        {/* Item rows */}
        {filtered.map(function (item: any) {
          var id = idOf(tab, item);
          var desc = getDesc(item);
          var isExpanded = expandedId === id;
          var isEditing = editingId === id;

          if (isEditing) {
            return (
              <InlineEditForm key={id} entity={tab} item={item} countries={countries} regions={regions}
                onSave={handleSave} onCancel={function () { setEditingId(null); }} />
            );
          }

          return (
            <div key={id} className="rounded-lg border border-white/6 bg-white/2 hover:bg-white/4 transition-colors group">
              {/* Main row */}
              <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer" onClick={function () { toggleExpand(id); }}>
                <ChevronRight size={13} className={'text-slate-600 transition-transform shrink-0 ' + (isExpanded ? 'rotate-90' : '')} />

                {/* Entity-specific columns */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{nameOf(tab, item)}</span>
                    {tab === 'countries' && <span className="text-xs text-slate-500 font-mono">{item.iso}</span>}
                    {tab === 'classifications' && <ScopeBadge scope={item.category_scope} />}
                    {tab === 'classifications' && (item.is_active ? <span className="text-xs text-emerald-400">Active</span> : <span className="text-xs text-slate-600">Inactive</span>)}
                    {tab === 'regions' && <span className="text-xs text-slate-500">{countryName(item.country_id)}</span>}
                    {tab === 'subregions' && <span className="text-xs text-slate-500">{regionName(item.region_id)}</span>}
                    {tab === 'subregions' && <span className="text-[10px] text-slate-600">{item.subregion_type}</span>}
                    {tab === 'brands' && item.country && <span className="text-xs text-slate-500">{item.country}</span>}
                    {tab === 'brands' && item.region && <span className="text-xs text-slate-600">{item.region}</span>}
                    {desc && <DescBadge status={desc.status} />}
                  </div>

                  {/* Short description preview (when showDescs is on) */}
                  {showDescs && desc && desc.shortDesc && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate max-w-2xl">{desc.shortDesc}</p>
                  )}
                </div>

                {/* Product count */}
                {desc && desc.productCount > 0 && (
                  <span className="text-xs text-slate-600 shrink-0">{desc.productCount} products</span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={function (e) { e.stopPropagation(); setEditingId(id); setAdding(false); }}
                    className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={function (e) { e.stopPropagation(); handleDelete(id); }}
                    className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5 ml-7">
                  {desc ? (
                    <div className="space-y-3">
                      {/* Short description */}
                      <div>
                        <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-1">Short Description</p>
                        <p className="text-sm text-slate-300 leading-relaxed">{desc.shortDesc || <span className="text-slate-600 italic">No short description</span>}</p>
                      </div>

                      {/* Full description */}
                      {desc.fullDesc && (
                        <div>
                          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-1">Full Description</p>
                          <p className="text-xs text-slate-400 leading-relaxed">{desc.fullDesc}</p>
                        </div>
                      )}

                      {/* Meta row */}
                      <div className="flex items-center gap-4 text-[10px] text-slate-600">
                        {desc.segments && <span>Segments: {desc.segments}</span>}
                        {desc.parentCountry && <span>Country: {desc.parentCountry}</span>}
                        {desc.parentRegion && <span>Region: {desc.parentRegion}</span>}
                        <DescBadge status={desc.status} />
                      </div>

                      {/* Notes */}
                      {desc.notes && (
                        <p className="text-[10px] text-slate-600 italic">{desc.notes}</p>
                      )}
                    </div>
                  ) : (
                    <div className="py-4 text-center">
                      <p className="text-xs text-slate-600">No description available for this entry</p>
                      <p className="text-[10px] text-slate-700 mt-1">Descriptions are generated from the catalog — run the description pipeline to fill.</p>
                    </div>
                  )}

                  {/* Item-category-specific: show the description field */}
                  {tab === 'classifications' && item.description && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-1">Taxonomy Description</p>
                      <p className="text-xs text-slate-400">{item.description}</p>
                    </div>
                  )}

                  {/* Brand notes */}
                  {tab === 'brands' && item.notes && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-1">Brand Notes</p>
                      <p className="text-xs text-slate-400">{item.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && !loading && !adding && (
          <div className="p-8 text-center text-slate-500 text-sm">
            {search ? 'No results for "' + search + '"' : 'No ' + tab + ' yet. Click Add to create the first one.'}
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-xs text-slate-600 mt-3">
        {filtered.length} of {items.length} entries
        {Object.keys(descriptions).length > 0 && (' | ' + Object.keys(descriptions).length + ' descriptions loaded')}
      </p>
    </div>
  );
}

// --- Inline edit form ---

function InlineEditForm({ entity, item, countries, regions, onSave, onCancel }: {
  entity: Entity; item: any; countries: Country[]; regions: Region[];
  onSave: (updated: any) => void; onCancel: () => void;
}) {
  var [form, setForm] = useState<any>({ ...item });
  function set(k: string, v: any) { setForm(function (f: any) { return { ...f, [k]: v }; }); }

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        {entity === 'countries' && <>
          <div className="flex-1 min-w-32"><Input label="Name" value={form.name || ''} onChange={function (v) { set('name', v); }} /></div>
          <div className="w-20"><Input label="ISO" value={form.iso || ''} onChange={function (v) { set('iso', v.toUpperCase().slice(0, 2)); }} placeholder="FR" /></div>
        </>}

        {entity === 'regions' && <>
          <div className="flex-1 min-w-40"><Input label="Name" value={form.name || ''} onChange={function (v) { set('name', v); }} /></div>
          <div className="w-44">
            <Select label="Country" value={String(form.country_id || '')} onChange={function (v) { set('country_id', Number(v)); }}
              options={countries.map(function (c) { return { value: String(c.id), label: c.name }; })} />
          </div>
        </>}

        {entity === 'subregions' && <>
          <div className="flex-1 min-w-40"><Input label="Name" value={form.name || ''} onChange={function (v) { set('name', v); }} /></div>
          <div className="w-44">
            <Select label="Region" value={String(form.region_id || '')} onChange={function (v) { set('region_id', Number(v)); }}
              options={regions.map(function (r) { return { value: String(r.id), label: r.name }; })} />
          </div>
          <div className="w-36"><Input label="Type" value={form.subregion_type || ''} onChange={function (v) { set('subregion_type', v); }} placeholder="subregion" /></div>
        </>}

        {entity === 'classifications' && <>
          <div className="flex-1 min-w-40"><Input label="Name" value={form.classification || ''} onChange={function (v) { set('classification', v); }} /></div>
          <div className="w-40"><Input label="Group" value={form.classification_group || ''} onChange={function (v) { set('classification_group', v); }} /></div>
          <div className="w-36">
            <Select label="Scope" value={form.category_scope || ''} onChange={function (v) { set('category_scope', v); }}
              options={[{ value: 'wine', label: 'Wine' }, { value: 'spirits', label: 'Spirits' }, { value: 'beer', label: 'Beer' }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="w-24">
            <Select label="Active" value={form.is_active ? '1' : '0'} onChange={function (v) { set('is_active', v === '1' ? 1 : 0); }}
              options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
          </div>
        </>}

        {entity === 'brands' && <>
          <div className="flex-1 min-w-40"><Input label="Brand Name" value={form.name || ''} onChange={function (v) { set('name', v); }} /></div>
          <div className="w-44">
            <Select label="Country" value={form.country || ''} onChange={function (v) { set('country', v); }}
              options={countries.map(function (c) { return { value: c.name, label: c.name }; })} />
          </div>
          <div className="w-40"><Input label="Region" value={form.region || ''} onChange={function (v) { set('region', v); }} /></div>
        </>}
      </div>

      {/* Description field for classifications */}
      {entity === 'classifications' && (
        <Textarea label="Description" value={form.description || ''} onChange={function (v) { set('description', v); }} rows={2} />
      )}

      {/* Notes for brands */}
      {entity === 'brands' && (
        <Textarea label="Notes" value={form.notes || ''} onChange={function (v) { set('notes', v); }} rows={2} />
      )}

      <div className="flex gap-2">
        <button onClick={function () { onSave(form); }}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">
          <Check size={13} /> Save
        </button>
        <button onClick={onCancel}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-3 py-2 rounded-lg transition-colors">
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  );
}

function getBlankItem(entity: Entity): any {
  var blanks: Record<Entity, any> = {
    countries: { name: '', iso: '' },
    regions: { name: '', country_id: '' },
    subregions: { name: '', region_id: '', subregion_type: 'subregion' },
    classifications: { classification: '', classification_slug: '', classification_group: '', category_scope: 'wine', priority: 99, description: '', is_active: 1 },
    brands: { name: '', country: '', region: '', notes: '' },
  };
  return blanks[entity];
}
