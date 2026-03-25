'use client';
import { useEffect, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Edit2, X, Search,
  SlidersHorizontal, Layers, MapPin, Star, Droplets, Tag, Wine, Code2, Eye, FileText
} from 'lucide-react';

type Product = Record<string, any>;
type Facet = { value: string; count: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTags(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
}

function fmt(v: any) { return v === null || v === undefined || v === '' ? '—' : String(v); }

function fmtPrice(v: any, currency = 'THB') {
  if (!v && v !== 0) return '—';
  const n = parseFloat(String(v)); if (isNaN(n)) return '—';
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

const SKU_TYPES: Record<string, string> = {
  WRW:'Red Wine', WWW:'White Wine', WSP:'Sparkling', WRS:'Rosé', WDW:'Dessert Wine',
  LWH:'Whisky', LGN:'Gin', LRM:'Rum', LTQ:'Tequila', LVK:'Vodka', LLQ:'Liqueur',
  LBD:'Brandy', LSK:'Sake', LOT:'Other Spirit', LBE:'Beer',
  ABA:'Accessory', AWC:'Wine Cooler', GWN:'Glassware', GLQ:'Glassware', GBE:'Glassware', NNA:'Non-Alcoholic',
};
function skuType(sku: string) { return SKU_TYPES[(sku ?? '').substring(0, 3)] ?? 'Other'; }

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
  return TIER_SCALE[v.toLowerCase().trim()] ?? 2;
}

// ── Wine Profile Radar (inline SVG) ──────────────────────────────────────────

function RadarChart({ axes }: { axes: { label: string; value: number; max?: number }[] }) {
  const cx = 80, cy = 80, r = 60;
  const n = axes.length;
  const pts = axes.map((a, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const v = Math.min(1, (a.value / (a.max ?? 3)));
    return { x: cx + r * v * Math.cos(angle), y: cy + r * v * Math.sin(angle), lx: cx + (r + 18) * Math.cos(angle), ly: cy + (r + 18) * Math.sin(angle), label: a.label };
  });
  const polygon = pts.map(p => `${p.x},${p.y}`).join(' ');
  // grid rings
  const rings = [0.33, 0.67, 1].map(frac => {
    const gpts = Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      return `${cx + r * frac * Math.cos(angle)},${cy + r * frac * Math.sin(angle)}`;
    }).join(' ');
    return gpts;
  });
  return (
    <svg width={160} height={160} className="overflow-visible">
      {rings.map((pts, i) => <polygon key={i} points={pts} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />)}
      {pts.map((p, i) => <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos((i/n)*2*Math.PI - Math.PI/2)} y2={cy + r * Math.sin((i/n)*2*Math.PI - Math.PI/2)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
      <polygon points={polygon} fill="rgba(139,92,246,0.25)" stroke="rgba(139,92,246,0.7)" strokeWidth={1.5} />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="rgba(139,92,246,0.9)" />)}
      {pts.map((p, i) => (
        <text key={i} x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle" fill="rgba(148,163,184,0.9)" fontSize={9} fontFamily="sans-serif">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// ── Flavor Wheel (SVG radial) ─────────────────────────────────────────────────

function FlavorWheel({ flavors }: { flavors: string[] }) {
  if (!flavors.length) return null;
  const grouped = flavors.reduce<Record<string, string[]>>((acc, f) => {
    const c = guessFlavorCat(f);
    acc[c] = [...(acc[c] || []), f];
    return acc;
  }, {});
  const categories = Object.keys(grouped);
  const cx = 90, cy = 90, innerR = 28, outerR = 72;
  const total = flavors.length;
  let cumAngle = -Math.PI / 2;
  const CAT_COLORS: Record<string, string> = {
    fruit: '#f472b6', spice: '#fbbf24', herbal: '#34d399', earth: '#a8a29e',
    oak: '#fb923c', floral: '#c084fc', mineral: '#94a3b8', sweet: '#fb7185', other: '#60a5fa',
  };
  const segments = categories.map(cat => {
    const items = grouped[cat];
    const slice = (items.length / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += slice;
    const midAngle = startAngle + slice / 2;
    const x1 = cx + innerR * Math.cos(startAngle), y1 = cy + innerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(startAngle), y2 = cy + outerR * Math.sin(startAngle);
    const x3 = cx + outerR * Math.cos(cumAngle),   y3 = cy + outerR * Math.sin(cumAngle);
    const x4 = cx + innerR * Math.cos(cumAngle),   y4 = cy + innerR * Math.sin(cumAngle);
    const lx = cx + (outerR + 14) * Math.cos(midAngle);
    const ly = cy + (outerR + 14) * Math.sin(midAngle);
    const lg = slice > 0.3;
    return { cat, items, path: `M${x1},${y1} L${x2},${y2} A${outerR},${outerR} 0 ${slice > Math.PI ? 1 : 0} 1 ${x3},${y3} L${x4},${y4} A${innerR},${innerR} 0 ${slice > Math.PI ? 1 : 0} 0 ${x1},${y1} Z`, lx, ly, lg, color: CAT_COLORS[cat] ?? '#60a5fa' };
  });
  return (
    <div className="flex flex-col items-center">
      <svg width={180} height={180} className="overflow-visible">
        {segments.map(s => (
          <g key={s.cat}>
            <path d={s.path} fill={s.color} fillOpacity={0.3} stroke={s.color} strokeOpacity={0.7} strokeWidth={1} />
            {s.lg && (
              <text x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle" fill={s.color} fontSize={8} fontFamily="sans-serif" fontWeight="600">
                {s.cat}
              </text>
            )}
          </g>
        ))}
        <circle cx={cx} cy={cy} r={innerR - 2} fill="rgba(15,23,42,0.8)" />
        <text x={cx} y={cy - 5} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={9} fontFamily="sans-serif">Flavour</text>
        <text x={cx} y={cy + 7} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={11} fontFamily="sans-serif" fontWeight="bold">{total}</text>
      </svg>
    </div>
  );
}

// ── Confidence bars ────────────────────────────────────────────────────────────

function ConfBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.75 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-rose-500';
  const txt = value >= 0.75 ? 'text-emerald-400' : value >= 0.4 ? 'text-amber-400' : 'text-rose-400';
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={txt}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full">
        <div className={`h-1.5 rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const EDITABLE = ['name','sku','brand','vintage','country','region','subregion','classification','grape_variety','wine_type','liquor_main_type','price','cost_price','currency','alcohol','bottle_size','validation_status'];

const SEGMENTS = [
  { id: '', label: 'All' },
  { id: 'wine', label: '🍷 Wine' },
  { id: 'spirits', label: '🥃 Spirits' },
  { id: 'accessories', label: '🔧 Accessories' },
];

// ── Description block with Text / Preview / Source toggle ────────────────────

type DescView = 'text' | 'preview' | 'source';

// Language description block: explicit Short + Full sections
function LangDesc({
  shortText, fullText, fullHtml,
}: {
  shortText?: string | null; fullText?: string | null; fullHtml?: string | null;
}) {
  const [view, setView] = useState<DescView>('text');
  const hasShort = !!shortText;
  const hasFull  = !!(fullText || fullHtml);

  if (!hasShort && !hasFull) {
    return <p className="text-sm text-slate-600 italic">—</p>;
  }

  return (
    <div className="space-y-3">
      {/* Short description */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Short description</p>
        {hasShort
          ? <p className="text-sm text-slate-200 leading-relaxed">{shortText}</p>
          : <p className="text-sm text-slate-600 italic">—</p>
        }
      </div>

      {/* Full description */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Full description</p>
          {hasFull && fullHtml && (
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
        {!hasFull
          ? <p className="text-sm text-slate-600 italic">—</p>
          : (
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
          )
        }
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ProductsPage() {
  const [data, setData] = useState<{ items: Product[]; total: number; totalPages: number; page: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState('');
  const [classification, setClassification] = useState('');
  const [segment, setSegment] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'tasting' | 'edit'>('info');
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ classifications: Facet[]; countries: Facet[]; statuses: Facet[] } | null>(null);

  // Load facets once
  useEffect(() => {
    fetch('/api/products/facets').then(r => r.json()).then(setFacets).catch(() => {});
  }, []);

  async function load(p = page, q = search, c = country, s = status, cl = classification, sg = segment) {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('search', q);
    if (c) params.set('country', c);
    if (s) params.set('validation_status', s);
    if (cl) params.set('classification', cl);
    if (sg) params.set('segment', sg);
    const res = await fetch(`/api/products?${params}`);
    setData(await res.json());
  }

  useEffect(() => { load(page, search, country, status, classification, segment); }, [page, search, country, status, classification, segment]);

  async function openProduct(p: Product) {
    setSelected(p);
    setPanelTab('info');
    setEditFields(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v != null ? String(v) : ''])));
    setNote('');
    setSaveMsg(null);
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
    if (res.ok) { setSaveMsg('Saved ✓'); load(); }
    else { setSaveMsg(json.error ?? 'Save failed'); }
  }

  const confBadge = (conf: number) => {
    const pct = Math.round(conf * 100);
    const cls = conf >= 0.75 ? 'bg-emerald-500/20 text-emerald-300' : conf >= 0.4 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300';
    return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{pct}%</span>;
  };

  const activeFilters = [country, status, classification].filter(Boolean).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-white">Products</h1>
          {data && <p className="text-xs text-slate-500 mt-0.5">{data.total.toLocaleString()} products</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              placeholder="Search name or SKU…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-slate-600 w-56"
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${showFilters || activeFilters ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
          >
            <SlidersHorizontal size={13} /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </button>
        </div>
      </div>

      {/* Segment tabs */}
      <div className="flex gap-1.5 mb-4">
        {SEGMENTS.map(sg => (
          <button key={sg.id} onClick={() => { setSegment(sg.id); setPage(1); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${segment === sg.id ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'}`}>
            {sg.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-4 p-4 bg-white/5 rounded-xl border border-white/10">
          <select value={country} onChange={e => { setCountry(e.target.value); setPage(1); }}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white min-w-[140px]">
            <option value="">All countries</option>
            {(facets?.countries ?? []).slice(0, 40).map(f => (
              <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
            ))}
          </select>
          <select value={classification} onChange={e => { setClassification(e.target.value); setPage(1); }}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white min-w-[160px]">
            <option value="">All classifications</option>
            {(facets?.classifications ?? []).slice(0, 50).map(f => (
              <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
            ))}
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="">All statuses</option>
            {(facets?.statuses ?? []).map(f => (
              <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button onClick={() => { setCountry(''); setStatus(''); setClassification(''); setPage(1); }}
              className="text-xs text-slate-400 hover:text-white px-2">Clear ×</button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white/5 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {['SKU', 'Name', 'Type', 'Country · Region', 'Price', 'Confidence', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs text-slate-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p: Product) => {
              const conf = parseFloat(String(p.overall_confidence ?? 0));
              return (
                <tr key={p.id} onClick={() => openProduct(p)} className="border-b border-white/5 hover:bg-white/5 cursor-pointer">
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-white max-w-[200px] truncate">{p.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.classification || skuType(p.sku)}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">
                    {p.country || <span className="text-slate-600 italic">unknown</span>}
                    {p.region && <span className="text-slate-500"> · {p.region}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{fmtPrice(p.price, p.currency)}</td>
                  <td className="px-4 py-3">{confBadge(conf)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[p.validation_status ?? ''] ?? 'bg-slate-500/20 text-slate-300'}`}>
                      {p.validation_status ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2"><Edit2 size={12} className="text-slate-600" /></td>
                </tr>
              );
            })}
            {data?.items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">No products found</td></tr>
            )}
            {!data && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600 text-sm">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">{data.total.toLocaleString()} products · page {data.page} of {data.totalPages}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-slate-400 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="text-xs text-slate-300">{data.page} / {data.totalPages}</span>
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="text-slate-400 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-[500px] bg-slate-950 border-l border-white/10 flex flex-col z-50 shadow-2xl">
          {/* Panel header */}
          <div className="px-6 pt-5 pb-4 border-b border-white/10 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500">{selected.sku} · {selected.classification || skuType(selected.sku)}</p>
                <h2 className="text-base font-semibold text-white mt-0.5 leading-tight">{selected.name}</h2>
                {selected.brand && <p className="text-xs text-slate-400 mt-0.5">{selected.brand}</p>}
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white shrink-0"><X size={16} /></button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[selected.validation_status ?? ''] ?? 'bg-slate-500/20 text-slate-300'}`}>
                {selected.validation_status ?? 'unvalidated'}
              </span>
              {confBadge(parseFloat(String(selected.overall_confidence ?? 0)))}
              {selected.vintage && <span className="text-xs bg-white/5 text-slate-400 rounded px-2 py-0.5">Vintage {selected.vintage}</span>}
            </div>
            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {(['info', 'tasting', 'edit'] as const).map(tab => (
                <button key={tab} onClick={() => setPanelTab(tab)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${panelTab === tab ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  {tab === 'info' ? 'Details' : tab === 'tasting' ? '🍷 Tasting' : '✏️ Edit'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* ── INFO TAB ── */}
            {panelTab === 'info' && (
              <>
                {/* Key stats */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Price', value: fmtPrice(selected.price, selected.currency) },
                    { label: 'Alcohol', value: selected.alcohol ? `${selected.alcohol}%` : '—' },
                    { label: 'Bottle', value: fmt(selected.bottle_size) },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white/5 rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-white">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Geography */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><MapPin size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Geography</h3></div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[selected.country, selected.region, selected.subregion].filter(Boolean).map((loc, i, arr) => (
                      <span key={i} className="flex items-center gap-1.5 text-sm text-white">
                        {loc}{i < arr.length - 1 && <span className="text-slate-600">›</span>}
                      </span>
                    ))}
                    {!selected.country && <span className="text-sm text-slate-500 italic">Origin unknown</span>}
                  </div>
                  {selected.enrichment_note && <p className="text-xs text-slate-500 mt-2 italic">{selected.enrichment_note}</p>}
                </div>

                {/* Taxonomy */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><Layers size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Taxonomy</h3></div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                    {[
                      { label: 'Classification', value: selected.classification },
                      { label: 'Grape / Variety', value: selected.grape_variety },
                      { label: 'Wine Type', value: selected.wine_type },
                      { label: 'Origin', value: selected.origin },
                    ].map(({ label, value }) => (
                      <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="text-white mt-0.5 text-sm">{fmt(value)}</p></div>
                    ))}
                  </div>
                </div>

                {/* Character traits */}
                {(() => {
                  const traits = parseTags(selected.character_traits);
                  if (!traits.length) return null;
                  return (
                    <div className="bg-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3"><Star size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Character</h3></div>
                      <div className="flex flex-wrap gap-2">
                        {traits.map(t => <span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/25 capitalize">{t}</span>)}
                      </div>
                    </div>
                  );
                })()}

                {/* Confidence */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><Tag size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Confidence</h3></div>
                  <ConfBar label="Overall" value={parseFloat(String(selected.overall_confidence ?? 0))} />
                  <ConfBar label="Taxonomy" value={parseFloat(String(selected.taxonomy_confidence ?? 0))} />
                </div>
              </>
            )}

            {/* ── TASTING TAB ── */}
            {panelTab === 'tasting' && (
              <>
                {/* Descriptions — EN + TH (two store variants) */}
                {/* ── English ── */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs font-bold">EN</span>
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">English</h3>
                  </div>
                  <LangDesc
                    shortText={selected.short_description_en}
                    fullText={selected.description_en_text}
                    fullHtml={selected.description_en_html}
                  />
                </div>

                {/* ── Thai ── */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-xs font-bold">TH</span>
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Thai</h3>
                  </div>
                  <LangDesc
                    shortText={selected.short_description_th_wn || selected.short_description_th_liq9}
                    fullText={selected.description_th_wn_text || selected.description_th_liq9_text}
                    fullHtml={selected.description_th_wn_html || selected.description_th_liq9_html}
                  />
                </div>

                {/* Tasting Notes — always visible, all 4 rows */}
                <div className="bg-white/5 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Tasting Notes</p>
                  {[
                    { label: '👁 Color',       val: selected.wine_color },
                    { label: '👃 Aroma',       val: selected.wine_aroma },
                    { label: '👅 Palate',      val: selected.wine_palate },
                    { label: '🍽 Food Pairing', val: selected.food_matching },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                      <p className={`text-sm leading-relaxed ${val ? 'text-slate-200' : 'text-slate-600 italic'}`}>{val || '—'}</p>
                    </div>
                  ))}
                </div>

                {/* Wine Profile Radar — always visible */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3"><Wine size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Wine Profile</h3></div>
                  {(selected.wine_body || selected.wine_acidity || selected.wine_tannin) ? (
                    <div className="flex items-center gap-6">
                      <RadarChart axes={[
                        { label: 'Body',      value: scaleTier(selected.wine_body),     max: 3 },
                        { label: 'Acidity',   value: scaleTier(selected.wine_acidity),  max: 3 },
                        { label: 'Tannin',    value: scaleTier(selected.wine_tannin),   max: 3 },
                        { label: 'Sweetness', value: selected.classification?.toLowerCase().includes('dessert') ? 3 : 1, max: 3 },
                        { label: 'Intensity', value: 2, max: 3 },
                      ]} />
                      <div className="space-y-2.5">
                        {[
                          { label: 'Body',    val: selected.wine_body },
                          { label: 'Acidity', val: selected.wine_acidity },
                          { label: 'Tannin',  val: selected.wine_tannin },
                        ].map(({ label, val }) => (
                          <div key={label} className="flex items-center gap-3">
                            <span className="text-xs text-slate-500 w-14">{label}</span>
                            <div className="flex gap-1">
                              {[1, 2, 3].map(dot => (
                                <div key={dot} className={`w-2.5 h-2.5 rounded-full ${val && dot <= scaleTier(val) ? 'bg-violet-500' : 'bg-white/10'}`} />
                              ))}
                            </div>
                            <span className={`text-xs capitalize ${val ? 'text-slate-300' : 'text-slate-600 italic'}`}>{val || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600 italic text-center py-3">Profile data not yet available</p>
                  )}
                </div>

                {/* Flavour Wheel — only when flavor_profile data exists */}
                {(() => {
                  const flavors = parseTags(selected.flavor_profile);
                  if (!flavors.length) return null;
                  const grouped = flavors.reduce<Record<string, string[]>>((acc, f) => {
                    const c = guessFlavorCat(f); acc[c] = [...(acc[c] || []), f]; return acc;
                  }, {});
                  return (
                    <div className="bg-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3"><Droplets size={13} className="text-violet-400" /><h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Flavour Wheel</h3></div>
                      <div className="flex gap-4 items-start">
                        <FlavorWheel flavors={flavors} />
                        <div className="flex-1 space-y-2.5">
                          {Object.entries(grouped).map(([cat, items]) => (
                            <div key={cat}>
                              <p className="text-xs text-slate-500 mb-1 capitalize">{cat}</p>
                              <div className="flex flex-wrap gap-1">
                                {items.map(f => <span key={f} className={`px-2 py-0.5 rounded-full text-xs border ${FLAVOR_COLORS[cat] ?? DEFAULT_FLAVOR}`}>{f}</span>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* ── EDIT TAB ── */}
            {panelTab === 'edit' && (
              <div className="space-y-3">
                {EDITABLE.map(field => (
                  <div key={field}>
                    <label className="text-xs text-slate-400 block mb-1 capitalize">{field.replace(/_/g, ' ')}</label>
                    <input
                      value={editFields[field] ?? ''}
                      onChange={e => setEditFields(f => ({ ...f, [field]: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500/50 focus:outline-none"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Note (optional)</label>
                  <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Reason for this change…"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600"
                  />
                </div>
              </div>
            )}
          </div>

          {panelTab === 'edit' && (
            <div className="px-6 py-4 border-t border-white/10 shrink-0">
              {saveMsg && <p className="text-xs text-slate-400 mb-2">{saveMsg}</p>}
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium transition-colors">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
