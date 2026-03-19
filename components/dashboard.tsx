'use client';

import { DatabaseZap, FileUp, Filter, Sparkles, Tags } from 'lucide-react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import {
  flavorWheel,
  productLibraryStats,
  products,
  samplePairing,
  taxonomyMetrics,
  uploadPipeline
} from '@/lib/data';
import { runPipelinePreview } from '@/lib/batch-pipeline';

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
const pipelinePreview = runPipelinePreview(products);

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
                Premium product intelligence for 10,000+ wine and liquor SKUs.
              </h1>
              <p className="max-w-3xl text-lg text-slate-300">
                Manage taxonomy, visualize flavor DNA, enrich missing tasting notes, and orchestrate bulk imports from a single modern control center.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-200">
              {['Spreadsheet editing', 'AI enrichment', 'Flavor radar + wheel', 'Batch validation', 'Magento-ready export'].map((pill) => (
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

      <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="panel p-6">
          <CardHeader
            eyebrow="Product table"
            title="Spreadsheet-like library management"
            body="Searchable catalog rows provide inline SKU context for pricing, taxonomy, confidence scoring, and AI enrichment readiness."
          />
          <div className="mt-6 overflow-hidden rounded-3xl border border-white/10">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_100px_120px] gap-3 bg-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-400">
              <span>Name</span>
              <span>Grape / base</span>
              <span>Region</span>
              <span>Style</span>
              <span>Price</span>
              <span>Status</span>
            </div>
            {products.map((product) => {
              const confidence = calculateConfidence(product);
              return (
                <div
                  key={product.sku}
                  className="grid grid-cols-[1.2fr_1fr_1fr_1fr_100px_120px] gap-3 border-t border-white/10 px-4 py-4 text-sm text-slate-100"
                >
                  <div>
                    <p className="font-medium text-white">{product.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{product.sku}</p>
                  </div>
                  <div className="text-slate-300">{product.grape}</div>
                  <div className="text-slate-300">{product.region}</div>
                  <div className="text-slate-300">{product.style}</div>
                  <div className="text-slate-300">${product.price}</div>
                  <div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
                      {product.status} · {confidence.toFixed(1)}/5
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Flavor visualization"
              title="Radar chart + taste matrix"
              body="Flavor attributes are generated from the DNA engine and rendered for merchandisers, sommeliers, and pricing analysts."
            />
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] xl:grid-cols-1">
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

          <div className="panel p-6">
            <CardHeader
              eyebrow="Product detail"
              title={focusProduct.name}
              body="Pairing guidance, structure, and similar-cluster logic stay close to the editable product record."
            />
            <div className="mt-6 grid gap-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-violet-200">Recommended pairings</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...samplePairing.protein, ...samplePairing.cuisine].map((item) => (
                    <span key={item} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-100">
                      {item}
                    </span>
                  ))}
                </div>
                <p className="mt-4 leading-6">{samplePairing.logic}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: 'Body', value: focusProfile.body },
                  { label: 'Acidity', value: focusProfile.acidity },
                  { label: 'Intensity', value: focusProfile.intensity }
                ].map((metric) => (
                  <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{metric.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{metric.value.toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel p-6">
          <CardHeader
            eyebrow="Upload center"
            title="Batch ingestion pipeline"
            body="Bulk CSV/XLSX imports are validated, normalized, enriched, and exported with confidence tracking before publishing."
          />
          <div className="mt-6 grid gap-4">
            <div className="rounded-3xl border border-dashed border-violet-400/40 bg-violet-500/10 p-5 text-sm text-violet-100">
              <div className="flex items-center gap-3 font-medium text-white">
                <FileUp className="h-5 w-5 text-violet-300" />
                Drag and drop batch files for preview
              </div>
              <p className="mt-2 text-violet-100/80">
                Expected columns: SKU, name, category, grape, style, region, status, price, cost price, currency, and 0–5 sensory fields.
              </p>
            </div>
            <div className="grid gap-3">
              {pipelinePreview.map((stage) => (
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
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel p-6">
            <CardHeader
              eyebrow="Config panel"
              title="Taxonomy and mapping control"
              body="Centralized configuration keeps grape DNA, regional modifiers, and scoring logic consistent across every imported row."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                { icon: Tags, title: 'Grape DNA', text: 'Base body, acidity, tannin, and fruit structure by variety.' },
                { icon: Filter, title: 'Style DNA', text: 'Override structural logic with finish, sweetness, and intensity tendencies.' },
                { icon: DatabaseZap, title: 'Region modifiers', text: 'Terroir adjustments calibrate style outputs before AI enrichment.' }
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <item.icon className="h-5 w-5 text-violet-300" />
                  <p className="mt-3 font-medium text-white">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-6">
            <CardHeader
              eyebrow="Library + export"
              title="Search, segment, and distribute"
              body="Merchandisers can locate product families quickly, apply filters, and push approved subsets into CSV or XLSX exports."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {productLibraryStats.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-400">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                {uploadPipeline.map((step) => (
                  <span key={step} className="rounded-full border border-white/10 px-3 py-1">
                    {step}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
