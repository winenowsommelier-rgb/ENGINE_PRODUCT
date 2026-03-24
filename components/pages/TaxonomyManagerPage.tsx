'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, ChevronDown } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Entity = 'countries' | 'regions' | 'subregions' | 'classifications' | 'brands';

type Country    = { id: number; name: string; iso: string };
type Region     = { id: number; country_id: number; name: string };
type Subregion  = { id: number; region_id: number; name: string; subregion_type: string };
type Classification = {
  classification_id: number; classification: string; classification_slug: string;
  classification_group: string; category_scope: string; priority: number;
  description: string; is_active: number | boolean;
};
type Brand = { id: number; name: string; country: string; region: string; notes: string };

// ─── Config ───────────────────────────────────────────────────────────────────

const TABS: Array<{ id: Entity; label: string }> = [
  { id: 'countries',       label: 'Countries' },
  { id: 'regions',         label: 'Regions' },
  { id: 'subregions',      label: 'Sub-regions' },
  { id: 'classifications', label: 'Classifications' },
  { id: 'brands',          label: 'Brands' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function idOf(entity: Entity, item: any): number {
  return entity === 'classifications' ? item.classification_id : item.id;
}

function Input({ label, value, onChange, placeholder, small }: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; small?: boolean;
}) {
  return (
    <div className={small ? '' : 'flex flex-col gap-1'}>
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
      />
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
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50 pr-8"
        >
          <option value="">— select —</option>
          {options.map(o => (
            <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Row-level edit form ──────────────────────────────────────────────────────

function EditRow({ entity, item, countries, regions, onSave, onCancel }: {
  entity: Entity; item: any; countries: Country[]; regions: Region[];
  onSave: (updated: any) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<any>({ ...item });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <tr className="bg-violet-500/5">
      <td colSpan={99} className="px-4 py-3">
        <div className="flex items-end gap-3 flex-wrap">
          {entity === 'countries' && <>
            <div className="flex-1 min-w-32"><Input label="Name" value={form.name ?? ''} onChange={v => set('name', v)} /></div>
            <div className="w-20"><Input label="ISO" value={form.iso ?? ''} onChange={v => set('iso', v.toUpperCase().slice(0, 2))} placeholder="FR" /></div>
          </>}

          {entity === 'regions' && <>
            <div className="flex-1 min-w-40"><Input label="Name" value={form.name ?? ''} onChange={v => set('name', v)} /></div>
            <div className="w-44">
              <Select label="Country" value={String(form.country_id ?? '')} onChange={v => set('country_id', Number(v))}
                options={countries.map(c => ({ value: String(c.id), label: c.name }))} />
            </div>
          </>}

          {entity === 'subregions' && <>
            <div className="flex-1 min-w-40"><Input label="Name" value={form.name ?? ''} onChange={v => set('name', v)} /></div>
            <div className="w-44">
              <Select label="Region" value={String(form.region_id ?? '')} onChange={v => set('region_id', Number(v))}
                options={regions.map(r => ({ value: String(r.id), label: r.name }))} />
            </div>
            <div className="w-36"><Input label="Type" value={form.subregion_type ?? ''} onChange={v => set('subregion_type', v)} placeholder="subregion" /></div>
          </>}

          {entity === 'classifications' && <>
            <div className="flex-1 min-w-40"><Input label="Name" value={form.classification ?? ''} onChange={v => set('classification', v)} /></div>
            <div className="w-40"><Input label="Group" value={form.classification_group ?? ''} onChange={v => set('classification_group', v)} /></div>
            <div className="w-36">
              <Select label="Scope" value={form.category_scope ?? ''} onChange={v => set('category_scope', v)}
                options={[{ value: 'wine', label: 'Wine' }, { value: 'spirits', label: 'Spirits' }, { value: 'all', label: 'All' }]} />
            </div>
            <div className="flex-1 min-w-48"><Input label="Description" value={form.description ?? ''} onChange={v => set('description', v)} /></div>
            <div className="w-24">
              <Select label="Active" value={form.is_active ? '1' : '0'} onChange={v => set('is_active', v === '1' ? 1 : 0)}
                options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
            </div>
          </>}

          {entity === 'brands' && <>
            <div className="flex-1 min-w-40"><Input label="Brand Name" value={form.name ?? ''} onChange={v => set('name', v)} /></div>
            <div className="w-44">
              <Select label="Country" value={form.country ?? ''} onChange={v => set('country', v)}
                options={countries.map(c => ({ value: c.name, label: c.name }))} />
            </div>
            <div className="w-40"><Input label="Region (optional)" value={form.region ?? ''} onChange={v => set('region', v)} /></div>
            <div className="flex-1"><Input label="Notes" value={form.notes ?? ''} onChange={v => set('notes', v)} /></div>
          </>}

          <div className="flex gap-2 pb-0.5">
            <button onClick={() => onSave(form)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs px-3 py-2 rounded-lg transition-colors">
              <Check size={13} /> Save
            </button>
            <button onClick={onCancel} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs px-3 py-2 rounded-lg transition-colors">
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Entity tables ────────────────────────────────────────────────────────────

function CountriesTable({ items, onEdit, onDelete }: { items: Country[]; onEdit: (i: any) => void; onDelete: (id: number) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-white/10 text-left">
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Name</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400 w-20">ISO</th>
        <th className="px-4 py-2.5 w-20" />
      </tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className="border-b border-white/5 hover:bg-white/3 group">
            <td className="px-4 py-2.5 text-white">{item.name}</td>
            <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{item.iso}</td>
            <td className="px-4 py-2.5"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RegionsTable({ items, countries, onEdit, onDelete }: { items: Region[]; countries: Country[]; onEdit: (i: any) => void; onDelete: (id: number) => void }) {
  const countryName = (id: number) => countries.find(c => c.id === id)?.name ?? '—';
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-white/10 text-left">
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Name</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Country</th>
        <th className="px-4 py-2.5 w-20" />
      </tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className="border-b border-white/5 hover:bg-white/3 group">
            <td className="px-4 py-2.5 text-white">{item.name}</td>
            <td className="px-4 py-2.5 text-slate-400">{countryName(item.country_id)}</td>
            <td className="px-4 py-2.5"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SubregionsTable({ items, regions, onEdit, onDelete }: { items: Subregion[]; regions: Region[]; onEdit: (i: any) => void; onDelete: (id: number) => void }) {
  const regionName = (id: number) => regions.find(r => r.id === id)?.name ?? '—';
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-white/10 text-left">
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Name</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Region</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Type</th>
        <th className="px-4 py-2.5 w-20" />
      </tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className="border-b border-white/5 hover:bg-white/3 group">
            <td className="px-4 py-2.5 text-white">{item.name}</td>
            <td className="px-4 py-2.5 text-slate-400">{regionName(item.region_id)}</td>
            <td className="px-4 py-2.5 text-slate-500 text-xs">{item.subregion_type}</td>
            <td className="px-4 py-2.5"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClassificationsTable({ items, onEdit, onDelete }: { items: Classification[]; onEdit: (i: any) => void; onDelete: (id: number) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-white/10 text-left">
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Name</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Group</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Scope</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400 hidden md:table-cell">Description</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400 w-20">Active</th>
        <th className="px-4 py-2.5 w-20" />
      </tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.classification_id} className="border-b border-white/5 hover:bg-white/3 group">
            <td className="px-4 py-2.5 text-white">{item.classification}</td>
            <td className="px-4 py-2.5 text-slate-400 text-xs">{item.classification_group}</td>
            <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${item.category_scope === 'wine' ? 'bg-violet-500/20 text-violet-300' : item.category_scope === 'spirits' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/10 text-slate-300'}`}>{item.category_scope}</span></td>
            <td className="px-4 py-2.5 text-slate-500 text-xs hidden md:table-cell truncate max-w-xs">{item.description}</td>
            <td className="px-4 py-2.5">{item.is_active ? <span className="text-xs text-emerald-400">●</span> : <span className="text-xs text-slate-600">●</span>}</td>
            <td className="px-4 py-2.5"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.classification_id)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BrandsTable({ items, onEdit, onDelete }: { items: Brand[]; onEdit: (i: any) => void; onDelete: (id: number) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-white/10 text-left">
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Brand Name</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Country</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400">Region</th>
        <th className="px-4 py-2.5 text-xs font-medium text-slate-400 hidden md:table-cell">Notes</th>
        <th className="px-4 py-2.5 w-20" />
      </tr></thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id} className="border-b border-white/5 hover:bg-white/3 group">
            <td className="px-4 py-2.5 text-white font-medium">{item.name}</td>
            <td className="px-4 py-2.5 text-slate-400">{item.country || '—'}</td>
            <td className="px-4 py-2.5 text-slate-400">{item.region || '—'}</td>
            <td className="px-4 py-2.5 text-slate-500 text-xs hidden md:table-cell">{item.notes || '—'}</td>
            <td className="px-4 py-2.5"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={onEdit} className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><Pencil size={13} /></button>
      <button onClick={onDelete} className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"><Trash2 size={13} /></button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TaxonomyManagerPage() {
  const [tab, setTab] = useState<Entity>('countries');
  const [data, setData] = useState<Record<Entity, any[]>>({
    countries: [], regions: [], subregions: [], classifications: [], brands: [],
  });
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (entity: Entity) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/taxonomy/${entity}`);
      const json = await res.json();
      setData(d => ({ ...d, [entity]: json.data ?? [] }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const items = data[tab] ?? [];

  const filtered = items.filter(item => {
    if (!search) return true;
    const q = search.toLowerCase();
    return Object.values(item).some(v => String(v ?? '').toLowerCase().includes(q));
  });

  async function handleSave(updated: any) {
    const itemId = editingId ?? idOf(tab, updated);
    await fetch(`/api/taxonomy/${tab}/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated),
    });
    setEditingId(null);
    load(tab);
  }

  async function handleCreate(newItem: any) {
    await fetch(`/api/taxonomy/${tab}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newItem),
    });
    setAdding(false);
    load(tab);
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/taxonomy/${tab}/${id}`, { method: 'DELETE' });
    load(tab);
  }

  const blankItem: Record<Entity, any> = {
    countries: { name: '', iso: '' },
    regions: { name: '', country_id: '' },
    subregions: { name: '', region_id: '', subregion_type: 'subregion' },
    classifications: { classification: '', classification_slug: '', classification_group: '', category_scope: 'wine', priority: 99, description: '', is_active: 1 },
    brands: { name: '', country: '', region: '', notes: '' },
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Taxonomy Manager</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage reference data: countries, regions, classifications, and brands</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(''); setAdding(false); setEditingId(null); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-violet-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-slate-500">
              {data[t.id]?.length ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${tab}…`}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <button
          onClick={() => { setAdding(true); setEditingId(null); }}
          disabled={adding}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={14} /> Add {TABS.find(t => t.id === tab)?.label.replace(/s$/, '')}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Add new row */}
              {adding && (
                <tbody>
                  <EditRow
                    entity={tab}
                    item={blankItem[tab]}
                    countries={data.countries}
                    regions={data.regions}
                    onSave={handleCreate}
                    onCancel={() => setAdding(false)}
                  />
                </tbody>
              )}
            </table>

            {tab === 'countries' && (
              <CountriesTable
                items={filtered as Country[]}
                onEdit={item => { setEditingId(idOf(tab, item)); setAdding(false); }}
                onDelete={handleDelete}
              />
            )}
            {tab === 'regions' && (
              <RegionsTable
                items={filtered as Region[]}
                countries={data.countries}
                onEdit={item => { setEditingId(idOf(tab, item)); setAdding(false); }}
                onDelete={handleDelete}
              />
            )}
            {tab === 'subregions' && (
              <SubregionsTable
                items={filtered as Subregion[]}
                regions={data.regions}
                onEdit={item => { setEditingId(idOf(tab, item)); setAdding(false); }}
                onDelete={handleDelete}
              />
            )}
            {tab === 'classifications' && (
              <ClassificationsTable
                items={filtered as Classification[]}
                onEdit={item => { setEditingId(idOf(tab, item)); setAdding(false); }}
                onDelete={handleDelete}
              />
            )}
            {tab === 'brands' && (
              <BrandsTable
                items={filtered as Brand[]}
                onEdit={item => { setEditingId(idOf(tab, item)); setAdding(false); }}
                onDelete={handleDelete}
              />
            )}

            {/* Inline edit overlay */}
            {editingId !== null && (() => {
              const item = items.find((i: any) => idOf(tab, i) === editingId);
              if (!item) return null;
              return (
                <table className="w-full">
                  <tbody>
                    <EditRow
                      entity={tab}
                      item={item}
                      countries={data.countries}
                      regions={data.regions}
                      onSave={handleSave}
                      onCancel={() => setEditingId(null)}
                    />
                  </tbody>
                </table>
              );
            })()}

            {filtered.length === 0 && !loading && !adding && (
              <div className="p-8 text-center text-slate-500 text-sm">
                {search ? `No results for "${search}"` : `No ${tab} yet. Click Add to create the first one.`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer count */}
      <p className="text-xs text-slate-600 mt-3">
        {filtered.length} of {items.length} entries
      </p>
    </div>
  );
}
