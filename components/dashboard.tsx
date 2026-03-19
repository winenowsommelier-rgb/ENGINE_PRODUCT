'use client';

<<<<<<< HEAD
import type { ChangeEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { buildFlavorProfile, calculateConfidence, describeConfidence } from '@/lib/auto-mapping';
import { runBatchProcessing, summarizeIssues } from '@/lib/batch-pipeline';
import {
  excelImportSteps,
  flavorWheel,
  productLibraryStats,
  products,
  rawImportRows,
  samplePairing,
  taxonomyMetrics
} from '@/lib/data';
import { validateRenderedProduct } from '@/lib/render-validation';
import { taxonomyAuditIssues, taxonomyCountries, taxonomySheets } from '@/lib/taxonomy';
import { getSupabaseReadiness, supabaseProject } from '@/lib/supabase/config';
import { mapMagentoCsvToImportRows, uploadFieldGuide, type UploadedImportDataset } from '@/lib/taxonomy-mappings';

const workspaces = [
  { id: 'overview', label: 'Overview' },
  { id: 'catalog', label: 'Catalog workspace' },
  { id: 'import', label: 'Import studio' },
  { id: 'taxonomy', label: 'Taxonomy control' },
  { id: 'launch', label: 'Launch frontend' }
] as const;

type WorkspaceId = (typeof workspaces)[number]['id'];

const batchResult = runBatchProcessing(rawImportRows);
const supabaseReadiness = getSupabaseReadiness();
const onboardingSteps = [
  'Copy .env.example to .env.local.',
  'Run npm install once to install Next.js and Tailwind dependencies.',
  'Start the app with npm run dev and open localhost:3000.',
  'Review the catalog, import studio, taxonomy control, and launch guide workspaces.'
];
const workspaceHighlights = [
  {
    title: 'Overview',
    detail: 'Start here for environment readiness, launch instructions, and operational guidance.'
  },
  {
    title: 'Catalog workspace',
    detail: 'Inspect product flavor structure, pricing, readiness, and confidence signals.'
  },
  {
    title: 'Import studio',
    detail: 'Review self-healing corrections, row blocking issues, and import recommendations.'
  },
  {
    title: 'Taxonomy control',
    detail: 'Audit workbook structure, country registry coverage, and cleanup rules.'
  }
] as const;
const taxonomyRules = [
  'Keep tab names machine-safe or register display labels separately from canonical keys.',
  'Store geography level explicitly so countries and sub-national records validate predictably.',
  'Do not promote rows to Ready until SKU, price, country inference, and confidence all pass review.'
=======
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Check, CheckCircle, ChevronLeft,
  ChevronRight, Edit2, Info, LayoutDashboard,
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

// ─── Types ────────────────────────────────────────────────────────────────────
type Section = 'overview' | 'products' | 'import' | 'taxonomy' | 'settings';
type RowDecision = 'pending' | 'approved' | 'rejected';

// Computed once at module load (not inside render cycle)
const initialBatchResult = runBatchProcessing(rawImportRows);
const supabaseStatus = getSupabaseReadiness();

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'overview' as Section, label: 'Overview', Icon: LayoutDashboard },
  { id: 'products' as Section, label: 'Products', Icon: Package },
  { id: 'import' as Section, label: 'Import queue', Icon: Upload },
  { id: 'taxonomy' as Section, label: 'Taxonomy', Icon: Tag },
  { id: 'settings' as Section, label: 'Settings', Icon: Settings },
>>>>>>> f2a3efe (Optimize for Vercel: server-side Magento data, PIM redesign, merge conflict fixes)
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

<<<<<<< HEAD
function StatusPill({ tone, children }: { tone: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const styles = {
    neutral: 'border-white/10 bg-white/5 text-slate-200',
    good: 'border-emerald-400/20 bg-emerald-500/15 text-emerald-100',
    warn: 'border-amber-400/20 bg-amber-500/15 text-amber-100',
    bad: 'border-rose-400/20 bg-rose-500/15 text-rose-100'
  };

  return <span className={`rounded-full border px-3 py-1 text-xs ${styles[tone]}`}>{children}</span>;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-3">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function DetailList({ items }: { items: string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-100">{index + 1}</div>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}

function SimpleRadar({ values }: { values: Array<{ label: string; value: number }> }) {
  const center = 110;
  const radius = 82;
  const levels = [0.2, 0.4, 0.6, 0.8, 1];
  const points = values.map((item, index) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / values.length;
    const scaledRadius = radius * (item.value / 5);
    return {
      ...item,
      x: center + Math.cos(angle) * scaledRadius,
      y: center + Math.sin(angle) * scaledRadius,
      labelX: center + Math.cos(angle) * (radius + 24),
      labelY: center + Math.sin(angle) * (radius + 24)
    };
  });

  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <svg viewBox="0 0 220 220" className="h-full w-full">
      {levels.map((level) => {
        const levelPoints = values
          .map((_, index) => {
            const angle = (-Math.PI / 2) + (index * Math.PI * 2) / values.length;
            const scaledRadius = radius * level;
            return `${center + Math.cos(angle) * scaledRadius},${center + Math.sin(angle) * scaledRadius}`;
          })
          .join(' ');

        return <polygon key={level} points={levelPoints} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />;
      })}
      {points.map((point) => (
        <line key={point.label} x1={center} y1={center} x2={point.labelX - (point.labelX - center) * 0.18} y2={point.labelY - (point.labelY - center) * 0.18} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      ))}
      <polygon points={polygon} fill="rgba(124,58,237,0.32)" stroke="#A78BFA" strokeWidth="2" />
      {points.map((point) => (
        <g key={`${point.label}-marker`}>
          <circle cx={point.x} cy={point.y} r="3.5" fill="#E9D5FF" />
          <text x={point.labelX} y={point.labelY} fill="#CBD5E1" fontSize="11" textAnchor="middle">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Dashboard() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('overview');
  const [selectedSku, setSelectedSku] = useState(products[0].sku);
  const [selectedImportIndex, setSelectedImportIndex] = useState(0);
  const [uploadedDataset, setUploadedDataset] = useState<UploadedImportDataset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((product) => product.sku === selectedSku) ?? products[0],
    [selectedSku]
  );
  const selectedProfile = useMemo(() => buildFlavorProfile(selectedProduct), [selectedProduct]);
  const confidenceSignals = useMemo(() => describeConfidence(selectedProduct), [selectedProduct]);
  const renderChecks = useMemo(() => validateRenderedProduct(selectedProduct, selectedProfile), [selectedProduct, selectedProfile]);
  const activeBatchResult = useMemo(
    () => (uploadedDataset ? runBatchProcessing(uploadedDataset.rows) : batchResult),
    [uploadedDataset]
  );
  const selectedImportRow = activeBatchResult.rows[selectedImportIndex] ?? activeBatchResult.rows[0];
  const selectedIssueSummary = useMemo(() => summarizeIssues(selectedImportRow), [selectedImportRow]);
  const stagedLibraryRows = useMemo(
    () => activeBatchResult.rows.filter((row) => !row.issues.some((issue) => issue.severity === 'error')).map((row) => row.normalized),
    [activeBatchResult]
  );
  const radarData = [
    { label: 'Body', value: selectedProfile.body },
    { label: 'Acidity', value: selectedProfile.acidity },
    { label: 'Tannin', value: selectedProfile.tannin },
    { label: 'Sweetness', value: selectedProfile.sweetness },
    { label: 'Intensity', value: selectedProfile.intensity },
    { label: 'Finish', value: selectedProfile.finish }
  ];

  async function handleMagentoFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const dataset = mapMagentoCsvToImportRows(text, file.name);

      if (dataset.originalRowCount === 0 || dataset.mappedRowCount === 0) {
        throw new Error('No Magento rows could be mapped. Please confirm the file has a header row with columns like sku, name, and price.');
      }

      setUploadedDataset(dataset);
      setUploadError(null);
      setSelectedImportIndex(0);
      setActiveWorkspace('import');
    } catch (error) {
      setUploadedDataset(null);
      setUploadError(error instanceof Error ? error.message : 'Unable to read the uploaded file.');
    } finally {
      event.target.value = '';
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8 lg:px-8">
      <section className="panel overflow-hidden p-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-100">
              <span aria-hidden="true">🍷</span>
              WineNow Flavor Intelligence System
            </div>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                Frontend workspace for catalog review, self-healing imports, and flavor intelligence.
              </h1>
              <p className="max-w-3xl text-lg text-slate-300">
                This build focuses on a frontend you can run directly, inspect quickly, and use as the access point for product catalog, taxonomy health, import validation, and Supabase readiness.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-200">
              {['Frontend ready', 'Catalog explorer', 'Import review queue', 'Taxonomy audit', 'Supabase-aware launch guide'].map((pill) => (
                <span key={pill} className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                  {pill}
                </span>
              ))}
=======
// ─── Products (PIM) ───────────────────────────────────────────────────────────
function ProductsSection() {
  const [localProducts, setLocalProducts] = useState<ProductRecord[]>([...initialProducts]);
  const [selectedSku, setSelectedSku] = useState(initialProducts[0].sku);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<ProductRecord>({ ...initialProducts[0] });
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
>>>>>>> f2a3efe (Optimize for Vercel: server-side Magento data, PIM redesign, merge conflict fixes)
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

<<<<<<< HEAD
          <div className="grid w-full gap-4 sm:grid-cols-2 lg:max-w-xl">
            {taxonomyMetrics.map((metric) => (
              <MetricCard key={metric.label} label={metric.label} value={metric.count.toLocaleString()} detail={metric.trend} />
=======
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
function ImportSection() {
  // Fetch real Magento rows from the server-side API route
  const [importRows, setImportRows] = useState<RawImportRow[]>(rawImportRows);
  const [importLoading, setImportLoading] = useState(true);

  useEffect(() => {
    fetch('/api/import-rows?limit=200')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { rows: RawImportRow[] }) => { if (data.rows?.length) setImportRows(data.rows); })
      .catch(() => {})
      .finally(() => setImportLoading(false));
  }, []);

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
                  onClick={() => setCommitted(true)}
                  className="mt-3 w-full rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white hover:bg-violet-400"
                >
                  Commit {approvedCount} rows to import
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
                <p className="text-xs text-slate-400 mb-3">In production these would be written to Supabase now.</p>
                <button
                  onClick={() => { setCommitted(false); setDecisions({}); setBatchNote(''); }}
                  className="text-xs text-emerald-300 underline hover:text-emerald-200"
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
>>>>>>> f2a3efe (Optimize for Vercel: server-side Magento data, PIM redesign, merge conflict fixes)
            ))}
          </div>

<<<<<<< HEAD
      <section className="panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-white">Choose a workspace</p>
            <p className="mt-1 text-sm text-slate-400">Open the part of the frontend you need right now.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setActiveWorkspace(workspace.id)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  activeWorkspace === workspace.id
                    ? 'border-violet-400/50 bg-violet-500/20 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {workspace.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeWorkspace === 'overview' && (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Launch right now"
                title="Professional setup in four simple steps"
                body="This workspace is designed for quick onboarding: install once, run the app, verify readiness, then move into catalog or import review."
              />
              <div className="mt-6 rounded-3xl border border-violet-400/30 bg-violet-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-violet-200">Recommended command</p>
                <code className="mt-3 block overflow-x-auto rounded-2xl bg-slate-950/70 px-4 py-3 text-sm text-violet-100">
                  npm install && npm run dev
                </code>
                <p className="mt-3 text-sm text-slate-300">The dev server binds to <span className="font-medium text-white">0.0.0.0:3000</span>, so you can access it locally, through a forwarded port, or in a remote workspace.</p>
              </div>
              <div className="mt-6">
                <DetailList items={onboardingSteps} />
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Workspace guide"
                title="What each area is for"
                body="Use the navigation above as a guided workflow instead of one long dashboard."
              />
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {workspaceHighlights.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-medium text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Current system health"
                title="Readiness at a glance"
                body="Before connecting live reads, you can already validate app setup, sample content, and environment coverage."
              />
              <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                <MetricCard label="Ready products" value={String(products.length)} detail="Available sample rows in the catalog workspace." />
                <MetricCard label="Import rows" value={String(batchResult.summary.totalRows)} detail="Preview rows flowing through self-healing checks." />
                <MetricCard label="Taxonomy countries" value={String(taxonomyCountries.length)} detail="Visible country or market records loaded into the audit view." />
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Environment readiness"
                title="Connection and credential status"
                body="These checks help a new operator understand what is already configured and what still needs local secrets."
              />
              <div className="mt-6 space-y-4 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-white">Supabase URL</span>
                    <StatusPill tone={supabaseReadiness.hasUrl ? 'good' : 'warn'}>{supabaseReadiness.hasUrl ? 'Configured' : 'Missing'}</StatusPill>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-white">Publishable key</span>
                    <StatusPill tone={supabaseReadiness.hasPublishableKey ? 'good' : 'warn'}>{supabaseReadiness.hasPublishableKey ? 'Configured' : 'Missing'}</StatusPill>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-white">Database password in env</span>
                    <StatusPill tone={supabaseReadiness.hasDatabasePassword ? 'good' : 'warn'}>{supabaseReadiness.hasDatabasePassword ? 'Ready' : 'Template only'}</StatusPill>
                  </div>
                </div>
                <div className="rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4 text-violet-100">
                  Professional recommendation: keep the real database password only in <code>.env.local</code> and use the publishable key for frontend-safe reads.
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === 'catalog' && (
        <section className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Catalog workspace"
              title="Browse the product library"
              body="Pick any row to inspect its flavor structure, validation results, and export-facing identity."
            />
            <div className="mt-6 space-y-3">
              {products.map((product) => {
                const isSelected = product.sku === selectedProduct.sku;
                return (
                  <button
                    key={product.sku}
                    type="button"
                    onClick={() => setSelectedSku(product.sku)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-violet-400/40 bg-violet-500/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{product.name}</p>
                        <p className="mt-1 text-sm text-slate-400">{product.grape} · {product.region} · {product.style}</p>
                      </div>
                      <StatusPill tone={product.status === 'Ready' ? 'good' : product.status === 'Needs review' ? 'warn' : 'neutral'}>
                        {product.status}
                      </StatusPill>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-white/10 px-3 py-1">{product.sku}</span>
                      <span className="rounded-full border border-white/10 px-3 py-1">{product.currency} {product.price}</span>
                      <span className="rounded-full border border-white/10 px-3 py-1">Confidence {calculateConfidence(product).toFixed(1)}/5</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Selected product"
                title={selectedProduct.name}
                body="This panel updates as you choose products from the library list."
              />
              <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="h-[280px]">
                    <SimpleRadar values={radarData} />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Category', value: selectedProduct.category },
                      { label: 'Type', value: selectedProduct.type },
                      { label: 'Country', value: selectedProduct.country ?? 'Unknown' },
                      { label: 'Oak score', value: `${selectedProduct.oak}/5` }
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                        <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-medium text-white">Pairing logic</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...samplePairing.protein, ...samplePairing.cuisine].map((item) => (
                        <span key={item} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-100">
                          {item}
                        </span>
                      ))}
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-300">{samplePairing.logic}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="panel p-6">
                <CardHeader
                  eyebrow="Render safety"
                  title="Validation before UI and export"
                  body="These checks confirm the selected product will render safely and remain usable downstream."
                />
                <div className="mt-6 space-y-3">
                  {renderChecks.map((check) => (
                    <div key={check.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">{check.label}</span>
                        <StatusPill tone={check.status === 'pass' ? 'good' : 'warn'}>{check.status}</StatusPill>
                      </div>
                      <p className="mt-2">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel p-6">
                <CardHeader
                  eyebrow="Confidence rationale"
                  title="Why this product scores the way it does"
                  body="A more professional review experience should explain confidence, not just show a number."
                />
                <div className="mt-6 space-y-3">
                  {confidenceSignals.map((signal) => (
                    <div key={signal.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">{signal.label}</span>
                        <StatusPill tone={signal.status === 'strong' ? 'good' : 'warn'}>{signal.status === 'strong' ? 'Matched' : 'Review'}</StatusPill>
                      </div>
                      <p className="mt-2">{signal.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel p-6">
                <CardHeader
                  eyebrow="Flavor distribution"
                  title="Taste wheel intensity"
                  body="A lightweight frontend-friendly chart alternative without extra charting dependencies."
                />
                <div className="mt-6 space-y-4">
                  {flavorWheel.map((item) => (
                    <div key={item.segment}>
                      <div className="flex items-center justify-between text-sm text-slate-300">
                        <span>{item.segment}</span>
                        <span>{item.value.toFixed(1)}/5</span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-500 to-cyan-400" style={{ width: `${(item.value / 5) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === 'import' && (
        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Import studio"
              title="Upload Magento export and stage the item library"
              body="Upload your Magento present/export file here to clean, validate, and stage rows before they are promoted into the product library and database."
            />
            <div className="mt-6 rounded-3xl border border-dashed border-violet-400/40 bg-violet-500/10 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-violet-200">Magento file upload</p>
                  <p className="mt-2 max-w-2xl text-sm text-slate-200">
                    Use a CSV export from Magento or your working product sheet. The app will map supported columns, normalize values, run self-healing validation, and stage ready rows for the full product library.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-violet-300/40 bg-slate-950/60 px-5 py-3 text-sm font-medium text-violet-100 transition hover:border-violet-200/60 hover:text-white">
                  Choose CSV file
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleMagentoFileUpload} />
                </label>
              </div>
              <div className="mt-5">
                <DetailList items={[...uploadFieldGuide]} />
              </div>
              {uploadError && (
                <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/15 p-4 text-sm text-rose-100">{uploadError}</div>
              )}
              {uploadedDataset && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    <p className="font-medium text-white">Uploaded source</p>
                    <p className="mt-2">{uploadedDataset.sourceFile}</p>
                    <p className="mt-2 text-slate-400">
                      {uploadedDataset.mappedRowCount} mapped rows from {uploadedDataset.originalRowCount} file rows.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    <p className="font-medium text-white">Mapping review</p>
                    <p className="mt-2">
                      Missing required fields: {uploadedDataset.missingRequiredFields.length > 0 ? uploadedDataset.missingRequiredFields.join(', ') : 'None'}
                    </p>
                    <p className="mt-2">
                      Unmapped headers: {uploadedDataset.unmappedHeaders.length > 0 ? uploadedDataset.unmappedHeaders.join(', ') : 'None'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-4">
              <MetricCard label="Rows previewed" value={String(activeBatchResult.summary.totalRows)} detail={uploadedDataset ? 'Rows currently staged from the uploaded Magento file.' : 'Rows currently in the sample import set.'} />
              <MetricCard label="Auto-corrected" value={String(activeBatchResult.summary.autoCorrected)} detail="Rows that received at least one automated repair." />
              <MetricCard label="Ready to import" value={String(activeBatchResult.summary.readyToImport)} detail="Rows with no hard validation errors." />
              <MetricCard label="Blocked" value={String(activeBatchResult.summary.blocked)} detail="Rows that still require spreadsheet cleanup." />
            </div>
            <div className="mt-6 space-y-3">
              {activeBatchResult.rows.map((row, index) => {
                const selected = index === selectedImportIndex;
                const hasError = row.issues.some((issue) => issue.severity === 'error');
                return (
                  <button
                    key={`${row.original.name}-${index}`}
                    type="button"
                    onClick={() => setSelectedImportIndex(index)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-violet-400/40 bg-violet-500/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{row.normalized.name || 'Unnamed row'}</p>
                        <p className="mt-1 text-sm text-slate-400">{row.normalized.sku || 'Missing SKU'} · {row.normalized.region || 'Unknown region'} · {row.normalized.style || 'Unknown style'}</p>
                      </div>
                      <StatusPill tone={hasError ? 'bad' : 'good'}>{hasError ? 'Blocked' : 'Ready'}</StatusPill>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-full border border-white/10 px-3 py-1">Corrections {row.corrections.length}</span>
                      <span className="rounded-full border border-white/10 px-3 py-1">Issues {row.issues.length}</span>
                      <span className="rounded-full border border-white/10 px-3 py-1">Confidence {row.confidence.toFixed(1)}/5</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Selected row detail"
                title={selectedImportRow.normalized.name || 'Import row review'}
                body="Review the exact self-healing output before you approve or fix the original spreadsheet row."
              />
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Normalized SKU', value: selectedImportRow.normalized.sku || 'Missing' },
                  { label: 'Country', value: selectedImportRow.normalized.country ?? 'Unmapped' },
                  { label: 'Currency', value: selectedImportRow.normalized.currency },
                  { label: 'Confidence', value: `${selectedImportRow.confidence.toFixed(1)}/5` }
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4 text-sm text-violet-100">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={selectedIssueSummary.errors > 0 ? 'bad' : 'good'}>Errors {selectedIssueSummary.errors}</StatusPill>
                  <StatusPill tone={selectedIssueSummary.warnings > 0 ? 'warn' : 'good'}>Warnings {selectedIssueSummary.warnings}</StatusPill>
                  <StatusPill tone="neutral">Info {selectedIssueSummary.infos}</StatusPill>
                </div>
                <p className="mt-3">{selectedIssueSummary.recommendation}</p>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-medium text-white">Corrections</p>
                  <div className="mt-3 space-y-2">
                    {selectedImportRow.corrections.map((correction) => (
                      <div key={`${correction.field}-${correction.to}`} className="rounded-2xl bg-violet-500/10 px-3 py-3 text-sm text-violet-100">
                        <p><span className="font-medium">{correction.field}:</span> {correction.from || '∅'} → {correction.to}</p>
                        <p className="mt-1 text-xs text-violet-200/80">{correction.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-medium text-white">Issues</p>
                  <div className="mt-3 space-y-2">
                    {selectedImportRow.issues.map((issue, issueIndex) => (
                      <div
                        key={`${issue.field}-${issueIndex}`}
                        className={`rounded-2xl px-3 py-3 text-sm ${
                          issue.severity === 'error'
                            ? 'bg-rose-500/15 text-rose-100'
                            : issue.severity === 'warning'
                              ? 'bg-amber-500/15 text-amber-100'
                              : 'bg-emerald-500/15 text-emerald-100'
                        }`}
                      >
                        <p><span className="font-medium">{issue.field}:</span> {issue.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Library build"
                title="Rows staged for the full item library"
                body="This is the set of cleaned rows that can move into your app library and then into Supabase once you approve the import flow."
              />
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <MetricCard label="Library-ready rows" value={String(stagedLibraryRows.length)} detail="Rows currently safe to stage into the product library." />
                <MetricCard label="Needs manual cleanup" value={String(activeBatchResult.summary.blocked)} detail="Rows that should be fixed before insertion." />
                <MetricCard label="Source mode" value={uploadedDataset ? 'Magento upload' : 'Sample data'} detail="Shows whether the current preview comes from your file or the seeded demo set." />
              </div>
              <div className="mt-6 space-y-3">
                {stagedLibraryRows.slice(0, 5).map((row) => (
                  <div key={`${row.sku}-${row.name}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{row.name}</p>
                        <p className="mt-1 text-sm text-slate-400">{row.sku} · {row.grape || 'Unknown grape'} · {row.region || 'Unknown region'}</p>
                      </div>
                      <StatusPill tone="good">Ready for library</StatusPill>
                    </div>
                  </div>
                ))}
                {stagedLibraryRows.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    No rows are library-ready yet. Upload a Magento CSV and fix blocking issues to populate this section.
                  </div>
                )}
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Excel process"
                title="How to use your existing spreadsheet"
                body="If the workbook cannot be uploaded here, this frontend still gives you the exact prep and validation flow to follow locally."
              />
              <div className="mt-6">
                <DetailList items={excelImportSteps} />
              </div>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === 'taxonomy' && (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Taxonomy control"
              title="Workbook and registry review"
              body="Track the spreadsheet structure, surface issues, and keep geography / naming rules visible to operators before import."
            />
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {taxonomySheets.map((sheet) => (
                <div key={sheet.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-medium text-white">{sheet.name}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{sheet.purpose}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Audit findings"
                title="Cleanup recommendations"
                body="These are the specific consistency issues already identified from the visible workbook structure."
              />
              <div className="mt-6 space-y-3">
                {taxonomyAuditIssues.map((issue) => (
                  <div key={issue.area} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{issue.area}</span>
                      <StatusPill tone={issue.severity === 'warning' ? 'warn' : 'good'}>{issue.severity}</StatusPill>
                    </div>
                    <p className="mt-2">{issue.message}</p>
                    <p className="mt-2 text-slate-400">{issue.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Country registry"
                title="Visible countries and markets"
                body="Use this as the current canonical list until the full workbook is imported directly."
              />
              <div className="mt-6 max-h-[420px] overflow-auto rounded-2xl border border-white/10 bg-white/5">
                <div className="grid grid-cols-[70px_1fr_100px] border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-400">
                  <span>ID</span>
                  <span>Name</span>
                  <span>ISO</span>
                </div>
                {taxonomyCountries.map((country) => (
                  <div key={country.id} className="grid grid-cols-[70px_1fr_100px] border-b border-white/10 px-4 py-3 text-sm text-slate-300 last:border-b-0">
                    <span>{country.id}</span>
                    <span>{country.name}</span>
                    <span>{country.iso}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Standardization rules"
                title="Professional taxonomy guardrails"
                body="These rules make the shared workbook safer for batch automation and future integrations."
              />
              <div className="mt-6">
                <DetailList items={taxonomyRules} />
              </div>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === 'launch' && (
        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Launch frontend"
                title="Newbie-friendly terminal setup"
                body="Use these exact steps if you just want the app running with the least friction."
              />
              <div className="mt-6">
                <DetailList
                  items={[
                    'Open the repository root in your terminal.',
                    'Run cp .env.example .env.local to create your local environment file.',
                    'Run npm install once to install dependencies.',
                    'Run npm run dev and open http://localhost:3000.'
                  ]}
                />
              </div>
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white">Copy-paste command block</p>
                <code className="mt-3 block overflow-x-auto rounded-2xl bg-slate-950/70 px-4 py-3 text-sm text-violet-100">
                  cp .env.example .env.local{'\n'}npm install{'\n'}npm run dev
                </code>
              </div>
              <div className="mt-6 rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4 text-sm text-violet-100">
                If package installation is blocked in your environment, use the fallback preview at <code>python3 scripts/serve_frontend.py</code> and open <code>/preview/</code>.
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="VS Code path"
                title="Open it from tasks and Run & Debug"
                body="If you prefer buttons instead of commands, the workspace already includes helper tasks."
              />
              <div className="mt-6">
                <DetailList
                  items={[
                    'Run the task WineNow: install dependencies.',
                    'Run the task WineNow: dev server.',
                    'Open Run and Debug and choose WineNow: launch frontend.',
                    'If you are in a remote workspace, forward port 3000.'
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="panel p-6">
              <CardHeader
                eyebrow="Supabase context"
                title="Environment values already prepared"
                body="The frontend runs on local sample data right away, and these values are ready when you want to connect real reads next."
              />
              <div className="mt-6 space-y-4 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Project URL</p>
                  <p className="mt-2 break-all text-white">{supabaseProject.url}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Publishable key</p>
                  <p className="mt-2 break-all text-white">{supabaseProject.publishableKey}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Database URL template</p>
                  <p className="mt-2 break-all text-white">{supabaseProject.databaseUrl}</p>
                </div>
              </div>
            </div>

            <div className="panel p-6">
              <CardHeader
                eyebrow="Operational notes"
                title="What makes this process more production-ready"
                body="These reminders help the app feel more like a real operator tool instead of a demo page."
              />
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {productLibraryStats.map((item) => (
                  <MetricCard key={item.label} label={item.label} value={item.value.toLocaleString()} detail="Current library stat placeholder." />
                ))}
              </div>
              <div className="mt-6">
                <DetailList
                  items={[
                    'Keep the real password only in .env.local or your deployment secret store.',
                    'Apply the schema before wiring live product reads.',
                    'Use the import studio to review warnings before promoting rows to Ready.'
                  ]}
                />
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
=======
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

  const sectionTitles: Record<Section, string> = {
    overview: 'Overview',
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
            <span>{rawImportRows.length} import rows</span>
            <span className="h-3.5 w-px bg-white/10" />
            <span>{initialProducts.length} products</span>
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
          {activeSection === 'products' && <ProductsSection />}
          {activeSection === 'import' && <ImportSection />}
          {activeSection === 'taxonomy' && <TaxonomySection />}
          {activeSection === 'settings' && <SettingsSection />}
        </main>
      </div>
    </div>
>>>>>>> f2a3efe (Optimize for Vercel: server-side Magento data, PIM redesign, merge conflict fixes)
  );
}
