'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Check, CheckCircle, ChevronLeft,
  ChevronRight, Database, Edit2, Info, LayoutDashboard,
  Package, Plus, RefreshCw, Search, Settings, Tag, Upload,
  X, XCircle
} from 'lucide-react';
import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import { runBatchProcessing, type ProcessedImportRow } from '@/lib/batch-pipeline';
import {
  products as initialProducts, rawImportRows, samplePairing,
  type ProductRecord, type RawImportRow
} from '@/lib/data';
import { validateRenderedProduct } from '@/lib/render-validation';
import {
  knownGrapeAliases, knownRegionAliases,
  knownStyleAliases, taxonomyAuditIssues, taxonomyCountries
} from '@/lib/taxonomy';
import { getSupabaseReadiness, supabaseProject } from '@/lib/supabase/config';
import { mapMagentoCsvToImportRows } from '@/lib/taxonomy-mappings';
import { BatchProcessor } from '@/components/batch-processor-ui';

// ─── Types ────────────────────────────────────────────────────────────────────
type Section = 'overview' | 'products' | 'import' | 'taxonomy' | 'data_hub' | 'settings';
type RowDecision = 'pending' | 'approved' | 'rejected';

// Computed once at module load (not inside render cycle)
const initialBatchResult = runBatchProcessing(rawImportRows);
const supabaseStatus = getSupabaseReadiness();

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'overview' as Section, label: 'Overview', Icon: LayoutDashboard },
  { id: 'data_hub' as Section, label: 'Data Hub', Icon: Database },
  { id: 'products' as Section, label: 'Products', Icon: Package },
  { id: 'import' as Section, label: 'Import queue', Icon: Upload },
  { id: 'taxonomy' as Section, label: 'Taxonomy', Icon: Tag },
  { id: 'settings' as Section, label: 'Settings', Icon: Settings },
];

function Sidebar({ active, onNavigate }: { active: Section; onNavigate: (s: Section) => void }) {
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-slate-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="text-xl">🍷</span>
        <span className="text-sm font-semibold text-white">WineNow PIM</span>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2 pt-3">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              active === id
                ? 'bg-violet-500/20 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="border-t border-white/10 p-4 space-y-1">
        <p className="text-xs text-slate-500">Import queue: {rawImportRows.length} rows</p>
        <p className="text-xs text-slate-500">Products: {initialProducts.length} SKUs</p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${supabaseStatus.hasUrl ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-xs text-slate-500">Supabase {supabaseStatus.hasUrl ? 'ready' : 'not configured'}</span>
        </div>
      </div>
    </nav>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function Pill({ tone, children }: { tone: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const s = {
    neutral: 'bg-white/10 text-slate-300',
    good: 'bg-emerald-500/20 text-emerald-200',
    warn: 'bg-amber-500/20 text-amber-200',
    bad: 'bg-rose-500/20 text-rose-200',
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s[tone]}`}>{children}</span>;
}

function FieldRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-sm text-white text-right truncate max-w-[200px]">{value}</span>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none"
      />
    </label>
  );
}

function EditSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );
}

function RadarChart({ values }: { values: Array<{ label: string; value: number }> }) {
  const cx = 100; const cy = 100; const r = 72;
  const pts = values.map((item, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / values.length;
    const sr = r * (item.value / 5);
    return {
      ...item,
      x: cx + Math.cos(angle) * sr,
      y: cy + Math.sin(angle) * sr,
      lx: cx + Math.cos(angle) * (r + 22),
      ly: cy + Math.sin(angle) * (r + 22),
    };
  });
  const polygon = pts.map(p => `${p.x},${p.y}`).join(' ');
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      {[0.25, 0.5, 0.75, 1].map(level => {
        const lp = values.map((_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / values.length;
          return `${cx + Math.cos(a) * r * level},${cy + Math.sin(a) * r * level}`;
        }).join(' ');
        return <polygon key={level} points={lp} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />;
      })}
      {pts.map(p => (
        <line key={p.label} x1={cx} y1={cy} x2={p.lx - (p.lx - cx) * 0.2} y2={p.ly - (p.ly - cy) * 0.2} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      <polygon points={polygon} fill="rgba(124,58,237,0.22)" stroke="#A78BFA" strokeWidth="1.5" />
      {pts.map(p => (
        <g key={`${p.label}-m`}>
          <circle cx={p.x} cy={p.y} r="2.5" fill="#C4B5FD" />
          <text x={p.lx} y={p.ly + 3} fill="#94A3B8" fontSize="9" textAnchor="middle">{p.label}</text>
          <text x={p.lx} y={p.ly + 12} fill="#C4B5FD" fontSize="8" textAnchor="middle">{p.value.toFixed(1)}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function OverviewSection({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const blocked = initialBatchResult.summary.blocked;
  const autoCorrected = initialBatchResult.summary.autoCorrected;
  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { Icon: Package, label: 'Products', value: initialProducts.length, sub: 'In curated catalog', color: 'violet' },
          { Icon: Upload, label: 'Import queue', value: rawImportRows.length, sub: 'From Magento feed', color: 'cyan' },
          { Icon: AlertTriangle, label: 'Blocked rows', value: blocked, sub: 'Require attention', color: 'amber' },
          { Icon: RefreshCw, label: 'Auto-corrected', value: autoCorrected, sub: 'Self-healed by pipeline', color: 'emerald' },
        ].map(({ Icon, label, value, sub, color }) => {
          const colors: Record<string, string> = {
            violet: 'bg-violet-500/10 text-violet-300',
            cyan: 'bg-cyan-500/10 text-cyan-300',
            emerald: 'bg-emerald-500/10 text-emerald-300',
            amber: 'bg-amber-500/10 text-amber-300',
          };
          return (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className={`inline-flex rounded-xl p-2 ${colors[color]}`}><Icon size={16} /></div>
              <p className="mt-3 text-2xl font-semibold text-white">{value.toLocaleString()}</p>
              <p className="mt-0.5 text-sm font-medium text-white">{label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-white">Import queue</p>
          <p className="mt-1 text-xs text-slate-400">{rawImportRows.length} rows from Magento waiting for normalization, review, and approval.</p>
          <div className="mt-4 flex gap-3 text-xs">
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200">{initialBatchResult.summary.readyToImport} ready</span>
            <span className="rounded-full bg-rose-500/15 px-3 py-1 text-rose-200">{blocked} blocked</span>
          </div>
          <button onClick={() => onNavigate('import')} className="mt-4 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/25">
            Open Import studio →
          </button>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-white">Product catalog</p>
          <p className="mt-1 text-xs text-slate-400">{initialProducts.length} curated products with flavor profiles, render validation, and edit controls.</p>
          <div className="mt-4 flex gap-3 text-xs">
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200">{initialProducts.filter(p => p.status === 'Ready').length} ready</span>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">{initialProducts.filter(p => p.status === 'Needs review').length} need review</span>
          </div>
          <button onClick={() => onNavigate('products')} className="mt-4 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/25">
            Open Products →
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="mb-4 text-sm font-semibold text-white">System status</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Supabase URL', ok: supabaseStatus.hasUrl },
            { label: 'Publishable key', ok: supabaseStatus.hasPublishableKey },
            { label: 'DB password', ok: supabaseStatus.hasDatabasePassword },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-2">
              {ok ? <CheckCircle size={13} className="text-emerald-400 shrink-0" /> : <XCircle size={13} className="text-amber-400 shrink-0" />}
              <span className="text-sm text-slate-300">{label}</span>
              <span className={`ml-auto text-xs ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{ok ? 'Ready' : 'Missing'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="mb-4 text-sm font-semibold text-white">Taxonomy audit</p>
        <div className="space-y-3">
          {taxonomyAuditIssues.map(issue => (
            <div key={issue.area} className="flex gap-3">
              <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${issue.severity === 'warning' ? 'text-amber-400' : 'text-slate-500'}`} />
              <div>
                <p className="text-sm text-white">{issue.area}</p>
                <p className="mt-0.5 text-xs text-slate-400">{issue.message}</p>
                <p className="mt-0.5 text-xs text-violet-300">{issue.recommendation}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Products (PIM) ───────────────────────────────────────────────────────────
function ProductsSection({ products: localProducts, setProducts: setLocalProducts }: {
  products: ProductRecord[];
  setProducts: React.Dispatch<React.SetStateAction<ProductRecord[]>>;
}) {
  const [selectedSku, setSelectedSku] = useState(localProducts[0]?.sku ?? '');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<ProductRecord>({ ...(localProducts[0] ?? initialProducts[0]) });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const filtered = useMemo(() => localProducts.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.grape.toLowerCase().includes(q) || p.region.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchSearch && matchStatus;
  }), [localProducts, search, statusFilter]);

  const selected = localProducts.find(p => p.sku === selectedSku) ?? localProducts[0];
  const liveProduct = editMode ? editValues : selected;
  const profile = useMemo(() => buildFlavorProfile(liveProduct), [liveProduct]);
  const renderChecks = useMemo(() => validateRenderedProduct(selected, profile), [selected, profile]);

  const radarData = [
    { label: 'Body', value: profile.body },
    { label: 'Acidity', value: profile.acidity },
    { label: 'Tannin', value: profile.tannin },
    { label: 'Sweetness', value: profile.sweetness },
    { label: 'Intensity', value: profile.intensity },
    { label: 'Finish', value: profile.finish },
  ];

  function startEdit() { setEditValues({ ...selected }); setEditMode(true); }
  function cancelEdit() { setEditMode(false); }
  function saveEdit() {
    setLocalProducts(prev => prev.map(p => p.sku === editValues.sku ? { ...editValues } : p));
    setEditMode(false);
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(null), 2500);
  }
  function edit<K extends keyof ProductRecord>(field: K, value: ProductRecord[K]) {
    setEditValues(prev => ({ ...prev, [field]: value }));
  }

  return (
    <div className="flex h-full">
      {/* ── Product list ── */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-white/10">
        <div className="space-y-2 border-b border-white/10 p-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-white"
          >
            <option value="all">All statuses</option>
            <option value="Ready">Ready</option>
            <option value="Needs review">Needs review</option>
            <option value="Draft">Draft</option>
          </select>
        </div>
        <div className="px-3 py-2 text-xs text-slate-500 border-b border-white/5">{filtered.length} products</div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(product => {
            const isSelected = product.sku === selectedSku;
            return (
              <button
                key={product.sku}
                type="button"
                onClick={() => { setSelectedSku(product.sku); setEditMode(false); }}
                className={`w-full border-b border-white/5 px-4 py-3 text-left transition-colors ${isSelected ? 'bg-violet-500/10' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{product.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400 truncate">{product.sku} · {product.type}</p>
                  </div>
                  <Pill tone={product.status === 'Ready' ? 'good' : product.status === 'Needs review' ? 'warn' : 'neutral'}>
                    {product.status === 'Ready' ? '✓' : product.status === 'Needs review' ? '!' : '–'}
                  </Pill>
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
                  <span className="truncate">{product.grape}</span>
                  <span>·</span>
                  <span className="truncate">{product.region}</span>
                  <span className="ml-auto shrink-0">{calculateConfidence(product).toFixed(1)}/5</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-white/10 p-3">
          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-2 text-xs text-slate-400 hover:border-violet-400/40 hover:text-violet-300 transition-colors">
            <Plus size={13} /> Add product
          </button>
        </div>
      </div>

      {/* ── Detail / Edit panel ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-violet-300">{selected.category} · {selected.type}</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">{editMode ? editValues.name : selected.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{selected.sku}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {savedMsg && <span className="text-sm text-emerald-400">{savedMsg}</span>}
            {editMode ? (
              <>
                <button onClick={saveEdit} className="flex items-center gap-1.5 rounded-full bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400">
                  <Check size={13} /> Save changes
                </button>
                <button onClick={cancelEdit} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:text-white">
                  Discard
                </button>
              </>
            ) : (
              <button onClick={startEdit} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:text-white">
                <Edit2 size={13} /> Edit
              </button>
            )}
          </div>
        </div>

        {editMode ? (
          /* ── EDIT MODE ── */
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Identity</p>
                <EditField label="Product name" value={editValues.name} onChange={v => edit('name', v)} />
                <EditSelect label="Category" value={editValues.category} options={['Wine', 'Spirits']} onChange={v => edit('category', v as ProductRecord['category'])} />
                <EditField label="Type" value={editValues.type} onChange={v => edit('type', v)} placeholder="e.g. Red Wine, Agave Spirit" />
                <EditSelect label="Status" value={editValues.status} options={['Ready', 'Needs review', 'Draft']} onChange={v => edit('status', v as ProductRecord['status'])} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Taxonomy</p>
                <EditField label="Grape / ingredient" value={editValues.grape} onChange={v => edit('grape', v)} placeholder="e.g. Cabernet Sauvignon" />
                <EditField label="Region" value={editValues.region} onChange={v => edit('region', v)} placeholder="e.g. Napa Valley" />
                <EditField label="Country" value={editValues.country ?? ''} onChange={v => edit('country', v)} placeholder="e.g. USA" />
                <EditSelect label="Style" value={editValues.style} options={['Structured & Oak-Aged', 'Crisp & Aromatic', 'Elegant & Earthy', 'Barrel Rested']} onChange={v => edit('style', v)} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Pricing</p>
                <div className="grid grid-cols-2 gap-3">
                  <EditField label="Price" type="number" value={String(editValues.price)} onChange={v => edit('price', Number(v))} />
                  <EditField label="Cost price" type="number" value={String(editValues.costPrice)} onChange={v => edit('costPrice', Number(v))} />
                </div>
                <EditSelect label="Currency" value={editValues.currency} options={['USD', 'THB', 'EUR', 'GBP', 'AUD', 'NZD']} onChange={v => edit('currency', v)} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Oak intensity</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="0" max="5" step="0.5"
                    value={editValues.oak}
                    onChange={e => edit('oak', Number(e.target.value))}
                    className="flex-1 accent-violet-400"
                  />
                  <span className="w-10 text-center text-sm font-semibold text-white">{editValues.oak}/5</span>
                </div>
              </div>
            </div>

            {/* Live flavor preview */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-5">
                <p className="text-sm font-semibold text-violet-200">Live flavor preview</p>
                <p className="mt-0.5 text-xs text-slate-400 mb-4">Updates in real-time as you edit grape, region, style, and oak.</p>
                <div className="h-[240px]">
                  <RadarChart values={radarData} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {radarData.map(d => (
                    <div key={d.label} className="rounded-xl bg-white/5 px-2 py-2 text-center">
                      <p className="text-xs text-slate-400">{d.label}</p>
                      <p className="text-sm font-semibold text-white">{d.value.toFixed(1)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white mb-3">Confidence score</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400"
                      style={{ width: `${(calculateConfidence(editValues) / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-white shrink-0">{calculateConfidence(editValues).toFixed(1)}/5</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">Higher confidence when grape, style, and region match DNA tables.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white mb-3">Full profile values</p>
                <div className="space-y-2">
                  {[
                    { label: 'Fruit', value: profile.fruit },
                    { label: 'Spice', value: profile.spice },
                    { label: 'Earth', value: profile.earth },
                    { label: 'Floral', value: profile.floral },
                    { label: 'Mineral', value: profile.mineral },
                    { label: 'Herbal', value: profile.herbal },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{item.label}</span>
                        <span className="text-slate-300">{item.value.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-500 to-cyan-400" style={{ width: `${(item.value / 5) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── VIEW MODE ── */
          <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Product details</p>
                <FieldRow label="Category" value={selected.category} />
                <FieldRow label="Type" value={selected.type} />
                <FieldRow label="Grape" value={selected.grape} />
                <FieldRow label="Region" value={selected.region} />
                <FieldRow label="Country" value={selected.country ?? '—'} />
                <FieldRow label="Style" value={selected.style} />
                <FieldRow label="Oak" value={`${selected.oak} / 5`} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Pricing</p>
                <FieldRow label="Price" value={`${selected.currency} ${selected.price}`} />
                <FieldRow label="Cost" value={`${selected.currency} ${selected.costPrice}`} />
                <FieldRow label="Margin" value={`${(((selected.price - selected.costPrice) / selected.price) * 100).toFixed(0)}%`} />
                <FieldRow label="Status" value={selected.status} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Render safety</p>
                {renderChecks.map(check => (
                  <div key={check.label} className="flex items-start gap-2 py-2 border-b border-white/5 last:border-0">
                    {check.status === 'pass'
                      ? <CheckCircle size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                      : <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />}
                    <div>
                      <p className="text-xs font-medium text-white">{check.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-white">Flavor radar</p>
                  <span className="text-xs text-slate-400">Confidence {calculateConfidence(selected).toFixed(1)}/5</span>
                </div>
                <div className="h-[230px]">
                  <RadarChart values={radarData} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white mb-3">Flavor distribution</p>
                {[
                  { label: 'Fruit', value: profile.fruit },
                  { label: 'Spice', value: profile.spice },
                  { label: 'Earth', value: profile.earth },
                  { label: 'Oak', value: profile.oak },
                  { label: 'Floral', value: profile.floral },
                  { label: 'Mineral', value: profile.mineral },
                ].map(item => (
                  <div key={item.label} className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">{item.label}</span>
                      <span className="text-slate-300">{item.value.toFixed(1)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-500 to-cyan-400" style={{ width: `${(item.value / 5) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white mb-3">Pairing suggestions</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[...samplePairing.protein, ...samplePairing.cuisine].map(item => (
                    <span key={item} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-200">{item}</span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 leading-5">{samplePairing.logic}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Import queue ─────────────────────────────────────────────────────────────
function ImportSection({ onCommit, onGoToProducts }: {
  onCommit: (rows: ProductRecord[]) => void;
  onGoToProducts: () => void;
}) {
  // Fetch real Magento rows from the server-side API route
  const [importRows, setImportRows] = useState<RawImportRow[]>(rawImportRows);
  const [importLoading, setImportLoading] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/import-rows?limit=200')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { rows: RawImportRow[] }) => { if (data.rows?.length) { setImportRows(data.rows); setSourceName('Magento feed'); } })
      .catch(() => {})
      .finally(() => setImportLoading(false));
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const dataset = mapMagentoCsvToImportRows(text, file.name);
      if (dataset.mappedRowCount === 0) throw new Error('No rows could be mapped. Check your file has a header row with columns like sku, name, price.');
      setImportRows(dataset.rows);
      setSourceName(file.name);
      setUploadError(null);
      setDecisions({});
      setRowEdits({});
      setRowOverrides({});
      setCommitted(false);
      setSelectedIdx(0);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not parse file.');
    }
  }

  // Recompute batch result whenever importRows changes
  const batchResult = useMemo(() => runBatchProcessing(importRows), [importRows]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [rowEdits, setRowEdits] = useState<Record<number, RawImportRow>>({});
  const [rowOverrides, setRowOverrides] = useState<Record<number, ProcessedImportRow>>({});
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [committed, setCommitted] = useState(false);
  const [batchNote, setBatchNote] = useState('');
  const PAGE_SIZE = 40;

  function getResult(i: number): ProcessedImportRow {
    return rowOverrides[i] ?? batchResult.rows[i];
  }
  function getRow(i: number): RawImportRow {
    return rowEdits[i] ?? importRows[i];
  }

  function reprocess(i: number) {
    const row = getRow(i);
    const result = runBatchProcessing([row]).rows[0];
    setRowOverrides(prev => ({ ...prev, [i]: result }));
    setEditingIdx(null);
  }

  function updateEdit(i: number, field: keyof RawImportRow, value: string) {
    setRowEdits(prev => ({ ...prev, [i]: { ...(prev[i] ?? importRows[i]), [field]: value } }));
  }

  function toggleDecision(i: number, decision: RowDecision) {
    setDecisions(prev => ({ ...prev, [i]: prev[i] === decision ? 'pending' : decision }));
  }

  const filteredIndices = useMemo(() => {
    return importRows.map((_, i) => i).filter(i => {
      const result = getResult(i);
      const row = getRow(i);
      const hasError = result.issues.some(iss => iss.severity === 'error');
      const dec = decisions[i] ?? 'pending';
      if (statusFilter === 'ready' && hasError) return false;
      if (statusFilter === 'blocked' && !hasError) return false;
      if (decisionFilter !== 'all' && dec !== decisionFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !row.sku.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRows, search, statusFilter, decisionFilter, decisions, rowOverrides]);

  const pageCount = Math.max(1, Math.ceil(filteredIndices.length / PAGE_SIZE));
  const pagedIndices = filteredIndices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const approvedCount = Object.values(decisions).filter(d => d === 'approved').length;
  const rejectedCount = Object.values(decisions).filter(d => d === 'rejected').length;

  const selectedResult = getResult(selectedIdx);
  const editRow = getRow(selectedIdx);
  const selectedHasError = selectedResult.issues.some(i => i.severity === 'error');
  const selectedDecision = decisions[selectedIdx] ?? 'pending';

  return (
    <div className="flex h-full">
      {/* ── Queue list ── */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-white/10">
        {/* Upload zone */}
        <label className="group m-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-dashed border-white/20 bg-white/3 px-4 py-4 text-center transition-colors hover:border-violet-400/50 hover:bg-violet-500/5">
          <Upload size={16} className="text-slate-400 group-hover:text-violet-300" />
          <span className="text-xs font-medium text-slate-300 group-hover:text-violet-200">
            {sourceName ? `${sourceName}` : 'Upload CSV or drop here'}
          </span>
          <span className="text-[11px] text-slate-500">{importRows.length} rows loaded</span>
          <input type="file" accept=".csv,.txt" className="sr-only" onChange={handleFileUpload} />
        </label>
        {uploadError && (
          <p className="mx-3 -mt-2 mb-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{uploadError}</p>
        )}
        <div className="space-y-2 border-b border-white/10 p-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search SKU or name…"
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
              className="flex-1 rounded-xl border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white">
              <option value="all">All rows</option>
              <option value="ready">Ready</option>
              <option value="blocked">Blocked</option>
            </select>
            <select value={decisionFilter} onChange={e => { setDecisionFilter(e.target.value); setPage(0); }}
              className="flex-1 rounded-xl border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-white">
              <option value="all">All decisions</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2 text-xs">
          <span className="text-emerald-400">{approvedCount} approved</span>
          <span className="text-rose-400">{rejectedCount} rejected</span>
          <span className="ml-auto text-slate-500">
            {importLoading ? 'Loading…' : `${filteredIndices.length} shown`}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {pagedIndices.map(i => {
            const result = getResult(i);
            const hasErr = result.issues.some(iss => iss.severity === 'error');
            const dec = decisions[i] ?? 'pending';
            const isSelected = i === selectedIdx;
            return (
              <button
                key={i}
                type="button"
                onClick={() => { setSelectedIdx(i); setEditingIdx(null); }}
                className={`w-full border-b border-white/5 px-4 py-3 text-left transition-colors ${isSelected ? 'bg-violet-500/10' : 'hover:bg-white/5'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{result.normalized.name || importRows[i]?.name || 'Unnamed'}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{result.normalized.sku || '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone={hasErr ? 'bad' : 'good'}>{hasErr ? 'Error' : 'OK'}</Pill>
                    {dec !== 'pending' && <Pill tone={dec === 'approved' ? 'good' : 'bad'}>{dec}</Pill>}
                  </div>
                </div>
                <div className="mt-1.5 flex gap-3 text-xs text-slate-500">
                  <span>{result.corrections.length} fix{result.corrections.length !== 1 ? 'es' : ''}</span>
                  <span>{result.issues.length} issue{result.issues.length !== 1 ? 's' : ''}</span>
                  <span className="ml-auto">{result.confidence.toFixed(1)}/5</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 text-xs text-slate-400">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="disabled:opacity-30 hover:text-white"><ChevronLeft size={14} /></button>
          <span>{page + 1} / {pageCount}</span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} className="disabled:opacity-30 hover:text-white"><ChevronRight size={14} /></button>
        </div>
      </div>

      {/* ── Row detail / edit ── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-violet-300">
              Row {selectedIdx + 1} of {importRows.length}
              {importLoading && <span className="ml-2 text-slate-500">(loading…)</span>}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {selectedResult.normalized.name || importRows[selectedIdx]?.name || 'Unnamed row'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {selectedResult.normalized.sku || 'Missing SKU'} · Confidence {selectedResult.confidence.toFixed(1)}/5
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editingIdx === selectedIdx ? (
              <>
                <button
                  onClick={() => reprocess(selectedIdx)}
                  className="flex items-center gap-1.5 rounded-full bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400"
                >
                  <RefreshCw size={13} /> Re-process
                </button>
                <button
                  onClick={() => setEditingIdx(null)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditingIdx(selectedIdx)}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:text-white"
              >
                <Edit2 size={13} /> Edit row
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Left column */}
          <div className="space-y-4">
            {editingIdx === selectedIdx ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Edit2 size={13} className="text-amber-300" />
                  <p className="text-sm font-medium text-amber-200">Editing raw values — click Re-process when done</p>
                </div>
                {(Object.keys(importRows[0] ?? rawImportRows[0]) as (keyof RawImportRow)[]).map(field => (
                  <label key={field} className="block">
                    <span className="text-xs text-slate-400">{field}</span>
                    <input
                      value={editRow[field]}
                      onChange={e => updateEdit(selectedIdx, field, e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-violet-400/50 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Normalized values</p>
                <FieldRow label="SKU" value={selectedResult.normalized.sku || '—'} />
                <FieldRow label="Name" value={selectedResult.normalized.name || '—'} />
                <FieldRow label="Category" value={selectedResult.normalized.category} />
                <FieldRow label="Type" value={selectedResult.normalized.type} />
                <FieldRow label="Grape" value={selectedResult.normalized.grape} />
                <FieldRow label="Region" value={selectedResult.normalized.region} />
                <FieldRow label="Country" value={selectedResult.normalized.country ?? '—'} />
                <FieldRow label="Style" value={selectedResult.normalized.style} />
                <FieldRow label="Price" value={`${selectedResult.normalized.currency} ${selectedResult.normalized.price}`} />
                <FieldRow label="Status" value={selectedResult.normalized.status} />
              </div>
            )}

            {selectedResult.corrections.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Auto-corrections ({selectedResult.corrections.length})</p>
                <div className="space-y-2">
                  {selectedResult.corrections.map((c, ci) => (
                    <div key={`${c.field}-${ci}`} className="rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                      <span className="font-medium">{c.field}:</span> {c.from || '∅'} → <span className="font-medium">{c.to}</span>
                      <p className="mt-0.5 text-violet-300/70">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Validation issues ({selectedResult.issues.length})</p>
              <div className="space-y-2">
                {selectedResult.issues.map((issue, ii) => (
                  <div key={`${issue.field}-${ii}`} className={`flex gap-2 rounded-xl px-3 py-2 text-xs ${
                    issue.severity === 'error' ? 'bg-rose-500/15 text-rose-200' :
                    issue.severity === 'warning' ? 'bg-amber-500/15 text-amber-200' :
                    'bg-emerald-500/15 text-emerald-200'
                  }`}>
                    {issue.severity === 'error' ? <XCircle size={11} className="mt-0.5 shrink-0" /> :
                     issue.severity === 'warning' ? <AlertTriangle size={11} className="mt-0.5 shrink-0" /> :
                     <Info size={11} className="mt-0.5 shrink-0" />}
                    <span><span className="font-medium">{issue.field}:</span> {issue.message}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Review decision */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Review decision</p>
              {selectedHasError && selectedDecision !== 'approved' && (
                <p className="mb-3 text-xs text-rose-300">Edit the row and re-process to clear errors before approving.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={selectedHasError}
                  onClick={() => toggleDecision(selectedIdx, 'approved')}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                    selectedDecision === 'approved'
                      ? 'border border-emerald-400/30 bg-emerald-500/20 text-emerald-200'
                      : selectedHasError
                        ? 'cursor-not-allowed bg-white/5 text-slate-500'
                        : 'bg-white/5 text-slate-300 hover:bg-emerald-500/10 hover:text-emerald-200'
                  }`}
                >
                  <Check size={13} /> {selectedDecision === 'approved' ? 'Approved ✓' : 'Approve'}
                </button>
                <button
                  onClick={() => toggleDecision(selectedIdx, 'rejected')}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                    selectedDecision === 'rejected'
                      ? 'border border-rose-400/30 bg-rose-500/20 text-rose-200'
                      : 'bg-white/5 text-slate-300 hover:bg-rose-500/10 hover:text-rose-200'
                  }`}
                >
                  <X size={13} /> {selectedDecision === 'rejected' ? 'Rejected' : 'Reject'}
                </button>
              </div>
            </div>

            {/* Commit panel */}
            {!committed && approvedCount > 0 && (
              <div className="rounded-2xl border border-violet-400/20 bg-violet-500/10 p-5">
                <p className="text-sm font-semibold text-violet-200 mb-1">Stage {approvedCount} approved rows</p>
                <p className="text-xs text-slate-400 mb-3">Rejected and pending rows are excluded. Add an optional batch note.</p>
                <textarea
                  value={batchNote}
                  onChange={e => setBatchNote(e.target.value)}
                  placeholder="Batch note (optional)…"
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none resize-none"
                />
                <button
                  onClick={() => {
                    const approvedRows = Object.entries(decisions)
                      .filter(([, d]) => d === 'approved')
                      .map(([idx]) => getResult(Number(idx)).normalized);
                    onCommit(approvedRows);
                    setCommitted(true);
                  }}
                  className="mt-3 w-full rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white hover:bg-violet-400"
                >
                  Commit {approvedCount} rows → Products
                </button>
              </div>
            )}

            {committed && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={15} className="text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-200">{approvedCount} rows staged for import</p>
                </div>
                {batchNote && <p className="text-xs text-emerald-300/80 mb-3">{batchNote}</p>}
                <button
                  onClick={onGoToProducts}
                  className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400"
                >
                  View in Products →
                </button>
                <button
                  onClick={() => { setCommitted(false); setDecisions({}); setBatchNote(''); }}
                  className="mt-2 text-xs text-slate-400 underline hover:text-slate-300"
                >
                  Reset review queue
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Taxonomy editor ───────────────────────────────────────────────────────────
type AliasEntry = { alias: string; canonical: string };

function TaxonomySection() {
  type TaxTab = 'countries' | 'regions' | 'grapes' | 'styles';
  const [tab, setTab] = useState<TaxTab>('countries');
  const [search, setSearch] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Record<string, string>>({});
  const [addMode, setAddMode] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const [localCountries, setLocalCountries] = useState([...taxonomyCountries]);
  const [localRegions, setLocalRegions] = useState<AliasEntry[]>(
    Object.entries(knownRegionAliases).map(([alias, canonical]) => ({ alias, canonical }))
  );
  const [localGrapes, setLocalGrapes] = useState<AliasEntry[]>(
    Object.entries(knownGrapeAliases).map(([alias, canonical]) => ({ alias, canonical }))
  );
  const [localStyles, setLocalStyles] = useState<AliasEntry[]>(
    Object.entries(knownStyleAliases).map(([alias, canonical]) => ({ alias, canonical }))
  );

  const TABS: { id: TaxTab; label: string }[] = [
    { id: 'countries', label: 'Countries' },
    { id: 'regions', label: 'Region aliases' },
    { id: 'grapes', label: 'Grape aliases' },
    { id: 'styles', label: 'Style aliases' },
  ];

  function saveAliasEdit(list: AliasEntry[], setList: (v: AliasEntry[]) => void, key: string) {
    setList(list.map(e => e.alias === key ? { alias: e.alias, canonical: editBuf[key] ?? e.canonical } : e));
    setEditingKey(null);
  }

  function deleteAlias(list: AliasEntry[], setList: (v: AliasEntry[]) => void, alias: string) {
    setList(list.filter(e => e.alias !== alias));
  }

  function addAlias(list: AliasEntry[], setList: (v: AliasEntry[]) => void) {
    if (!newKey.trim() || !newVal.trim()) return;
    setList([...list, { alias: newKey.trim(), canonical: newVal.trim() }]);
    setNewKey(''); setNewVal(''); setAddMode(false);
  }

  function AliasTable({ list, setList }: { list: AliasEntry[]; setList: (v: AliasEntry[]) => void }) {
    const q = search.toLowerCase();
    const filtered = list.filter(e => !q || e.alias.includes(q) || e.canonical.toLowerCase().includes(q));
    return (
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_100px] border-b border-white/10 bg-white/5 px-4 py-2.5 text-xs uppercase tracking-widest text-slate-400">
          <span>Alias (input)</span><span>Canonical (output)</span><span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-white/5">
          {filtered.map(entry => (
            <div key={entry.alias} className="grid grid-cols-[1fr_1fr_100px] items-center px-4 py-3">
              <span className="text-sm text-slate-300 font-mono">{entry.alias}</span>
              {editingKey === entry.alias ? (
                <input
                  value={editBuf[entry.alias] ?? entry.canonical}
                  onChange={e => setEditBuf(prev => ({ ...prev, [entry.alias]: e.target.value }))}
                  className="mr-4 rounded-lg border border-violet-400/40 bg-white/5 px-2 py-1 text-sm text-white focus:outline-none"
                />
              ) : (
                <span className="text-sm text-white">{entry.canonical}</span>
              )}
              <div className="flex items-center justify-end gap-1">
                {editingKey === entry.alias ? (
                  <>
                    <button onClick={() => saveAliasEdit(list, setList, entry.alias)} className="rounded-lg bg-violet-500/20 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/30"><Check size={11} /></button>
                    <button onClick={() => setEditingKey(null)} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white"><X size={11} /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingKey(entry.alias); setEditBuf({ [entry.alias]: entry.canonical }); }} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white"><Edit2 size={11} /></button>
                    <button onClick={() => deleteAlias(list, setList, entry.alias)} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-rose-300"><X size={11} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => { setTab(t.id); setSearch(''); setEditingKey(null); setAddMode(false); }}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${tab === t.id ? 'bg-violet-500/20 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none w-48" />
          </div>
          {tab !== 'countries' && (
            <button onClick={() => setAddMode(true)} className="flex items-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/25">
              <Plus size={13} /> Add entry
            </button>
          )}
        </div>
      </div>

      {/* Add entry form */}
      {addMode && tab !== 'countries' && (
        <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-5">
          <p className="mb-3 text-sm font-medium text-violet-200">New alias entry</p>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <EditField label="Alias (input string)" value={newKey} onChange={setNewKey} placeholder="e.g. cab sauv" />
            <EditField label="Canonical (output value)" value={newVal} onChange={setNewVal} placeholder="e.g. Cabernet Sauvignon" />
            <div className="flex gap-2 pb-0.5">
              <button onClick={() => addAlias(tab === 'regions' ? localRegions : tab === 'grapes' ? localGrapes : localStyles, tab === 'regions' ? setLocalRegions : tab === 'grapes' ? setLocalGrapes : setLocalStyles)}
                className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400">
                Add
              </button>
              <button onClick={() => setAddMode(false)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'countries' && (
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[60px_1fr_80px] border-b border-white/10 bg-white/5 px-4 py-2.5 text-xs uppercase tracking-widest text-slate-400">
            <span>ID</span><span>Country name</span><span>ISO</span>
          </div>
          <div className="divide-y divide-white/5 max-h-[520px] overflow-y-auto">
            {localCountries
              .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.iso.toLowerCase().includes(search.toLowerCase()))
              .map(c => {
                const isEditing = editingKey === String(c.id);
                return (
                  <div key={c.id} className="grid grid-cols-[60px_1fr_80px_80px] items-center px-4 py-3">
                    <span className="text-xs text-slate-500">{c.id}</span>
                    {isEditing ? (
                      <input value={editBuf['name'] ?? c.name} onChange={e => setEditBuf(p => ({ ...p, name: e.target.value }))}
                        className="mr-3 rounded-lg border border-violet-400/40 bg-white/5 px-2 py-1 text-sm text-white focus:outline-none" />
                    ) : (
                      <span className="text-sm text-white">{c.name}</span>
                    )}
                    {isEditing ? (
                      <input value={editBuf['iso'] ?? c.iso} onChange={e => setEditBuf(p => ({ ...p, iso: e.target.value }))}
                        className="mr-3 w-16 rounded-lg border border-violet-400/40 bg-white/5 px-2 py-1 text-sm text-white focus:outline-none" />
                    ) : (
                      <span className="text-xs font-mono text-slate-400">{c.iso}</span>
                    )}
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={() => {
                            setLocalCountries(prev => prev.map(x => x.id === c.id ? { ...x, name: editBuf['name'] ?? x.name, iso: editBuf['iso'] ?? x.iso } : x));
                            setEditingKey(null);
                          }} className="rounded-lg bg-violet-500/20 px-2 py-1 text-xs text-violet-200"><Check size={11} /></button>
                          <button onClick={() => setEditingKey(null)} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400"><X size={11} /></button>
                        </>
                      ) : (
                        <button onClick={() => { setEditingKey(String(c.id)); setEditBuf({ name: c.name, iso: c.iso }); }}
                          className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white"><Edit2 size={11} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      {tab === 'regions' && <AliasTable list={localRegions} setList={setLocalRegions} />}
      {tab === 'grapes' && <AliasTable list={localGrapes} setList={setLocalGrapes} />}
      {tab === 'styles' && <AliasTable list={localStyles} setList={setLocalStyles} />}
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsSection() {
  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white mb-4">Launch commands</p>
            {[
              { step: '1', label: 'Install dependencies', cmd: 'npm install' },
              { step: '2', label: 'Start dev server', cmd: 'npm run dev' },
              { step: '3', label: 'VSCode port forward', cmd: 'npm run dev:vscode' },
              { step: '4', label: 'Type check', cmd: 'npm run typecheck' },
            ].map(({ step, label, cmd }) => (
              <div key={step} className="mb-3">
                <p className="text-xs text-slate-400 mb-1">{step}. {label}</p>
                <code className="block rounded-xl bg-slate-950/60 px-4 py-2 text-sm text-violet-200">{cmd}</code>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white mb-4">Environment setup</p>
            <p className="text-xs text-slate-400 mb-3">Copy <code className="text-violet-300">.env.example</code> to <code className="text-violet-300">.env.local</code> and fill in your database password.</p>
            <div className={`flex items-center gap-2 rounded-xl p-3 ${supabaseStatus.hasDatabasePassword ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
              {supabaseStatus.hasDatabasePassword
                ? <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                : <AlertTriangle size={14} className="text-amber-400 shrink-0" />}
              <span className="text-sm text-slate-300">
                {supabaseStatus.hasDatabasePassword ? 'DB password configured in .env.local' : 'DB password not yet set — using template placeholder'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white mb-4">Supabase project</p>
            <FieldRow label="Project URL" value={supabaseProject.url} />
            <FieldRow label="Publishable key" value={`${supabaseProject.publishableKey.slice(0, 24)}…`} />
            <FieldRow label="DB URL" value="postgresql://postgres:***@…" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white mb-4">Pipeline summary</p>
            <FieldRow label="Total import rows" value={rawImportRows.length} />
            <FieldRow label="Auto-corrected" value={initialBatchResult.summary.autoCorrected} />
            <FieldRow label="Ready to import" value={initialBatchResult.summary.readyToImport} />
            <FieldRow label="Blocked" value={initialBatchResult.summary.blocked} />
          </div>

          <div className="rounded-2xl border border-dashed border-violet-400/30 bg-violet-500/5 p-5 text-violet-200 text-sm">
            The app runs entirely on local sample + Magento data without a live database. Connect Supabase to enable real reads, persisted taxonomy edits, and import audit logs.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export function Dashboard() {
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [catalogProducts, setCatalogProducts] = useState<ProductRecord[]>([...initialProducts]);

  function handleCommit(rows: ProductRecord[]) {
    setCatalogProducts(prev => {
      const skus = new Set(prev.map(p => p.sku));
      const incoming = rows.filter(r => r.sku && !skus.has(r.sku));
      return [...prev, ...incoming];
    });
    setActiveSection('products');
  }

  const sectionTitles: Record<Section, string> = {
    overview: 'Overview',
    data_hub: 'Data Hub - Batch Processor',
    products: 'Product catalog',
    import: 'Import queue',
    taxonomy: 'Taxonomy editor',
    settings: 'Settings',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <Sidebar active={activeSection} onNavigate={setActiveSection} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/50 px-6 backdrop-blur">
          <h1 className="text-sm font-semibold text-white">{sectionTitles[activeSection]}</h1>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-3.5 w-px bg-white/10" />
            <span>{catalogProducts.length} products</span>
            <span className="h-3.5 w-px bg-white/10" />
            <span className={`flex items-center gap-1 ${supabaseStatus.hasUrl ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${supabaseStatus.hasUrl ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              Supabase {supabaseStatus.hasUrl ? 'connected' : 'not configured'}
            </span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {activeSection === 'overview' && <OverviewSection onNavigate={setActiveSection} />}
          {activeSection === 'data_hub' && <BatchProcessor />}
          {activeSection === 'products' && <ProductsSection products={catalogProducts} setProducts={setCatalogProducts} />}
          {activeSection === 'import' && <ImportSection onCommit={handleCommit} onGoToProducts={() => setActiveSection('products')} />}
          {activeSection === 'taxonomy' && <TaxonomySection />}
          {activeSection === 'settings' && <SettingsSection />}
        </main>
      </div>
    </div>
  );
}
