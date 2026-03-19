'use client';

import { AlertTriangle, CheckCircle2, DatabaseZap, FileSpreadsheet, HardDriveUpload, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import { runBatchProcessing } from '@/lib/batch-pipeline';
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

const focusProduct = products[0];
const focusProfile = buildFlavorProfile(focusProduct);
const radarData = [
  { metric: 'Body', value: focusProfile.body },
  { metric: 'Acidity', value: focusProfile.acidity },
  { metric: 'Tannin', value: focusProfile.tannin },
  { metric: 'Sweetness', value: focusProfile.sweetness },
  { metric: 'Intensity', value: focusProfile.intensity },
  { metric: 'Finish', value: focusProfile.finish }
];
const batchResult = runBatchProcessing(rawImportRows);
const renderChecks = validateRenderedProduct(focusProduct, focusProfile);
const supabaseReadiness = getSupabaseReadiness();

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

export function Dashboard() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8 lg:px-8">
      <section className="panel overflow-hidden p-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-100">
              <Sparkles className="h-4 w-4" />
              WineNow Flavor Intelligence System
            </div>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                Global taxonomy-aware batch processing with self-healing validation.
              </h1>
              <p className="max-w-3xl text-lg text-slate-300">
                The workspace now studies the supplied taxonomy workbook, flags inconsistencies, repairs import rows automatically, and validates results before they reach rendering or export.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-200">
              {['Global taxonomy audit', 'Self-healing import preview', 'Render-safe validation', 'Supabase-ready config', 'Magento-ready handoff'].map((pill) => (
                <span key={pill} className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div className="grid w-full gap-4 sm:grid-cols-2 lg:max-w-xl">
            {taxonomyMetrics.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="metric-label">{metric.label}</p>
                <p className="metric-value mt-3">{metric.count.toLocaleString()}</p>
                <p className="mt-2 text-sm text-slate-400">{metric.trend}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel p-6">
          <CardHeader
            eyebrow="Supabase integration"
            title="Project wiring for your provided backend"
            body="The app now carries environment-based configuration for the provided Supabase project, while keeping the database password as a local-only secret."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Project ref', value: supabaseProject.projectRef },
              { label: 'URL ready', value: supabaseReadiness.hasUrl ? 'Yes' : 'No' },
              { label: 'Publishable key ready', value: supabaseReadiness.hasPublishableKey ? 'Yes' : 'No' }
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-white break-all">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p className="font-medium text-white">Project URL</p>
              <p className="mt-2 break-all">{supabaseProject.url}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p className="font-medium text-white">Database connection template</p>
              <p className="mt-2 break-all">{supabaseProject.databaseUrl}</p>
              <p className="mt-2 text-slate-400">Keep the real password only in <code>.env.local</code> or your deployment secret store.</p>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <CardHeader
            eyebrow="Operational guidance"
            title="What to do next in Supabase"
            body="The project is ready for schema application and frontend-safe reads with the publishable key, but production writes and privileged operations should stay behind protected backend routes or edge functions."
          />
          <div className="mt-6 space-y-3">
            {[
              'Copy .env.example to .env.local and keep the provided URL + publishable key.',
              'Apply supabase/schema.sql through the SQL Editor or with psql using SUPABASE_DB_URL.',
              'Enable read policies for tables the UI should query with the publishable key.',
              'Keep the database password and any future service-role key out of git and only in secret storage.'
            ].map((item, index) => (
              <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-100">{index + 1}</div>
                <p>{item}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4 text-sm text-violet-100">
              <div className="flex items-center gap-2 font-medium text-white">
                <HardDriveUpload className="h-4 w-4 text-violet-200" />
                Safe credential handling
              </div>
              <p className="mt-2">The publishable key is frontend-safe. The direct connection string stays template-only until you inject the real password locally.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="panel p-6">
          <CardHeader
            eyebrow="Taxonomy source review"
            title="Global taxonomy workbook audit"
            body="Using the visible spreadsheet structure as the source of truth, the dashboard tracks the discovered sheet layout, country registry, and issues that should be cleaned up before ingestion."
          />
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3 text-white">
                <FileSpreadsheet className="h-5 w-5 text-violet-300" />
                <p className="font-medium">Visible workbook tabs</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {taxonomySheets.map((sheet) => (
                  <div key={sheet.name} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <p className="font-medium text-white">{sheet.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{sheet.purpose}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Visible countries</p>
                <p className="mt-2 text-3xl font-semibold text-white">{taxonomyCountries.length}</p>
                <p className="mt-2 text-sm text-slate-400">Country/market entries captured from the shared workbook’s visible countries sheet.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Audit findings</p>
                <div className="mt-4 space-y-3">
                  {taxonomyAuditIssues.map((issue) => (
                    <div key={issue.area} className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-slate-300">
                      <div className="flex items-center gap-2 text-white">
                        {issue.severity === 'warning' ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                        <span className="font-medium">{issue.area}</span>
                      </div>
                      <p className="mt-2">{issue.message}</p>
                      <p className="mt-2 text-slate-400">{issue.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="panel p-6">
          <CardHeader
            eyebrow="Render validation"
            title="Check results before rendering"
            body="Every product detail card can be checked for chart safety, identity completeness, and export-safe commercial fields before the UI consumes it."
          />
          <div className="mt-6 space-y-4">
            <div className="h-72 rounded-3xl border border-white/10 bg-white/5 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="rgba(255,255,255,0.18)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: '#CBD5E1', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 5]} tick={false} axisLine={false} />
                  <Radar dataKey="value" stroke="#A78BFA" fill="#7C3AED" fillOpacity={0.45} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {renderChecks.map((check) => (
              <div key={check.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="flex items-center gap-3 text-white">
                  {check.status === 'pass' ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
                  <span className="font-medium">{check.label}</span>
                </div>
                <p className="mt-2">{check.detail}</p>
              </div>
            ))}
            <div className="grid gap-3">
              {flavorWheel.map((item) => (
                <div key={item.segment} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>{item.segment}</span>
                    <span>{item.value.toFixed(1)}/5</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-500" style={{ width: `${(item.value / 5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="panel p-6">
          <CardHeader
            eyebrow="Self-healing import"
            title="Batch preview with automated fixes"
            body="The import process trims SKUs, maps aliases, infers countries from known regions, clamps sensory scores to 0–5, and blocks only rows that still fail hard validation."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            {[
              { label: 'Rows previewed', value: batchResult.summary.totalRows },
              { label: 'Auto-corrected', value: batchResult.summary.autoCorrected },
              { label: 'Ready to import', value: batchResult.summary.readyToImport },
              { label: 'Blocked', value: batchResult.summary.blocked }
            ].map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold text-white">{metric.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3">
            {batchResult.stages.map((stage) => (
              <div key={stage.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{stage.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{stage.outcome}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                      stage.status === 'complete'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : stage.status === 'attention'
                          ? 'bg-amber-500/15 text-amber-200'
                          : 'bg-slate-500/15 text-slate-300'
                    }`}
                  >
                    {stage.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 overflow-hidden rounded-3xl border border-white/10">
            <div className="grid grid-cols-[110px_1.3fr_1.4fr_1.2fr] gap-3 bg-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-400">
              <span>SKU</span>
              <span>Normalization</span>
              <span>Corrections</span>
              <span>Issues</span>
            </div>
            {batchResult.rows.map((row, index) => (
              <div key={`${row.original.name}-${index}`} className="grid grid-cols-[110px_1.3fr_1.4fr_1.2fr] gap-3 border-t border-white/10 px-4 py-4 text-sm">
                <div className="text-slate-200">{row.normalized.sku || 'Missing'}</div>
                <div className="space-y-1 text-slate-300">
                  <p>{row.normalized.grape} · {row.normalized.region}</p>
                  <p>{row.normalized.style} · {row.normalized.country ?? 'Unknown country'}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Confidence {row.confidence.toFixed(1)}/5</p>
                </div>
                <div className="space-y-2">
                  {row.corrections.map((correction) => (
                    <div key={`${row.original.name}-${correction.field}-${correction.to}`} className="rounded-2xl bg-violet-500/10 px-3 py-2 text-xs text-violet-100">
                      <span className="font-medium">{correction.field}:</span> {correction.from || '∅'} → {correction.to}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {row.issues.map((issue, issueIndex) => (
                    <div
                      key={`${row.original.name}-${issue.field}-${issueIndex}`}
                      className={`rounded-2xl px-3 py-2 text-xs ${
                        issue.severity === 'error'
                          ? 'bg-rose-500/15 text-rose-100'
                          : issue.severity === 'warning'
                            ? 'bg-amber-500/15 text-amber-100'
                            : 'bg-emerald-500/15 text-emerald-100'
                      }`}
                    >
                      <span className="font-medium">{issue.field}:</span> {issue.message}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Product library"
              title="Spreadsheet-like catalog confidence"
              body="Published products continue to show merchandising identity, canonical taxonomy values, and current confidence scoring."
            />
            <div className="mt-6 space-y-3">
              {products.map((product) => (
                <div key={product.sku} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-white">{product.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{product.grape} · {product.region} · {product.style}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                      {product.status} · {calculateConfidence(product).toFixed(1)}/5
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <CardHeader
              eyebrow="Excel process"
              title="How to prepare the file you already have"
              body="If you cannot upload the workbook here, follow this process locally so the importer can self-heal the easy issues and isolate the hard ones."
            />
            <div className="mt-6 space-y-3">
              {excelImportSteps.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-100">{index + 1}</div>
                  <p>{step}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4 text-sm text-violet-100">
              <div className="flex items-center gap-2 font-medium text-white">
                <Wand2 className="h-4 w-4 text-violet-200" />
                Self-healing rules applied in preview
              </div>
              <p className="mt-2">Alias normalization, SKU trimming, uppercase currency, country inference from region, score clamping, and confidence-based review flags.</p>
            </div>
          </div>

          <div className="panel p-6">
            <CardHeader
              eyebrow="Pairing + export"
              title={focusProduct.name}
              body="Flavor output, pairing context, and library distribution remain available after validation passes."
            />
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap gap-2">
                {[...samplePairing.protein, ...samplePairing.cuisine].map((item) => (
                  <span key={item} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-100">
                    {item}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{samplePairing.logic}</p>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {productLibraryStats.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-400">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-300">
              {['CSV export', 'XLSX export', 'Magento-ready mapping', 'Low-confidence review queue'].map((item) => (
                <span key={item} className="rounded-full border border-white/10 px-3 py-1">{item}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
