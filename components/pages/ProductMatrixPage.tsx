'use client';
import { useEffect, useState } from 'react';
import { Grid3x3, Globe, Tag, Star, Layers, BarChart2, TrendingUp } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type MatrixData = {
  totalProducts: number;
  validated: number;
  needsReview: number;
  byCategory: { value: string; count: number }[];
  byCountry: { value: string; count: number }[];
  byPriceTier: { tier: string; label: string; count: number }[];
  byGrape: { value: string; count: number }[];
  byClassification: { value: string; count: number }[];
  categoryCountry: Record<string, Record<string, number>>;  // category → country → count
  confidenceDistribution: { band: string; count: number }[];
};

// ── Colour palette ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'Red Wine':      '#ef4444',
  'White Wine':    '#fbbf24',
  'Sparkling Wine':'#a78bfa',
  'Champagne':     '#c084fc',
  'Rosé Wine':     '#f472b6',
  'Dessert Wine':  '#fb923c',
  'Wine product':  '#6b7280',
  'Whisky':        '#92400e',
  'Gin':           '#34d399',
  'Rum':           '#f59e0b',
  'Vodka':         '#60a5fa',
  'Tequila':       '#84cc16',
  'Liqueur':       '#e879f9',
  'Brandy':        '#d97706',
  'Beer':          '#fde68a',
  'Sake/Shochu':   '#a5f3fc',
};
const DEFAULT_COLOR = '#475569';

function categoryColor(cat: string) { return CATEGORY_COLORS[cat] ?? DEFAULT_COLOR; }

// ── Bar helpers ────────────────────────────────────────────────────────────────

function HBar({ label, count, max, color }: { label: string; count: number; max: number; color?: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 group">
      <div className="w-36 text-right text-xs text-slate-400 truncate shrink-0 group-hover:text-white transition-colors">{label}</div>
      <div className="flex-1 h-5 bg-white/5 rounded-sm overflow-hidden">
        <div className="h-full rounded-sm transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color ?? '#8b5cf6' }} />
      </div>
      <div className="w-10 text-right text-xs text-slate-400 shrink-0">{count.toLocaleString()}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white/5 rounded-2xl p-5 flex flex-col gap-3 border border-white/8">
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color: color ?? '#8b5cf6' }} />
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Category × Country matrix ──────────────────────────────────────────────────

function CrossMatrix({ data }: { data: Record<string, Record<string, number>> }) {
  const categories = Object.keys(data).slice(0, 12);
  const countrySet = new Set<string>();
  for (const cats of Object.values(data)) Object.keys(cats).forEach(c => countrySet.add(c));
  const countries = [...countrySet].sort((a, b) => {
    const ta = Object.values(data).reduce((s, cats) => s + (cats[a] ?? 0), 0);
    const tb = Object.values(data).reduce((s, cats) => s + (cats[b] ?? 0), 0);
    return tb - ta;
  }).slice(0, 15);

  const cellMax = Math.max(...categories.flatMap(cat => countries.map(co => data[cat]?.[co] ?? 0)));

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] min-w-max w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 text-slate-500 font-medium w-32">Category ╲ Country</th>
            {countries.map(co => (
              <th key={co} className="px-2 py-2 text-slate-400 font-medium text-center max-w-[60px] truncate" title={co}>
                {co.length > 7 ? co.slice(0, 6) + '…' : co}
              </th>
            ))}
            <th className="px-2 py-2 text-slate-500 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {categories.map(cat => {
            const rowTotal = Object.values(data[cat] ?? {}).reduce((s, v) => s + v, 0);
            return (
              <tr key={cat} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor(cat) }} />
                    <span className="text-slate-300 truncate max-w-[116px]" title={cat}>{cat}</span>
                  </span>
                </td>
                {countries.map(co => {
                  const v = data[cat]?.[co] ?? 0;
                  const intensity = cellMax > 0 ? v / cellMax : 0;
                  return (
                    <td key={co} className="px-2 py-1.5 text-center" title={`${cat} × ${co}: ${v}`}>
                      {v > 0 ? (
                        <span className="inline-flex items-center justify-center w-9 h-6 rounded text-[10px] font-medium transition-colors"
                          style={{
                            backgroundColor: `rgba(139,92,246,${Math.max(0.08, intensity * 0.7)})`,
                            color: intensity > 0.4 ? '#e2e8f0' : '#94a3b8',
                          }}>
                          {v}
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right text-slate-400 font-medium">{rowTotal.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Confidence donut ───────────────────────────────────────────────────────────

function ConfidenceDonut({ bands }: { bands: { band: string; count: number }[] }) {
  const total = bands.reduce((s, b) => s + b.count, 0);
  if (!total) return null;
  const COLORS: Record<string, string> = { High: '#10b981', Medium: '#f59e0b', Low: '#ef4444' };
  let cumAngle = -Math.PI / 2;
  const cx = 70, cy = 70, r = 52, ir = 32;
  const slices = bands.map(b => {
    const frac = b.count / total;
    const start = cumAngle;
    cumAngle += frac * 2 * Math.PI;
    const end = cumAngle;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
    const x3 = cx + ir * Math.cos(end),  y3 = cy + ir * Math.sin(end);
    const x4 = cx + ir * Math.cos(start), y4 = cy + ir * Math.sin(start);
    return { ...b, frac, path: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${ir},${ir} 0 ${large} 0 ${x4},${y4} Z`, color: COLORS[b.band] ?? '#6b7280' };
  });
  return (
    <div className="flex items-center gap-6">
      <svg width={140} height={140}>
        {slices.map(s => (
          <path key={s.band} d={s.path} fill={s.color} fillOpacity={0.85} stroke="rgba(15,23,42,0.6)" strokeWidth={1.5} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize={18} fontWeight="bold" fontFamily="sans-serif">
          {total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize={9} fontFamily="sans-serif">products</text>
      </svg>
      <div className="space-y-2.5">
        {slices.map(s => (
          <div key={s.band} className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-slate-300 w-16">{s.band}</span>
            <span className="text-xs text-slate-400">{s.count.toLocaleString()}</span>
            <span className="text-xs text-slate-600">({Math.round(s.frac * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function ProductMatrixPage() {
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Fetch all three facets + product count in parallel
        const [facetsRes, countRes] = await Promise.all([
          fetch('/api/products/facets'),
          fetch('/api/products?page=1&limit=1'),
        ]);
        const facets  = await facetsRes.json();
        const counts  = await countRes.json();

        // Price tier breakdown — fetch products with price field
        const priceRes = await fetch('/api/products/export?format=json&status=all');
        const priceData = await priceRes.json();
        const allProducts: any[] = priceData.products ?? [];

        // Price tiers
        const TIERS = [
          { tier: 'A', label: '฿0 – 1,000',     min: 0,    max: 1000   },
          { tier: 'B', label: '฿1,000 – 2,000',  min: 1000, max: 2000   },
          { tier: 'C', label: '฿2,000 – 3,000',  min: 2000, max: 3000   },
          { tier: 'D', label: '฿3,000 – 5,000',  min: 3000, max: 5000   },
          { tier: 'E', label: '฿5,000+',          min: 5000, max: Infinity },
        ];
        const byPriceTier = TIERS.map(t => ({
          ...t,
          count: allProducts.filter(p => {
            const price = parseFloat(p.price);
            return !isNaN(price) && price >= t.min && price < t.max;
          }).length,
        }));

        // Category × Country cross-matrix
        const categoryCountry: Record<string, Record<string, number>> = {};
        for (const p of allProducts) {
          const cat = p.classification || 'Unknown';
          const co  = p.country || 'Unknown';
          if (!categoryCountry[cat]) categoryCountry[cat] = {};
          categoryCountry[cat][co] = (categoryCountry[cat][co] ?? 0) + 1;
        }
        // Sort categories by total desc
        const sortedCats = Object.entries(categoryCountry)
          .sort((a, b) => Object.values(b[1]).reduce((s,v)=>s+v,0) - Object.values(a[1]).reduce((s,v)=>s+v,0))
          .reduce<Record<string, Record<string, number>>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});

        // Confidence distribution
        const highConf   = allProducts.filter(p => parseFloat(p.overall_confidence) >= 0.75).length;
        const medConf    = allProducts.filter(p => { const c = parseFloat(p.overall_confidence); return c >= 0.4 && c < 0.75; }).length;
        const lowConf    = allProducts.filter(p => parseFloat(p.overall_confidence) < 0.4).length;
        const confidenceDistribution = [
          { band: 'High',   count: highConf },
          { band: 'Medium', count: medConf  },
          { band: 'Low',    count: lowConf  },
        ];

        const validated   = (facets.statuses ?? []).find((s: any) => s.value === 'validated')?.count ?? 0;
        const needsReview = (facets.statuses ?? []).find((s: any) => s.value === 'needs_review')?.count ?? 0;

        setMatrix({
          totalProducts:           counts.total ?? allProducts.length,
          validated,
          needsReview,
          byCategory:              facets.categories  ?? [],
          byCountry:               facets.countries   ?? [],
          byPriceTier,
          byGrape:                 facets.appellations?.slice(0, 30) ?? [],
          byClassification:        facets.wineClasses ?? [],
          categoryCountry:         sortedCats,
          confidenceDistribution,
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!matrix) return <div className="p-8 text-slate-500">Failed to load matrix.</div>;

  const catMax     = matrix.byCategory[0]?.count ?? 1;
  const countryMax = matrix.byCountry[0]?.count ?? 1;
  const tierMax    = Math.max(...matrix.byPriceTier.map(t => t.count), 1);
  const validPct   = matrix.totalProducts > 0 ? Math.round((matrix.validated / matrix.totalProducts) * 100) : 0;

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Grid3x3 size={18} className="text-violet-400" />
          Product Matrix
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">Portfolio intelligence — full view of {matrix.totalProducts.toLocaleString()} products across all dimensions</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BarChart2}  label="Total Products"   value={matrix.totalProducts}  sub="All categories & statuses" color="#8b5cf6" />
        <StatCard icon={Star}       label="Validated"        value={matrix.validated}       sub={`${validPct}% of catalog`}  color="#10b981" />
        <StatCard icon={TrendingUp} label="Needs Review"     value={matrix.needsReview}     sub="Taxonomy flags pending"     color="#f59e0b" />
        <StatCard icon={Globe}      label="Countries"        value={matrix.byCountry.length} sub="Origin countries in catalog" color="#60a5fa" />
      </div>

      {/* Data quality ring + Category breakdown side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Confidence donut */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
          <div className="flex items-center gap-2 mb-5">
            <Tag size={13} className="text-violet-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Data Quality Distribution</h3>
          </div>
          <ConfidenceDonut bands={matrix.confidenceDistribution} />
          <p className="text-xs text-slate-600 mt-4">High ≥ 75% · Medium 40–74% · Low &lt; 40%</p>
        </div>

        {/* Classification tiers */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
          <div className="flex items-center gap-2 mb-5">
            <Layers size={13} className="text-violet-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Classification Tiers</h3>
          </div>
          {matrix.byClassification.length > 0 ? (
            <div className="space-y-2">
              {matrix.byClassification.slice(0, 12).map(f => (
                <HBar key={f.value} label={f.value} count={f.count} max={matrix.byClassification[0].count} color="#f59e0b" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600 italic">No classification data yet — run the enrichment pipeline to populate.</p>
          )}
        </div>
      </div>

      {/* Category bars */}
      <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
        <div className="flex items-center gap-2 mb-5">
          <Tag size={13} className="text-violet-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Product Categories</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2">
          {matrix.byCategory.map(f => (
            <HBar key={f.value} label={f.value} count={f.count} max={catMax} color={categoryColor(f.value)} />
          ))}
        </div>
      </div>

      {/* Country + Price tier side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Country */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
          <div className="flex items-center gap-2 mb-5">
            <Globe size={13} className="text-violet-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">By Country of Origin</h3>
          </div>
          <div className="space-y-2">
            {matrix.byCountry.slice(0, 20).map(f => (
              <HBar key={f.value} label={f.value} count={f.count} max={countryMax} color="#60a5fa" />
            ))}
          </div>
        </div>

        {/* Price tiers */}
        <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
          <div className="flex items-center gap-2 mb-5">
            <BarChart2 size={13} className="text-violet-400" />
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Price Tier Distribution (THB)</h3>
          </div>
          <div className="space-y-2">
            {matrix.byPriceTier.map(t => (
              <HBar key={t.tier} label={`${t.tier}  ${t.label}`} count={t.count} max={tierMax} color="#34d399" />
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-4">
            {matrix.byPriceTier.filter(t => t.count === 0).length > 0
              ? `${matrix.byPriceTier.filter(t => t.count === 0).length} tier(s) empty — price data may be missing on some products.`
              : 'All price tiers have products.'}
          </p>
        </div>
      </div>

      {/* Category × Country cross matrix */}
      <div className="bg-white/5 rounded-2xl p-6 border border-white/8">
        <div className="flex items-center gap-2 mb-2">
          <Grid3x3 size={13} className="text-violet-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Category × Country Portfolio Matrix</h3>
        </div>
        <p className="text-xs text-slate-600 mb-5">How many products sit at each intersection. Darker = more products.</p>
        <CrossMatrix data={matrix.categoryCountry} />
      </div>

      {/* Integration card */}
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-violet-300 mb-3">Connect to Another Project</h3>
        <p className="text-xs text-slate-400 mb-4">
          This PIM is the source of truth for product intelligence. Other projects (sales, ecommerce, BI) can pull clean data by SKU:
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="bg-slate-900/60 rounded-lg px-4 py-3 text-emerald-300">
            <span className="text-slate-500">GET </span>
            /api/products/lookup?sku=WRW0066AC,WWW0047AC
          </div>
          <div className="bg-slate-900/60 rounded-lg px-4 py-3 text-emerald-300">
            <span className="text-slate-500">GET </span>
            /api/products/export?format=csv
            <span className="text-slate-500 ml-2">— full catalog CSV</span>
          </div>
          <div className="bg-slate-900/60 rounded-lg px-4 py-3 text-emerald-300">
            <span className="text-slate-500">POST</span>
            /api/products/lookup
            <span className="text-slate-500 ml-2 font-sans">body: </span>
            {'{ "skus": ["SKU1","SKU2"] }'}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-4">
          The link key is <code className="text-violet-300">sku</code> — every external project joins back to this PIM via SKU.
        </p>
      </div>
    </div>
  );
}
