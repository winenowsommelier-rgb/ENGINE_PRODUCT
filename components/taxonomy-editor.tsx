'use client';

/**
 * taxonomy-editor.tsx
 * Full hierarchy taxonomy editor:
 * Country → Region → Sub-region → Origin → Classification → Ingredient (with aliases) → Flavour
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Edit2, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import {
  buildGeographyTree, classifications, flavours, getClassificationGroups,
  getFlavourFamilies, getIngredientGroups, ingredients,
  type TaxClassification, type TaxFlavour, type TaxIngredient,
  type TaxOrigin, type TaxRegion, type TaxSubregion, type GeographyTree,
} from '@/lib/taxonomy/service';

// ── shared inline edit ────────────────────────────────────────────────────────
function InlineEdit({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(value);
  return (
    <form onSubmit={e => { e.preventDefault(); if (val.trim()) onSave(val.trim()); }} className="flex items-center gap-1.5">
      <input autoFocus value={val} onChange={e => setVal(e.target.value)}
        className="rounded-lg border border-violet-400/40 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none w-44" />
      <button type="submit" className="rounded-lg bg-violet-500 px-2 py-1 text-xs text-white hover:bg-violet-400"><Check size={11} /></button>
      <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 hover:text-white"><X size={11} /></button>
    </form>
  );
}

function Pill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
      {label}
      <button onClick={onRemove} className="hover:text-rose-300"><X size={9} /></button>
    </span>
  );
}

// ── Geography Tab ─────────────────────────────────────────────────────────────
function GeographyTab() {
  const tree = useMemo(() => buildGeographyTree(), []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editKey, setEditKey] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<string | null>(null); // e.g. 'region:1' to add region under country 1
  const [search, setSearch] = useState('');

  // Local mutable copies for alias management
  const [regionAliases, setRegionAliases] = useState<Record<number, string[]>>({});
  const [subregionAliases, setSubregionAliases] = useState<Record<number, string[]>>({});
  const [aliasInput, setAliasInput] = useState<Record<string, string>>({});

  const toggle = (key: string) => setExpanded(prev => {
    const s = new Set(prev);
    s.has(key) ? s.delete(key) : s.add(key);
    return s;
  });

  const filteredTree = useMemo(() => {
    if (!search) return tree;
    const q = search.toLowerCase();
    return tree.filter(node =>
      node.country.name.toLowerCase().includes(q) ||
      node.regions.some(r => r.region.name.toLowerCase().includes(q) ||
        r.subregions.some(sr => sr.subregion.name.toLowerCase().includes(q) ||
          sr.origins.some(o => o.name.toLowerCase().includes(q))
        ))
    );
  }, [tree, search]);

  function addAlias(type: 'region' | 'subregion', id: number) {
    const key = `${type}-${id}`;
    const val = (aliasInput[key] ?? '').trim();
    if (!val) return;
    if (type === 'region') setRegionAliases(prev => ({ ...prev, [id]: [...(prev[id] ?? []), val] }));
    else setSubregionAliases(prev => ({ ...prev, [id]: [...(prev[id] ?? []), val] }));
    setAliasInput(prev => ({ ...prev, [key]: '' }));
  }

  function removeAlias(type: 'region' | 'subregion', id: number, alias: string) {
    if (type === 'region') setRegionAliases(prev => ({ ...prev, [id]: (prev[id] ?? []).filter(a => a !== alias) }));
    else setSubregionAliases(prev => ({ ...prev, [id]: (prev[id] ?? []).filter(a => a !== alias) }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search countries, regions, origins…"
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
        </div>
        <span className="text-xs text-slate-500">{tree.length} countries · {tree.reduce((a, c) => a + c.regions.length, 0)} regions · {tree.reduce((a, c) => a + c.regions.reduce((b, r) => b + r.subregions.length, 0), 0)} subregions</span>
      </div>

      <div className="space-y-1">
        {filteredTree.map(({ country, regions: countryRegions }) => (
          <div key={country.id} className="rounded-xl border border-white/10 overflow-hidden">
            {/* Country row */}
            <button type="button" onClick={() => toggle(`c-${country.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors">
              {expanded.has(`c-${country.id}`) ? <ChevronDown size={14} className="text-violet-400" /> : <ChevronRight size={14} className="text-slate-500" />}
              <span className="inline-flex h-5 w-7 items-center justify-center rounded bg-slate-700 text-[10px] font-mono text-slate-300">{country.iso}</span>
              <span className="font-medium text-white">{country.name}</span>
              <span className="ml-auto text-xs text-slate-500">{countryRegions.length} regions</span>
            </button>

            {expanded.has(`c-${country.id}`) && (
              <div className="border-t border-white/5 bg-white/2">
                {countryRegions.map(({ region, subregions: regionSubs }) => (
                  <div key={region.id} className="border-b border-white/5 last:border-0">
                    {/* Region row */}
                    <button type="button" onClick={() => toggle(`r-${region.id}`)}
                      className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-white/5 transition-colors">
                      {expanded.has(`r-${region.id}`) ? <ChevronDown size={12} className="text-cyan-400" /> : <ChevronRight size={12} className="text-slate-500" />}
                      <span className="text-sm text-slate-200">{region.name}</span>
                      <span className="ml-auto text-[10px] text-slate-500">{regionSubs.length} subregions</span>
                    </button>

                    {expanded.has(`r-${region.id}`) && (
                      <div className="border-t border-white/5 bg-white/2 px-8 py-3 space-y-4">
                        {/* Region aliases */}
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Region aliases</p>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {(regionAliases[region.id] ?? []).map(a => (
                              <Pill key={a} label={a} onRemove={() => removeAlias('region', region.id, a)} />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input value={aliasInput[`region-${region.id}`] ?? ''} onChange={e => setAliasInput(p => ({ ...p, [`region-${region.id}`]: e.target.value }))}
                              placeholder="Add alias…" className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none w-40" />
                            <button onClick={() => addAlias('region', region.id)} className="rounded-lg bg-violet-500/20 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/30"><Plus size={11} /></button>
                          </div>
                        </div>

                        {/* Subregions */}
                        {regionSubs.map(({ subregion, origins: subOrigins }) => (
                          <div key={subregion.id} className="rounded-xl border border-white/10 bg-slate-900 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{subregion.subregion_type}</span>
                              <span className="text-sm font-medium text-white">{subregion.name}</span>
                              <span className="ml-auto text-[10px] text-slate-500">{subOrigins.length} appellations</span>
                            </div>

                            {/* Subregion aliases */}
                            <div className="mb-3">
                              <p className="text-[10px] text-slate-500 mb-1.5">Aliases</p>
                              <div className="flex flex-wrap gap-1.5 mb-1.5">
                                {(subregionAliases[subregion.id] ?? []).map(a => (
                                  <Pill key={a} label={a} onRemove={() => removeAlias('subregion', subregion.id, a)} />
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <input value={aliasInput[`subregion-${subregion.id}`] ?? ''} onChange={e => setAliasInput(p => ({ ...p, [`subregion-${subregion.id}`]: e.target.value }))}
                                  placeholder="Add alias…" className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-[10px] text-white focus:outline-none w-36" />
                                <button onClick={() => addAlias('subregion', subregion.id)} className="rounded-lg bg-violet-500/20 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/30"><Plus size={10} /></button>
                              </div>
                            </div>

                            {/* Origins */}
                            {subOrigins.length > 0 && (
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1.5">Appellations / Origins</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {subOrigins.map(o => (
                                    <span key={o.id} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">{o.name}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Classification Tab ────────────────────────────────────────────────────────
function ClassificationTab() {
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [editing, setEditing] = useState<number | null>(null);
  const [localData, setLocalData] = useState<TaxClassification[]>(classifications);

  const scopes = useMemo(() => ['all', ...[...new Set(classifications.map(c => c.category_scope))].sort()], []);
  const groups = useMemo(() => ['all', ...getClassificationGroups()], []);

  const filtered = useMemo(() => localData.filter(c => {
    const q = search.toLowerCase();
    const matchQ = !q || c.classification.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    const matchScope = scopeFilter === 'all' || c.category_scope === scopeFilter;
    const matchGroup = groupFilter === 'all' || c.classification_group === groupFilter;
    return matchQ && matchScope && matchGroup;
  }), [localData, search, scopeFilter, groupFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaxClassification[]>();
    for (const c of filtered) {
      const g = map.get(c.classification_group) ?? [];
      g.push(c);
      map.set(c.classification_group, g);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search classifications…"
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
        </div>
        <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
          {scopes.map(s => <option key={s} value={s}>{s === 'all' ? 'All scopes' : s}</option>)}
        </select>
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
          {groups.map(g => <option key={g} value={g}>{g === 'all' ? 'All groups' : g.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {[...grouped.entries()].map(([group, items]) => (
        <div key={group} className="rounded-xl border border-white/10 overflow-hidden">
          <div className="border-b border-white/10 bg-white/3 px-4 py-2.5 flex items-center gap-3">
            <Tag size={13} className="text-violet-400" />
            <span className="text-sm font-semibold text-white">{group.replace(/_/g, ' ')}</span>
            <span className="text-xs text-slate-500">{items.length} entries</span>
          </div>
          <div className="divide-y divide-white/5">
            {items.sort((a, b) => a.priority - b.priority).map(c => (
              <div key={c.classification_id} className="flex items-start gap-4 px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{c.classification}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">{c.category_scope}</span>
                    {!c.is_active && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">inactive</span>}
                  </div>
                  {c.description && <p className="mt-0.5 text-xs text-slate-400">{c.description}</p>}
                </div>
                <span className="text-xs text-slate-600">#{c.priority}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Ingredients Tab ───────────────────────────────────────────────────────────
function IngredientsTab() {
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [editId, setEditId] = useState<number | null>(null);
  const [aliasInput, setAliasInput] = useState<Record<number, string>>({});
  const [localIngredients, setLocalIngredients] = useState<TaxIngredient[]>(ingredients);

  const scopes = useMemo(() => ['all', ...[...new Set(ingredients.map(i => i.category_scope))].sort()], []);
  const groups = useMemo(() => ['all', ...getIngredientGroups()], []);

  const filtered = useMemo(() => localIngredients.filter(i => {
    const q = search.toLowerCase();
    const matchQ = !q || i.ingredient.toLowerCase().includes(q) ||
      i.synonyms.some(s => s.toLowerCase().includes(q)) ||
      i.description.toLowerCase().includes(q);
    const matchScope = scopeFilter === 'all' || i.category_scope === scopeFilter;
    const matchGroup = groupFilter === 'all' || i.ingredient_group === groupFilter;
    return matchQ && matchScope && matchGroup;
  }), [localIngredients, search, scopeFilter, groupFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaxIngredient[]>();
    for (const i of filtered) {
      const g = map.get(i.ingredient_group) ?? [];
      g.push(i);
      map.set(i.ingredient_group, g);
    }
    return map;
  }, [filtered]);

  function addSynonym(id: number) {
    const val = (aliasInput[id] ?? '').trim();
    if (!val) return;
    setLocalIngredients(prev => prev.map(i => i.ingredient_id === id
      ? { ...i, synonyms: [...i.synonyms, val] } : i));
    setAliasInput(prev => ({ ...prev, [id]: '' }));
  }

  function removeSynonym(id: number, syn: string) {
    setLocalIngredients(prev => prev.map(i => i.ingredient_id === id
      ? { ...i, synonyms: i.synonyms.filter(s => s !== syn) } : i));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ingredients, grapes, synonyms…"
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
        </div>
        <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
          {scopes.map(s => <option key={s} value={s}>{s === 'all' ? 'All scopes' : s}</option>)}
        </select>
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
          {groups.map(g => <option key={g} value={g}>{g === 'all' ? 'All groups' : g.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {[...grouped.entries()].map(([group, items]) => (
        <div key={group} className="rounded-xl border border-white/10 overflow-hidden">
          <div className="border-b border-white/10 bg-white/3 px-4 py-2.5 flex items-center gap-3">
            <span className="text-sm font-semibold text-white">{group.replace(/_/g, ' ')}</span>
            <span className="text-xs text-slate-500">{items.length} entries</span>
          </div>
          <div className="divide-y divide-white/5">
            {items.map(ing => (
              <div key={ing.ingredient_id} className={`px-4 py-3 transition-colors ${editId === ing.ingredient_id ? 'bg-violet-500/5' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{ing.ingredient}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">{ing.category_scope}</span>
                      {ing.is_primary_default && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">primary</span>}
                      {!ing.is_active && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">inactive</span>}
                    </div>
                    {ing.description && <p className="mt-0.5 text-xs text-slate-400">{ing.description}</p>}

                    {/* Synonyms / Aliases */}
                    <div className="mt-2">
                      <p className="text-[10px] text-slate-500 mb-1.5">Aliases / synonyms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ing.synonyms.map(syn => (
                          <Pill key={syn} label={syn} onRemove={() => removeSynonym(ing.ingredient_id, syn)} />
                        ))}
                        {ing.synonyms.length === 0 && <span className="text-[10px] text-slate-600">None — add below</span>}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input value={aliasInput[ing.ingredient_id] ?? ''} onChange={e => setAliasInput(p => ({ ...p, [ing.ingredient_id]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && addSynonym(ing.ingredient_id)}
                          placeholder="Add synonym…" className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-white focus:outline-none w-40" />
                        <button onClick={() => addSynonym(ing.ingredient_id)} className="rounded-lg bg-violet-500/20 px-2.5 py-1 text-xs text-violet-200 hover:bg-violet-500/30"><Plus size={11} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Flavour Tab ───────────────────────────────────────────────────────────────
function FlavoursTab() {
  const [search, setSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState('all');

  const families = useMemo(() => ['all', ...getFlavourFamilies()], []);
  const filtered = useMemo(() => flavours.filter(f => {
    const q = search.toLowerCase();
    const matchQ = !q || f.note.toLowerCase().includes(q);
    const matchFam = familyFilter === 'all' || f.note_family === familyFilter;
    return matchQ && matchFam && f.is_active;
  }), [search, familyFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaxFlavour[]>();
    for (const f of filtered) {
      const g = map.get(f.note_family) ?? [];
      g.push(f);
      map.set(f.note_family, g);
    }
    return map;
  }, [filtered]);

  const FAMILY_COLORS: Record<string, string> = {
    fruit: 'text-rose-300 border-rose-400/20 bg-rose-500/10',
    floral: 'text-pink-300 border-pink-400/20 bg-pink-500/10',
    spice: 'text-amber-300 border-amber-400/20 bg-amber-500/10',
    oak_wood: 'text-orange-300 border-orange-400/20 bg-orange-500/10',
    earth_savory: 'text-lime-300 border-lime-400/20 bg-lime-500/10',
    herbal: 'text-green-300 border-green-400/20 bg-green-500/10',
    fresh: 'text-cyan-300 border-cyan-400/20 bg-cyan-500/10',
    mineral_saline: 'text-blue-300 border-blue-400/20 bg-blue-500/10',
    nutty: 'text-yellow-300 border-yellow-400/20 bg-yellow-500/10',
    smoky: 'text-slate-300 border-slate-400/20 bg-slate-500/10',
    sweet: 'text-violet-300 border-violet-400/20 bg-violet-500/10',
    umami: 'text-teal-300 border-teal-400/20 bg-teal-500/10',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search flavour notes…"
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
        </div>
        <select value={familyFilter} onChange={e => setFamilyFilter(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white">
          {families.map(f => <option key={f} value={f}>{f === 'all' ? 'All families' : f.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...grouped.entries()].map(([family, notes]) => {
          const colorClass = FAMILY_COLORS[family] ?? 'text-slate-300 border-white/10 bg-white/5';
          return (
            <div key={family} className={`rounded-xl border p-4 ${colorClass.split(' ').slice(1).join(' ')}`}>
              <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${colorClass.split(' ')[0]}`}>
                {family.replace(/_/g, ' ')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {notes.map(n => (
                  <span key={n.note_id} className={`rounded-full border px-2.5 py-1 text-xs ${colorClass}`}>
                    {n.note}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main TaxonomyEditor ───────────────────────────────────────────────────────
type TaxTab = 'geography' | 'classification' | 'ingredients' | 'flavours';

export function TaxonomyEditor() {
  const [tab, setTab] = useState<TaxTab>('geography');

  const TABS: { id: TaxTab; label: string; count: string }[] = [
    { id: 'geography', label: 'Geography', count: '28 countries · 83 regions · 129 subregions · 154 origins' },
    { id: 'classification', label: 'Classification', count: `${classifications.length} entries` },
    { id: 'ingredients', label: 'Ingredients & Grapes', count: `${ingredients.length} entries` },
    { id: 'flavours', label: 'Flavour notes', count: `${flavours.length} entries` },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-white/10 bg-slate-900/40 px-6 pt-4">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-t-xl px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? 'bg-violet-500/15 text-violet-200 border border-b-0 border-violet-400/20' : 'text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-header */}
      <div className="shrink-0 border-b border-white/5 bg-slate-900/20 px-6 py-2">
        <p className="text-xs text-slate-500">{TABS.find(t => t.id === tab)?.count}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'geography' && <GeographyTab />}
        {tab === 'classification' && <ClassificationTab />}
        {tab === 'ingredients' && <IngredientsTab />}
        {tab === 'flavours' && <FlavoursTab />}
      </div>
    </div>
  );
}
