'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Edit2, X, Search,
  SlidersHorizontal, Layers, MapPin, Star, Tag, Wine, Code2, Eye, FileText,
  ArrowUpDown, ChevronDown, CheckCircle2, Utensils, BarChart3
} from 'lucide-react';

// ── Searchable select dropdown ──────────────────────────────────────────────

function SearchableSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; count?: number }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) { setQuery(''); inputRef.current?.focus(); }
  }, [open]);

  const selectedLabel = value ? options.find(o => o.value === value)?.label ?? value : '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-left transition-colors hover:border-white/20"
      >
        <span className={value ? 'text-white' : 'text-slate-500'}>{value ? selectedLabel : placeholder}</span>
        <ChevronDown size={12} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/10 bg-slate-800 shadow-xl">
          {/* Search input */}
          {options.length > 5 && (
            <div className="p-1.5 border-b border-white/8">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type to filter..."
                className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-slate-600 outline-none"
              />
            </div>
          )}

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto p-1">
            {/* Clear / All option */}
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors ${!value ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              {placeholder}
            </button>
            {filtered.map(o => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-center justify-between ${value === o.value ? 'bg-violet-500/15 text-violet-300' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
              >
                <span className="truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-slate-600 ml-1 shrink-0">{o.count}</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-600">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
import {
  CharacterRadarChart, FlavorWheel, BodySweetnessMatrix,
  FoodPairingGrid, DataQualityGauge, VintageTimeline,
} from '@/components/product-visualizations';

type Product = Record<string, unknown>;
type Facet = { value: string; count: number };
type Facets = {
  categories: Facet[]; countries: Facet[]; statuses: Facet[];
  regions: Facet[]; appellations: Facet[]; wineClasses: Facet[];
};
type CharDimension = { dimension_key: string; label: string; description: string };
type TaxContext = { term: string; description_short: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
  try { const p = JSON.parse(raw as string); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
}

function fmt(v: unknown) { return v === null || v === undefined || v === '' ? '--' : String(v); }

function fmtPrice(v: unknown, currency = 'THB') {
  if (!v && v !== 0) return '--';
  const n = parseFloat(String(v)); if (isNaN(n)) return '--';
  const cur = (currency || 'THB').toUpperCase();
  try { return n.toLocaleString('th-TH', { style: 'currency', currency: cur, maximumFractionDigits: 0 }); }
  catch { return `${cur} ${n.toLocaleString()}`; }
}

const STATUS_COLORS: Record<string, string> = {
  validated:       'bg-emerald-500/20 text-emerald-300',
  needs_review:    'bg-amber-500/20 text-amber-300',
  needs_attention: 'bg-rose-500/20 text-rose-300',
  raw:             'bg-slate-500/20 text-slate-400',
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  'Red Wine':       'bg-red-500/20 text-red-300 border-red-500/30',
  'White Wine':     'bg-yellow-500/20 text-yellow-200 border-yellow-500/30',
  'Sparkling Wine': 'bg-amber-400/20 text-amber-200 border-amber-400/30',
  'Champagne':      'bg-amber-400/20 text-amber-200 border-amber-400/30',
  'Rose':           'bg-pink-400/20 text-pink-300 border-pink-400/30',
  'Whisky':         'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Gin':            'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'Rum':            'bg-amber-600/20 text-amber-300 border-amber-600/30',
  'Vodka':          'bg-sky-500/20 text-sky-300 border-sky-500/30',
  'Tequila':        'bg-lime-500/20 text-lime-300 border-lime-500/30',
  'Sake':           'bg-indigo-400/20 text-indigo-300 border-indigo-400/30',
};
function classificationBadge(cls: string | null | undefined) {
  const c = cls ? String(cls) : '';
  const colors = CLASSIFICATION_COLORS[c] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors}`}>{c || 'Uncategorized'}</span>;
}

// ── Description block ─────────────────────────────────────────────────────────

type DescView = 'text' | 'preview' | 'source';

function LangDesc({ shortText, fullText, fullHtml }: {
  shortText?: string | null; fullText?: string | null; fullHtml?: string | null;
}) {
  const [view, setView] = useState<DescView>('text');
  const hasShort = !!shortText;
  const hasFull  = !!(fullText || fullHtml);

  if (!hasShort && !hasFull) return null;

  return (
    <div className="space-y-3">
      {hasShort && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Short description</p>
          <p className="text-sm text-slate-200 leading-relaxed">{shortText}</p>
        </div>
      )}
      {hasFull && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Full description</p>
            {fullHtml && (
              <div className="flex gap-0.5">
                {([['text', FileText, 'Text'], ['preview', Eye, 'Preview'], ['source', Code2, 'HTML']] as const).map(([v, Icon, tip]) => (
                  <button key={v} title={tip} onClick={() => setView(v as DescView)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${view === v ? 'bg-violet-500/30 text-violet-300' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                    <Icon size={10} />{tip}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`rounded-lg overflow-hidden ${view !== 'text' ? 'border border-white/10' : ''}`}>
            {view === 'text' && fullText && (
              <p className="text-sm text-slate-400 leading-relaxed">{fullText}</p>
            )}
            {view === 'preview' && fullHtml && (
              <div className="p-3 bg-white/5 text-slate-200 text-sm leading-relaxed
                [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1
                [&_strong]:text-white [&_em]:text-slate-300"
                dangerouslySetInnerHTML={{ __html: fullHtml }} />
            )}
            {view === 'source' && fullHtml && (
              <pre className="p-3 bg-slate-900 text-[10px] text-emerald-300 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
                {fullHtml}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ label, value, showLabel = true }: { label: string; value: number; showLabel?: boolean }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.75 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-rose-500';
  const txt = value >= 0.75 ? 'text-emerald-400' : value >= 0.4 ? 'text-amber-400' : 'text-rose-400';
  return (
    <div className="mb-2.5 last:mb-0">
      {showLabel && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400">{label}</span>
          <span className={txt}>{pct}%</span>
        </div>
      )}
      <div className="h-1.5 bg-white/10 rounded-full">
        <div className={`h-1.5 rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────

const EDITABLE = ['name','sku','brand','vintage','country','region','subregion','classification','grape_variety','wine_type','liquor_main_type','price','cost_price','currency','alcohol','bottle_size','validation_status'];

// ── Main Component ────────────────────────────────────────────────────────────

export function ProductsPage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [appellation, setAppellation] = useState('');
  const [status, setStatus] = useState('');
  const [classification, setClassification] = useState('');
  const [wineClass, setWineClass] = useState('');
  const [segment, setSegment] = useState('');
  const [sortBy, setSortBy] = useState('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Detail state
  const [selected, setSelected] = useState<Product | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [charDimensions, setCharDimensions] = useState<CharDimension[]>([]);
  const [taxContexts, setTaxContexts] = useState<TaxContext[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);

  // Load facets once
  useEffect(() => {
    fetch('/api/products/facets').then(r => r.json()).then(setFacets).catch(() => {});
  }, []);

  const load = useCallback(async (
    p = page, q = search, c = country, r = region, ap = appellation,
    s = status, cl = classification, wc = wineClass, sg = segment,
    sb = sortBy, sd = sortDir, append = false,
  ) => {
    if (append) setLoadingMore(true);
    const params = new URLSearchParams({ page: String(p) });
    if (q)  params.set('search', q);
    if (c)  params.set('country', c);
    if (r)  params.set('region', r);
    if (ap) params.set('appellation', ap);
    if (s)  params.set('validation_status', s);
    if (cl) params.set('classification', cl);
    if (wc) params.set('wine_classification', wc);
    if (sg) params.set('segment', sg);
    params.set('sort', sb);
    params.set('sortDir', sd);
    const res = await fetch(`/api/products?${params}`);
    const json = await res.json();
    if (append && data) {
      setData({ ...json, items: [...data.items, ...json.items] });
    } else {
      setData(json);
    }
    setLoadingMore(false);
  }, [page, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir, data]);

  // Reset and load on filter change
  useEffect(() => {
    setPage(1);
    const params = new URLSearchParams({ page: '1' });
    if (search)  params.set('search', search);
    if (country)  params.set('country', country);
    if (region)  params.set('region', region);
    if (appellation) params.set('appellation', appellation);
    if (status)  params.set('validation_status', status);
    if (classification) params.set('classification', classification);
    if (wineClass) params.set('wine_classification', wineClass);
    if (segment) params.set('segment', segment);
    params.set('sort', sortBy);
    params.set('sortDir', sortDir);
    fetch(`/api/products?${params}`).then(r => r.json()).then(setData).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir]);

  // Infinite scroll handler
  const handleListScroll = useCallback(() => {
    const el = listScrollRef.current;
    if (!el || loadingMore || !data) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      if (data.items.length < data.total) {
        const nextPage = page + 1;
        setPage(nextPage);
        load(nextPage, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir, true);
      }
    }
  }, [loadingMore, data, page, load, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir]);

  async function openProduct(p: Product) {
    setSelected(p);
    setEditMode(false);
    setDetailLoading(true);
    setCharDimensions([]);
    setTaxContexts([]);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/products/${p.id}`);
      const json = await res.json();
      if (json.product) {
        setSelected(json.product);
        setEditFields(Object.fromEntries(Object.entries(json.product).map(([k, v]) => [k, v != null ? String(v) : ''])));
      }
      if (json.characterDimensions) setCharDimensions(json.characterDimensions);
      if (json.taxonomyContexts) setTaxContexts(json.taxonomyContexts);
    } catch { /* keep the initial product data */ }
    setDetailLoading(false);
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
    if (res.ok) { setSaveMsg('Saved'); load(); }
    else { setSaveMsg(json.error ?? 'Save failed'); }
  }

  const confValue = (p: Product) => parseFloat(String(p.overall_confidence ?? 0));

  const confBadge = (conf: number) => {
    const pct = Math.round(conf * 100);
    const cls = conf >= 0.75 ? 'bg-emerald-500/20 text-emerald-300' : conf >= 0.4 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300';
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{pct}%</span>;
  };

  const activeFilters = [country, region, appellation, status, classification, wineClass].filter(Boolean).length;

  // Price range filter state
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  // Confidence filter
  const [confFilter, setConfFilter] = useState('');

  // Enrichment tier filter
  const [tierFilter, setTierFilter] = useState('');

  // Group products by sku_base
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const groupedProducts = useMemo(() => {
    const items = data?.items ?? [];
    // Client-side price filter
    let filtered = items;
    if (priceMin || priceMax) {
      const min = priceMin ? parseFloat(priceMin) : 0;
      const max = priceMax ? parseFloat(priceMax) : Infinity;
      filtered = filtered.filter(p => {
        const price = parseFloat(String(p.price ?? 0));
        return price >= min && price <= max;
      });
    }
    // Confidence filter
    if (confFilter) {
      const threshold = parseFloat(confFilter) / 100;
      filtered = filtered.filter(p => confValue(p) >= threshold);
    }
    // Tier filter
    if (tierFilter) {
      filtered = filtered.filter(p => String(p.enrichment_priority) === tierFilter);
    }

    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const base = String(p.sku_base ?? (p.sku ? String(p.sku).substring(0, 7) : 'unknown'));
      if (!map.has(base)) map.set(base, []);
      map.get(base)!.push(p);
    }
    for (const variants of map.values()) {
      variants.sort((a, b) => {
        if (a.is_primary_variant) return -1;
        if (b.is_primary_variant) return 1;
        return String(a.sku ?? '').localeCompare(String(b.sku ?? ''));
      });
    }
    return Array.from(map.values());
  }, [data?.items, priceMin, priceMax, confFilter, tierFilter]);

  function clearFilters() {
    setCountry(''); setRegion(''); setAppellation('');
    setStatus(''); setClassification(''); setWineClass('');
    setPriceMin(''); setPriceMax('');
    setConfFilter(''); setTierFilter('');
    setPage(1);
  }

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  }

  const taxContextMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const tc of taxContexts) {
      if (tc.term && tc.description_short) m.set(tc.term, tc.description_short);
    }
    return m;
  }, [taxContexts]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ═══ LEFT PANEL: Product List ═══ */}
      <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[400px] lg:min-w-[400px] lg:max-w-[400px] border-r border-white/10 bg-slate-950`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-white">Products</h1>
              {data && <p className="text-[11px] text-slate-500">{data.total.toLocaleString()} products</p>}
            </div>
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${showFilters || activeFilters ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
            >
              <SlidersHorizontal size={12} /> {activeFilters > 0 ? `${activeFilters}` : ''}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              placeholder="Search name or SKU..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-slate-600"
            />
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="space-y-2 pt-1">
              <SearchableSelect
                value={classification}
                onChange={v => { setClassification(v); setPage(1); }}
                options={(facets?.categories ?? []).map(f => ({ value: f.value, label: f.value, count: f.count }))}
                placeholder="All classifications"
              />
              <SearchableSelect
                value={country}
                onChange={v => { setCountry(v); setRegion(''); setAppellation(''); setPage(1); }}
                options={(facets?.countries ?? []).map(f => ({ value: f.value, label: f.value, count: f.count }))}
                placeholder="All countries"
              />
              <div className="flex gap-2">
                <input placeholder="Price min" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600" />
                <input placeholder="Price max" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600" />
              </div>
              <SearchableSelect
                value={confFilter}
                onChange={v => setConfFilter(v)}
                options={[{ value: '75', label: '75%+' }, { value: '50', label: '50%+' }, { value: '25', label: '25%+' }]}
                placeholder="Any confidence"
              />
              <SearchableSelect
                value={tierFilter}
                onChange={v => setTierFilter(v)}
                options={[
                  { value: '1', label: 'T1 - High priority' },
                  { value: '2', label: 'T2 - Medium priority' },
                  { value: '3', label: 'T3 - Standard' },
                  { value: '5', label: 'T5 - Low / No sales' },
                ]}
                placeholder="Any enrichment tier"
              />
              {/* Sort */}
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                <ArrowUpDown size={10} className="text-slate-500" />
                {[
                  { id: 'created', label: 'Added' },
                  { id: 'name', label: 'Name' },
                  { id: 'price', label: 'Price' },
                  { id: 'confidence', label: 'Conf.' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => toggleSort(opt.id)}
                    className={`flex items-center gap-0.5 px-2 py-1 rounded text-[10px] transition-colors ${sortBy === opt.id ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
                    {opt.label}
                    {sortBy === opt.id && <ChevronDown size={8} className={`transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />}
                  </button>
                ))}
              </div>
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="text-[10px] text-slate-400 hover:text-rose-300 transition-colors">
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Product list — infinite scroll */}
        <div className="flex-1 overflow-y-auto" ref={listScrollRef} onScroll={handleListScroll}>
          {groupedProducts.map((group) => {
            const p = group[0];
            const conf = confValue(p);
            const isActive = selected && selected.id === p.id;
            return (
              <div key={String(p.id)} onClick={() => openProduct(p)}
                className={`px-4 py-3 border-b border-white/5 cursor-pointer transition-colors ${isActive ? 'bg-violet-500/10 border-l-2 border-l-violet-500' : 'hover:bg-white/5'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate font-medium">{String(p.name ?? 'Untitled')}</p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">{String(p.sku ?? '--')}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {confBadge(conf)}
                    <span className="text-[11px] text-slate-400">{fmtPrice(p.price, String(p.currency ?? 'THB'))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {classificationBadge(p.classification != null ? String(p.classification) : null)}
                  {group.length > 1 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300 font-medium">
                      {group.length} variants
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {data?.items.length === 0 && (
            <div className="px-4 py-12 text-center text-slate-500 text-sm">No products found</div>
          )}
          {!data && (
            <div className="px-4 py-12 text-center text-slate-600 text-sm">Loading...</div>
          )}
          {loadingMore && (
            <div className="px-4 py-4 text-center">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}
          {data && data.items.length > 0 && (
            <div className="px-4 py-2 border-t border-white/8 text-center shrink-0">
              <p className="text-[10px] text-slate-600">
                {data.items.length} of {data.total.toLocaleString()} products
                {data.items.length < data.total && ' — scroll for more'}
              </p>
            </div>
          )}
      </div>

      {/* ═══ RIGHT PANEL: Product Detail Dashboard ═══ */}
      <div className={`${selected ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Wine size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Select a product to view details</p>
            </div>
          </div>
        ) : (
          <>
            {/* Sticky header bar */}
            <div className="px-6 py-3 border-b border-white/10 shrink-0 flex items-center justify-between bg-slate-950/80 backdrop-blur">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => setSelected(null)} className="lg:hidden text-slate-400 hover:text-white shrink-0">
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white truncate">{String(selected.name ?? '')}</h2>
                  <p className="text-[11px] text-slate-500 font-mono">{String(selected.sku ?? '')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditMode(!editMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${editMode ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}>
                  <Edit2 size={11} /> Edit
                </button>
                <button onClick={() => setSelected(null)} className="hidden lg:block text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable dashboard */}
            <div className="flex-1 overflow-y-auto">
              {detailLoading && (
                <div className="px-6 py-2">
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-1 bg-violet-500/50 rounded-full animate-pulse w-2/3" />
                  </div>
                </div>
              )}

              <div className="px-6 py-5 space-y-5 max-w-4xl">
                {/* ── Card 1: Identity ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-xl font-semibold text-white leading-tight">{String(selected.name ?? '')}</h2>
                      {!!selected.brand && <p className="text-sm text-slate-400 mt-1">{String(selected.brand)}</p>}
                    </div>
                    {!!selected.vintage && (
                      <span className="shrink-0 text-2xl font-light text-slate-400">{String(selected.vintage)}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="text-[11px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded">{String(selected.sku ?? '')}</span>
                    {classificationBadge(selected.classification != null ? String(selected.classification) : null)}
                    {!!selected.wine_classification && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25">
                        {String(selected.wine_classification)}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-slate-500 mb-0.5">Price</p>
                      <p className="text-sm font-semibold text-white">{fmtPrice(selected.price, String(selected.currency ?? 'THB'))}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-slate-500 mb-0.5">Bottle</p>
                      <p className="text-sm font-semibold text-white">{fmt(selected.bottle_size)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-slate-500 mb-0.5">Status</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[String(selected.validation_status ?? '')] ?? 'bg-slate-500/20 text-slate-300'}`}>
                        {String(selected.validation_status ?? 'raw')}
                      </span>
                    </div>
                    <div className="bg-white/5 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-slate-500 mb-0.5">Confidence</p>
                      <div className="mt-1">
                        {confBadge(confValue(selected))}
                      </div>
                    </div>
                  </div>

                  {/* Confidence bar */}
                  <div className="mt-3">
                    <ConfBar label="" value={confValue(selected)} showLabel={false} />
                  </div>
                </div>

                {/* ── Card 2: Origin ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Origin</h3>
                  </div>

                  {/* Breadcrumb path */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { val: selected.country, type: 'country' },
                      { val: selected.region, type: 'region' },
                      { val: selected.subregion, type: 'subregion' },
                      { val: selected.appellation, type: 'appellation' },
                    ].filter(loc => loc.val).map((loc, i, arr) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            if (loc.type === 'country') { setCountry(String(loc.val)); setPage(1); }
                            else if (loc.type === 'region') { setRegion(String(loc.val)); setPage(1); }
                            else if (loc.type === 'appellation') { setAppellation(String(loc.val)); setPage(1); }
                          }}
                          className="text-sm text-white hover:text-violet-300 transition-colors"
                        >
                          {String(loc.val)}
                        </button>
                        {i < arr.length - 1 && <span className="text-slate-600 text-xs">/</span>}
                      </span>
                    ))}
                    {!selected.country && <span className="text-sm text-slate-500 italic">Origin unknown</span>}
                  </div>

                  {/* Taxonomy context descriptions */}
                  {(taxContextMap.size > 0) && (
                    <div className="mt-3 space-y-1">
                      {Array.from(taxContextMap.entries()).map(([term, desc]) => (
                        <p key={term} className="text-xs text-slate-500 leading-relaxed">
                          <span className="text-slate-400 font-medium">{term}:</span> {desc}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Card 3: Character Profile (Dynamic Radar) ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Character Profile</h3>
                    {charDimensions.length > 0 && (
                      <span className="text-[10px] text-slate-600 ml-auto">{charDimensions.length} dimensions</span>
                    )}
                  </div>
                  <CharacterRadarChart product={selected} charDimensions={charDimensions} />
                </div>

                {/* ── Card 3b: Body/Sweetness Matrix ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Style Position</h3>
                  </div>
                  <BodySweetnessMatrix product={selected} />
                </div>

                {/* ── Card 4a: Flavor Wheel ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Flavor Profile</h3>
                  </div>
                  <FlavorWheel product={selected} />
                  {!parseTags(selected.flavor_tags as string).length && (
                    <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                      <p className="text-xs text-slate-500 italic">No flavor data yet</p>
                    </div>
                  )}
                </div>

                {/* ── Card 4b: Food Pairing Grid ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Utensils size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Food Pairing</h3>
                  </div>
                  <FoodPairingGrid product={selected} />
                  {!parseTags(selected.food_matching as string).length && (
                    <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                      <p className="text-xs text-slate-500 italic">No pairing data yet</p>
                    </div>
                  )}
                </div>

                {/* ── Card 5: Description ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Description</h3>
                  </div>

                  {(() => {
                    const shortEn = selected.desc_en_short || selected.short_description_en;
                    const fullEn = selected.desc_en_full || selected.description_en_text;
                    const fullHtml = selected.description_en_html;
                    const hasEn = !!(shortEn || fullEn);

                    const shortTh = selected.short_description_th_wn || selected.short_description_th_liq9;
                    const fullTh = selected.description_th_wn_text || selected.description_th_liq9_text;
                    const fullThHtml = selected.description_th_wn_html || selected.description_th_liq9_html;
                    const hasTh = !!(shortTh || fullTh);

                    if (!hasEn && !hasTh) {
                      return (
                        <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                          <p className="text-xs text-slate-500 italic">Pending enrichment</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        {hasEn && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">EN</span>
                            </div>
                            <LangDesc
                              shortText={shortEn as string}
                              fullText={fullEn as string}
                              fullHtml={fullHtml as string}
                            />
                          </div>
                        )}
                        {hasTh && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">TH</span>
                            </div>
                            <LangDesc
                              shortText={shortTh as string}
                              fullText={fullTh as string}
                              fullHtml={fullThHtml as string}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Card 5b: Vintage Timeline ── */}
                {!!selected.vintage && (
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Star size={14} className="text-violet-400" />
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Vintage</h3>
                    </div>
                    <VintageTimeline product={selected} />
                  </div>
                )}

                {/* ── Card 6: Data Quality ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Data Quality</h3>
                    {!!selected.validation_status && (
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[String(selected.validation_status)] ?? 'bg-slate-500/20 text-slate-300'}`}>
                        {String(selected.validation_status)}
                      </span>
                    )}
                  </div>
                  <DataQualityGauge product={selected} />
                </div>

                {/* ── Inline Edit Panel ── */}
                {editMode && (
                  <div className="bg-white/[0.03] border border-violet-500/20 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Edit2 size={14} className="text-violet-400" />
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Edit Fields</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {EDITABLE.map(field => (
                        <div key={field}>
                          <label className="text-[10px] text-slate-400 block mb-1 capitalize">{field.replace(/_/g, ' ')}</label>
                          <input
                            value={editFields[field] ?? ''}
                            onChange={e => setEditFields(f => ({ ...f, [field]: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-violet-500/50 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] text-slate-400 block mb-1">Note (optional)</label>
                      <input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Reason for this change..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-600"
                      />
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <button onClick={handleSave} disabled={saving}
                        className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2 px-6 rounded-lg font-medium transition-colors">
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                      <button onClick={() => setEditMode(false)} className="text-xs text-slate-400 hover:text-white transition-colors">
                        Cancel
                      </button>
                      {saveMsg && <p className="text-xs text-slate-400">{saveMsg}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
