'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Edit2, X, Search,
  SlidersHorizontal, Layers, MapPin, Star, Droplets, Tag, Wine, Code2, Eye, FileText,
  ArrowUpDown, ChevronDown, AlertTriangle, CheckCircle2, Info, Utensils, BarChart3
} from 'lucide-react';
import {
  RadarChart as RechartsRadar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, ResponsiveContainer, Tooltip,
} from 'recharts';

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

const FLAVOR_COLORS: Record<string, string> = {
  fruit:   'bg-pink-500/20 text-pink-300 border-pink-500/30',
  spice:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  herbal:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  earth:   'bg-stone-500/20 text-stone-300 border-stone-500/30',
  oak:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  floral:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  mineral: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
  sweet:   'bg-rose-500/20 text-rose-300 border-rose-500/30',
};
const DEFAULT_FLAVOR = 'bg-blue-500/20 text-blue-300 border-blue-500/30';

function guessFlavorCat(f: string) {
  const s = f.toLowerCase();
  if (/apple|pear|cherry|plum|berry|fig|peach|citrus|lemon|lime|orange|mango|tropical|melon/.test(s)) return 'fruit';
  if (/pepper|spice|clove|cinnamon|ginger|nutmeg|vanilla/.test(s)) return 'spice';
  if (/grass|mint|herb|eucalyptus|thyme|sage|green/.test(s)) return 'herbal';
  if (/earth|soil|mushroom|truffle|leather|tobacco/.test(s)) return 'earth';
  if (/oak|cedar|wood|smoke|toast/.test(s)) return 'oak';
  if (/floral|rose|violet|jasmine|blossom|flower/.test(s)) return 'floral';
  if (/mineral|chalk|flint|stone|slate/.test(s)) return 'mineral';
  if (/honey|caramel|chocolate|cream|butter|sweet/.test(s)) return 'sweet';
  return 'other';
}

const STATUS_COLORS: Record<string, string> = {
  validated:       'bg-emerald-500/20 text-emerald-300',
  needs_review:    'bg-amber-500/20 text-amber-300',
  needs_attention: 'bg-rose-500/20 text-rose-300',
  raw:             'bg-slate-500/20 text-slate-400',
};

const TIER_SCALE: Record<string, number> = {
  low: 1, medium: 2, high: 3, full: 3, light: 1,
};
function scaleTier(v: string | null | undefined): number {
  if (!v) return 0;
  return TIER_SCALE[String(v).toLowerCase().trim()] ?? 2;
}

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

// Map dimension keys to product fields
const DIMENSION_FIELD_MAP: Record<string, string> = {
  body: 'wine_body',
  acidity: 'wine_acidity',
  tannin: 'wine_tannin',
  sweetness: 'wine_sweetness',
  alcohol: 'alcohol',
  intensity: 'wine_intensity',
  complexity: 'wine_complexity',
  finish: 'wine_finish',
  smoke: 'spirit_smoke',
  spice: 'spirit_spice',
  oak: 'spirit_oak',
  fruit: 'spirit_fruit',
  umami: 'sake_umami',
  fragrance: 'sake_fragrance',
};

function dimensionValue(product: Product, dimKey: string): number {
  const field = DIMENSION_FIELD_MAP[dimKey];
  if (field && product[field] != null) {
    const raw = product[field];
    const num = parseFloat(String(raw));
    if (!isNaN(num)) return Math.min(num, 5);
    return scaleTier(String(raw));
  }
  // fallback: try direct key
  if (product[dimKey] != null) {
    const num = parseFloat(String(product[dimKey]));
    if (!isNaN(num)) return Math.min(num, 5);
    return scaleTier(String(product[dimKey]));
  }
  return 0;
}

const IMPORTANT_FIELDS = [
  { key: 'classification', label: 'Classification' },
  { key: 'country', label: 'Country' },
  { key: 'region', label: 'Region' },
  { key: 'grape_variety', label: 'Grape Variety' },
  { key: 'vintage', label: 'Vintage' },
  { key: 'wine_body', label: 'Body' },
  { key: 'wine_acidity', label: 'Acidity' },
  { key: 'flavor_tags', label: 'Flavor Tags' },
  { key: 'food_matching', label: 'Food Matching' },
  { key: 'desc_en_short', label: 'Short Description (EN)' },
  { key: 'desc_en_full', label: 'Full Description (EN)' },
  { key: 'price', label: 'Price' },
];

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
    params.set('sort', sb);
    params.set('sortDir', sd);
    const res = await fetch(`/api/products?${params}`);
    setData(await res.json());
  }, [page, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir]);

  useEffect(() => {
    load(page, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, country, region, appellation, status, classification, wineClass, segment, sortBy, sortDir]);

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

  // Radar data from dynamic character dimensions
  const radarData = useMemo(() => {
    if (!selected || !charDimensions.length) return [];
    return charDimensions
      .map(d => ({
        dimension: d.label,
        value: dimensionValue(selected, d.dimension_key),
        fullMark: 3,
      }))
      .filter(d => d.value > 0);
  }, [selected, charDimensions]);

  // Missing fields analysis
  const missingFields = useMemo(() => {
    if (!selected) return [];
    return IMPORTANT_FIELDS
      .filter(f => {
        const v = selected[f.key];
        if (v === null || v === undefined || v === '') return true;
        if (typeof v === 'string' && v.trim() === '') return true;
        return false;
      })
      .map(f => ({
        label: f.label,
        severity: ['classification', 'country', 'price'].includes(f.key) ? 'high' as const : 'medium' as const,
      }));
  }, [selected]);

  const taxContextMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const tc of taxContexts) {
      if (tc.term && tc.description_short) m.set(tc.term, tc.description_short);
    }
    return m;
  }, [taxContexts]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)]">
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
              <select value={classification} onChange={e => { setClassification(e.target.value); setPage(1); }}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">All classifications</option>
                {(facets?.categories ?? []).map(f => (
                  <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
                ))}
              </select>
              <select value={country} onChange={e => { setCountry(e.target.value); setRegion(''); setAppellation(''); setPage(1); }}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">All countries</option>
                {(facets?.countries ?? []).map(f => (
                  <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input placeholder="Price min" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600" />
                <input placeholder="Price max" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600" />
              </div>
              <select value={confFilter} onChange={e => setConfFilter(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">Any confidence</option>
                <option value="75">75%+</option>
                <option value="50">50%+</option>
                <option value="25">25%+</option>
              </select>
              <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="">Any enrichment tier</option>
                <option value="1">T1 - High priority</option>
                <option value="2">T2 - Medium priority</option>
                <option value="3">T3 - Standard</option>
                <option value="5">T5 - Low / No sales</option>
              </select>
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

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
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

                  {radarData.length >= 3 ? (
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <div className="w-[260px] h-[220px] shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsRadar cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                            <PolarGrid stroke="rgba(255,255,255,0.08)" />
                            <PolarAngleAxis
                              dataKey="dimension"
                              tick={{ fill: 'rgba(148,163,184,0.8)', fontSize: 11 }}
                            />
                            <PolarRadiusAxis
                              angle={90}
                              domain={[0, 3]}
                              tick={false}
                              axisLine={false}
                            />
                            <Radar
                              name="Profile"
                              dataKey="value"
                              stroke="rgba(139,92,246,0.8)"
                              fill="rgba(139,92,246,0.25)"
                              strokeWidth={2}
                            />
                            <Tooltip
                              contentStyle={{
                                background: 'rgba(15,23,42,0.95)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                fontSize: '12px',
                                color: '#e2e8f0',
                              }}
                            />
                          </RechartsRadar>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2">
                        {charDimensions.map(d => {
                          const val = dimensionValue(selected, d.dimension_key);
                          return (
                            <div key={d.dimension_key} className="flex items-center gap-3">
                              <span className="text-xs text-slate-400 w-20 shrink-0">{d.label}</span>
                              <div className="flex gap-1">
                                {[1, 2, 3].map(dot => (
                                  <div key={dot} className={`w-2 h-2 rounded-full transition-colors ${val >= dot ? 'bg-violet-500' : 'bg-white/10'}`} />
                                ))}
                              </div>
                              <span className="text-[11px] text-slate-500">
                                {val > 0 ? val.toFixed(0) : '--'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : radarData.length > 0 ? (
                    /* Fewer than 3 data points -- show as simple bars */
                    <div className="space-y-2">
                      {charDimensions.map(d => {
                        const val = dimensionValue(selected, d.dimension_key);
                        return (
                          <div key={d.dimension_key} className="flex items-center gap-3">
                            <span className="text-xs text-slate-400 w-20">{d.label}</span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full">
                              <div className="h-1.5 bg-violet-500 rounded-full" style={{ width: `${(val / 3) * 100}%` }} />
                            </div>
                            <span className="text-[11px] text-slate-500 w-6 text-right">
                              {val > 0 ? val.toFixed(0) : '--'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : charDimensions.length > 0 ? (
                    <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                      <p className="text-xs text-slate-500 italic">
                        Character dimensions defined but no values yet. Available:
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {charDimensions.map(d => (
                          <span key={d.dimension_key} className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-slate-600">{d.label}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                      <p className="text-xs text-slate-500 italic">
                        No character dimensions available for this product scope. Dimensions are loaded from the character_dimensions table based on the product classification.
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Card 4: Flavor & Pairing ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Utensils size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Flavor & Pairing</h3>
                  </div>

                  {(() => {
                    const flavorTags = parseTags(selected.flavor_tags as string);
                    const foodMatching = parseTags(selected.food_matching as string);
                    const hasAny = flavorTags.length > 0 || foodMatching.length > 0;

                    if (!hasAny) {
                      return (
                        <div className="border border-dashed border-white/10 rounded-lg px-4 py-4">
                          <p className="text-xs text-slate-500 italic">Not yet enriched</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        {flavorTags.length > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">Flavor Tags</p>
                            <div className="flex flex-wrap gap-1.5">
                              {flavorTags.map(t => {
                                const cat = guessFlavorCat(t);
                                return (
                                  <span key={t} className={`px-2.5 py-1 rounded-full text-xs border capitalize ${FLAVOR_COLORS[cat] ?? DEFAULT_FLAVOR}`}>
                                    {t}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {foodMatching.length > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">Food Pairing</p>
                            <div className="flex flex-wrap gap-1.5">
                              {foodMatching.map(f => (
                                <span key={f} className="px-2.5 py-1 rounded-full text-xs border bg-emerald-500/15 text-emerald-300 border-emerald-500/25 capitalize">
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
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

                {/* ── Card 6: Data Quality ── */}
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={14} className="text-violet-400" />
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Data Quality</h3>
                  </div>

                  {/* Overall confidence */}
                  <div className="mb-4">
                    <ConfBar label="Overall Confidence" value={confValue(selected)} />
                    {selected.taxonomy_confidence != null && (
                      <ConfBar label="Taxonomy Confidence" value={parseFloat(String(selected.taxonomy_confidence ?? 0))} />
                    )}
                  </div>

                  {/* Validation status */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[String(selected.validation_status ?? '')] ?? 'bg-slate-500/20 text-slate-300'}`}>
                      {String(selected.validation_status ?? 'raw')}
                    </span>
                    {!!selected.updated_at && (
                      <span className="text-[10px] text-slate-600">
                        Updated {new Date(String(selected.updated_at)).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {/* Missing fields */}
                  {missingFields.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">
                        Missing Fields ({missingFields.length})
                      </p>
                      <div className="space-y-1">
                        {missingFields.map(f => (
                          <div key={f.label} className="flex items-center gap-2">
                            {f.severity === 'high' ? (
                              <AlertTriangle size={11} className="text-rose-400 shrink-0" />
                            ) : (
                              <Info size={11} className="text-amber-400 shrink-0" />
                            )}
                            <span className={`text-xs ${f.severity === 'high' ? 'text-rose-300' : 'text-amber-300'}`}>
                              {f.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {missingFields.length === 0 && (
                    <div className="flex items-center gap-2 text-emerald-400">
                      <CheckCircle2 size={13} />
                      <span className="text-xs">All important fields populated</span>
                    </div>
                  )}
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
