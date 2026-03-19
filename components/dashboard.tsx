'use client';

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
];

function CardHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.3em] text-violet-300">{eyebrow}</p>
      <div>
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">{body}</p>
      </div>
    </div>
  );
}

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
            </div>
          </div>

          <div className="grid w-full gap-4 sm:grid-cols-2 lg:max-w-xl">
            {taxonomyMetrics.map((metric) => (
              <MetricCard key={metric.label} label={metric.label} value={metric.count.toLocaleString()} detail={metric.trend} />
            ))}
          </div>
        </div>
      </section>

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
  );
}
