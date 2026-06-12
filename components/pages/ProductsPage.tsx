'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Edit2, X, Search,
  SlidersHorizontal, Layers, MapPin, Star, Tag, Wine, Code2, Eye, FileText,
  ArrowUpDown, ChevronDown, CheckCircle2, Utensils, BarChart3, Target, PackagePlus
} from 'lucide-react';
import { ProductImage } from '@/components/ProductImage';
import { ProductDetailPanel } from '@/components/product/ProductDetailPanel';
import { toExploreProduct } from '@/lib/explore/adapters';
import type { CharDimension, RelatedProduct, AffinityItem, ProductAffinities } from '@/lib/explore/types';

function SearchableSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; count?: number }>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(function (o) { return o.label.toLowerCase().includes(q); });
  }, [options, query]);

  useEffect(function () {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return function () { document.removeEventListener('mousedown', handler); };
  }, [open]);

  useEffect(function () {
    if (open) { setQuery(''); inputRef.current?.focus(); }
  }, [open]);

  const selectedLabel = value ? (options.find(function (o) { return o.value === value; })?.label || value) : '';

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={function () { setOpen(!open); }}
        className="w-full flex items-center justify-between bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-left transition-colors hover:border-white/20">
        <span className={value ? 'text-white' : 'text-slate-500'}>{value ? selectedLabel : placeholder}</span>
        <ChevronDown size={12} className={'text-slate-500 transition-transform' + (open ? ' rotate-180' : '')} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/[0.08] bg-[#111111] shadow-xl">
          {options.length > 5 && (
            <div className="p-1.5 border-b border-white/8">
              <input ref={inputRef} type="text" value={query}
                onChange={function (e) { setQuery(e.target.value); }}
                placeholder="Type to filter..."
                className="w-full bg-[#080808] border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-slate-500 outline-none" />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto p-1">
            <button onClick={function () { onChange(''); setOpen(false); }}
              className={'w-full text-left rounded px-2 py-1.5 text-xs transition-colors ' + (!value ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
              {placeholder}
            </button>
            {filtered.map(function (o) {
              return (
                <button key={o.value} onClick={function () { onChange(o.value); setOpen(false); }}
                  className={'w-full text-left rounded px-2 py-1.5 text-xs transition-colors flex items-center justify-between ' + (value === o.value ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                  <span className="truncate">{o.label}</span>
                  {o.count !== undefined && <span className="text-slate-400 ml-1 shrink-0">{o.count}</span>}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-400">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Product = Record<string, unknown>;
type Facet = { value: string; count: number };
type Facets = {
  categories: Facet[]; countries: Facet[]; statuses: Facet[];
  regions: Facet[]; appellations: Facet[]; wineClasses: Facet[]; tiers?: Facet[];
};
type TaxContext = { term: string; description_short: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
  try { const p = JSON.parse(raw as string); return Array.isArray(p) ? p.filter(Boolean) : []; } catch (_e) { return []; }
}

function fmt(v: unknown) { return v === null || v === undefined || v === '' ? '--' : String(v); }

function fmtPrice(v: unknown, currency = 'THB') {
  if (!v && v !== 0) return '--';
  const n = parseFloat(String(v)); if (isNaN(n)) return '--';
  const cur = (currency || 'THB').toUpperCase();
  try { return n.toLocaleString('th-TH', { style: 'currency', currency: cur, maximumFractionDigits: 0 }); }
  catch (_e) { return `${cur} ${n.toLocaleString()}`; }
}

const STATUS_COLORS: Record<string, string> = {
  validated:       'bg-emerald-500/20 text-emerald-300',
  needs_review:    'bg-amber-500/20 text-amber-300',
  needs_attention: 'bg-rose-500/20 text-rose-300',
  raw:             'bg-slate-500/20 text-slate-400',
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  'Red Wine':       'bg-white/8 text-white/80 border-white/15',
  'White Wine':     'bg-white/8 text-white/80 border-white/15',
  'Sparkling Wine': 'bg-white/8 text-white/80 border-white/15',
  'Champagne':      'bg-white/8 text-white/80 border-white/15',
  'Rose':           'bg-white/8 text-white/80 border-white/15',
  'Whisky':         'bg-white/8 text-white/80 border-white/15',
  'Gin':            'bg-white/8 text-white/80 border-white/15',
  'Rum':            'bg-white/8 text-white/80 border-white/15',
  'Vodka':          'bg-white/8 text-white/80 border-white/15',
  'Tequila':        'bg-white/8 text-white/80 border-white/15',
  'Sake':           'bg-white/8 text-white/80 border-white/15',
};
function classificationBadge(cls: string | null | undefined) {
  const c = cls ? String(cls) : '';
  const colors = CLASSIFICATION_COLORS[c] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors}`}>{c || 'Uncategorized item'}</span>;
}

const TIER_LABELS: Record<string, string> = {
  '1': 'T1 - Focus now',
  '2': 'T2 - High value',
  '3': 'T3 - Standard',
  '4': 'T4 - Monitor',
  '5': 'T5 - Low signal',
};

function tierValue(product: Product | null): string {
  if (!product) return '';
  const raw = product.product_tier ?? product.enrichment_priority;
  if (raw === null || raw === undefined || raw === '') return '';
  return String(raw).replace(/^T/i, '');
}

function tierLabel(product: Product | null): string {
  const tier = tierValue(product);
  return tier ? (TIER_LABELS[tier] ?? `T${tier}`) : 'Not tiered';
}

function tierDefinition(product: Product | null): string {
  if (!product) return '';
  const note = product.product_tier_definition ?? product.enrichment_note;
  if (note) return String(note).replace(/\s*\|\s*/g, ' · ');
  const tier = tierValue(product);
  if (tier === '1') return 'Highest BI priority: focus first for content, taxonomy, and merchandising work.';
  if (tier === '2') return 'Strong BI signal: important product or cluster, but behind T1 urgent focus.';
  if (tier === '3') return 'Normal catalog priority with useful signals but lower immediate focus.';
  if (tier === '5') return 'Low current demand signal or no recent sales signal.';
  return 'No BI priority explanation is attached yet.';
}

function fieldLabel(field: string): string {
  if (field === 'classification') return 'Item Category';
  if (field === 'wine_classification') return 'Classification';
  return field.replace(/_/g, ' ');
}

function fmtPct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${(n * 100).toFixed(1)}%`;
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
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${view === v ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
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
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [appellation, setAppellation] = useState('');
  const [status, setStatus] = useState('');
  const [classification, setClassification] = useState('');
  const [wineClass, setWineClass] = useState('');
  const [segment, setSegment] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [sortBy, setSortBy] = useState('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Detail state
  const [selected, setSelected] = useState<Product | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [charDimensions, setCharDimensions] = useState<CharDimension[]>([]);
  const [taxContexts, setTaxContexts] = useState<TaxContext[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([]);
  const [productAffinities, setProductAffinities] = useState<ProductAffinities | null>(null);
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
    sb = sortBy, sd = sortDir,
  ) => {
    const params = new URLSearchParams({ page: String(p) });
    if (q)  params.set('search', q);
    if (c)  params.set('country', c);
    if (r)  params.set('region', r);
    if (ap) params.set('appellation', ap);
    if (s)  params.set('validation_status', s);
    if (cl) params.set('classification', cl);
    if (wc) params.set('wine_classification', wc);
    if (sg) params.set('segment', sg);
    if (tierFilter) params.set('tier', tierFilter);
    params.set('sort', sb);
    params.set('sortDir', sd);
    const res = await fetch(`/api/products?${params}`);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json.total === 'number') setData(json);
    }
  }, [page, search, country, region, appellation, status, classification, wineClass, segment, tierFilter, sortBy, sortDir]);

  useEffect(() => {
    load(page, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, country, region, appellation, status, classification, wineClass, segment, tierFilter, sortBy, sortDir]);

  async function openProduct(p: Product) {
    setSelected(p);
    setEditMode(false);
    setDetailLoading(true);
    setCharDimensions([]);
    setTaxContexts([]);
    setRelatedProducts([]);
    setProductAffinities(null);
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
      if (json.relatedProducts) setRelatedProducts(json.relatedProducts);
      if (json.productAffinities) setProductAffinities(json.productAffinities);
    } catch (_e) { /* keep the initial product data */ }
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
    const cls = conf >= 0.75 ? 'bg-white/10 text-white' : conf >= 0.4 ? 'bg-white/8 text-white/70' : 'bg-white/5 text-white/40';
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{pct}%</span>;
  };

  const activeFilters = [country, region, appellation, status, classification, wineClass, tierFilter].filter(Boolean).length;

  // Price range filter state
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');

  // Confidence filter
  const [confFilter, setConfFilter] = useState('');

  // Group products by sku_base
  const [expandedGroups, setExpandedGroups] = useState(() => new Set<string>());
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
      filtered = filtered.filter(p => tierValue(p) === tierFilter);
    }

    const map = new Map() as Map<string, Product[]>;
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
    const m = new Map() as Map<string, string>;
    for (const tc of taxContexts) {
      if (tc.term && tc.description_short) m.set(tc.term, tc.description_short);
    }
    return m;
  }, [taxContexts]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ═══ LEFT PANEL: Product List ═══ */}
      <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[400px] lg:min-w-[400px] lg:max-w-[400px] border-r border-white/[0.07] bg-[#080808]`}>
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-white">Products</h1>
              {data && data.total != null && <p className="text-[11px] text-slate-500">{data.total.toLocaleString()} products</p>}
            </div>
            <button
              aria-label="Toggle filters"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${showFilters || activeFilters ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-white/[0.08] text-white/70 hover:text-white/90 hover:border-white/20'}`}
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
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-slate-500"
            />
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="space-y-2 pt-1">
              <SearchableSelect value={classification}
                onChange={function(v) { setClassification(v); setPage(1); }}
                options={(facets?.categories ?? []).map(function(f) { return { value: f.value, label: f.value, count: f.count }; })}
                placeholder="All item categories" />
              <SearchableSelect value={country}
                onChange={function(v) { setCountry(v); setRegion(''); setAppellation(''); setPage(1); }}
                options={(facets?.countries ?? []).map(function(f) { return { value: f.value, label: f.value, count: f.count }; })}
                placeholder="All countries" />
              <div className="flex gap-2">
                <input aria-label="Minimum price" placeholder="Price min" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                  className="flex-1 bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500" />
                <input aria-label="Maximum price" placeholder="Price max" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                  className="flex-1 bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500" />
              </div>
              <select aria-label="Confidence threshold" value={confFilter} onChange={e => setConfFilter(e.target.value)}
                className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">Any confidence</option>
                <option value="75">75%+</option>
                <option value="50">50%+</option>
                <option value="25">25%+</option>
              </select>
              <select aria-label="BI tier" value={tierFilter} onChange={e => setTierFilter(e.target.value)}
                className="w-full bg-[#111111] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">Any BI tier</option>
                {(['1', '2', '3', '4', '5'] as const).map(t => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
              </select>
              {/* Sort */}
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                <ArrowUpDown size={10} className="text-slate-500" />
                {[
                  { id: 'created', label: 'Added' },
                  { id: 'name', label: 'Name' },
                  { id: 'price', label: 'Price' },
                  { id: 'confidence', label: 'Conf.' },
                  { id: 'tier', label: 'Tier' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => toggleSort(opt.id)}
                    className={`flex items-center gap-0.5 px-2 py-1 rounded text-[10px] transition-colors ${sortBy === opt.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
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

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {groupedProducts.map((group) => {
            const p = group[0];
            const conf = confValue(p);
            const isActive = selected && selected.id === p.id;
            return (
              <div key={String(p.id)} onClick={() => openProduct(p)}
                className={`px-4 py-3 border-b border-white/5 cursor-pointer transition-colors ${isActive ? 'bg-white/[0.05] border-l border-l-white/40' : 'hover:bg-white/5'}`}>
                <div className="flex items-start gap-3">
                  <ProductImage
                    src={p.image_url ? String(p.image_url) : undefined}
                    alt={p.image_alt_text ? String(p.image_alt_text) : undefined}
                    sku={String(p.sku ?? '')}
                    classification={p.classification ? String(p.classification) : undefined}
                    size="sm"
                  />
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
                  {tierValue(p) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/8 text-white/60 font-medium">
                      T{tierValue(p)}
                    </span>
                  )}
                  {group.length > 1 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/8 text-white/50 font-medium">
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
            <div className="px-4 py-12 text-center text-slate-400 text-sm">Loading...</div>
          )}
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-white/10 flex items-center justify-between shrink-0">
            <p className="text-[10px] text-slate-500">Page {data.page}/{data.totalPages}</p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="text-slate-400 disabled:opacity-30 p-1"><ChevronLeft size={14} /></button>
              <span className="text-[11px] text-slate-300">{data.page}</span>
              <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}
                className="text-slate-400 disabled:opacity-30 p-1"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ RIGHT PANEL: Product Detail Dashboard ═══ */}
      <div className={`${selected ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Wine size={40} className="text-slate-500 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Select a product to view details</p>
            </div>
          </div>
        ) : (
          <>
            {/* Sticky header bar */}
            <div className="px-6 py-3 border-b border-white/10 shrink-0 flex items-center justify-between bg-[#080808]/90 backdrop-blur">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => setSelected(null)} className="lg:hidden text-slate-400 hover:text-white shrink-0">
                  <ChevronLeft size={18} />
                </button>
                <ProductImage
                  src={selected.image_url ? String(selected.image_url) : undefined}
                  alt={selected.image_alt_text ? String(selected.image_alt_text) : undefined}
                  sku={String(selected.sku ?? '')}
                  classification={selected.classification ? String(selected.classification) : undefined}
                  size="md"
                />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white truncate">{String(selected.name ?? '')}</h2>
                  <p className="text-[11px] text-slate-500 font-mono">{String(selected.sku ?? '')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditMode(!editMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${editMode ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}>
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
                    <div className="h-1 bg-white/30 rounded-full animate-pulse w-2/3" />
                  </div>
                </div>
              )}

              <div className="max-w-4xl">
                <ProductDetailPanel
                  product={toExploreProduct(selected)}
                  theme="dark"
                  charDimensions={charDimensions}
                  taxContextMap={taxContextMap}
                  relatedProducts={relatedProducts}
                  productAffinities={productAffinities}
                />

                {/* ── Inline Edit Panel ── */}
                {editMode && (
                  <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Edit2 size={14} className="text-white/40" />
                      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Edit Fields</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {EDITABLE.map(field => (
                        <div key={field}>
                          <label className="text-[10px] text-slate-400 block mb-1 capitalize">{fieldLabel(field)}</label>
                          <input
                            value={editFields[field] ?? ''}
                            onChange={e => setEditFields(f => ({ ...f, [field]: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-white/30 focus:outline-none"
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
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500"
                      />
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <button onClick={handleSave} disabled={saving}
                        className="bg-white hover:bg-white/90 disabled:opacity-50 text-black text-sm py-2 px-6 rounded-lg font-medium transition-colors">
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                      <button onClick={() => setEditMode(false)} className="text-xs text-slate-400 hover:text-white transition-colors">
                        Cancel
                      </button>
                      <p aria-live="polite" aria-atomic="true" className="text-xs text-slate-400">{saveMsg ?? ''}</p>
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
