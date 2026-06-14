'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronRight, ChevronDown, Save, Loader2, BookOpen, Check, ArrowLeft } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type EntityType = 'country' | 'region' | 'subregion' | 'appellation' | 'brand';

type Scope = { id: string; label: string; description: string; icon: string };

type Context = {
  id: string;
  entity_id: string;
  scope_id: string;
  description_short: string | null;
  description_en: string | null;
  attributes: Record<string, any> | null;
  status: 'draft' | 'validated' | 'published';
};

type Entity = {
  id: string;
  entity_type: EntityType;
  name: string;
  slug: string;
  parent_id: string | null;
  contexts: Context[];
};

type AttrDef = {
  id: string;
  scope_id: string;
  attribute_key: string;
  label: string;
  data_type: string;
};

type BreadcrumbItem = { id: string; name: string; entity_type: string };

type DetailData = {
  entity: Entity;
  breadcrumb: BreadcrumbItem[];
  contexts: Context[];
  scopes: Scope[];
  attributeDefs: AttrDef[];
};

// ─── Config ─────────────────────────────────────────────────────────────────

const ENTITY_TABS: Array<{ id: EntityType; label: string }> = [
  { id: 'country', label: 'Countries' },
  { id: 'region', label: 'Regions' },
  { id: 'subregion', label: 'Subregions' },
  { id: 'appellation', label: 'Appellations' },
  { id: 'brand', label: 'Brands' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'validated', label: 'Validated' },
  { value: 'published', label: 'Published' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-300',
  validated: 'bg-amber-500/20 text-amber-300',
  published: 'bg-emerald-500/20 text-emerald-300',
};

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-slate-400',
  validated: 'bg-amber-400',
  published: 'bg-emerald-400',
};

// ─── Entity Browser (Left Panel) ────────────────────────────────────────────

function EntityBrowser({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [entityType, setEntityType] = useState<EntityType>('country');
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(false);
  const [parentStack, setParentStack] = useState<Array<{ id: string; name: string }>>([]);
  const [totalContexts, setTotalContexts] = useState<{ total: number; validated: number }>({ total: 0, validated: 0 });

  const currentParentId = parentStack.length > 0 ? parentStack[parentStack.length - 1].id : null;

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('entity_type', entityType);
      if (scopeFilter) params.set('scope_id', scopeFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      if (currentParentId) params.set('parent_id', currentParentId);

      const res = await fetch(`/api/taxonomy-library?${params}`);
      const data = await res.json();
      setEntities(data.entities ?? []);
      if (data.scopes?.length && scopes.length === 0) setScopes(data.scopes);
    } finally {
      setLoading(false);
    }
  }, [entityType, scopeFilter, statusFilter, search, currentParentId, scopes.length]);

  // Fetch stats once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/taxonomy-library?entity_type=country');
        const data = await res.json();
        if (data.scopes) setScopes(data.scopes);
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch context counts
  useEffect(() => {
    (async () => {
      try {
        // Rough count: fetch all entity types without filters to get total
        const allRes = await fetch('/api/taxonomy-library?entity_type=country');
        const allData = await allRes.json();
        const allContexts = (allData.entities ?? []).flatMap((e: Entity) => e.contexts);
        const validated = allContexts.filter((c: Context) => c.status === 'validated' || c.status === 'published').length;
        setTotalContexts({ total: 3211, validated });
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchEntities, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchEntities, search]);

  function handleEntityTypeChange(type: EntityType) {
    setEntityType(type);
    setSearch('');
    setParentStack([]);
  }

  function drillInto(entity: Entity) {
    setParentStack(prev => [...prev, { id: entity.id, name: entity.name }]);
  }

  function goBack() {
    setParentStack(prev => prev.slice(0, -1));
  }

  // Determine if entity type supports hierarchy drilling
  const canDrill = entityType === 'country' || entityType === 'region';

  return (
    <div className="flex flex-col h-full">
      {/* Entity type tabs */}
      <div className="flex flex-wrap gap-1 p-3 border-b border-white/10">
        {ENTITY_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleEntityTypeChange(t.id)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              entityType === t.id
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="p-3 space-y-2 border-b border-white/10">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Filter by scope"
            value={scopeFilter}
            onChange={e => setScopeFilter(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-violet-500/60 appearance-none"
          >
            <option value="" className="bg-slate-900">All Scopes</option>
            {scopes.map(s => (
              <option key={s.id} value={s.id} className="bg-slate-900">{s.label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-violet-500/60 appearance-none"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Breadcrumb for hierarchy */}
      {parentStack.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
          <button onClick={goBack} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
            <ArrowLeft size={12} />
            Back
          </button>
          <span className="text-slate-600 text-xs mx-1">/</span>
          {parentStack.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={10} className="text-slate-600" />}
              <span className="text-xs text-slate-400">{p.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* Entity list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={16} className="animate-spin text-slate-500" />
          </div>
        ) : entities.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {search ? `No results for "${search}"` : 'No entities found'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {entities.map(entity => {
              const isSelected = selectedId === entity.id;
              const scopeBadges = entity.contexts?.map(c => c.scope_id) ?? [];
              const statuses = entity.contexts?.map(c => c.status) ?? [];
              const worstStatus = statuses.includes('draft') ? 'draft' : statuses.includes('validated') ? 'validated' : 'published';

              return (
                <div
                  key={entity.id}
                  className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-violet-500/10 border-l-2 border-violet-500' : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                  }`}
                  onClick={() => onSelect(entity.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[worstStatus] ?? 'bg-slate-600'}`} />
                      <span className="text-sm text-white truncate">{entity.name}</span>
                      {scopeBadges.length > 0 && (
                        <div className="flex gap-1">
                          {scopes
                            .filter(s => scopeBadges.includes(s.id))
                            .map(s => (
                              <span key={s.id} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                                {s.label}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    {/* Description preview */}
                    {entity.contexts?.length > 0 && entity.contexts[0].description_short && (
                      <p className="text-[11px] text-slate-500 mt-0.5 ml-3.5 truncate">
                        {entity.contexts[0].description_short}
                      </p>
                    )}
                    {(!entity.contexts?.length || !entity.contexts[0].description_short) && (
                      <p className="text-[10px] text-slate-700 mt-0.5 ml-3.5 italic">No description</p>
                    )}
                  </div>
                  {canDrill && !search && (
                    <button
                      onClick={e => { e.stopPropagation(); drillInto(entity); }}
                      className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 shrink-0"
                      title="Browse children"
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="px-3 py-2 border-t border-white/10 bg-white/[0.02]">
        <p className="text-[10px] text-slate-500">
          {entities.length} shown &middot; {totalContexts.validated} validated / {totalContexts.total.toLocaleString()} total contexts
        </p>
      </div>
    </div>
  );
}

// ─── Entity Detail (Right Panel) ────────────────────────────────────────────

function EntityDetail({ entityId }: { entityId: string }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable form state per context
  const [editForms, setEditForms] = useState<Record<string, {
    description_short: string;
    description_en: string;
    attributes: Record<string, any>;
    status: string;
  }>>({});

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/taxonomy-library/${entityId}`);
      const data: DetailData = await res.json();
      setDetail(data);

      // Initialize forms from contexts
      const forms: typeof editForms = {};
      for (const ctx of data.contexts) {
        forms[ctx.id] = {
          description_short: ctx.description_short ?? '',
          description_en: ctx.description_en ?? '',
          attributes: ctx.attributes ?? {},
          status: ctx.status,
        };
      }
      setEditForms(forms);

      // Set active scope to first available
      if (data.contexts.length > 0) {
        setActiveScope(data.contexts[0].scope_id);
      }
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  function updateForm(contextId: string, field: string, value: any) {
    setEditForms(prev => ({
      ...prev,
      [contextId]: { ...prev[contextId], [field]: value },
    }));
    setSaved(false);
  }

  function updateAttribute(contextId: string, key: string, value: any) {
    setEditForms(prev => ({
      ...prev,
      [contextId]: {
        ...prev[contextId],
        attributes: { ...prev[contextId].attributes, [key]: value },
      },
    }));
    setSaved(false);
  }

  async function handleSave(contextId: string) {
    const form = editForms[contextId];
    if (!form) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/taxonomy-library/${entityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_id: contextId,
          description_short: form.description_short,
          description_en: form.description_en,
          attributes: form.attributes,
          status: form.status,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-slate-500" />
      </div>
    );
  }

  if (!detail) return null;

  const { entity, breadcrumb, contexts, scopes, attributeDefs } = detail;
  const activeCtx = contexts.find(c => c.scope_id === activeScope);
  const activeCtxForm = activeCtx ? editForms[activeCtx.id] : null;
  const activeScopeDefs = attributeDefs.filter(d => d.scope_id === activeScope);
  const scopeLabel = (id: string) => scopes.find(s => s.id === id)?.label ?? id;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        {/* Breadcrumb */}
        {breadcrumb.length > 0 && (
          <div className="flex items-center gap-1 mb-2">
            {breadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={10} className="text-slate-600" />}
                <span className="text-xs text-slate-500">{b.name}</span>
              </span>
            ))}
            <ChevronRight size={10} className="text-slate-600" />
          </div>
        )}
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{entity.name}</h2>
          <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-400 capitalize">
            {entity.entity_type}
          </span>
        </div>
      </div>

      {/* Scope tabs */}
      {contexts.length > 0 ? (
        <>
          <div className="flex gap-1 px-6 pt-3 border-b border-white/10">
            {contexts.map(ctx => {
              const isActive = ctx.scope_id === activeScope;
              return (
                <button
                  key={ctx.id}
                  onClick={() => setActiveScope(ctx.scope_id)}
                  className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    isActive
                      ? 'border-violet-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {scopeLabel(ctx.scope_id)}
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[ctx.status]}`}>
                    {ctx.status}
                  </span>
                  {(ctx as any).expert_overlay && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-semibold">
                      Expert {(ctx as any).expert_confidence || ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Context form */}
          {activeCtx && activeCtxForm && (
            <div className="flex-1 overflow-auto p-6 space-y-5">
              {/* Expert overlay banner */}
              {(activeCtx as any).expert_overlay && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/8 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex h-5 items-center rounded-full bg-violet-500/30 px-2 text-[10px] font-semibold text-violet-200">
                      Expert {(activeCtx as any).expert_confidence || ''}
                    </div>
                    <div className="flex-1 text-xs text-slate-300">
                      <p>This description is expert-authored content from the knowledge library.</p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        {(activeCtx as any).expert_signature_varieties && (
                          <div><span className="text-slate-500">Signature:</span> {(activeCtx as any).expert_signature_varieties}</div>
                        )}
                        {(activeCtx as any).expert_signature_regions && (
                          <div><span className="text-slate-500">Regions:</span> {(activeCtx as any).expert_signature_regions}</div>
                        )}
                        {(activeCtx as any).expert_house_traits && (
                          <div><span className="text-slate-500">Traits:</span> {(activeCtx as any).expert_house_traits}</div>
                        )}
                        {(activeCtx as any).expert_use_cases && (
                          <div><span className="text-slate-500">Use cases:</span> {(activeCtx as any).expert_use_cases}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Status</label>
                <select
                  value={activeCtxForm.status}
                  onChange={e => updateForm(activeCtx.id, 'status', e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50 appearance-none w-40"
                >
                  <option value="draft" className="bg-slate-900">Draft</option>
                  <option value="validated" className="bg-slate-900">Validated</option>
                  <option value="published" className="bg-slate-900">Published</option>
                </select>
              </div>

              {/* Short description */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Short Description</label>
                <input
                  value={activeCtxForm.description_short}
                  onChange={e => updateForm(activeCtx.id, 'description_short', e.target.value)}
                  placeholder="Brief one-line description..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Full description */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Full Description (Markdown)</label>
                <textarea
                  value={activeCtxForm.description_en}
                  onChange={e => updateForm(activeCtx.id, 'description_en', e.target.value)}
                  rows={8}
                  placeholder="Detailed description in markdown..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 font-mono resize-y"
                />
                {/* Preview */}
                {activeCtxForm.description_en && (
                  <div className="mt-2 p-3 bg-white/[0.02] border border-white/5 rounded-lg">
                    <p className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Preview</p>
                    <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {activeCtxForm.description_en}
                    </div>
                  </div>
                )}
              </div>

              {/* Dynamic attribute fields */}
              {activeScopeDefs.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 mb-2">Scope Attributes</label>
                  <div className="grid grid-cols-2 gap-3">
                    {activeScopeDefs.map(def => {
                      const val = activeCtxForm.attributes[def.attribute_key] ?? '';
                      return (
                        <div key={def.id}>
                          <label className="block text-[11px] text-slate-500 mb-1">{def.label}</label>
                          {def.data_type === 'boolean' ? (
                            <select
                              value={val === true || val === 'true' ? 'true' : 'false'}
                              onChange={e => updateAttribute(activeCtx.id, def.attribute_key, e.target.value === 'true')}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50 appearance-none"
                            >
                              <option value="false" className="bg-slate-900">No</option>
                              <option value="true" className="bg-slate-900">Yes</option>
                            </select>
                          ) : def.data_type === 'number' ? (
                            <input
                              type="number"
                              value={val}
                              onChange={e => updateAttribute(activeCtx.id, def.attribute_key, e.target.value ? Number(e.target.value) : '')}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50"
                            />
                          ) : def.data_type === 'text' ? (
                            <textarea
                              value={typeof val === 'string' ? val : JSON.stringify(val)}
                              onChange={e => updateAttribute(activeCtx.id, def.attribute_key, e.target.value)}
                              rows={2}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50 resize-y"
                            />
                          ) : (
                            <input
                              value={typeof val === 'string' ? val : JSON.stringify(val)}
                              onChange={e => updateAttribute(activeCtx.id, def.attribute_key, e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Character benchmarks placeholder */}
              <div className="p-4 bg-white/[0.02] border border-dashed border-white/10 rounded-lg">
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <BookOpen size={13} />
                  Character benchmarks &mdash; coming soon
                </p>
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => handleSave(activeCtx.id)}
                  disabled={saving}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Changes
                </button>
                {saved && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check size={13} /> Saved
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-slate-500">No scope contexts for this entity</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function KnowledgeLibraryPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      {/* Left panel — entity browser */}
      <div className="w-[350px] shrink-0 border-r border-white/10 flex flex-col bg-slate-950">
        <div className="px-4 py-3 border-b border-white/10">
          <h1 className="text-sm font-semibold text-white flex items-center gap-2">
            <BookOpen size={15} className="text-violet-400" />
            Knowledge Library
          </h1>
          <p className="text-[10px] text-slate-500 mt-0.5">Browse, search, and manage taxonomy with descriptions</p>
        </div>
        <EntityBrowser onSelect={setSelectedId} selectedId={selectedId} />
      </div>

      {/* Right panel — entity detail */}
      <div className="flex-1 min-w-0 bg-slate-950">
        {selectedId ? (
          <EntityDetail key={selectedId} entityId={selectedId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
            <BookOpen size={32} className="text-slate-600" />
            <p className="text-sm">Select an entity to view its details</p>
            <p className="text-xs text-slate-600">Browse by type, scope, or search by name</p>
          </div>
        )}
      </div>
    </div>
  );
}
